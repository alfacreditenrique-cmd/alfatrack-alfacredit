/* AlfaTrack Google Sheets Bridge (Zero-dependency Google Sheets API v4 + Drive v3 via Service Account JWT RS256) */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('./core.js');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

let tokenCache = { clientEmail: '', accessToken: '', expiresAt: 0 };
let spreadsheetIdCache = { name: '', id: '' };
let customTransport = null; // Injectable test double: async ({ op, prospecto, row, range, values, config }) => ({ ok, sheetRow, ... })
let appendLock = Promise.resolve();

function withAppendLock(fn) {
  const next = appendLock.then(fn, fn);
  appendLock = next.catch(() => {});
  return next;
}

function setTransport(fn) {
  customTransport = typeof fn === 'function' ? fn : null;
}

function resetCaches() {
  tokenCache = { clientEmail: '', accessToken: '', expiresAt: 0 };
  spreadsheetIdCache = { name: '', id: '' };
}

function sanitizeSheetText(val, fallback) {
  const s = String(val === undefined || val === null ? '' : val).replace(/[\r\n]+/g, ' ').trim();
  if (!s) return fallback !== undefined ? fallback : '';
  // Guard against spreadsheet formula injection under USER_ENTERED while preserving literal '-' placeholder
  if (s !== '-' && /^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function parseServiceAccountJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && obj.client_email && obj.private_key) return obj;
  } catch {}
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    if (obj && obj.client_email && obj.private_key) return obj;
  } catch {}
  return null;
}

