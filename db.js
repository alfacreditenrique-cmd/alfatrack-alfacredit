/* AlfaTrack Database Engine: Turso Cloud SQLite (libSQL HTTP v2/pipeline) + Local JSON Mirror */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Core = require('./core.js');

// Load .env.local in non-Vercel local environments without overwriting existing process.env vars
(function loadLocalEnv() {
  if (process.env.VERCEL) return;
  const envPath = path.join(__dirname, '.env.local');
  try {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {}
})();

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
  const rawUrl = (process.env.TURSO_URL || '').trim().replace(/^libsql:\/\//i, 'https://').replace(/\/+$/, '');
  const token = (process.env.TURSO_AUTH_TOKEN || '').trim();
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
  const timer = setTimeout(() => controller.abort(), 9000);
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
  if (!execResult || !execResult.response || !execResult.response.result) return { columns: [], rows: [], affectedRowCount: 0 };
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
  return { columns, rows, affectedRowCount: Number(r.affected_row_count || 0) };
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
      origen_tipo TEXT DEFAULT 'promotor',
      asignado_promotor_id TEXT,
      sheet_row INTEGER,
      external_id TEXT,
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
  if (!r.ok) return r;

  // Idempotent column migration for existing production Turso tables
  const infoRes = await tursoPipeline(['PRAGMA table_info(alfatrack_prospectos)']);
  if (!infoRes.ok || !infoRes.results || !infoRes.results[0]) {
    return infoRes;
  }
  const cols = new Set(parseTursoResult(infoRes.results[0]).rows.map((row) => String(row.name || '').toLowerCase()));
  const alters = [];
  if (!cols.has('origen_tipo')) alters.push(`ALTER TABLE alfatrack_prospectos ADD COLUMN origen_tipo TEXT DEFAULT 'promotor'`);
  if (!cols.has('asignado_promotor_id')) alters.push(`ALTER TABLE alfatrack_prospectos ADD COLUMN asignado_promotor_id TEXT`);
  if (!cols.has('sheet_row')) alters.push(`ALTER TABLE alfatrack_prospectos ADD COLUMN sheet_row INTEGER`);
  if (!cols.has('external_id')) alters.push(`ALTER TABLE alfatrack_prospectos ADD COLUMN external_id TEXT`);
  for (const sql of alters) {
    const ar = await tursoPipeline([sql]);
    if (!ar.ok && !/duplicate column/i.test(String(ar.error || ''))) {
      return ar;
    }
  }
  schemaInitialized = true;
  return r;
}

const upgradeState = Core.upgradeState;

function readLocalStore() {
  const fp = getLocalFilePath();
  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (raw && raw.state) return { state: upgradeState(raw.state), backups: raw.backups || [], rev: Number(raw.rev || 1) };
      if (raw && raw.version === 1) return { state: upgradeState(raw), backups: [], rev: 1 };
    }
  } catch {}
  return null;
}

function writeLocalStore(state, backups, rev) {
  const fp = getLocalFilePath();
  const cur = readLocalStore();
  const existingBackups = backups || (cur && cur.backups) || [];
  const nextRev = rev !== undefined ? rev : ((cur && cur.rev) ? cur.rev + 1 : 1);
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ state, backups: existingBackups, rev: nextRev, updatedAt: new Date().toISOString() }), 'utf8');
  } catch {}
  return nextRev;
}

function stmtUpsertUsuario(u, ts) {
  return {
    sql: `INSERT INTO alfatrack_usuarios (id, username, password, password_hash, nombre, rol, sucursal, email, activo, ultimo_acceso, actualizado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            password = excluded.password,
            password_hash = excluded.password_hash,
            nombre = excluded.nombre,
            rol = excluded.rol,
            sucursal = excluded.sucursal,
            email = excluded.email,
            activo = excluded.activo,
            ultimo_acceso = excluded.ultimo_acceso,
            actualizado = excluded.actualizado`,
    args: [
      u.id, u.username, u.password || '', u.passwordHash || Core.hashPwd(u.password || ''),
      u.nombre, u.rol, u.sucursal, u.email || '', u.activo ? 1 : 0,
      u.ultimoAcceso || null, u.actualizado || ts,
    ],
  };
}

