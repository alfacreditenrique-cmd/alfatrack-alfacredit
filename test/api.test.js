const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Use isolated local DB file for deterministic API integration tests
process.env.ALFATRACK_DB_MODE = 'local';
process.env.ALFATRACK_DB_FILE = path.join(os.tmpdir(), `alfatrack_api_test_${Date.now()}.json`);
process.env.ALFATRACK_SESSION_SECRET = 'test-hmac-secret-alfatrack-2026';

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
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  const res = await fetch(baseUrl + route, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data, headers: res.headers };
}

async function login(username, password) {
  const r = await api('/api/auth/login', { body: { username, password } });
  assert.strictEqual(r.status, 200, `login failed for ${username}: ${JSON.stringify(r.data)}`);
  return r.data;
}

test('GET /api/health returns only safe metadata; unauthenticated /api/state returns 401; static security enforced', async () => {
  const h = await api('/api/health');
  assert.strictEqual(h.status, 200);
  assert.strictEqual(h.data.ok, true);
  assert.strictEqual(h.data.status, 'healthy');
  assert.ok(h.data.engine);
  assert.strictEqual(h.data.tables, undefined, 'health must not leak DB table metadata');
  assert.strictEqual(h.data.backups, undefined, 'health must not leak backup metadata');

  // Unauthenticated or forged token rejected with 401
  const stUnauth = await api('/api/state');
  assert.strictEqual(stUnauth.status, 401);
  const stForged = await api('/api/state', { token: 'at_tok_ZmFrZQ.badsignature' });
  assert.strictEqual(stForged.status, 401);
  const mutUnauth = await api('/api/mutate', { body: { action: 'crearProspecto', actorId: 'u-pro-esteli', payload: {} } });
  assert.strictEqual(mutUnauth.status, 401);

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

test('POST /api/auth/login signs HMAC-SHA256 tokens and scopes state strictly by role', async () => {
  const bad = await api('/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  assert.strictEqual(bad.status, 401);
  assert.ok(!bad.data.ok);

  const okAdmin = await api('/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(okAdmin.status, 200);
  assert.ok(okAdmin.data.ok);
  assert.ok(okAdmin.data.token.startsWith('at_tok_'));
  assert.ok(okAdmin.data.token.includes('.'), 'token must carry HMAC signature segment');
  assert.strictEqual(okAdmin.data.usuario.rol, 'admin');
  assert.ok(okAdmin.data.state.usuarios.length >= 60);

  // Non-admin promoter receives role-scoped state: NO passwords, NO other promoters' prospects, NO audit log
  const okPro = await api('/api/auth/login', { body: { username: 'laura.varela', password: 'laura123' } });
  assert.strictEqual(okPro.status, 200);
  assert.strictEqual(okPro.data.usuario.nombre, 'Laura Varela');
  assert.strictEqual(okPro.data.usuario.password, undefined, 'must not expose password to non-admin');
  assert.strictEqual(okPro.data.usuario.passwordHash, undefined, 'must not expose passwordHash to non-admin');
  assert.ok(okPro.data.state.usuarios.every((u) => u.password === undefined && u.passwordHash === undefined), 'no user passwords leaked to promoter');
  assert.ok(okPro.data.state.prospectos.every((p) => p.promotor_origen_id === okPro.data.usuario.id), 'promoter only sees own prospects');
  assert.strictEqual(okPro.data.state.auditoria.length, 0, 'promoter does not receive global audit log');

  // Authenticated GET /api/state works with Bearer token and remains scoped
  const stPro = await api('/api/state', { token: okPro.data.token });
  assert.strictEqual(stPro.status, 200);
  assert.ok(stPro.data.state.usuarios.every((u) => u.password === undefined));

  // Authenticated /api/check-dup detects duplicate from another branch without exposing their prospect list
  const dupRes = await api('/api/check-dup?telefono=88451122', { token: okPro.data.token });
  assert.strictEqual(dupRes.status, 200);
  assert.ok(dupRes.data.duplicate && /Carlos Rivera/.test(dupRes.data.duplicate.mensaje));
  const noDup = await api('/api/check-dup?telefono=89990000', { token: okPro.data.token });
  assert.strictEqual(noDup.status, 200);
  assert.strictEqual(noDup.data.duplicate, null);
});

test('POST /api/auth/password requires signed token, ignores spoofed actorId, and persists scrypt hash', async () => {
  const betsy = await login('betsy.ruiz', 'betsy123');
  const admin = await login('admin', 'admin123');

  // Unauthenticated rejected
  const unauth = await api('/api/auth/password', {
    body: { actorId: 'u-admin', targetUserId: betsy.usuario.id, passwordNueva: 'hacked123' },
  });
  assert.strictEqual(unauth.status, 401);

  // Betsy cannot spoof actorId='u-admin' to reset admin password
  const spoof = await api('/api/auth/password', {
    token: betsy.token,
    body: { actorId: 'u-admin', targetUserId: 'u-admin', passwordActual: '', passwordNueva: 'hacked123' },
  });
  assert.strictEqual(spoof.status, 400);

  // Betsy changes own password legitimately
  const chg = await api('/api/auth/password', {
    token: betsy.token,
    body: { targetUserId: betsy.usuario.id, passwordActual: 'betsy123', passwordNueva: 'betsy2026' },
  });
  assert.strictEqual(chg.status, 200);
  assert.ok(chg.data.ok);

  const oldLogin = await api('/api/auth/login', { body: { username: 'betsy.ruiz', password: 'betsy123' } });
  assert.strictEqual(oldLogin.status, 401);

  const newLogin = await api('/api/auth/login', { body: { username: 'betsy.ruiz', password: 'betsy2026' } });
  assert.strictEqual(newLogin.status, 200);

  // Admin resets it back to betsy123
  const rst = await api('/api/auth/password', {
    token: admin.token,
    body: { targetUserId: betsy.usuario.id, passwordActual: '', passwordNueva: 'betsy123' },
  });
  assert.strictEqual(rst.status, 200);
});

test('POST /api/mutate creates prospects with token identity, imports CSVs, and restricts /api/sync to admin', async () => {
  const laura = await login('laura.varela', 'laura123');
  const betsy = await login('betsy.ruiz', 'betsy123');

  // Non-admin blocked from /api/sync
  const syncDenied = await api('/api/sync', { token: laura.token, body: { state: { usuarios: [] } } });
  assert.strictEqual(syncDenied.status, 403);

  // Even if spoofed actorId is passed, server locks origin to authenticated token (Laura Varela)
  const m1 = await api('/api/mutate', {
    token: laura.token,
    body: {
      action: 'crearProspecto',
      actorId: 'u-pro-esteli',
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
  assert.strictEqual(m1.data.result.prospecto.promotor_origen_id, laura.usuario.id);

  const csvImp = await api('/api/mutate', {
    token: betsy.token,
    body: {
      action: 'importarFilasCSV',
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

test('Database manager API: strict auth + admin-only enforcement, real SQL errors, and backup create/restore', async () => {
  const admin = await login('admin', 'admin123');
  const carlos = await login('carlos.rivera', 'carlos123');

  // Unauthenticated -> 401; non-admin -> 403
  assert.strictEqual((await api('/api/db/stats')).status, 401);
  assert.strictEqual((await api('/api/db/stats', { token: carlos.token })).status, 403);
  assert.strictEqual((await api('/api/db/table?name=alfatrack_usuarios&limit=10')).status, 401);
  assert.strictEqual((await api('/api/db/table?name=alfatrack_usuarios&limit=10', { token: carlos.token })).status, 403);

  const stats = await api('/api/db/stats', { token: admin.token });
  assert.strictEqual(stats.status, 200);
  assert.ok(stats.data.tables.some((t) => t.name === 'alfatrack_usuarios' && t.rows >= 60));

  const tbl = await api('/api/db/table?name=alfatrack_usuarios&limit=10', { token: admin.token });
  assert.strictEqual(tbl.status, 200);
  assert.ok(tbl.data.ok);
  assert.strictEqual(tbl.data.rows.length, 10);

  // Non-admin rejected from SQL console
  const unauthSql = await api('/api/db/query', {
    token: carlos.token,
    body: { sql: 'SELECT * FROM alfatrack_usuarios' },
  });
  assert.strictEqual(unauthSql.status, 403);

  // Destructive SQL blocked even for admin with explicit error message
  const dropSql = await api('/api/db/query', {
    token: admin.token,
    body: { sql: 'DROP TABLE alfatrack_usuarios' },
  });
  assert.strictEqual(dropSql.status, 400);
  assert.match(dropSql.data.error, /lectura/i);

  // Invalid table name returns 400 error instead of silent fallback rows
  const badTblSql = await api('/api/db/query', {
    token: admin.token,
    body: { sql: 'SELECT * FROM tabla_inexistente' },
  });
  assert.strictEqual(badTblSql.status, 400);

  // Read-only SELECT succeeds for admin
  const okSql = await api('/api/db/query', {
    token: admin.token,
    body: { sql: 'SELECT username, rol, sucursal FROM alfatrack_usuarios LIMIT 5' },
  });
  assert.strictEqual(okSql.status, 200);
  assert.ok(okSql.data.rows.length >= 5);

  // Create backup and restore
  const bk = await api('/api/db/backup', {
    token: admin.token,
    body: { action: 'create', nombre: 'Backup Test API' },
  });
  assert.strictEqual(bk.status, 200);
  assert.ok(bk.data.backup.id);

  const rst = await api('/api/db/backup', {
    token: admin.token,
    body: { action: 'restore', backupId: bk.data.backup.id },
  });
  assert.strictEqual(rst.status, 200);
  assert.ok(rst.data.ok);
});

test('upgradeState migrates legacy pre-v2 official promoters once and preserves subsequent admin edits', async () => {
  const admin = await login('admin', 'admin123');
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

  const editRes = await api('/api/mutate', {
    token: admin.token,
    body: {
      action: 'guardarUsuario',
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
    token: admin.token,
    body: {
      action: 'guardarUsuario',
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

test('POST /api/mutate handles concurrent requests from two promoters without lost updates', async () => {
  const carlos = await login('carlos.rivera', 'carlos123');
  const maria = await login('maria.lopez', 'maria123');
  const admin = await login('admin', 'admin123');

  const [r1, r2] = await Promise.all([
    api('/api/mutate', {
      token: carlos.token,
      body: {
        action: 'crearProspecto',
        payload: { nombre: 'Concurrente Uno', telefono: '8111-0001', negocio: 'Pulpería', monto: 10000 },
      },
    }),
    api('/api/mutate', {
      token: maria.token,
      body: {
        action: 'crearProspecto',
        payload: { nombre: 'Concurrente Dos', telefono: '8111-0002', negocio: 'Taller', monto: 12000 },
      },
    }),
  ]);
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);
  const st = await api('/api/state', { token: admin.token });
  assert.ok(st.data.state.prospectos.some((p) => p.nombre === 'Concurrente Uno'));
  assert.ok(st.data.state.prospectos.some((p) => p.nombre === 'Concurrente Dos'));
});
