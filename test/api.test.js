const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Use isolated local DB file for deterministic API integration tests
process.env.ALFATRACK_DB_MODE = 'local';
process.env.ALFATRACK_DB_FILE = path.join(os.tmpdir(), `alfatrack_api_test_${Date.now()}.json`);
process.env.ALFATRACK_SESSION_SECRET = 'test-hmac-secret-alfatrack-2026';
process.env.ALFATRACK_INTEGRATION_KEY = 'test-cc-integration-key-2026';

const { createServer } = require('../server.js');
const DB = require('../db.js');
const SheetsBridge = require('../sheets-bridge.js');

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
  // Private credential files and backend source files must not be served over HTTP
  for (const blocked of ['/CREDENCIALES_ALFATRACK.txt', '/CREDENCIALES_USUARIOS.md', '/db.js', '/sheets-bridge.js', '/server.js', '/package.json', '/.env.local']) {
    const r = await fetch(baseUrl + blocked);
    assert.strictEqual(r.status, 403, `expected 403 for ${blocked}, got ${r.status}`);
  }
  // Malformed URL encoding returns 400 and never crashes server
  const badUrl = await fetch(baseUrl + '/%E0%A4%A');
  assert.strictEqual(badUrl.status, 400);
  // Malformed cookie header returns 401 and never crashes API with 500
  const badCookie = await api('/api/state', { headers: { Cookie: 'corrupt=%E0%A4%A' } });
  assert.strictEqual(badCookie.status, 401);
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

