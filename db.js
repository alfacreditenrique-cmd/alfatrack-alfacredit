/* AlfaTrack Database Engine: Turso Cloud SQLite (libSQL HTTP v2/pipeline) + Local JSON/SQLite Mirror */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Core = require('./core.js');

const DEFAULT_TURSO_URL = 'https://baseinventario-alfacreditenrique-cmd.aws-us-east-2.turso.io';
const DEFAULT_TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzYyNjgxODgsImlkIjoiMDE5ZDkxZDMtYTcwMS03ZDYzLWFiM2MtMGFmMjQ4YzI2ZWU4IiwicmlkIjoiZWIxOGNlOTItNjRiOS00OTRjLTgzZWYtMTM0Mzk5ZmExZTBmIn0.Zh4suZn4iXch7sJi_b4W34pPGzd16U9DJwcp_cfbnkH5IWf0gy7LZIeIcw1nyHw6RMoHQQ_MxEZMm9leLMq9CQ';

const ALLOWED_TABLES = [
  'alfatrack_usuarios',
  'alfatrack_prospectos',
  'alfatrack_notificaciones',
  'alfatrack_auditoria',
  'alfatrack_config',
  'alfatrack_backups',
  'alfatrack_state',
];

function getTursoConfig() {
  const mode = process.env.ALFATRACK_DB_MODE || 'turso';
  if (mode === 'local') return { enabled: false, url: '', token: '' };
  const rawUrl = (process.env.TURSO_URL || DEFAULT_TURSO_URL).trim().replace(/^libsql:\/\//i, 'https://').replace(/\/+$/, '');
  const token = (process.env.TURSO_AUTH_TOKEN || DEFAULT_TURSO_TOKEN).trim();
  return { enabled: Boolean(rawUrl && token), url: rawUrl, token };
}

function getLocalFilePath() {
  if (process.env.ALFATRACK_DB_FILE) return process.env.ALFATRACK_DB_FILE;
  const baseDir = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, 'storage');
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
  return path.join(baseDir, 'alfatrack_db.json');
}

function toTursoArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: v };
  }
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  return { type: 'text', value: String(v) };
}