function stmtUpsertProspecto(p) {
  const origenTipo = Core.esCallCenterDirecto(p) ? 'callcenter_directo' : 'promotor';
  const sheetRow = (p.sheetSync && Number(p.sheetSync.sheetRow) > 0) ? Number(p.sheetSync.sheetRow) : null;
  return {
    sql: `INSERT INTO alfatrack_prospectos (
            id, nombre, telefono, telefono_secundario, cedula, tipo_credito, direccion, negocio, monto,
            plataforma, campana, email_gerente, notas, promotor_origen_id, promotor_nombre, sucursal_origen,
            sucursal, estado, gestor_id, origen_tipo, asignado_promotor_id, sheet_row, external_id,
            motivo_descarte, cc_json, gerencia_json, desembolso_json, historial_json, creado, actualizado
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            nombre = excluded.nombre,
            telefono = excluded.telefono,
            telefono_secundario = excluded.telefono_secundario,
            cedula = excluded.cedula,
            tipo_credito = excluded.tipo_credito,
            direccion = excluded.direccion,
            negocio = excluded.negocio,
            monto = excluded.monto,
            plataforma = excluded.plataforma,
            campana = excluded.campana,
            email_gerente = excluded.email_gerente,
            notas = excluded.notas,
            promotor_nombre = excluded.promotor_nombre,
            sucursal = excluded.sucursal,
            estado = excluded.estado,
            gestor_id = excluded.gestor_id,
            origen_tipo = excluded.origen_tipo,
            asignado_promotor_id = excluded.asignado_promotor_id,
            sheet_row = excluded.sheet_row,
            external_id = excluded.external_id,
            motivo_descarte = excluded.motivo_descarte,
            cc_json = excluded.cc_json,
            gerencia_json = excluded.gerencia_json,
            desembolso_json = excluded.desembolso_json,
            historial_json = excluded.historial_json,
            actualizado = excluded.actualizado`,
    args: [
      p.id, p.nombre, p.telefono, p.telefonoSecundario || '', p.cedula || '',
      p.tipoCredito || 'NV(NUEVO)', p.direccion || '', p.negocio || '', Number(p.monto) || 0,
      p.plataforma || 'Cambaceo / Campo', p.campana || '', p.emailGerente || '', p.notas || '',
      p.promotor_origen_id, p.promotor_nombre, p.sucursal_origen || p.sucursal, p.sucursal,
      p.estado, p.gestorId || null, origenTipo, p.asignadoPromotorId || null, sheetRow, p.externalId || '',
      p.motivoDescarte || '',
      p.cc ? JSON.stringify(p.cc) : null,
      p.gerencia ? JSON.stringify(p.gerencia) : null,
      p.desembolso ? JSON.stringify(p.desembolso) : null,
      JSON.stringify(p.historial || []),
      p.creado, p.actualizado,
    ],
  };
}

function stmtUpsertNotif(n) {
  return {
    sql: `INSERT INTO alfatrack_notificaciones (id, user_id, texto, prospecto_id, ts, leida, toasted)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET leida = excluded.leida, toasted = excluded.toasted`,
    args: [n.id, n.userId, n.texto, n.prospectoId || null, n.ts, n.leida ? 1 : 0, n.toasted ? 1 : 0],
  };
}