test('Call Center unification API: Python ingest (idempotent, auth, branch routing) + Web capture <-> Google Sheets bidirectional sync', async () => {
  const sheetsCalls = [];
  let nextMockRow = 205;
  let failNextAppend = false;

  SheetsBridge.setTransport(async (req) => {
    sheetsCalls.push(req);
    if (req.op === 'append') {
      await new Promise((r) => setTimeout(r, 30));
      if (failNextAppend) {
        failNextAppend = false;
        return { ok: false, error: 'Simulated Google Sheets timeout' };
      }
      const row = nextMockRow++;
      return { ok: true, sheetRow: row, range: `Clientes!A${row}:J${row}`, values: req.values };
    }
    if (req.op === 'update_followup') {
      return { ok: true, sheetRow: req.row, range: `Clientes!K${req.row}:O${req.row}`, values: req.values };
    }
    return { ok: false, error: 'Unknown op' };
  });

  try {
    const betsy = await login('betsy.ruiz', 'betsy123');
    const gerEsteli = await login('gerente.esteli', 'esteli123');
    const proEsteli = await login('carlos.rivera', 'carlos123');
    const admin = await login('admin', 'admin123');

    // 1. Auth enforcement on /api/integrations/callcenter/ingest and /status
    assert.strictEqual((await api('/api/integrations/callcenter/ingest', { body: { nombre: 'Sin Auth', telefono: '81119999', sucursal: 'Estelí' } })).status, 401);
    assert.strictEqual((await api('/api/integrations/callcenter/ingest', { headers: { 'X-AlfaTrack-Key': 'wrong-key' }, body: { nombre: 'Bad Key', telefono: '81119999', sucursal: 'Estelí' } })).status, 401);
    assert.strictEqual((await api('/api/integrations/callcenter/ingest', { token: proEsteli.token, body: { nombre: 'Promotor No', telefono: '81119999', sucursal: 'Estelí' } })).status, 403);
    assert.strictEqual((await api('/api/integrations/callcenter/status')).status, 401);
    assert.strictEqual((await api('/api/integrations/callcenter/status', { token: proEsteli.token })).status, 403);

    // 2. Python app pushes a new Call Center case via X-AlfaTrack-Key (must NOT echo back to Google Sheets!)
    const ing1 = await api('/api/integrations/callcenter/ingest', {
      headers: { 'X-AlfaTrack-Key': process.env.ALFATRACK_INTEGRATION_KEY },
      body: {
        externalId: 'cc-py-r180-test',
        sheetRow: 180,
        agente: 'Xochilt',
        nombre: 'Sofía Martínez Python',
        tipoCredito: 'NV(NUEVO)',
        telefono: '8444-5566',
        direccion: 'Estelí, Barrio Central',
        negocio: 'Comedor / Fritanga',
        emailGerente: 'gerenteesteli7@gmail.com',
        sucursal: 'Sucursal Esteli',
        monto: 'C$ 18,000',
        plataforma: 'Facebook',
        detalle: 'Campaña Crédito Rápido',
      },
    });
    assert.strictEqual(ing1.status, 201, JSON.stringify(ing1.data));
    assert.strictEqual(ing1.data.ok, true);
    assert.strictEqual(ing1.data.deduplicated, false);
    assert.strictEqual(ing1.data.prospecto.sucursal, 'Estelí');
    assert.strictEqual(ing1.data.prospecto.estado, 'pescado');
    assert.strictEqual(ing1.data.prospecto.sheetSync.sheetRow, 180);
    assert.strictEqual(sheetsCalls.length, 0, 'ingest from Python must NOT write duplicate row back to Google Sheets');

    // Idempotent replay -> 200 deduplicated
    const ingReplay = await api('/api/integrations/callcenter/ingest', {
      headers: { 'X-AlfaTrack-Key': process.env.ALFATRACK_INTEGRATION_KEY },
      body: {
        externalId: 'cc-py-r180-test',
        sheetRow: 180,
        agente: 'Xochilt',
        nombre: 'Sofía Martínez Python',
        telefono: '8444-5566',
        sucursal: 'Sucursal Esteli',
      },
    });
    assert.strictEqual(ingReplay.status, 200);
    assert.strictEqual(ingReplay.data.deduplicated, true);
    assert.strictEqual(ingReplay.data.prospecto.id, ing1.data.prospecto.id);

    // Different case with same phone -> 409 duplicate
    const ingDupPhone = await api('/api/integrations/callcenter/ingest', {
      headers: { 'X-AlfaTrack-Key': process.env.ALFATRACK_INTEGRATION_KEY },
      body: {
        externalId: 'cc-py-r181-dup',
        sheetRow: 181,
        agente: 'Eva',
        nombre: 'Otra Persona',
        telefono: '84445566',
        sucursal: 'Sucursal Managua',
      },
    });
    assert.strictEqual(ingDupPhone.status, 409);
    assert.strictEqual(ingDupPhone.data.duplicate, true);

    // Branch Manager sees Python lead immediately; promoter does NOT until distributed
    const gerState = await api('/api/state', { token: gerEsteli.token });
    assert.ok(gerState.data.state.prospectos.some((p) => p.id === ing1.data.prospecto.id));
    const proStateBefore = await api('/api/state', { token: proEsteli.token });
    assert.ok(!proStateBefore.data.state.prospectos.some((p) => p.id === ing1.data.prospecto.id));

    // 3. Dual entry: Call Center creates Directo lead INSIDE AlfaTrack Web -> appends to Google Sheets (triggering manager email!)
    const webCC = await api('/api/mutate', {
      token: betsy.token,
      body: {
        action: 'capturarCasoCallCenterDirecto',
        payload: {
          nombre: 'Roberto Sánchez Web',
          telefono: '8444-7788',
          sucursal: 'Estelí',
          tipoCredito: 'RP(REPRESTAMO)',
          monto: 25000,
          negocio: 'Taller',
          direccion: 'Estelí, salida norte',
          plataforma: 'Whatsapp',
          campana: 'WhatsApp Directo',
          notas: 'Solicita visita mañana',
        },
      },
    });
    assert.strictEqual(webCC.status, 200, JSON.stringify(webCC.data));
    const pWeb = webCC.data.result.prospecto;
    assert.strictEqual(pWeb.estado, 'pescado');
    assert.strictEqual(pWeb.sheetSync.status, 'synced');
    assert.strictEqual(pWeb.sheetSync.sheetRow, 205);
    assert.strictEqual(sheetsCalls.length, 1);
    assert.strictEqual(sheetsCalls[0].op, 'append');
    assert.strictEqual(sheetsCalls[0].values[0], 'Betsy Ruiz');
    assert.strictEqual(sheetsCalls[0].values[2], 'Roberto Sánchez Web');
    assert.strictEqual(sheetsCalls[0].values[7], 'gerenteesteli7@gmail.com');
    assert.strictEqual(sheetsCalls[0].values[8], 'Sucursal Esteli');
    assert.strictEqual(sheetsCalls[0].values[9], 'C$ 25,000');

    // 4. Branch Manager distributes the Web Call Center lead to Carlos Rivera -> updates AlfaTrack AND syncs K:O in Google Sheets!
    const dist = await api('/api/mutate', {
      token: gerEsteli.token,
      body: {
        action: 'cambiarEstado',
        payload: {
          id: pWeb.id,
          estado: 'seguimiento',
          datos: {
            asignadoPromotorId: proEsteli.usuario.id,
            instrucciones: 'Carlos, contactar hoy y evaluar taller.',
          },
        },
      },
    });
    assert.strictEqual(dist.status, 200, JSON.stringify(dist.data));
    assert.strictEqual(sheetsCalls.length, 2);
    assert.strictEqual(sheetsCalls[1].op, 'update_followup');
    assert.strictEqual(sheetsCalls[1].row, 205);
    assert.strictEqual(sheetsCalls[1].values[0], 'Proceso');
    assert.match(sheetsCalls[1].values[1], /Carlos, contactar hoy/);
    assert.strictEqual(sheetsCalls[1].values[2], 'Carlos Rivera');

    // Promoter now sees distributed lead and can add follow-up note (which also syncs K:O!)
    const proStateAfter = await api('/api/state', { token: proEsteli.token });
    assert.ok(proStateAfter.data.state.prospectos.some((p) => p.id === pWeb.id));
    const noteRes = await api('/api/mutate', {
      token: proEsteli.token,
      body: { action: 'agregarNota', payload: { id: pWeb.id, texto: 'Visitado, documentación completa.' } },
    });
    assert.strictEqual(noteRes.status, 200);
    assert.strictEqual(sheetsCalls.length, 3);
    assert.match(sheetsCalls[2].values[1], /Visitado, documentación completa/);

    // Manager closes as desembolsado -> syncs Desembolsado + monto to Google Sheets!
    const closeRes = await api('/api/mutate', {
      token: gerEsteli.token,
      body: { action: 'cambiarEstado', payload: { id: pWeb.id, estado: 'desembolsado', datos: { monto: 25000 } } },
    });
    assert.strictEqual(closeRes.status, 200);
    assert.strictEqual(sheetsCalls.length, 4);
    assert.strictEqual(sheetsCalls[3].values[0], 'Desembolsado');
    assert.strictEqual(sheetsCalls[3].values[3], 25000);

    // 5. Resilience: transient Google Sheets failure still saves AlfaTrack lead; manager moves it to seguimiento + note;
    //    concurrent reintentarSyncSheet calls append ONLY ONCE AND immediately chain K:O follow-up sync!
    failNextAppend = true;
    const webFail = await api('/api/mutate', {
      token: betsy.token,
      body: {
        action: 'capturarCasoCallCenterDirecto',
        payload: { nombre: 'Cliente Reintento Sheet', telefono: '8444-9900', sucursal: 'Estelí', monto: 12000 },
      },
    });
    assert.strictEqual(webFail.status, 200);
    const pRetryId = webFail.data.result.prospecto.id;
    assert.strictEqual(webFail.data.result.prospecto.sheetSync.status, 'error');

    // Manager distributes BEFORE Sheets append recovers
    const distBeforeRetry = await api('/api/mutate', {
      token: gerEsteli.token,
      body: {
        action: 'cambiarEstado',
        payload: { id: pRetryId, estado: 'seguimiento', datos: { asignadoPromotorId: proEsteli.usuario.id, instrucciones: 'Llamar en cuanto vuelva Sheets' } },
      },
    });
    assert.strictEqual(distBeforeRetry.status, 200);

    const callsBeforeRetry = sheetsCalls.length;
    // Fire two concurrent retry clicks -> must only append ONCE and must chain update_followup for K:O!
    const [retry1, retry2] = await Promise.all([
      api('/api/mutate', { token: betsy.token, body: { action: 'reintentarSyncSheet', payload: { id: pRetryId } } }),
      api('/api/mutate', { token: betsy.token, body: { action: 'reintentarSyncSheet', payload: { id: pRetryId } } }),
    ]);
    assert.strictEqual(retry1.status, 200);
    assert.strictEqual(retry2.status, 200);
    assert.strictEqual(retry1.data.result.prospecto.sheetSync.status, 'synced');
    assert.strictEqual(retry1.data.result.prospecto.sheetSync.sheetRow, 206);
    const retryCalls = sheetsCalls.slice(callsBeforeRetry);
    assert.strictEqual(retryCalls.filter((c) => c.op === 'append').length, 1, 'concurrent retries must NOT append duplicate rows');
    assert.strictEqual(retryCalls.filter((c) => c.op === 'update_followup').length, 1, 'delayed append must chain K:O follow-up sync');
    assert.strictEqual(retryCalls.find((c) => c.op === 'update_followup').values[0], 'Proceso');

    // 6. Status endpoint reports accurate summary for Admin
    const stCC = await api('/api/integrations/callcenter/status', { token: admin.token });
    assert.strictEqual(stCC.status, 200);
    assert.strictEqual(stCC.data.integrationKeyConfigured, true);
    assert.strictEqual(stCC.data.stats.totalDirectos, 3);
    assert.strictEqual(stCC.data.stats.syncedToSheet, 3);
    assert.strictEqual(stCC.data.stats.fromPythonApp, 1);
    assert.strictEqual(stCC.data.stats.fromWebApp, 2);
  } finally {
    SheetsBridge.setTransport(null);
  }
});