async function tursoPipeline(statements) {
  const cfg = getTursoConfig();
  if (!cfg.enabled) return { ok: false, error: 'Turso deshabilitado (modo local).' };
  const t0 = Date.now();
  const requests = statements.map((s) => {
    if (typeof s === 'string') return { type: 'execute', stmt: { sql: s } };
    return {
      type: 'execute',
      stmt: {
        sql: s.sql,
        args: (s.args || []).map(toTursoArg),
      },
    };
  });
  requests.push({ type: 'close' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const res = await fetch(`${cfg.url}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}`, latencyMs: Date.now() - t0 };
    }
    const data = await res.json();
    const errRes = (data.results || []).find((r) => r.type === 'error');
    if (errRes) {
      return { ok: false, error: errRes.error ? errRes.error.message : 'Error SQL en Turso', latencyMs: Date.now() - t0, data };
    }
    return { ok: true, results: data.results || [], latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message || String(e), latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function parseTursoResult(execResult) {
  if (!execResult || !execResult.response || !execResult.response.result) return { columns: [], rows: [] };
  const r = execResult.response.result;
  const columns = (r.cols || []).map((c) => c.name);
  const rows = (r.rows || []).map((row) => {
    const obj = {};
    columns.forEach((col, i) => {
      const cell = row[i];
      if (!cell || cell.type === 'null') obj[col] = null;
      else if (cell.type === 'integer') obj[col] = Number(cell.value);
      else if (cell.type === 'float') obj[col] = Number(cell.value);
      else obj[col] = cell.value;
    });
    return obj;
  });
  return { columns, rows };
}

let schemaInitialized = false;

async function ensureSchema() {
  const cfg = getTursoConfig();
  if (!cfg.enabled || schemaInitialized) return;
  const ddl = [
    `CREATE TABLE IF NOT EXISTS alfatrack_state (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alfatrack_usuarios (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL,
      sucursal TEXT NOT NULL,
      email TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      ultimo_acceso TEXT,
      actualizado TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS alfatrack_prospectos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      telefono TEXT NOT NULL,
      telefono_secundario TEXT,
      cedula TEXT,
      tipo_credito TEXT,
      direccion TEXT,
      negocio TEXT,
      monto REAL,
      plataforma TEXT,
      campana TEXT,
      email_gerente TEXT,
      notas TEXT,
      promotor_origen_id TEXT NOT NULL,
      promotor_nombre TEXT NOT NULL,
      sucursal_origen TEXT NOT NULL,
      sucursal TEXT NOT NULL,
      estado TEXT NOT NULL,
      gestor_id TEXT,
      motivo_descarte TEXT,
      cc_json TEXT,
      gerencia_json TEXT,
      desembolso_json TEXT,
      historial_json TEXT,
      creado TEXT NOT NULL,
      actualizado TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alfatrack_notificaciones (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      texto TEXT NOT NULL,
      prospecto_id TEXT,
      ts TEXT NOT NULL,
      leida INTEGER NOT NULL DEFAULT 0,
      toasted INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS alfatrack_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT,
      usuario TEXT,
      rol TEXT,
      accion TEXT NOT NULL,
      detalle TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS alfatrack_config (
      clave TEXT PRIMARY KEY,
      valor_json TEXT NOT NULL,
      actualizado TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alfatrack_backups (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      creado TEXT NOT NULL,
      autor TEXT,
      resumen TEXT,
      payload_json TEXT NOT NULL
    )`,
  ];
  const r = await tursoPipeline(ddl);
  if (r.ok) schemaInitialized = true;
  return r;
}

// Upgrade state so any newly added real promoters/agents/passwords or config fields exist
function upgradeState(s) {
  if (!s || typeof s !== 'object') return Core.seed();
  const base = Core.seed();
  s.version = 1;
  s.config = Object.assign({}, base.config, s.config || {});
  s.config.emailsGerentes = Object.assign({}, base.config.emailsGerentes, (s.config && s.config.emailsGerentes) || {});
  if (!Array.isArray(s.config.tiposCredito) || !s.config.tiposCredito.length) s.config.tiposCredito = base.config.tiposCredito;
  if (!Array.isArray(s.config.plataformas) || !s.config.plataformas.length) s.config.plataformas = base.config.plataformas;

  s.usuarios = Array.isArray(s.usuarios) ? s.usuarios : [];
  const byId = new Map(s.usuarios.map((u) => [u.id, u]));
  const usedUsernames = new Set(s.usuarios.map((u) => (u.username || '').toLowerCase()).filter(Boolean));

  const OFFICIAL_IDS = new Set([
    'u-pro-managua', 'u-pro-mga-lester', 'u-pro-mga-claudia', 'u-pro-mga-marjorie',
    'u-pro-mas-fanny', 'u-pro-mas-noelia', 'u-pro-mas-yeiling',
    'u-pro-jin-nidia', 'u-pro-jui-martha',
    'u-pro-seb-evelia', 'u-pro-seb-jiurem',
    'u-pro-leo-araceli', 'u-pro-leo-lorena',
  ]);

  // Ensure every existing user has username & password, and migrate pre-v2 official promoter records once
  const needsOfficialMigration = !s.officialPromotersV2;
  for (const u of s.usuarios) {
    const seedMatch = base.usuarios.find((bu) => bu.id === u.id);
    if (needsOfficialMigration && seedMatch && OFFICIAL_IDS.has(u.id)) {
      usedUsernames.delete((u.username || '').toLowerCase());
      u.nombre = seedMatch.nombre;
      u.sucursal = seedMatch.sucursal;
      u.username = seedMatch.username;
      usedUsernames.add(u.username);
    }
    if (!u.username) {
      u.username = (seedMatch && !usedUsernames.has(seedMatch.username))
        ? seedMatch.username
        : Core.genUsername(u.nombre, usedUsernames);
      usedUsernames.add(u.username);
    }
    if (!u.password) {
      u.password = (seedMatch && seedMatch.password) || (u.id === 'u-admin' ? 'admin123' : Core.genPassword(u.username));
    }
    if (!u.passwordHash) u.passwordHash = Core.hashPwd(u.password);
    if (u.email === undefined && seedMatch) u.email = seedMatch.email || '';
  }

  // Merge any missing seed users (all real promoters, agents, managers, credit officers)
  for (const bu of base.usuarios) {
    if (!byId.has(bu.id) && !usedUsernames.has(bu.username)) {
      s.usuarios.push(JSON.parse(JSON.stringify(bu)));
      byId.set(bu.id, bu);
      usedUsernames.add(bu.username);
    }
  }

  s.prospectos = Array.isArray(s.prospectos) ? s.prospectos : base.prospectos;
  if (needsOfficialMigration) {
    s.prospectos.forEach((p) => {
      const uOrig = byId.get(p.promotor_origen_id);
      if (uOrig && OFFICIAL_IDS.has(uOrig.id)) p.promotor_nombre = uOrig.nombre;
    });
  }
  s.officialPromotersV2 = true;
  s.notificaciones = Array.isArray(s.notificaciones) ? s.notificaciones : base.notificaciones;
  s.auditoria = Array.isArray(s.auditoria) ? s.auditoria : base.auditoria;
  return s;
}

function readLocalStore() {
  const fp = getLocalFilePath();
  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (raw && raw.state) return { state: upgradeState(raw.state), backups: raw.backups || [] };
      if (raw && raw.version === 1) return { state: upgradeState(raw), backups: [] };
    }
  } catch {}
  return null;
}

function writeLocalStore(state, backups) {
  const fp = getLocalFilePath();
  let existingBackups = backups;
  if (!existingBackups) {
    const cur = readLocalStore();
    existingBackups = (cur && cur.backups) || [];
  }
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ state, backups: existingBackups, updatedAt: new Date().toISOString() }), 'utf8');
  } catch {}
}