function loadServiceAccount() {
  // 1. Full JSON or Base64 JSON in env var (recommended for Vercel)
  const fromJson = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (fromJson) return { creds: fromJson, source: 'env:GOOGLE_SERVICE_ACCOUNT_JSON' };

  // 2. Separate client_email + private_key env vars
  const envEmail = (process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const envKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (envEmail && envKey) {
    return {
      creds: { client_email: envEmail, private_key: envKey, token_uri: 'https://oauth2.googleapis.com/token' },
      source: 'env:GOOGLE_CLIENT_EMAIL',
    };
  }

  // 3. Explicit credentials file path or local Call Center sibling path (non-Vercel local production only)
  if (!process.env.VERCEL) {
    const candidates = [];
    if (process.env.GOOGLE_CREDENTIALS_PATH) candidates.push(process.env.GOOGLE_CREDENTIALS_PATH);
    candidates.push(path.join(__dirname, '..', 'Call Center', 'credenciales.json'));
    for (const fp of candidates) {
      try {
        if (fp && fs.existsSync(fp)) {
          const parsed = parseServiceAccountJson(fs.readFileSync(fp, 'utf8'));
          if (parsed) return { creds: parsed, source: 'file' };
        }
      } catch {}
    }
  }
  return { creds: null, source: 'none' };
}

function getBridgeConfig() {
  const mode = (process.env.ALFATRACK_SHEETS_MODE || '').trim().toLowerCase();
  const dbMode = (process.env.ALFATRACK_DB_MODE || '').trim().toLowerCase();
  const spreadsheetName = (process.env.GOOGLE_SHEETS_NAME || 'base de datos').trim();
  const spreadsheetId = (process.env.GOOGLE_SHEETS_ID || '').trim();
  const tabName = (process.env.GOOGLE_SHEETS_TAB || 'Clientes').trim();
  const { creds, source } = loadServiceAccount();

  if (customTransport) {
    return {
      enabled: true,
      mode: 'mock',
      configured: true,
      spreadsheetName,
      spreadsheetId: spreadsheetId || 'mock-sheet-id',
      tabName,
      credsSource: 'mock-transport',
      clientEmail: 'mock@alfacredit.local',
      creds: null,
    };
  }

  if (mode === 'disabled' || (dbMode === 'local' && mode !== 'live')) {
    return {
      enabled: false,
      mode: mode || 'local-disabled',
      configured: Boolean(creds),
      spreadsheetName,
      spreadsheetId,
      tabName,
      credsSource: source,
      clientEmail: creds ? creds.client_email : '',
      creds: null,
    };
  }

  return {
    enabled: Boolean(creds),
    mode: creds ? 'live' : 'unconfigured',
    configured: Boolean(creds),
    spreadsheetName,
    spreadsheetId,
    tabName,
    credsSource: source,
    clientEmail: creds ? creds.client_email : '',
    creds,
  };
}

function getStatus() {
  const cfg = getBridgeConfig();
  return {
    enabled: cfg.enabled,
    configured: cfg.configured,
    mode: cfg.mode,
    spreadsheetName: cfg.spreadsheetName,
    spreadsheetIdConfigured: Boolean(cfg.spreadsheetId),
    tabName: cfg.tabName,
    credsSource: cfg.credsSource,
    clientEmail: cfg.clientEmail,
  };
}

function formatDateManagua(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  // Nicaragua is permanently UTC-6 (no DST)
  const ni = new Date(valid.getTime() - 6 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(ni.getUTCDate())}/${pad(ni.getUTCMonth() + 1)}/${ni.getUTCFullYear()} ${pad(ni.getUTCHours())}:${pad(ni.getUTCMinutes())}:${pad(ni.getUTCSeconds())}`;
}

function formatTelefonoSheet(tel, telSec) {
  const fmt = (t) => {
    const d = Core.soloDigitos(t);
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : String(t || '').trim();
  };
  const a = fmt(tel);
  const b = telSec ? fmt(telSec) : '';
  return b ? `${a} / ${b}` : a;
}

function formatMontoSheet(monto) {
  const n = Number(monto) || 0;
  if (!(n > 0)) return '-';
  return `C$ ${n.toLocaleString('en-US')}`;
}

function buildAppendRow(p) {
  const agente = sanitizeSheetText((p.cc && p.cc.agente) || 'Call Center', 'Call Center');
  const fecha = formatDateManagua(p.creado || new Date());
  const nombre = sanitizeSheetText(p.nombre, '');
  const tipoCredito = sanitizeSheetText(p.tipoCredito || 'NV(NUEVO)', 'NV(NUEVO)');
  const telefono = sanitizeSheetText(formatTelefonoSheet(p.telefono, p.telefonoSecundario), '');
  const direccion = sanitizeSheetText((p.cc && p.cc.direccionVisita) || p.direccion, '-');
  const negocio = sanitizeSheetText((p.cc && p.cc.rubro) || p.negocio, '-');
  const emailGerente = sanitizeSheetText(p.emailGerente || 'alfacreditenrique@gmail.com', 'alfacreditenrique@gmail.com');
  const sucursal = sanitizeSheetText(Core.sucursalParaSheet(p.sucursal), '');
  const monto = formatMontoSheet((p.cc && p.cc.monto) || p.monto);
  return [agente, fecha, nombre, tipoCredito, telefono, direccion, negocio, emailGerente, sucursal, monto];
}

function mapEstadoToSheetStatus(estado) {
  switch (estado) {
    case 'desembolsado': return 'Desembolsado';
    case 'descartado': return 'Denegado';
    case 'seguimiento': return 'Proceso';
    default: return 'Pendiente';
  }
}

function buildFollowUpRow(p, state) {
  const status = mapEstadoToSheetStatus(p.estado);
  const partesJust = [];
  if (p.estado === 'descartado' && p.motivoDescarte) {
    partesJust.push(p.motivoDescarte);
  } else if (p.gerencia && p.gerencia.instrucciones) {
    partesJust.push(p.gerencia.instrucciones);
  }
  const notasRecientes = (p.historial || []).filter((h) => h.accion === 'Nota agregada');
  if (notasRecientes.length) {
    const ultima = notasRecientes[notasRecientes.length - 1];
    if (ultima && ultima.detalle && !partesJust.includes(ultima.detalle)) {
      partesJust.push(`Nota (${ultima.usuario}): ${ultima.detalle}`);
    }
  }
  const justificacion = sanitizeSheetText(partesJust.join(' | ').slice(0, 450), '');

  const usuarios = (state && Array.isArray(state.usuarios)) ? state.usuarios : [];
  const findName = (id) => {
    const u = usuarios.find((x) => x.id === id);
    return u ? u.nombre : '';
  };
  const cols = [];
  if (p.asignadoPromotorNombre || p.asignadoPromotorId) {
    cols.push(p.asignadoPromotorNombre || findName(p.asignadoPromotorId));
  }
  if (p.gestorId) {
    const gName = findName(p.gestorId);
    if (gName && !cols.includes(gName)) cols.push(gName);
  }
  if (!cols.length && p.gerencia && p.gerencia.gerente) {
    cols.push(p.gerencia.gerente);
  }
  if (!cols.length && Array.isArray(p.historial) && p.historial.length) {
    const lastAction = [...p.historial].reverse().find((h) => h.rol && h.rol !== 'callcenter' && h.usuario);
    if (lastAction) cols.push(lastAction.usuario);
  }
  const colaborador = sanitizeSheetText(cols.filter(Boolean).join(' / '), '');
  const montoDes = p.estado === 'desembolsado' && p.desembolso && Number(p.desembolso.monto) > 0
    ? Number(p.desembolso.monto)
    : '';
  const fechaAct = formatDateManagua(p.actualizado || new Date());

  return [status, justificacion, colaborador, montoDes, fechaAct];
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signServiceAccountJwt(creds) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: creds.client_email,
    scope: SCOPES,
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = base64url(signer.sign(creds.private_key));
  return `${unsigned}.${sig}`;
}

async function fetchWithTimeout(url, opts, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(creds) {
  if (tokenCache.accessToken && tokenCache.clientEmail === creds.client_email && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  const assertion = signServiceAccountJwt(creds);
  const res = await fetchWithTimeout(creds.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  }, 8000);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OAuth2 Google error (${res.status}): ${txt.slice(0, 180)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('Google OAuth2 no devolvió access_token.');
  tokenCache = {
    clientEmail: creds.client_email,
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3500) * 1000),
  };
  return tokenCache.accessToken;
}

async function resolveSpreadsheetId(cfg, token) {
  if (cfg.spreadsheetId) return cfg.spreadsheetId;
  if (spreadsheetIdCache.id && spreadsheetIdCache.name === cfg.spreadsheetName) {
    return spreadsheetIdCache.id;
  }
  const safeName = cfg.spreadsheetName.replace(/'/g, "\\'");
  const q = `name='${safeName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }, 8000);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google Drive lookup error (${res.status}): ${txt.slice(0, 180)}`);
  }
  const data = await res.json();
  const file = data.files && data.files[0];
  if (!file || !file.id) {
    throw new Error(`No se encontró la hoja de cálculo "${cfg.spreadsheetName}" compartida con ${cfg.clientEmail}.`);
  }
  spreadsheetIdCache = { name: cfg.spreadsheetName, id: file.id };
  return file.id;
}

