/* AlfaTrack Unified Serverless API (Vercel /api/* + Node HTTP Server) */
'use strict';

const crypto = require('node:crypto');
const Core = require('../core.js');
const DB = require('../db.js');
const SheetsBridge = require('../sheets-bridge.js');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let writeLock = Promise.resolve();
const sheetAppendInFlight = new Map(); // prospectoId -> Promise (prevents duplicate concurrent Sheet appends)
function withWriteLock(fn) {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {});
  return next;
}

function getSessionSecret() {
  if (process.env.ALFATRACK_SESSION_SECRET && process.env.ALFATRACK_SESSION_SECRET.trim()) {
    return process.env.ALFATRACK_SESSION_SECRET.trim();
  }
  const cfg = DB.getTursoConfig();
  return crypto
    .createHash('sha256')
    .update('alfatrack-hmac-session-v2:' + (cfg.token || 'local-dev-secret'))
    .digest('hex');
}

function signToken(u) {
  const payload = {
    sub: u.id,
    usr: u.username,
    rol: u.rol,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  return `at_tok_${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('at_tok_')) return null;
  const raw = token.slice('at_tok_'.length);
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.sub || !payload.exp || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  String(cookieHeader || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) {
        try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
      }
    }
  });
  return out;
}

function extractToken(req) {
  const auth = String((req.headers && req.headers.authorization) || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return cookies.alfatrack_token || '';
}

function authenticateActor(req, state) {
  const payload = verifyToken(extractToken(req));
  if (!payload) return null;
  const actor = state.usuarios.find((u) => u.id === payload.sub && u.activo);
  return actor || null;
}

function getIntegrationKey() {
  return String(process.env.ALFATRACK_INTEGRATION_KEY || '').trim();
}

function verifyIntegrationKey(req) {
  const expected = getIntegrationKey();
  if (!expected) return false;
  const hKey = String((req.headers && req.headers['x-alfatrack-key']) || '').trim();
  const auth = String((req.headers && req.headers.authorization) || '').trim();
  const bearerKey = auth.startsWith('Bearer ') && !auth.startsWith('Bearer at_tok_') ? auth.slice(7).trim() : '';
  const candidate = hKey || bearerKey;
  if (!candidate) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function resolveCallCenterActor(state, agenteRaw, authActor) {
  const q = Core.sinAcentos(agenteRaw || '').toLowerCase().trim();
  if (q) {
    const exact = state.usuarios.find((u) =>
      u.activo && u.rol === 'callcenter' && (
        Core.sinAcentos(u.nombre).toLowerCase() === q ||
        (u.username && u.username.toLowerCase() === q)
      )
    );
    if (exact) return exact;
    const partial = state.usuarios.find((u) =>
      u.activo && u.rol === 'callcenter' && Core.sinAcentos(u.nombre).toLowerCase().includes(q)
    );
    if (partial) return partial;
  }
  if (authActor && authActor.activo && ['callcenter', 'admin'].includes(authActor.rol)) return authActor;
  return state.usuarios.find((u) => u.activo && u.rol === 'callcenter') || state.usuarios.find((u) => u.activo && u.rol === 'admin') || null;
}

async function persistSheetSyncOutcome(prospectoId, op, syncRes, actor) {
  const nowIso = new Date().toISOString();
  return runAtomicMutation((state) => {
    const p = state.prospectos.find((x) => x.id === prospectoId);
    if (!p) return { ok: false, error: 'Prospecto no encontrado.' };
    const prev = p.sheetSync || { status: 'pending', sheetRow: null, source: p.origenApp || 'alfatrack', syncedAt: null, emailAlertExpected: true, lastError: '' };
    if (op === 'append') {
      if (syncRes && syncRes.ok) {
        p.sheetSync = Object.assign({}, prev, {
          status: 'synced',
          sheetRow: Number(syncRes.sheetRow) || prev.sheetRow,
          syncedAt: nowIso,
          emailAlertExpected: true,
          lastError: '',
        });
        p.historial.push({
          ts: nowIso,
          userId: actor ? actor.id : 'system',
          usuario: actor ? actor.nombre : 'Sistema',
          rol: actor ? actor.rol : 'callcenter',
          accion: 'Sincronizado con Google Sheets',
          detalle: `Fila #${p.sheetSync.sheetRow} registrada en hoja "Clientes" (alerta de correo activada para ${p.emailGerente}).`,
        });
      } else {
        p.sheetSync = Object.assign({}, prev, {
          status: syncRes && syncRes.skipped ? 'pending' : 'error',
          lastError: (syncRes && syncRes.error) || 'No se pudo sincronizar con Google Sheets.',
        });
      }
    } else if (op === 'update_followup') {
      if (syncRes && syncRes.ok) {
        p.sheetSync = Object.assign({}, prev, {
          status: 'synced',
          lastFollowUpSyncAt: nowIso,
          lastFollowUpError: '',
        });
      } else if (!syncRes || !syncRes.skipped) {
        p.sheetSync = Object.assign({}, prev, {
          lastFollowUpError: (syncRes && syncRes.error) || 'No se pudo actualizar seguimiento en Google Sheets.',
        });
      } else {
        return { ok: true, skipSave: true, prospecto: p };
      }
    }
    return { ok: true, prospecto: p, delta: { prospectos: [p] } };
  });
}