test('SheetsBridge helpers: Managua timestamp, sheet row formatting, status mapping & local-mode live-call guard', async () => {
  SheetsBridge.setTransport(null);
  // In local test mode without mock transport, appendCallCenterRow must NOT hit real Google Sheets
  const skipped = await SheetsBridge.appendCallCenterRow({
    nombre: 'No Live Call', telefono: '88881111', sucursal: 'Estelí', monto: 5000,
  });
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.skipped, true);

  assert.strictEqual(SheetsBridge.formatDateManagua('2026-11-19T20:30:45.000Z'), '19/11/2026 14:30:45');
  assert.strictEqual(SheetsBridge.formatTelefonoSheet('83633886', '77771111'), '8363-3886 / 7777-1111');
  assert.strictEqual(SheetsBridge.formatMontoSheet(15000), 'C$ 15,000');
  assert.strictEqual(SheetsBridge.formatMontoSheet(0), '-');
  assert.strictEqual(SheetsBridge.mapEstadoToSheetStatus('pescado'), 'Pendiente');
  assert.strictEqual(SheetsBridge.mapEstadoToSheetStatus('seguimiento'), 'Proceso');
  assert.strictEqual(SheetsBridge.mapEstadoToSheetStatus('desembolsado'), 'Desembolsado');
  assert.strictEqual(SheetsBridge.mapEstadoToSheetStatus('descartado'), 'Denegado');

  const row = SheetsBridge.buildAppendRow({
    cc: { agente: 'Eva', monto: 12000, rubro: 'Pulpería', direccionVisita: 'Barrio Sur' },
    creado: '2026-11-19T20:30:45.000Z',
    nombre: 'Ana Pérez',
    tipoCredito: 'NV(NUEVO)',
    telefono: '88991122',
    emailGerente: 'gerentesebaco@gmail.com',
    sucursal: 'Sébaco',
  });
  assert.deepStrictEqual(row, [
    'Eva', '19/11/2026 14:30:45', 'Ana Pérez', 'NV(NUEVO)', '8899-1122',
    'Barrio Sur', 'Pulpería', 'gerentesebaco@gmail.com', 'Sucursal Sebaco', 'C$ 12,000',
  ]);

  // Formula injection neutralization + multiline flattening (keeps '-' placeholder intact)
  const dangerous = SheetsBridge.buildAppendRow({
    cc: { agente: '=HYPERLINK("http://evil")', monto: 0, rubro: 'Taller\nCentral', direccionVisita: '+cmd|calc' },
    creado: '2026-11-19T20:30:45.000Z',
    nombre: '=IMPORTXML("http://x")',
    tipoCredito: 'NV(NUEVO)',
    telefono: '88991122',
    emailGerente: 'gerentesebaco@gmail.com',
    sucursal: 'Sébaco',
  });
  assert.strictEqual(dangerous[0], `'=HYPERLINK("http://evil")`);
  assert.strictEqual(dangerous[2], `'=IMPORTXML("http://x")`);
  assert.strictEqual(dangerous[5], `'+cmd|calc`);
  assert.strictEqual(dangerous[6], 'Taller Central');
  assert.strictEqual(dangerous[9], '-');

  // Direct discard from pescado falls back to manager actor name in collaborator column
  const fuDiscard = SheetsBridge.buildFollowUpRow({
    estado: 'descartado',
    motivoDescarte: 'No contesta',
    gerencia: null,
    historial: [
      { rol: 'callcenter', usuario: 'Betsy Ruiz', accion: 'Caso Call Center Directo creado', detalle: '' },
      { rol: 'gerente', usuario: 'Gerente Estelí', accion: 'Pescado → Descartado', detalle: 'Motivo: No contesta' },
    ],
    actualizado: '2026-11-19T21:00:00.000Z',
  }, { usuarios: [] });
  assert.strictEqual(fuDiscard[0], 'Denegado');
  assert.strictEqual(fuDiscard[2], 'Gerente Estelí');
});