async function syncStateToTurso(state) {
  const cfg = getTursoConfig();
  if (!cfg.enabled) return { ok: true, mode: 'local' };
  await ensureSchema();
  const ts = new Date().toISOString();
  const stmts = [
    {
      sql: `INSERT INTO alfatrack_state (id, version, payload_json, updated_at)
            VALUES ('main', 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      args: [JSON.stringify(state), ts],
    },
    'DELETE FROM alfatrack_usuarios',
  ];

  for (const u of state.usuarios) {
    stmts.push({
      sql: `INSERT INTO alfatrack_usuarios (id, username, password, password_hash, nombre, rol, sucursal, email, activo, ultimo_acceso, actualizado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        u.id, u.username, u.password, u.passwordHash || Core.hashPwd(u.password),
        u.nombre, u.rol, u.sucursal, u.email || '', u.activo ? 1 : 0,
        u.ultimoAcceso || null, u.actualizado || ts,
      ],
    });
  }

  stmts.push('DELETE FROM alfatrack_prospectos');
  for (const p of state.prospectos) {
    stmts.push({
      sql: `INSERT INTO alfatrack_prospectos (
              id, nombre, telefono, telefono_secundario, cedula, tipo_credito, direccion, negocio, monto,
              plataforma, campana, email_gerente, notas, promotor_origen_id, promotor_nombre, sucursal_origen,
              sucursal, estado, gestor_id, motivo_descarte, cc_json, gerencia_json, desembolso_json, historial_json, creado, actualizado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        p.id, p.nombre, p.telefono, p.telefonoSecundario || '', p.cedula || '',
        p.tipoCredito || 'NV(NUEVO)', p.direccion || '', p.negocio || '', Number(p.monto) || 0,
        p.plataforma || 'Cambaceo / Campo', p.campana || '', p.emailGerente || '', p.notas || '',
        p.promotor_origen_id, p.promotor_nombre, p.sucursal_origen || p.sucursal, p.sucursal,
        p.estado, p.gestorId || null, p.motivoDescarte || '',
        p.cc ? JSON.stringify(p.cc) : null,
        p.gerencia ? JSON.stringify(p.gerencia) : null,
        p.desembolso ? JSON.stringify(p.desembolso) : null,
        JSON.stringify(p.historial || []),
        p.creado, p.actualizado,
      ],
    });
  }

  stmts.push('DELETE FROM alfatrack_notificaciones');
  for (const n of state.notificaciones.slice(-400)) {
    stmts.push({
      sql: `INSERT INTO alfatrack_notificaciones (id, user_id, texto, prospecto_id, ts, leida, toasted)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [n.id, n.userId, n.texto, n.prospectoId || null, n.ts, n.leida ? 1 : 0, n.toasted ? 1 : 0],
    });
  }

  stmts.push('DELETE FROM alfatrack_auditoria');
  for (const a of state.auditoria.slice(-400)) {
    stmts.push({
      sql: `INSERT INTO alfatrack_auditoria (ts, user_id, usuario, rol, accion, detalle)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [a.ts, a.userId || '', a.usuario || '', a.rol || '', a.accion || '', a.detalle || ''],
    });
  }

  stmts.push({
    sql: `INSERT INTO alfatrack_config (clave, valor_json, actualizado)
          VALUES ('config', ?, ?)
          ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizado = excluded.actualizado`,
    args: [JSON.stringify(state.config), ts],
  });

  return tursoPipeline(stmts);
}

async function getState() {
  const cfg = getTursoConfig();
  if (cfg.enabled) {
    await ensureSchema();
    const r = await tursoPipeline([
      `SELECT payload_json, updated_at FROM alfatrack_state WHERE id = 'main' LIMIT 1`,
    ]);
    if (r.ok && r.results && r.results[0]) {
      const parsed = parseTursoResult(r.results[0]);
      if (parsed.rows.length && parsed.rows[0].payload_json) {
        try {
          const rawState = JSON.parse(parsed.rows[0].payload_json);
          const beforeStr = JSON.stringify(rawState.usuarios || []);
          const s = upgradeState(rawState);
          writeLocalStore(s);
          if (JSON.stringify(s.usuarios) !== beforeStr) {
            await syncStateToTurso(s);
          }
          return { state: s, source: 'turso', latencyMs: r.latencyMs };
        } catch {}
      }
    }
    // Seed Turso on first run
    const local = readLocalStore();
    const initial = local ? local.state : upgradeState(Core.seed());
    writeLocalStore(initial);
    const syncRes = await syncStateToTurso(initial);
    return { state: initial, source: syncRes.ok ? 'turso-seeded' : 'local-fallback', latencyMs: syncRes.latencyMs || 0 };
  }

  const local = readLocalStore();
  if (local) return { state: local.state, source: 'local', latencyMs: 1 };
  const seeded = upgradeState(Core.seed());
  writeLocalStore(seeded, []);
  return { state: seeded, source: 'local-seeded', latencyMs: 1 };
}

async function saveState(state) {
  const clean = upgradeState(state);
  writeLocalStore(clean);
  const res = await syncStateToTurso(clean);
  return { ok: true, tursoSynced: Boolean(res && res.ok), latencyMs: (res && res.latencyMs) || 1 };
}

async function resetState() {
  const fresh = upgradeState(Core.seed());
  writeLocalStore(fresh);
  const res = await syncStateToTurso(fresh);
  return { ok: true, state: fresh, tursoSynced: Boolean(res && res.ok) };
}

async function getDbStats() {
  const cfg = getTursoConfig();
  const { state, source, latencyMs } = await getState();
  const stats = {
    ok: true,
    engine: cfg.enabled ? 'Turso Cloud SQLite (libSQL AWS us-east-2)' : 'Local JSON/SQLite Engine',
    tursoUrl: cfg.enabled ? 'Turso Cloud SQLite (AWS us-east-2 · baseinventario) — Gestor Web: /turso' : 'file://' + getLocalFilePath(),
    tursoConnected: false,
    source,
    latencyMs: latencyMs || 1,
    tables: [
      { name: 'alfatrack_usuarios', rows: state.usuarios.length, desc: 'Usuarios, roles, sucursales y contraseñas (hash + gestión)' },
      { name: 'alfatrack_prospectos', rows: state.prospectos.length, desc: 'Prospectos, candado de origen, pipeline y bitácora' },
      { name: 'alfatrack_notificaciones', rows: state.notificaciones.length, desc: 'Alertas en tiempo real por usuario' },
      { name: 'alfatrack_auditoria', rows: state.auditoria.length, desc: 'Bitácora global de seguridad y sesiones' },
      { name: 'alfatrack_config', rows: 1, desc: 'Sucursales, correos de gerentes, estados y plantillas' },
      { name: 'alfatrack_backups', rows: 0, desc: 'Puntos de restauración e instantáneas en la nube' },
    ],
    backups: [],
  };

  if (cfg.enabled) {
    const r = await tursoPipeline([
      'SELECT COUNT(*) AS c FROM alfatrack_usuarios',
      'SELECT COUNT(*) AS c FROM alfatrack_prospectos',
      'SELECT COUNT(*) AS c FROM alfatrack_notificaciones',
      'SELECT COUNT(*) AS c FROM alfatrack_auditoria',
      'SELECT id, nombre, creado, autor, resumen FROM alfatrack_backups ORDER BY creado DESC LIMIT 30',
    ]);
    if (r.ok) {
      stats.tursoConnected = true;
      stats.latencyMs = r.latencyMs;
      const uC = parseTursoResult(r.results[0]).rows[0];
      const pC = parseTursoResult(r.results[1]).rows[0];
      const nC = parseTursoResult(r.results[2]).rows[0];
      const aC = parseTursoResult(r.results[3]).rows[0];
      const bRows = parseTursoResult(r.results[4]).rows;
      if (uC) stats.tables[0].rows = Number(uC.c);
      if (pC) stats.tables[1].rows = Number(pC.c);
      if (nC) stats.tables[2].rows = Number(nC.c);
      if (aC) stats.tables[3].rows = Number(aC.c);
      stats.tables[5].rows = bRows.length;
      stats.backups = bRows;
      return stats;
    }
  }

  const local = readLocalStore();
  const bks = (local && local.backups) || [];
  stats.tables[5].rows = bks.length;
  stats.backups = bks.map((b) => ({ id: b.id, nombre: b.nombre, creado: b.creado, autor: b.autor, resumen: b.resumen }));
  return stats;
}

async function queryTable(tableName, limit) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  if (!ALLOWED_TABLES.includes(tableName)) {
    return { ok: false, error: `Tabla no permitida: ${tableName}` };
  }
  const cfg = getTursoConfig();
  if (cfg.enabled) {
    await ensureSchema();
    const sql = tableName === 'alfatrack_backups'
      ? `SELECT id, nombre, creado, autor, resumen FROM alfatrack_backups ORDER BY creado DESC LIMIT ${lim}`
      : tableName === 'alfatrack_state'
        ? `SELECT id, version, updated_at, length(payload_json) AS bytes FROM alfatrack_state LIMIT ${lim}`
        : `SELECT * FROM ${tableName} LIMIT ${lim}`;
    const r = await tursoPipeline([sql]);
    if (r.ok && r.results[0]) {
      const parsed = parseTursoResult(r.results[0]);
      return { ok: true, table: tableName, columns: parsed.columns, rows: parsed.rows, latencyMs: r.latencyMs };
    }
  }

  // Fallback to local state projection
  const { state } = await getState();
  const local = readLocalStore();
  let rows = [];
  if (tableName === 'alfatrack_usuarios') {
    rows = state.usuarios.map((u) => ({
      id: u.id, username: u.username, password: u.password, password_hash: u.passwordHash,
      nombre: u.nombre, rol: u.rol, sucursal: u.sucursal, email: u.email || '', activo: u.activo ? 1 : 0,
      ultimo_acceso: u.ultimoAcceso || '', actualizado: u.actualizado || '',
    }));
  } else if (tableName === 'alfatrack_prospectos') {
    rows = state.prospectos.map((p) => ({
      id: p.id, nombre: p.nombre, telefono: p.telefono, cedula: p.cedula || '',
      tipo_credito: p.tipoCredito || 'NV(NUEVO)', negocio: p.negocio || '', monto: p.monto,
      plataforma: p.plataforma || '', promotor_origen_id: p.promotor_origen_id,
      promotor_nombre: p.promotor_nombre, sucursal: p.sucursal, estado: p.estado,
      creado: p.creado, actualizado: p.actualizado,
    }));
  } else if (tableName === 'alfatrack_notificaciones') {
    rows = state.notificaciones.slice(-lim);
  } else if (tableName === 'alfatrack_auditoria') {
    rows = state.auditoria.slice(-lim);
  } else if (tableName === 'alfatrack_config') {
    rows = [{ clave: 'config', valor_json: JSON.stringify(state.config) }];
  } else if (tableName === 'alfatrack_backups') {
    rows = ((local && local.backups) || []).map((b) => ({ id: b.id, nombre: b.nombre, creado: b.creado, autor: b.autor, resumen: b.resumen }));
  } else if (tableName === 'alfatrack_state') {
    rows = [{ id: 'main', version: state.version, bytes: JSON.stringify(state).length }];
  }
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { ok: true, table: tableName, columns, rows: rows.slice(0, lim), latencyMs: 1 };
}

async function runSafeSQL(sqlQuery) {
  const q = String(sqlQuery || '').trim();
  if (!q) return { ok: false, error: 'Escriba una consulta SQL.' };
  if (!/^(SELECT|PRAGMA|EXPLAIN)\b/i.test(q)) {
    return { ok: false, error: 'Por seguridad, la consola SQL solo permite consultas de lectura (SELECT / PRAGMA / EXPLAIN).' };
  }
  if (/[;].+\S/.test(q)) {
    return { ok: false, error: 'Solo se permite una sentencia SQL por consulta.' };
  }
  if (/\b(DROP|DELETE|UPDATE|INSERT|ALTER|ATTACH|DETACH|REPLACE|CREATE)\b/i.test(q)) {
    return { ok: false, error: 'Comandos de escritura bloqueados en consola de consulta.' };
  }

  const cfg = getTursoConfig();
  if (cfg.enabled) {
    await ensureSchema();
    const r = await tursoPipeline([q]);
    if (!r.ok) return { ok: false, error: r.error };
    const parsed = parseTursoResult(r.results[0]);
    return { ok: true, columns: parsed.columns, rows: parsed.rows, latencyMs: r.latencyMs };
  }

  // Local mode lightweight SELECT emulator for alfatrack_* tables
  const m = q.match(/FROM\s+(alfatrack_\w+)/i);
  const tbl = m ? m[1].toLowerCase() : 'alfatrack_usuarios';
  return queryTable(tbl, 200);
}

async function createBackup(actor, nombre) {
  const { state } = await getState();
  const id = 'bk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const creado = new Date().toISOString();
  const titulo = String(nombre || '').trim() || `Respaldo ${creado.slice(0, 16).replace('T', ' ')}`;
  const resumen = `${state.usuarios.length} usuarios · ${state.prospectos.length} prospectos · ${state.auditoria.length} eventos`;
  const autor = actor ? actor.nombre : 'Administrador';
  const payload = JSON.stringify(state);

  const local = readLocalStore() || { state, backups: [] };
  local.backups = local.backups || [];
  local.backups.unshift({ id, nombre: titulo, creado, autor, resumen, payload_json: payload });
  writeLocalStore(state, local.backups.slice(0, 30));

  const cfg = getTursoConfig();
  if (cfg.enabled) {
    await ensureSchema();
    await tursoPipeline([
      {
        sql: `INSERT INTO alfatrack_backups (id, nombre, creado, autor, resumen, payload_json)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, titulo, creado, autor, resumen, payload],
      },
    ]);
  }
  return { ok: true, backup: { id, nombre: titulo, creado, autor, resumen } };
}