function sanitizeUser(u, isAdmin) {
  if (!u) return null;
  if (isAdmin) return Object.assign({}, u);
  return {
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    rol: u.rol,
    sucursal: u.sucursal,
    email: u.email || '',
    activo: Boolean(u.activo),
    ultimoAcceso: u.ultimoAcceso || null,
    actualizado: u.actualizado || null,
  };
}

function scopeStateForUser(state, actor) {
  if (!actor) return null;
  if (actor.rol === 'admin') {
    return Object.assign({ _scoped: false }, state);
  }
  return {
    version: state.version,
    officialPromotersV2: state.officialPromotersV2,
    realRosterV4: state.realRosterV4,
    _scoped: true,
    config: state.config,
    usuarios: state.usuarios.map((u) => sanitizeUser(u, false)),
    prospectos: Core.visibles(state, actor),
    notificaciones: state.notificaciones.filter((n) => n.userId === actor.id),
    auditoria: [],
  };
}

function setAuthCookie(res, req, token) {
  const isSecure = Boolean(
    process.env.VERCEL ||
    (req.headers && req.headers['x-forwarded-proto'] === 'https')
  );
  const parts = [
    `alfatrack_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`,
  ];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res, req) {
  const isSecure = Boolean(
    process.env.VERCEL ||
    (req && req.headers && req.headers['x-forwarded-proto'] === 'https')
  );
  const parts = ['alfatrack_token=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB guard against OOM/stalled uploads

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string' && req.body.trim()) {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) return Promise.resolve({ _tooLarge: true });
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return;
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), 'utf8');
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        raw = '';
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (overflow) return resolve({ _tooLarge: true });
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(JSON.stringify(obj));
}

const waitJitter = (attempt) => new Promise((r) => setTimeout(r, Math.min(260, 35 * (attempt + 1) + Math.floor(Math.random() * 65))));

async function runAtomicMutation(mutatorFn) {
  return withWriteLock(async () => {
    for (let attempt = 0; attempt < 7; attempt++) {
      const { state, rev } = await DB.getState();
      const out = await mutatorFn(state, rev);
      if (!out || !out.ok) return out;
      if (out.skipSave) {
        return Object.assign({}, out, { state, tursoSynced: true, rev });
      }
      const syncInfo = await DB.saveState(state, {
        delta: out.fullSync ? null : out.delta,
        expectedRev: rev,
      });
      if (syncInfo && syncInfo.conflict) {
        await waitJitter(attempt);
        continue;
      }
      return Object.assign({}, out, {
        state,
        tursoSynced: Boolean(syncInfo && syncInfo.tursoSynced),
        rev: (syncInfo && syncInfo.rev) || (rev + 1),
      });
    }
    return { ok: false, status: 409, error: 'Conflicto concurrente al guardar. Por favor intente nuevamente.' };
  });
}