function stmtInsertAudit(a) {
  return {
    sql: `INSERT INTO alfatrack_auditoria (ts, user_id, usuario, rol, accion, detalle)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [a.ts, a.userId || '', a.usuario || '', a.rol || '', a.accion || '', a.detalle || ''],
  };
}

async function persistDeltaToTurso(state, delta, expectedRev) {
  const cfg = getTursoConfig();
  if (!cfg.enabled) return { ok: true, mode: 'local' };
  await ensureSchema();
  const ts = new Date().toISOString();

  // Step 1: Optimistic concurrency compare-and-swap on alfatrack_state
  if (expectedRev !== undefined && expectedRev !== null) {
    const cas = await tursoPipeline([
      {
        sql: `UPDATE alfatrack_state
              SET version = version + 1, payload_json = ?, updated_at = ?
              WHERE id = 'main' AND version = ?`,
        args: [JSON.stringify(state), ts, Number(expectedRev)],
      },
    ]);
    if (!cas.ok) return cas;
    const affected = parseTursoResult(cas.results[0]).affectedRowCount;
    if (affected === 0) {
      return { ok: false, conflict: true, error: 'Conflicto de versión concurrente en base de datos.' };
    }
  } else {
    const up = await tursoPipeline([
      {
        sql: `INSERT INTO alfatrack_state (id, version, payload_json, updated_at)
              VALUES ('main', 1, ?, ?)
              ON CONFLICT(id) DO UPDATE SET version = alfatrack_state.version + 1, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
        args: [JSON.stringify(state), ts],
      },
    ]);
    if (!up.ok) return up;
  }

  // Step 2: Targeted transactional upserts for affected rows only (no full-table DELETEs)
  const stmts = ['BEGIN'];
  if (delta.usuarios && delta.usuarios.length) {
    for (const u of delta.usuarios) stmts.push(stmtUpsertUsuario(u, ts));
  }
  if (delta.prospectos && delta.prospectos.length) {
    for (const p of delta.prospectos) stmts.push(stmtUpsertProspecto(p));
  }
  if (delta.notificaciones && delta.notificaciones.length) {
    for (const n of delta.notificaciones) stmts.push(stmtUpsertNotif(n));
  }
  if (delta.auditoria && delta.auditoria.length) {
    for (const a of delta.auditoria) stmts.push(stmtInsertAudit(a));
  }
  if (delta.config) {
    stmts.push({
      sql: `INSERT INTO alfatrack_config (clave, valor_json, actualizado)
            VALUES ('config', ?, ?)
            ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizado = excluded.actualizado`,
      args: [JSON.stringify(state.config), ts],
    });
  }
  stmts.push('COMMIT');

  if (stmts.length === 2) return { ok: true, latencyMs: 1 };
  return tursoPipeline(stmts);
}

async function syncStateToTurso(state) {
  const cfg = getTursoConfig();
  if (!cfg.enabled) return { ok: true, mode: 'local' };
  await ensureSchema();
  const ts = new Date().toISOString();
  const stmts = [
    'BEGIN',
    {
      sql: `INSERT INTO alfatrack_state (id, version, payload_json, updated_at)
            VALUES ('main', 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET version = alfatrack_state.version + 1, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      args: [JSON.stringify(state), ts],
    },
    'DELETE FROM alfatrack_usuarios',
  ];

  for (const u of state.usuarios) {
    stmts.push({
      sql: `INSERT INTO alfatrack_usuarios (id, username, password, password_hash, nombre, rol, sucursal, email, activo, ultimo_acceso, actualizado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        u.id, u.username, u.password || '', u.passwordHash || Core.hashPwd(u.password || ''),
        u.nombre, u.rol, u.sucursal, u.email || '', u.activo ? 1 : 0,
        u.ultimoAcceso || null, u.actualizado || ts,
      ],
    });
  }

  stmts.push('DELETE FROM alfatrack_prospectos');
  for (const p of state.prospectos) {
    stmts.push(stmtUpsertProspecto(p));
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
    stmts.push(stmtInsertAudit(a));
  }

  stmts.push({
    sql: `INSERT INTO alfatrack_config (clave, valor_json, actualizado)
          VALUES ('config', ?, ?)
          ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizado = excluded.actualizado`,
    args: [JSON.stringify(state.config), ts],
  });

  stmts.push('COMMIT');
  return tursoPipeline(stmts);
}