async function restoreBackup(actor, backupId) {
  let payloadStr = null;
  const cfg = getTursoConfig();
  if (cfg.enabled) {
    await ensureSchema();
    const r = await tursoPipeline([
      { sql: 'SELECT payload_json FROM alfatrack_backups WHERE id = ? LIMIT 1', args: [backupId] },
    ]);
    if (r.ok && r.results[0]) {
      const parsed = parseTursoResult(r.results[0]);
      if (parsed.rows.length) payloadStr = parsed.rows[0].payload_json;
    }
  }
  if (!payloadStr) {
    const local = readLocalStore();
    const found = ((local && local.backups) || []).find((b) => b.id === backupId);
    if (found) payloadStr = found.payload_json;
  }
  if (!payloadStr) return { ok: false, error: 'Respaldo no encontrado.' };
  try {
    const restored = upgradeState(JSON.parse(payloadStr));
    restored.auditoria.push({
      ts: new Date().toISOString(),
      userId: actor ? actor.id : 'u-admin',
      usuario: actor ? actor.nombre : 'Administrador',
      rol: 'admin',
      accion: 'Base de datos restaurada',
      detalle: `Se restauró el respaldo ${backupId}.`,
    });
    await saveState(restored);
    return { ok: true, state: restored };
  } catch (e) {
    return { ok: false, error: 'El respaldo contiene JSON inválido.' };
  }
}

module.exports = {
  ALLOWED_TABLES,
  getTursoConfig,
  tursoPipeline,
  ensureSchema,
  upgradeState,
  getState,
  saveState,
  resetState,
  getDbStats,
  queryTable,
  runSafeSQL,
  createBackup,
  restoreBackup,
};
