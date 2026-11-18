const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Use isolated local DB file for deterministic API integration tests, plus 1 live Turso test
process.env.ALFATRACK_DB_MODE = 'local';
process.env.ALFATRACK_DB_FILE = path.join(os.tmpdir(), `alfatrack_api_test_${Date.now()}.json`);

const { createServer } = require('../server.js');
const DB = require('../db.js');

let srv, baseUrl;

test.before(async () => {
  srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${srv.address().port}`;
});

test.after(async () => {
  await new Promise((r) => srv.close(r));
  try { fs.unlinkSync(process.env.ALFATRACK_DB_FILE); } catch {}
});

async function api(route, opts = {}) {
  const res = await fetch(baseUrl + route, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('GET /api/health and /api/state return initialized database with all real users and passwords', async () => {
  const h = await api('/api/health');
  assert.strictEqual(h.status, 200);
  assert.ok(h.data.ok);
  assert.ok(h.data.tables.some((t) => t.name === 'alfatrack_usuarios' && t.rows >= 60));

  const st = await api('/api/state');
  assert.strictEqual(st.status, 200);
  assert.ok(st.data.ok);
  assert.ok(st.data.state.usuarios.length >= 60);
  // Dedicated Turso Database Manager routes serve the web application (HTTP 200 HTML)
  for (const dbRoute of ['/turso', '/db', '/gestor-db.html']) {
    const r = await fetch(baseUrl + dbRoute);
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('AlfaTrack'));
  }
  // Private credential files must not be served over HTTP
  const forbiddenTxt = await fetch(baseUrl + '/CREDENCIALES_ALFATRACK.txt');
  assert.strictEqual(forbiddenTxt.status, 403);
  const forbiddenMd = await fetch(baseUrl + '/CREDENCIALES_USUARIOS.md');
  assert.strictEqual(forbiddenMd.status, 403);
});

test('POST /api/auth/login authenticates admin/admin123 and promoters, rejects invalid credentials', async () => {
  const bad = await api('/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  assert.strictEqual(bad.status, 401);
  assert.ok(!bad.data.ok);

  const okAdmin = await api('/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(okAdmin.status, 200);
  assert.ok(okAdmin.data.ok);
  assert.ok(okAdmin.data.token.startsWith('at_tok_'));
  assert.strictEqual(okAdmin.data.usuario.rol, 'admin');

  const okPro = await api('/api/auth/login', { body: { username: 'laura.varela', password: 'laura123' } });
  assert.strictEqual(okPro.status, 200);
  assert.strictEqual(okPro.data.usuario.nombre, 'Laura Varela');
  assert.strictEqual(okPro.data.usuario.sucursal, 'Managua');
});

test('POST /api/auth/password changes password and persists across requests', async () => {
  const login1 = await api('/api/auth/login', { body: { username: 'betsy.ruiz', password: 'betsy123' } });
  assert.strictEqual(login1.status, 200);
  const betsyId = login1.data.usuario.id;

  const chg = await api('/api/auth/password', {
    body: { actorId: betsyId, targetUserId: betsyId, passwordActual: 'betsy123', passwordNueva: 'betsy2026' },
  });
  assert.strictEqual(chg.status, 200);
  assert.ok(chg.data.ok);

  const oldLogin = await api('/api/auth/login', { body: { username: 'betsy.ruiz', password: 'betsy123' } });
  assert.strictEqual(oldLogin.status, 401);

  const newLogin = await api('/api/auth/login', { body: { username: 'betsy.ruiz', password: 'betsy2026' } });
  assert.strictEqual(newLogin.status, 200);

  // Admin resets it back to betsy123
  const rst = await api('/api/auth/password', {
    body: { actorId: 'u-admin', targetUserId: betsyId, passwordActual: '', passwordNueva: 'betsy123' },
  });
  assert.strictEqual(rst.status, 200);
});

test('POST /api/mutate creates prospects, imports CSVs, and manages users in DB', async () => {
  const m1 = await api('/api/mutate', {
    body: {
      action: 'crearProspecto',
      actorId: 'u-pro-mga-laura',
      payload: {
        nombre: 'Cliente API Managua',
        telefono: '8555-4433',
        tipoCredito: 'NV(NUEVO)',
        plataforma: 'Whatsapp',
        negocio: 'Pulpería',
        monto: 18000,
        direccion: 'Bolonia, Managua',
      },
    },
  });
  assert.strictEqual(m1.status, 200);
  assert.strictEqual(m1.data.result.prospecto.promotor_nombre, 'Laura Varela');

  const csvImp = await api('/api/mutate', {
    body: {
      action: 'importarFilasCSV',
      actorId: 'u-cc-betsy',
      payload: {
        filas: [
          { Cliente: 'Cliente CSV Esteli', Telefono: '86667788', Promotor: 'Cristell Calderon', VALOR: '25000', Negocio: 'Taller' },
        ],
      },
    },
  });
  assert.strictEqual(csvImp.status, 200);
  assert.strictEqual(csvImp.data.result.importados.length, 1);
  assert.strictEqual(csvImp.data.result.importados[0].promotor_nombre, 'Cristell Massiel Calderón Osorio');
});

test('Database manager API: table explorer, safe SQL console, and backup create/restore', async () => {
  // Non-admin or unauthenticated rejected from table explorer
  const unauthTbl = await api('/api/db/table?name=alfatrack_usuarios&limit=10');
  assert.strictEqual(unauthTbl.status, 403);
  const nonAdminTbl = await api('/api/db/table?name=alfatrack_usuarios&limit=10&actorId=u-pro-esteli');
  assert.strictEqual(nonAdminTbl.status, 403);

  const tbl = await api('/api/db/table?name=alfatrack_usuarios&limit=10&actorId=u-admin');
  assert.strictEqual(tbl.status, 200);
  assert.ok(tbl.data.ok);
  assert.strictEqual(tbl.data.rows.length, 10);

  // Non-admin rejected from SQL console
  const unauthSql = await api('/api/db/query', {
    body: { actorId: 'u-pro-esteli', sql: 'SELECT * FROM alfatrack_usuarios' },
  });
  assert.strictEqual(unauthSql.status, 403);

  // Destructive SQL blocked even for admin
  const dropSql = await api('/api/db/query', {
    body: { actorId: 'u-admin', sql: 'DROP TABLE alfatrack_usuarios' },
  });
  assert.strictEqual(dropSql.status, 400);

  // Read-only SELECT succeeds for admin
  const okSql = await api('/api/db/query', {
    body: { actorId: 'u-admin', sql: 'SELECT username, rol, sucursal FROM alfatrack_usuarios LIMIT 5' },
  });
  assert.strictEqual(okSql.status, 200);
  assert.ok(okSql.data.rows.length >= 5);

  // Create backup and restore
  const bk = await api('/api/db/backup', {
    body: { actorId: 'u-admin', action: 'create', nombre: 'Backup Test API' },
  });
  assert.strictEqual(bk.status, 200);
  assert.ok(bk.data.backup.id);

  const rst = await api('/api/db/backup', {
    body: { actorId: 'u-admin', action: 'restore', backupId: bk.data.backup.id },
  });
  assert.strictEqual(rst.status, 200);
  assert.ok(rst.data.ok);
});

test('upgradeState migrates legacy pre-v2 official promoters once and preserves subsequent admin edits', async () => {
  // 1. Legacy state (without officialPromotersV2 flag) gets migrated to official names & usernames
  const legacy = DB.upgradeState({
    version: 1,
    usuarios: [
      { id: 'u-pro-managua', nombre: 'María José López', rol: 'promotor', sucursal: 'Managua', username: 'maria.lopez', password: 'customPassword123' },
      { id: 'u-pro-leo-araceli', nombre: 'Araceli Juárez', rol: 'promotor', sucursal: 'León', username: 'araceli.juarez', password: 'araceli123' },
    ],
    prospectos: [
      { id: 'p-1', nombre: 'Cliente 1', telefono: '88881111', promotor_origen_id: 'u-pro-managua', promotor_nombre: 'María José López', sucursal: 'Managua', estado: 'nuevo', creado: new Date().toISOString(), actualizado: new Date().toISOString(), historial: [] },
    ],
  });
  assert.strictEqual(legacy.officialPromotersV2, true);
  const maria = legacy.usuarios.find((u) => u.id === 'u-pro-managua');
  assert.strictEqual(maria.nombre, 'Maria Jose Lopez Wilson');
  assert.strictEqual(maria.password, 'customPassword123', 'preserves custom password during migration');
  const aracely = legacy.usuarios.find((u) => u.id === 'u-pro-leo-araceli');
  assert.strictEqual(aracely.nombre, 'ARACELY JUÁREZ');
  assert.strictEqual(aracely.username, 'aracely.juarez');
  assert.strictEqual(legacy.prospectos[0].promotor_nombre, 'Maria Jose Lopez Wilson');

  // 2. Subsequent Admin edits to an official promoter via /api/mutate guardarUsuario are preserved across saveState/upgradeState
  const editRes = await api('/api/mutate', {
    body: {
      action: 'guardarUsuario',
      actorId: 'u-admin',
      payload: {
        id: 'u-pro-mas-fanny',
        nombre: 'FANNY DEL CARMEN RAMÍREZ LÓPEZ',
        rol: 'promotor',
        sucursal: 'Managua',
        username: 'fanny.ramirez',
        password: 'fannyNewPwd2026',
      },
    },
  });
  assert.strictEqual(editRes.status, 200);
  const fannyAfter = editRes.data.state.usuarios.find((u) => u.id === 'u-pro-mas-fanny');
  assert.strictEqual(fannyAfter.sucursal, 'Managua');
  assert.strictEqual(fannyAfter.password, 'fannyNewPwd2026');

  // Revert back to Masaya / fanny123
  await api('/api/mutate', {
    body: {
      action: 'guardarUsuario',
      actorId: 'u-admin',
      payload: {
        id: 'u-pro-mas-fanny',
        nombre: 'FANNY DEL CARMEN RAMÍREZ LÓPEZ',
        rol: 'promotor',
        sucursal: 'Masaya',
        username: 'fanny.ramirez',
        password: 'fanny123',
      },
    },
  });
});

test('POST /api/mutate handles concurrent requests without lost updates', async () => {
  const [r1, r2] = await Promise.all([
    api('/api/mutate', {
      body: {
        action: 'crearProspecto',
        actorId: 'u-pro-esteli',
        payload: { nombre: 'Concurrente Uno', telefono: '8111-0001', negocio: 'Pulpería', monto: 10000 },
      },
    }),
    api('/api/mutate', {
      body: {
        action: 'crearProspecto',
        actorId: 'u-pro-managua',
        payload: { nombre: 'Concurrente Dos', telefono: '8111-0002', negocio: 'Taller', monto: 12000 },
      },
    }),
  ]);
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);
  const st = await api('/api/state');
  assert.ok(st.data.state.prospectos.some((p) => p.nombre === 'Concurrente Uno'));
  assert.ok(st.data.state.prospectos.some((p) => p.nombre === 'Concurrente Dos'));
});