async function getState() {
  const cfg = getTursoConfig();
  if (cfg.enabled) {
    await ensureSchema();
    const r = await tursoPipeline([
      `SELECT version, payload_json, updated_at FROM alfatrack_state WHERE id = 'main' LIMIT 1`,
    ]);
    if (r.ok && r.results && r.results[0]) {
      const parsed = parseTursoResult(r.results[0]);
      if (parsed.rows.length && parsed.rows[0].payload_json) {
        try {
          const rawState = JSON.parse(parsed.rows[0].payload_json);
          let rev = Number(parsed.rows[0].version || 1);
          const beforeStr = JSON.stringify(rawState.usuarios || []);
          const s = upgradeState(rawState);
          if (JSON.stringify(s.usuarios) !== beforeStr) {
            const upRes = await syncStateToTurso(s);
            if (upRes && upRes.ok) rev += 1;
          }
          writeLocalStore(s, undefined, rev);
          return { state: s, source: 'turso', latencyMs: r.latencyMs, rev };
        } catch {}
      }
    }
    const local = readLocalStore();
    const initial = local ? local.state : upgradeState(Core.seed());
    const rev = writeLocalStore(initial, undefined, 1);
    const syncRes = await syncStateToTurso(initial);
    return { state: initial, source: syncRes.ok ? 'turso-seeded' : 'local-fallback', latencyMs: syncRes.latencyMs || 0, rev };
  }

  const local = readLocalStore();
  if (local) return { state: local.state, source: 'local', latencyMs: 1, rev: local.rev || 1 };
  const seeded = upgradeState(Core.seed());
  const rev = writeLocalStore(seeded, [], 1);
  return { state: seeded, source: 'local-seeded', latencyMs: 1, rev };
}

async function saveState(state, opts) {
  opts = opts || {};
  const clean = upgradeState(state);
  const cfg = getTursoConfig();

  if (!cfg.enabled) {
    if (opts.expectedRev !== undefined && opts.expectedRev !== null) {
      const cur = readLocalStore();
      const curRev = (cur && cur.rev) || 1;
      if (curRev !== Number(opts.expectedRev)) {
        return { ok: false, conflict: true, error: 'Conflicto de versión concurrente.' };
      }
    }
    const nextRev = writeLocalStore(clean);
    return { ok: true, tursoSynced: false, latencyMs: 1, rev: nextRev };
  }

  const res = opts.delta
    ? await persistDeltaToTurso(clean, opts.delta, opts.expectedRev)
    : await syncStateToTurso(clean);

  if (res && res.conflict) {
    return { ok: false, conflict: true, error: res.error };
  }

  const hasExpectedRev = opts.expectedRev !== undefined && opts.expectedRev !== null;
  const nextRev = writeLocalStore(clean, undefined, hasExpectedRev ? Number(opts.expectedRev) + 1 : undefined);
  return { ok: true, tursoSynced: Boolean(res && res.ok), latencyMs: (res && res.latencyMs) || 1, rev: nextRev };
}

async function resetState() {
  const fresh = upgradeState(Core.seed());
  const rev = writeLocalStore(fresh);
  const res = await syncStateToTurso(fresh);
  return { ok: true, state: fresh, tursoSynced: Boolean(res && res.ok), rev };
}

async function getHealthInfo() {
  const cfg = getTursoConfig();
  if (cfg.enabled) {
    const r = await tursoPipeline(['SELECT 1 AS ok']);
    return {
      ok: true,
      status: 'healthy',
      engine: 'Turso Cloud SQLite (libSQL AWS us-east-2)',
      tursoConnected: Boolean(r && r.ok),
      source: r && r.ok ? 'turso' : 'local-fallback',
      latencyMs: (r && r.latencyMs) || 1,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    ok: true,
    status: 'healthy',
    engine: 'Local JSON/SQLite Engine',
    tursoConnected: false,
    source: 'local',
    latencyMs: 1,
    timestamp: new Date().toISOString(),
  };
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
      plataforma: p.plataforma || '', origen_tipo: Core.esCallCenterDirecto(p) ? 'callcenter_directo' : 'promotor',
      promotor_origen_id: p.promotor_origen_id, promotor_nombre: p.promotor_nombre,
      asignado_promotor_id: p.asignadoPromotorId || '', gestor_id: p.gestorId || '',
      sheet_row: (p.sheetSync && p.sheetSync.sheetRow) || '', external_id: p.externalId || '', sucursal: p.sucursal, estado: p.estado,
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

  const m = q.match(/FROM\s+(alfatrack_\w+)/i);
  if (!m) return { ok: false, error: 'Indique una tabla válida (alfatrack_usuarios, alfatrack_prospectos, etc.).' };
  const tbl = m[1].toLowerCase();
  if (!ALLOWED_TABLES.includes(tbl)) return { ok: false, error: `Tabla no encontrada: ${tbl}` };
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
  getHealthInfo,
  getDbStats,
  queryTable,
  runSafeSQL,
  createBackup,
  restoreBackup,
};