test('SheetsBridge live HTTP protocol: RS256 JWT cryptographic verification + OAuth2 -> Drive v3 -> Sheets v4 PUT A:J & K:O', async () => {
  const crypto = require('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fakeCreds = {
    client_email: 'test-sa@alfacredit-app.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  // 1. Verify RS256 JWT signature & claims directly against publicKey
  const jwt = SheetsBridge.signServiceAccountJwt(fakeCreds);
  const [hdrB64, claimB64, sigB64] = jwt.split('.');
  assert.ok(hdrB64 && claimB64 && sigB64);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${hdrB64}.${claimB64}`);
  verifier.end();
  const sigBuf = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.strictEqual(verifier.verify(publicKey, sigBuf), true, 'JWT RS256 signature must verify');
  const claims = JSON.parse(Buffer.from(claimB64, 'base64url').toString('utf8'));
  assert.strictEqual(claims.iss, fakeCreds.client_email);
  assert.match(claims.scope, /spreadsheets/);

  // 2. Drive the real HTTP path with mocked globalThis.fetch (no real network traffic)
  const origFetch = globalThis.fetch;
  const origMode = process.env.ALFATRACK_SHEETS_MODE;
  const origSa = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const origId = process.env.GOOGLE_SHEETS_ID;
  const calls = [];
  let currentColC = [['Nombre'], ['Cliente 1'], ['Cliente 2']];

  SheetsBridge.setTransport(null);
  SheetsBridge.resetCaches();
  process.env.ALFATRACK_SHEETS_MODE = 'live';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(fakeCreds);
  delete process.env.GOOGLE_SHEETS_ID;

  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.mock-token', expires_in: 3600 }), { status: 200 });
    }
    if (u.startsWith('https://www.googleapis.com/drive/v3/files')) {
      return new Response(JSON.stringify({ files: [{ id: 'sheet-id-123', name: 'base de datos' }] }), { status: 200 });
    }
    if (u.includes('/values/') && (!opts || opts.method === 'GET')) {
      return new Response(JSON.stringify({ values: currentColC }), { status: 200 });
    }
    if (u.includes('/values/') && opts && opts.method === 'PUT') {
      const parsed = JSON.parse(opts.body);
      if (parsed.range.includes('!A')) currentColC.push([parsed.values[0][2]]);
      return new Response(JSON.stringify({ updatedRange: parsed.range, updatedRows: 1 }), { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  };

  try {
    // Concurrent appends must serialize through appendLock and get distinct rows (#4 and #5)
    const [a1, a2] = await Promise.all([
      SheetsBridge.appendCallCenterRow({
        cc: { agente: 'Betsy Ruiz', monto: 10000, rubro: 'Pulpería', direccionVisita: 'Centro' },
        creado: '2026-11-19T20:30:45.000Z', nombre: 'Primero', tipoCredito: 'NV(NUEVO)',
        telefono: '88001122', emailGerente: 'gerenteesteli7@gmail.com', sucursal: 'Estelí',
      }),
      SheetsBridge.appendCallCenterRow({
        cc: { agente: 'Eva', monto: 15000, rubro: 'Taller', direccionVisita: 'Norte' },
        creado: '2026-11-19T20:31:00.000Z', nombre: 'Segundo', tipoCredito: 'NV(NUEVO)',
        telefono: '88003344', emailGerente: 'gerenteleon8@gmail.com', sucursal: 'León',
      }),
    ]);
    assert.strictEqual(a1.ok, true, a1.error);
    assert.strictEqual(a2.ok, true, a2.error);
    assert.strictEqual(a1.sheetRow, 4);
    assert.strictEqual(a2.sheetRow, 5, 'serialized concurrent appends must not collide on same row');
    assert.strictEqual(calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length, 1, 'OAuth token must be cached');
    assert.strictEqual(calls.filter((c) => c.url.includes('drive/v3/files')).length, 1, 'Spreadsheet ID must be cached');

    const fu = await SheetsBridge.updateCallCenterFollowUp({
      estado: 'desembolsado',
      desembolso: { monto: 10000 },
      asignadoPromotorNombre: 'Carlos Rivera',
      gerencia: { gerente: 'Gerente Estelí', instrucciones: 'Aprobado' },
      sheetSync: { sheetRow: 4 },
      actualizado: '2026-11-19T22:00:00.000Z',
    }, { usuarios: [] });
    assert.strictEqual(fu.ok, true, fu.error);
    assert.strictEqual(fu.range, "'Clientes'!K4:O4");
  } finally {
    globalThis.fetch = origFetch;
    if (origMode === undefined) delete process.env.ALFATRACK_SHEETS_MODE;
    else process.env.ALFATRACK_SHEETS_MODE = origMode;
    if (origSa === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = origSa;
    if (origId === undefined) delete process.env.GOOGLE_SHEETS_ID;
    else process.env.GOOGLE_SHEETS_ID = origId;
    SheetsBridge.resetCaches();
  }
});