async function appendCallCenterRow(prospecto) {
  return withAppendLock(async () => {
    const cfg = getBridgeConfig();
    const rowValues = buildAppendRow(prospecto);

    if (customTransport) {
      return customTransport({ op: 'append', prospecto, values: rowValues, config: cfg });
    }
    if (!cfg.enabled || !cfg.creds) {
      return {
        ok: false,
        skipped: true,
        error: cfg.configured
          ? 'Sincronización con Google Sheets desactivada en modo local/pruebas.'
          : 'Credenciales de Google Sheets no configuradas en el servidor.',
      };
    }

    try {
      const token = await getAccessToken(cfg.creds);
      const ssId = await resolveSpreadsheetId(cfg, token);
      const tabEsc = encodeURIComponent(`'${cfg.tabName.replace(/'/g, "''")}'!C:C`);
      const colRes = await fetchWithTimeout(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssId)}/values/${tabEsc}`,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        8000
      );
      if (!colRes.ok) {
        const txt = await colRes.text().catch(() => '');
        return { ok: false, error: `Error leyendo columna C de Sheets (${colRes.status}): ${txt.slice(0, 180)}` };
      }
      const colData = await colRes.json();
      const existingRows = Array.isArray(colData.values) ? colData.values.length : 1;
      const nextRow = Math.max(2, existingRows + 1);
      const range = `'${cfg.tabName.replace(/'/g, "''")}'!A${nextRow}:J${nextRow}`;
      const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
      const putRes = await fetchWithTimeout(putUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ range, majorDimension: 'ROWS', values: [rowValues] }),
      }, 8000);
      if (!putRes.ok) {
        const txt = await putRes.text().catch(() => '');
        return { ok: false, error: `Error escribiendo fila #${nextRow} en Sheets (${putRes.status}): ${txt.slice(0, 180)}` };
      }
      return { ok: true, sheetRow: nextRow, range, values: rowValues, emailGerente: rowValues[7] };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
}

async function updateCallCenterFollowUp(prospecto, state) {
  const sheetRow = Number(prospecto && prospecto.sheetSync && prospecto.sheetSync.sheetRow);
  if (!(sheetRow > 1)) {
    return { ok: false, skipped: true, error: 'El caso aún no tiene número de fila asignado en Google Sheets.' };
  }
  const cfg = getBridgeConfig();
  const rowValues = buildFollowUpRow(prospecto, state);

  if (customTransport) {
    return customTransport({ op: 'update_followup', prospecto, row: sheetRow, values: rowValues, config: cfg });
  }
  if (!cfg.enabled || !cfg.creds) {
    return { ok: false, skipped: true, error: 'Google Sheets no activo en este entorno.' };
  }

  try {
    const token = await getAccessToken(cfg.creds);
    const ssId = await resolveSpreadsheetId(cfg, token);
    const range = `'${cfg.tabName.replace(/'/g, "''")}'!K${sheetRow}:O${sheetRow}`;
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const putRes = await fetchWithTimeout(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: [rowValues] }),
    }, 8000);
    if (!putRes.ok) {
      const txt = await putRes.text().catch(() => '');
      return { ok: false, error: `Error actualizando seguimiento fila #${sheetRow} en Sheets (${putRes.status}): ${txt.slice(0, 180)}` };
    }
    return { ok: true, sheetRow, range, values: rowValues };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = {
  getBridgeConfig,
  getStatus,
  sanitizeSheetText,
  formatDateManagua,
  formatTelefonoSheet,
  formatMontoSheet,
  buildAppendRow,
  buildFollowUpRow,
  mapEstadoToSheetStatus,
  signServiceAccountJwt,
  appendCallCenterRow,
  updateCallCenterFollowUp,
  setTransport,
  resetCaches,
};