module.exports = async function handler(req, res) {
  try {
    const parsedUrl = new URL(req.url || '/api/health', 'http://localhost');
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/api';
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    // 1. Public Health Check (safe metadata only — never exposes table counts, backups, or secrets)
    if (pathname === '/api/health' || pathname === '/api') {
      const health = await DB.getHealthInfo();
      return sendJson(res, 200, health);
    }

    // 2. Authenticate user with username & password -> returns HMAC-SHA256 signed session token + role-scoped state
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      if (body && body._tooLarge) return sendJson(res, 413, { ok: false, error: 'Solicitud demasiado grande.' });
      let out = await runAtomicMutation((state) => {
        const auth = Core.autenticar(state, body.username, body.password);
        if (!auth.ok) return { ok: false, status: 401, error: auth.error };
        return {
          ok: true,
          usuario: auth.usuario,
          delta: {
            usuarios: [auth.usuario],
            auditoria: state.auditoria.slice(-1),
          },
        };
      });
      // Never block valid user logins if concurrent login storm causes CAS conflict on ultimoAcceso/audit write
      if (!out.ok && out.status === 409) {
        const { state, rev } = await DB.getState();
        const auth = Core.autenticar(state, body.username, body.password);
        if (auth.ok) {
          out = { ok: true, usuario: auth.usuario, state, rev };
        }
      }
      if (!out.ok) return sendJson(res, out.status || 401, { ok: false, error: out.error });
      const token = signToken(out.usuario);
      setAuthCookie(res, req, token);
      return sendJson(res, 200, {
        ok: true,
        token,
        usuario: sanitizeUser(out.usuario, out.usuario.rol === 'admin'),
        state: scopeStateForUser(out.state, out.usuario),
        rev: out.rev,
      });
    }

    // 2b. Logout (clears HttpOnly session cookie)
    if (pathname === '/api/auth/logout' && method === 'POST') {
      clearAuthCookie(res, req);
      return sendJson(res, 200, { ok: true });
    }

    // 3. Get role-scoped synchronized state (authenticated)
    if (pathname === '/api/state' && method === 'GET') {
      const { state, source, latencyMs, rev } = await DB.getState();
      const actor = authenticateActor(req, state);
      if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida o expirada. Inicie sesión nuevamente.' });
      return sendJson(res, 200, {
        ok: true,
        usuario: sanitizeUser(actor, actor.rol === 'admin'),
        state: scopeStateForUser(state, actor),
        source,
        latencyMs,
        rev,
      });
    }

    // 3b. Authenticated duplicate check against full DB (without leaking other promoters' prospect lists)
    if (pathname === '/api/check-dup' && method === 'GET') {
      const { state } = await DB.getState();
      const actor = authenticateActor(req, state);
      if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
      const telefono = parsedUrl.searchParams.get('telefono') || '';
      const cedula = parsedUrl.searchParams.get('cedula') || '';
      const excluirId = parsedUrl.searchParams.get('excluirId') || '';
      const telValid = Core.validarTelefono(telefono) ? telefono : '';
      const cedValid = Core.normCedula(cedula).length === 14 ? cedula : '';
      const dup = (telValid || cedValid) ? Core.buscarDuplicado(state, telValid, cedValid, excluirId || undefined) : null;
      return sendJson(res, 200, {
        ok: true,
        duplicate: dup ? { campo: dup.campo, mensaje: Core.mensajeDuplicado(dup) } : null,
      });
    }

    // 4. Change or reset password (authenticated; actor strictly from signed token)
    if (pathname === '/api/auth/password' && method === 'POST') {
      const body = await readBody(req);
      const out = await runAtomicMutation((state) => {
        const actor = authenticateActor(req, state);
        if (!actor) return { ok: false, status: 401, error: 'Sesión requerida o expirada.' };
        const r = Core.cambiarPassword(state, actor, body.targetUserId, body.passwordActual, body.passwordNueva);
        if (!r.ok) return { ok: false, status: 400, error: r.error };
        return {
          ok: true,
          actor,
          usuario: r.usuario,
          delta: {
            usuarios: [r.usuario],
            auditoria: state.auditoria.slice(-1),
          },
        };
      });
      if (!out.ok) return sendJson(res, out.status || 400, { ok: false, error: out.error });
      return sendJson(res, 200, {
        ok: true,
        usuario: sanitizeUser(out.usuario, out.actor.rol === 'admin'),
        state: scopeStateForUser(out.state, out.actor),
        rev: out.rev,
      });
    }

    // 5. Atomic domain mutation persisted to Turso Cloud SQLite (authenticated; actor strictly from signed token)
    if (pathname === '/api/mutate' && method === 'POST') {
      const body = await readBody(req);
      if (body && body._tooLarge) return sendJson(res, 413, { ok: false, error: 'La solicitud excede el límite de 4 MB.' });
      const { action, payload } = body || {};

      if (action === 'reset') {
        return withWriteLock(async () => {
          const { state } = await DB.getState();
          const actor = authenticateActor(req, state);
          if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida o expirada.' });
          if (actor.rol !== 'admin') {
            return sendJson(res, 403, { ok: false, error: 'Solo el administrador puede restablecer la base de datos.' });
          }
          const rst = await DB.resetState();
          return sendJson(res, 200, {
            ok: true,
            result: { ok: true },
            state: scopeStateForUser(rst.state, actor),
            tursoSynced: rst.tursoSynced,
            rev: rst.rev,
          });
        });
      }

      const out = await runAtomicMutation((state) => {
        const actor = authenticateActor(req, state);
        if (!actor) return { ok: false, status: 401, error: 'Sesión requerida o expirada.' };
        const notifBefore = state.notificaciones.length;
        const auditBefore = state.auditoria.length;
        let result;
        let delta = {};
        let skipSave = false;

        switch (action) {
          case 'crearProspecto':
            result = Core.crearProspecto(state, actor, payload || {});
            if (result.ok) delta = { prospectos: [result.prospecto] };
            break;
          case 'capturarProspectoCallCenter':
            result = Core.capturarProspectoCallCenter(state, actor, payload || {});
            if (result.ok) delta = { prospectos: [result.prospecto] };
            break;
          case 'capturarCasoCallCenterDirecto':
            result = Core.capturarCasoCallCenterDirecto(state, actor, Object.assign({}, payload || {}, { origenApp: 'alfatrack' }));
            if (result.ok) {
              if (result.deduplicated) skipSave = true;
              else delta = { prospectos: [result.prospecto] };
            }
            break;
          case 'reintentarSyncSheet': {
            const pTarget = state.prospectos.find((x) => x.id === (payload && payload.id));
            if (!pTarget) {
              result = { ok: false, error: 'Prospecto no encontrado.' };
            } else if (!Core.esCallCenterDirecto(pTarget)) {
              result = { ok: false, error: 'Solo los casos directos de Call Center se sincronizan con Google Sheets.' };
            } else if (!['callcenter', 'gerente', 'admin'].includes(actor.rol) || !Core.puedeVer(actor, pTarget)) {
              result = { ok: false, error: 'No tiene permiso para sincronizar este caso.' };
            } else {
              result = { ok: true, prospecto: pTarget };
              skipSave = true;
            }
            break;
          }
          case 'importarFilasCSV':
            result = Core.importarFilasCSV(state, actor, (payload && payload.filas) || [], (payload && payload.opts) || {});
            if (result.ok) {
              delta = { prospectos: result.importados || [] };
              if (!delta.prospectos.length) skipSave = true;
            }
            break;
          case 'cambiarEstado':
            result = Core.cambiarEstado(state, actor, payload && payload.id, payload && payload.estado, (payload && payload.datos) || {});
            if (result.ok) delta = { prospectos: [result.prospecto] };
            break;
          case 'agregarNota':
            result = Core.agregarNota(state, actor, payload && payload.id, payload && payload.texto);
            if (result.ok) delta = { prospectos: [result.prospecto] };
            break;
          case 'adminEditarProspecto':
            result = Core.adminEditarProspecto(state, actor, payload && payload.id, (payload && payload.patch) || {});
            if (result.ok) {
              if (result.sinCambios) skipSave = true;
              else delta = { prospectos: [result.prospecto] };
            }
            break;
          case 'guardarUsuario':
            result = Core.guardarUsuario(state, actor, payload || {});
            if (result.ok) {
              delta = {
                usuarios: [result.usuario],
                prospectos: state.prospectos.filter((p) => p.promotor_origen_id === result.usuario.id || p.asignadoPromotorId === result.usuario.id),
              };
            }
            break;
          case 'toggleUsuario':
            result = Core.toggleUsuario(state, actor, payload && payload.id);
            if (result.ok) delta = { usuarios: [result.usuario] };
            break;
          case 'cambiarPassword':
            result = Core.cambiarPassword(state, actor, payload && payload.targetUserId, payload && payload.passwordActual, payload && payload.passwordNueva);
            if (result.ok) delta = { usuarios: [result.usuario] };
            break;
          case 'guardarConfig':
            result = Core.guardarConfig(state, actor, (payload && payload.config) || {});
            if (result.ok) delta = { config: true };
            break;
          case 'marcarLeidas': {
            const notifId = payload && payload.id;
            const changed = state.notificaciones.filter((n) => n.userId === actor.id && (!notifId || n.id === notifId) && (!n.leida || !n.toasted));
            result = Core.marcarLeidas(state, actor.id, notifId);
            if (result.ok) {
              if (!changed.length) skipSave = true;
              else delta = { notificaciones: changed };
            }
            break;
          }
          default:
            return { ok: false, status: 400, error: `Acción desconocida: ${action}` };
        }

        if (!result || !result.ok) {
          return { ok: false, status: 400, error: (result && result.error) || 'Error en la operación.', result };
        }

        if (!skipSave) {
          const newNotifs = state.notificaciones.slice(notifBefore);
          if (newNotifs.length) delta.notificaciones = (delta.notificaciones || []).concat(newNotifs);
          const newAudit = state.auditoria.slice(auditBefore);
          if (newAudit.length) delta.auditoria = (delta.auditoria || []).concat(newAudit);
        }

        const safeResult = Object.assign({}, result);
        if (safeResult.usuario) safeResult.usuario = sanitizeUser(safeResult.usuario, actor.rol === 'admin');
        return { ok: true, actor, result: safeResult, delta, skipSave };
      });

      if (!out.ok) {
        return sendJson(res, out.status || 400, { ok: false, error: out.error, result: out.result });
      }

      // Post-commit Google Sheets synchronization for Call Center Directo cases (never blocks or rolls back DB persistence)
      let finalState = out.state;
      let finalRev = out.rev;
      let finalTursoSynced = out.tursoSynced;
      let finalResult = out.result;
      const pAffected = finalResult && finalResult.prospecto;

      if (pAffected && Core.esCallCenterDirecto(pAffected)) {
        const isCreateDirecto = (action === 'capturarCasoCallCenterDirecto' || (action === 'capturarProspectoCallCenter' && payload && payload.modo === 'directo')) && !finalResult.deduplicated;
        const isRetry = action === 'reintentarSyncSheet';
        const isFollowUpChange = ['cambiarEstado', 'agregarNota', 'adminEditarProspecto'].includes(action) && !finalResult.sinCambios;

        if (isCreateDirecto || (isRetry && !(pAffected.sheetSync && Number(pAffected.sheetSync.sheetRow) > 1))) {
          let syncTask = sheetAppendInFlight.get(pAffected.id);
          if (!syncTask) {
            syncTask = (async () => {
              // Re-check latest persisted row before appending to prevent duplicate rows on concurrent retries
              const fresh = await DB.getState();
              const cur = fresh && fresh.state && fresh.state.prospectos.find((x) => x.id === pAffected.id);
              if (cur && cur.sheetSync && Number(cur.sheetSync.sheetRow) > 1) {
                return { syncRes: { ok: true, sheetRow: cur.sheetSync.sheetRow, deduplicated: true }, updated: { ok: true, state: fresh.state, rev: fresh.rev, tursoSynced: finalTursoSynced, prospecto: cur } };
              }
              const target = cur || pAffected;
              const syncRes = await SheetsBridge.appendCallCenterRow(target);
              let updated = await persistSheetSyncOutcome(target.id, 'append', syncRes, out.actor);
              // If the case already has follow-up progress (state != 'pescado', gerencia, or notes), immediately sync K:O too
              if (syncRes && syncRes.ok && updated && updated.ok && updated.prospecto) {
                const pNow = updated.prospecto;
                const hasFollowUp = pNow.estado !== 'pescado' || Boolean(pNow.gerencia) || (pNow.historial || []).some((h) => h.accion === 'Nota agregada');
                if (hasFollowUp) {
                  const fuRes = await SheetsBridge.updateCallCenterFollowUp(pNow, updated.state);
                  const fuUpdated = await persistSheetSyncOutcome(pNow.id, 'update_followup', fuRes, out.actor);
                  if (fuUpdated && fuUpdated.ok) updated = fuUpdated;
                }
              }
              return { syncRes, updated };
            })().finally(() => { sheetAppendInFlight.delete(pAffected.id); });
            sheetAppendInFlight.set(pAffected.id, syncTask);
          }
          const { syncRes, updated } = await syncTask;
          if (updated && updated.ok) {
            finalState = updated.state;
            finalRev = updated.rev || finalRev;
            finalTursoSynced = updated.tursoSynced;
            finalResult = Object.assign({}, finalResult, { prospecto: updated.prospecto, sheetSync: syncRes });
          }
        } else if ((isFollowUpChange || isRetry) && pAffected.sheetSync && Number(pAffected.sheetSync.sheetRow) > 1) {
          const syncRes = await SheetsBridge.updateCallCenterFollowUp(pAffected, finalState);
          const updated = await persistSheetSyncOutcome(pAffected.id, 'update_followup', syncRes, out.actor);
          if (updated && updated.ok) {
            finalState = updated.state;
            finalRev = updated.rev || finalRev;
            finalTursoSynced = updated.tursoSynced;
            finalResult = Object.assign({}, finalResult, { prospecto: updated.prospecto, sheetSync: syncRes });
          }
        }
      }

      return sendJson(res, 200, {
        ok: true,
        result: finalResult,
        state: scopeStateForUser(finalState, out.actor),
        tursoSynced: finalTursoSynced,
        rev: finalRev,
      });
    }

    // 5b. Integration: Ingest new Call Center credit lead from Python Call Center app (idempotent, no Google Sheet echo)
    if (pathname === '/api/integrations/callcenter/ingest' && method === 'POST') {
      const body = await readBody(req);
      if (body && body._tooLarge) return sendJson(res, 413, { ok: false, error: 'Solicitud demasiado grande.' });
      const hasValidKey = verifyIntegrationKey(req);
      const out = await runAtomicMutation((state) => {
        const authActor = authenticateActor(req, state);
        if (!hasValidKey) {
          if (!authActor) {
            return { ok: false, status: 401, error: 'Autenticación requerida (X-AlfaTrack-Key o sesión de Call Center/Admin).' };
          }
          if (!['callcenter', 'admin'].includes(authActor.rol)) {
            return { ok: false, status: 403, error: 'Solo Call Center o Administrador puede registrar casos por integración.' };
          }
        }
        const actor = resolveCallCenterActor(state, body.agente || body.agenteNombre, authActor);
        if (!actor) return { ok: false, status: 500, error: 'No se encontró un actor válido de Call Center.' };

        const notifBefore = state.notificaciones.length;
        const auditBefore = state.auditoria.length;
        const result = Core.capturarCasoCallCenterDirecto(state, actor, {
          externalId: body.externalId || body.external_id || '',
          sheetRow: body.sheetRow || body.fila_sheet || null,
          agenteNombre: body.agente || body.agenteNombre || actor.nombre,
          nombre: body.nombre || body.cliente || '',
          tipoCredito: body.tipoCredito || body.tipo_credito || 'NV(NUEVO)',
          telefono: body.telefono || '',
          telefonoSecundario: body.telefonoSecundario || body.telefono_secundario || '',
          cedula: body.cedula || '',
          direccion: body.direccion || body.direccionNegocio || '',
          negocio: body.negocio || body.tipoNegocio || '',
          emailGerente: body.emailGerente || body.email_gerente || '',
          sucursal: body.sucursal || '',
          monto: body.monto !== undefined ? body.monto : (body.monto_solicitado !== undefined ? body.monto_solicitado : ''),
          plataforma: body.plataforma || 'Whatsapp',
          campana: body.campana || body.detalle || '',
          notas: body.notas || '',
          origenApp: 'python_callcenter',
        });

        if (!result.ok) {
          return { ok: false, status: result.duplicate ? 409 : 400, duplicate: Boolean(result.duplicate), error: result.error };
        }
        if (result.deduplicated) {
          return { ok: true, deduplicated: true, skipSave: true, prospecto: result.prospecto, notificacionesCount: 0 };
        }

        const delta = { prospectos: [result.prospecto] };
        const newNotifs = state.notificaciones.slice(notifBefore);
        if (newNotifs.length) delta.notificaciones = newNotifs;
        const newAudit = state.auditoria.slice(auditBefore);
        if (newAudit.length) delta.auditoria = newAudit;
        return {
          ok: true,
          deduplicated: false,
          prospecto: result.prospecto,
          notificacionesCount: (result.notificaciones || []).length,
          delta,
        };
      });

      if (!out.ok) {
        return sendJson(res, out.status || 400, { ok: false, duplicate: Boolean(out.duplicate), error: out.error });
      }
      return sendJson(res, out.deduplicated ? 200 : 201, {
        ok: true,
        deduplicated: Boolean(out.deduplicated),
        prospecto: out.prospecto,
        notificacionesCount: out.notificacionesCount || 0,
        rev: out.rev,
      });
    }

    // 5c. Integration diagnostic status (authenticated Admin or Call Center only)
    if (pathname === '/api/integrations/callcenter/status' && method === 'GET') {
      const { state } = await DB.getState();
      const actor = authenticateActor(req, state);
      if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
      if (!['admin', 'callcenter'].includes(actor.rol)) {
        return sendJson(res, 403, { ok: false, error: 'Acceso restringido a Call Center y Administración.' });
      }
      const directos = state.prospectos.filter((p) => Core.esCallCenterDirecto(p));
      return sendJson(res, 200, {
        ok: true,
        endpoint: '/api/integrations/callcenter/ingest',
        integrationKeyConfigured: Boolean(getIntegrationKey()),
        sheets: SheetsBridge.getStatus(),
        stats: {
          totalDirectos: directos.length,
          syncedToSheet: directos.filter((p) => p.sheetSync && p.sheetSync.status === 'synced').length,
          pendingSheetSync: directos.filter((p) => !p.sheetSync || p.sheetSync.status === 'pending').length,
          errorSheetSync: directos.filter((p) => p.sheetSync && p.sheetSync.status === 'error').length,
          fromPythonApp: directos.filter((p) => p.origenApp === 'python_callcenter').length,
          fromWebApp: directos.filter((p) => p.origenApp !== 'python_callcenter').length,
        },
      });
    }

    // 6. Full state sync from Admin to cloud DB (authenticated Admin only)
    if (pathname === '/api/sync' && method === 'POST') {
      const body = await readBody(req);
      return withWriteLock(async () => {
        const { state: current } = await DB.getState();
        const actor = authenticateActor(req, current);
        if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
        if (actor.rol !== 'admin') return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General puede sincronizar instantáneas completas.' });
        if (!body || !body.state || !Array.isArray(body.state.usuarios)) {
          return sendJson(res, 400, { ok: false, error: 'Estado inválido para sincronización.' });
        }
        const syncInfo = await DB.saveState(body.state);
        const { state, rev } = await DB.getState();
        return sendJson(res, 200, { ok: true, state: scopeStateForUser(state, actor), tursoSynced: syncInfo.tursoSynced, latencyMs: syncInfo.latencyMs, rev });
      });
    }

    // 7. Database Manager endpoints (authenticated Admin only)
    if (pathname === '/api/db/stats' && method === 'GET') {
      const { state } = await DB.getState();
      const actor = authenticateActor(req, state);
      if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
      if (actor.rol !== 'admin') return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General puede consultar estadísticas de base de datos.' });
      const stats = await DB.getDbStats();
      return sendJson(res, 200, stats);
    }

    if (pathname === '/api/db/table' && method === 'GET') {
      const { state } = await DB.getState();
      const actor = authenticateActor(req, state);
      if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
      if (actor.rol !== 'admin') {
        return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General puede explorar tablas SQL.' });
      }
      const name = parsedUrl.searchParams.get('name') || 'alfatrack_usuarios';
      const limit = parsedUrl.searchParams.get('limit') || '200';
      const data = await DB.queryTable(name, limit);
      return sendJson(res, data.ok ? 200 : 400, data);
    }

    if (pathname === '/api/db/query' && method === 'POST') {
      const body = await readBody(req);
      const { state } = await DB.getState();
      const actor = authenticateActor(req, state);
      if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
      if (actor.rol !== 'admin') {
        return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General puede ejecutar consultas SQL.' });
      }
      const out = await DB.runSafeSQL(body.sql);
      return sendJson(res, out.ok ? 200 : 400, out);
    }

    if (pathname === '/api/db/backup' && method === 'POST') {
      const body = await readBody(req);
      return withWriteLock(async () => {
        const { state } = await DB.getState();
        const actor = authenticateActor(req, state);
        if (!actor) return sendJson(res, 401, { ok: false, error: 'Sesión requerida.' });
        if (actor.rol !== 'admin') {
          return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General gestiona respaldos de base de datos.' });
        }
        if (body.action === 'create') {
          const bk = await DB.createBackup(actor, body.nombre);
          const stats = await DB.getDbStats();
          return sendJson(res, 200, { ok: true, backup: bk.backup, stats });
        }
        if (body.action === 'restore') {
          const rst = await DB.restoreBackup(actor, body.backupId);
          if (!rst.ok) return sendJson(res, 400, rst);
          const stats = await DB.getDbStats();
          return sendJson(res, 200, { ok: true, state: scopeStateForUser(rst.state, actor), stats });
        }
        if (body.action === 'import') {
          if (!body.state || !Array.isArray(body.state.usuarios) || !Array.isArray(body.state.prospectos)) {
            return sendJson(res, 400, { ok: false, error: 'El archivo JSON no tiene una estructura válida de AlfaTrack.' });
          }
          await DB.createBackup(actor, 'Auto-respaldo previo a importación JSON');
          await DB.saveState(body.state);
          const { state: nextState } = await DB.getState();
          const stats = await DB.getDbStats();
          return sendJson(res, 200, { ok: true, state: scopeStateForUser(nextState, actor), stats });
        }
        return sendJson(res, 400, { ok: false, error: 'Acción de respaldo inválida.' });
      });
    }

    return sendJson(res, 404, { ok: false, error: `Ruta API no encontrada: ${pathname}` });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Error interno del servidor' });
  }
};
