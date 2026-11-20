const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const fresh = () => C.seed();
const U = (s, id) => s.usuarios.find((u) => u.id === id);
const P = (s, nombre) => s.prospectos.find((p) => p.nombre === nombre);
const datos = (o) => Object.assign({ nombre: 'Cliente Prueba', telefono: '8000-0001', direccion: 'X', negocio: 'Pulpería', monto: 1000 }, o);

test('seed: exact 79 real collaborators, >=8 prospects covering every state, all operational branches covered', () => {
  const s = fresh();
  assert.strictEqual(s.usuarios.length, 79);
  assert.strictEqual(s.usuarios.filter((u) => u.rol === 'admin').length, 1);
  assert.strictEqual(s.usuarios.filter((u) => u.rol === 'callcenter').length, 3);
  assert.strictEqual(s.usuarios.filter((u) => u.rol === 'gerente').length, 8);
  assert.strictEqual(s.usuarios.filter((u) => u.rol === 'promotor').length, 13);
  assert.strictEqual(s.usuarios.filter((u) => u.rol === 'gestor').length, 54);
  assert.strictEqual(s.usuarios.find((u) => u.username === 'luis.mendez').cedula, '001-231200-1055G');
  assert.ok(s.prospectos.length >= 8);
  C.ESTADOS.forEach((e) => assert.ok(s.prospectos.some((p) => p.estado === e), e));
  ['Estelí', 'Managua', 'Masaya', 'León', 'Juigalpa', 'Sébaco', 'Jinotepe', 'Rivas'].forEach((suc) => {
    assert.ok(s.usuarios.some((u) => u.rol === 'gerente' && u.sucursal === suc), `gerente ${suc}`);
    assert.ok(s.usuarios.some((u) => u.rol === 'gestor' && u.sucursal === suc), `gestor ${suc}`);
  });
  ['Managua', 'Masaya', 'León', 'Juigalpa', 'Sébaco', 'Jinotepe'].forEach((suc) =>
    assert.ok(s.usuarios.some((u) => u.rol === 'promotor' && u.sucursal === suc), `promotor ${suc}`));
  assert.ok(s.notificaciones.some((n) => !n.leida), 'some unread notifications for the bell');
  assert.ok(JSON.parse(JSON.stringify(s)), 'serializable');
});

test('crearProspecto: origin comes from logged user, not form data', () => {
  const s = fresh();
  const pro = U(s, 'u-pro-leo-araceli');
  const r = C.crearProspecto(s, pro, datos({ promotor_origen_id: 'u-pro-mga-lester', promotor_nombre: 'Hacker', sucursal: 'Managua' }));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.prospecto.promotor_origen_id, 'u-pro-leo-araceli');
  assert.strictEqual(r.prospecto.promotor_nombre, 'Araceli De Jesús Juárez');
  assert.strictEqual(r.prospecto.sucursal, 'León');
  assert.strictEqual(r.prospecto.estado, 'nuevo');
  assert.strictEqual(r.prospecto.historial.length, 1);
});

test('phone validation: exactly 8 digits', () => {
  assert.ok(C.validarTelefono('8888-1234'));
  assert.ok(C.validarTelefono('8888 1234'));
  assert.ok(!C.validarTelefono('8888123'));
  assert.ok(!C.validarTelefono('888812345'));
  assert.ok(!C.validarTelefono(''));
  const s = fresh();
  assert.ok(!C.crearProspecto(s, U(s, 'u-pro-leo-araceli'), datos({ telefono: '123' })).ok);
});

test('duplicates by phone or cédula are blocked and name the original promotor', () => {
  const s = fresh();
  const otro = U(s, 'u-pro-mas-fanny');
  let r = C.crearProspecto(s, otro, datos({ telefono: '88451122' })); // Juana, by Lester Antonio De La Rocha Rivera
  assert.ok(!r.ok);
  assert.match(r.error, /Lester Antonio De La Rocha Rivera/);
  r = C.crearProspecto(s, otro, datos({ cedula: '001 150385 0002k' }));
  assert.ok(!r.ok);
  assert.match(r.error, /cédula/);
  // optional cédula empty must not match other empty cédulas
  r = C.crearProspecto(s, otro, datos({ telefono: '80009999', cedula: '' }));
  assert.ok(r.ok, r.error);
});

test('only promotores can create; inactive promotor cannot', () => {
  const s = fresh();
  assert.ok(!C.crearProspecto(s, U(s, 'u-cc-betsy'), datos()).ok);
  const pro = U(s, 'u-pro-leo-araceli');
  C.toggleUsuario(s, U(s, 'u-admin'), pro.id);
  assert.ok(!C.crearProspecto(s, pro, datos()).ok);
});

test('pescado requires confirmation fields and notifies gerente of branch + promotor', () => {
  const s = fresh();
  const cc = U(s, 'u-cc-betsy');
  const p = P(s, 'Juana María Rodríguez');
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'pescado', { monto: 0 }).ok);
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'pescado', { monto: 100, rubro: 'x', direccionVisita: 'y' }).ok, 'comments required');
  const r = C.cambiarEstado(s, cc, p.id, 'pescado', { monto: 100, rubro: 'Pulpería', direccionVisita: 'Casa', comentarios: 'OK' });
  assert.ok(r.ok, r.error);
  const dest = r.notificaciones.map((n) => n.userId).sort();
  const gerManagua = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Managua').id;
  assert.deepStrictEqual(dest, [gerManagua, 'u-pro-mga-lester'].sort());
  const msg = r.notificaciones.find((n) => n.userId === 'u-pro-mga-lester').texto;
  assert.strictEqual(msg, '¡Atención! Call Center ya calificó a tu cliente Juana María Rodríguez y fue enviado a tu Gerente de Sucursal.');
  assert.strictEqual(p.promotor_origen_id, 'u-pro-mga-lester');
});

test('gerente assigns gestor without replacing origin; other branch gerente denied', () => {
  const s = fresh();
  const p = P(s, 'Ana Gabriela Sequeira'); // Masaya, pescado
  const gerMasaya = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Masaya');
  const gerLeon = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'León');
  assert.ok(!C.cambiarEstado(s, gerLeon, p.id, 'seguimiento', { instrucciones: 'x' }).ok);
  assert.ok(!C.cambiarEstado(s, gerMasaya, p.id, 'seguimiento', {}).ok, 'instructions required');
  const r = C.cambiarEstado(s, gerMasaya, p.id, 'seguimiento', { gestorId: 'u-ges-mas-diego', instrucciones: 'Visitar lunes' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(p.promotor_origen_id, 'u-pro-mas-fanny');
  assert.strictEqual(p.gestorId, 'u-ges-mas-diego');
  assert.deepStrictEqual(r.notificaciones.map((n) => n.userId).sort(), ['u-ges-mas-diego', 'u-pro-mas-fanny']);
  assert.match(r.notificaciones.find((n) => n.userId === 'u-pro-mas-fanny').texto, /Visitar lunes/);
  // promoter of another branch can't see it, gestor can
  assert.ok(!C.puedeVer(U(s, 'u-pro-leo-araceli'), p));
  assert.ok(C.puedeVer(U(s, 'u-ges-mas-diego'), p));
  assert.ok(C.cambiarEstado(s, U(s, 'u-ges-mas-diego'), p.id, 'desembolsado', {}).ok);
});

test('descartado requires motivo; invalid transitions rejected', () => {
  const s = fresh();
  const cc = U(s, 'u-cc-betsy');
  const p = P(s, 'Rosa Elena Calero');
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'descartado', {}).ok);
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'desembolsado', {}).ok, 'call center cannot disburse');
  assert.ok(!C.cambiarEstado(s, U(s, 'u-pro-jin-nydia'), p.id, 'pescado', {}).ok, 'promotor cannot move states');
  assert.ok(C.cambiarEstado(s, cc, p.id, 'descartado', { motivo: 'Fuera de zona' }).ok);
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'gestion', {}).ok, 'closed for call center');
});

test('history is append-only and records every change with user', () => {
  const s = fresh();
  const p = P(s, 'José Santos Moreno');
  const roles = p.historial.map((h) => h.rol);
  assert.deepStrictEqual(roles, ['promotor', 'callcenter', 'gerente', 'gerente']);
  p.historial.forEach((h) => assert.ok(h.ts && h.usuario && h.accion));
  const n = p.historial.length;
  C.agregarNota(s, U(s, 'u-pro-mga-lester'), p.id, 'Cliente satisfecho');
  assert.strictEqual(p.historial.length, n + 1);
});

test('admin edits everything except the origin lock', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  const p = P(s, 'Rosa Elena Calero');
  assert.ok(!C.adminEditarProspecto(s, U(s, 'u-ger-esteli'), p.id, { nombre: 'X' }).ok);
  let r = C.adminEditarProspecto(s, admin, p.id, { promotor_origen_id: 'u-pro-leo-araceli' });
  assert.ok(!r.ok);
  assert.match(r.error, /CANDADO/);
  r = C.adminEditarProspecto(s, admin, p.id, { telefono: '88451122' });
  assert.ok(!r.ok, 'duplicate on edit');
  r = C.adminEditarProspecto(s, admin, p.id, { nombre: 'Rosa E. Calero', monto: 9000, gestorId: 'u-ges-leo-laleska' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(p.nombre, 'Rosa E. Calero');
  assert.strictEqual(p.promotor_origen_id, 'u-pro-jin-nydia');
  assert.match(p.historial.at(-1).detalle, /monto/);
  assert.strictEqual(r.notificaciones[0].userId, 'u-ges-leo-laleska');
  // admin can force any state
  assert.ok(C.cambiarEstado(s, admin, p.id, 'desembolsado', { monto: 9000 }).ok);
});

test('admin users and config management', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  let r = C.guardarUsuario(s, admin, { nombre: 'Nuevo Promotor', rol: 'promotor', sucursal: 'Rivas' });
  assert.ok(r.ok);
  assert.ok(!C.guardarUsuario(s, admin, { nombre: 'X Y Z', rol: 'hacker', sucursal: 'Rivas' }).ok);
  assert.ok(!C.guardarUsuario(s, U(s, 'u-cc-betsy'), { nombre: 'Abc', rol: 'admin', sucursal: 'Rivas' }).ok);
  assert.ok(!C.toggleUsuario(s, admin, admin.id).ok, 'cannot deactivate self');
  assert.ok(!C.guardarUsuario(s, admin, { id: admin.id, nombre: admin.nombre, rol: 'promotor', sucursal: 'Rivas' }).ok);
  const cfg = JSON.parse(JSON.stringify(s.config));
  cfg.estados.nuevo = 'Recién llegado';
  cfg.plantillas.notif_pescado_promotor = 'Calificado: {cliente}';
  assert.ok(C.guardarConfig(s, admin, cfg).ok);
  const p = P(s, 'Rosa Elena Calero');
  r = C.cambiarEstado(s, U(s, 'u-cc-betsy'), p.id, 'pescado', { monto: 1, rubro: 'a', direccionVisita: 'b', comentarios: 'c' });
  assert.strictEqual(r.notificaciones.find((n) => n.userId === 'u-pro-jin-nydia').texto, 'Calificado: Rosa Elena Calero');
  assert.match(p.historial.at(-1).accion, /Recién llegado/);
  const bad = JSON.parse(JSON.stringify(s.config));
  bad.sucursales = bad.sucursales.filter((x) => x !== 'León');
  assert.ok(!C.guardarConfig(s, admin, bad).ok, 'cannot remove branch in use');
  bad.sucursales = []; assert.ok(!C.guardarConfig(s, admin, bad).ok);
});

test('metricas', () => {
  const s = fresh();
  const m = C.metricas(s);
  assert.strictEqual(m.total, s.prospectos.length);
  assert.strictEqual(m.porEstado.desembolsado, 2);
  assert.strictEqual(m.porPromotor['u-pro-mga-lester'].monto, 25000);
});

test('adversarial edge cases: cédula length, disbursement amount, inactive gestor, user rename & config guardrails', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  const pro = U(s, 'u-pro-mga-lester');

  // 1. Cédula must be exactly 14 normalized chars (rejects >14 as well as <14)
  assert.ok(!C.crearProspecto(s, pro, datos({ telefono: '80001111', cedula: '001-010190-0001A-EXTRA' })).ok);
  assert.ok(C.crearProspecto(s, pro, datos({ telefono: '80001111', cedula: '001-010190-0001A' })).ok);

  // 2. Desembolsado rejects negative or zero explicit monto, or 0 fallback monto
  const pSeg = P(s, 'Luisa Amanda Lacayo'); // en seguimiento
  const gerJui = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Juigalpa');
  assert.ok(!C.cambiarEstado(s, gerJui, pSeg.id, 'desembolsado', { monto: -500 }).ok);
  assert.ok(!C.cambiarEstado(s, gerJui, pSeg.id, 'desembolsado', { monto: 0 }).ok);

  // 3. Admin cannot assign an inactive gestor to a prospect
  const ges = U(s, 'u-ges-leo-laleska');
  C.toggleUsuario(s, admin, ges.id);
  const pRosa = P(s, 'Rosa Elena Calero');
  assert.ok(!C.adminEditarProspecto(s, admin, pRosa.id, { gestorId: ges.id }).ok);

  // 4. Admin moving a 'pescado' prospect to another branch notifies the new branch's gerente and keeps promoter's origin branch in metrics
  const pAna = P(s, 'Ana Gabriela Sequeira'); // Masaya, pescado
  const rEdit = C.adminEditarProspecto(s, admin, pAna.id, { sucursal: 'León' });
  assert.ok(rEdit.ok, rEdit.error);
  const gerLeon = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'León');
  assert.ok(rEdit.notificaciones.some((n) => n.userId === gerLeon.id));
  assert.strictEqual(C.metricas(s).porPromotor['u-pro-mas-fanny'].sucursal, 'Masaya');

  // 5. Admin renaming a promoter updates promotor_nombre on their prospects while keeping promotor_origen_id locked
  C.guardarUsuario(s, admin, { id: 'u-pro-mga-lester', nombre: 'Lester A. De La Rocha', rol: 'promotor', sucursal: 'Managua' });
  assert.strictEqual(P(s, 'Juana María Rodríguez').promotor_nombre, 'Lester A. De La Rocha');
  assert.strictEqual(P(s, 'Juana María Rodríguez').promotor_origen_id, 'u-pro-mga-lester');

  // 6. Admin config rejects empty negocios or empty notification templates
  const badNeg = JSON.parse(JSON.stringify(s.config));
  badNeg.negocios = [];
  assert.ok(!C.guardarConfig(s, admin, badNeg).ok);
  const badTpl = JSON.parse(JSON.stringify(s.config));
  badTpl.plantillas.notif_pescado_promotor = '   ';
  assert.ok(!C.guardarConfig(s, admin, badTpl).ok);
});

test('authentication & credentials: admin/admin123 + all 79 real staff authenticate and old/removed accounts are rejected', () => {
  const s = fresh();
  const usernames = new Set();
  for (const u of s.usuarios) {
    assert.ok(u.username && u.username.length >= 3, `missing username for ${u.nombre}`);
    assert.ok(u.password && u.password.length >= 4, `missing password for ${u.nombre}`);
    assert.ok(!usernames.has(u.username), `duplicate username ${u.username}`);
    usernames.add(u.username);
  }
  // Admin must be admin / admin123
  const rAdmin = C.autenticar(s, 'admin', 'admin123');
  assert.ok(rAdmin.ok, rAdmin.error);
  assert.strictEqual(rAdmin.usuario.rol, 'admin');

  // Wrong password & removed accounts rejected
  assert.ok(!C.autenticar(s, 'admin', 'wrongpass').ok);
  assert.ok(!C.autenticar(s, 'karla.mendoza', 'karla123').ok);
  assert.ok(!C.autenticar(s, 'laura.varela', 'laura123').ok);
  assert.ok(!C.autenticar(s, 'carlos.rivera', 'carlos123').ok);
  assert.ok(!C.autenticar(s, 'nerlin.escoto', 'nerlin123').ok);
  assert.ok(!C.autenticar(s, '', '').ok);

  // Real agents, managers, promoters, and credit officers (incl. supervisores & oficiales de desembolso as gestor) authenticate properly
  for (const [u, p, rol, suc] of [
    ['betsy.ruiz', 'betsy123', 'callcenter', 'Casa Matriz'],
    ['xochil.torrez', 'xochil123', 'callcenter', 'Casa Matriz'],
    ['eva.sevilla', 'eva123', 'callcenter', 'Casa Matriz'],
    ['gerente.managua', 'managua123', 'gerente', 'Managua'],
    ['gerente.sebaco', 'sebaco123', 'gerente', 'Sébaco'],
    ['gerente.esteli', 'esteli123', 'gerente', 'Estelí'],
    ['fanny.ramirez', 'fanny123', 'promotor', 'Masaya'],
    ['noelia.namendi', 'noelia123', 'promotor', 'Masaya'],
    ['yeiling.perez', 'yeiling123', 'promotor', 'Masaya'],
    ['lester.rocha', 'lester123', 'promotor', 'Managua'],
    ['claudia.suazo', 'claudia123', 'promotor', 'Managua'],
    ['wendy.perez', 'wendy123', 'promotor', 'Managua'],
    ['marjorie.diaz', 'marjorie123', 'promotor', 'Managua'],
    ['nydia.sanchez', 'nydia123', 'promotor', 'Jinotepe'],
    ['martha.centeno', 'martha123', 'promotor', 'Juigalpa'],
    ['araceli.juarez', 'araceli123', 'promotor', 'León'],
    ['lorena.castillo', 'lorena123', 'promotor', 'León'],
    ['evelia.diaz', 'evelia123', 'promotor', 'Sébaco'],
    ['jiurem.luna', 'jiurem123', 'promotor', 'Sébaco'],
    ['juan.salinas', 'juan123', 'gestor', 'León'],
    ['oscar.aguilar', 'oscar123', 'gestor', 'Managua'],
    ['jaqueline.soza', 'jaqueline123', 'gestor', 'León'],
    ['janhson.picado', 'janhson123', 'gestor', 'Estelí'],
    ['julio.madriz', 'julio123', 'gestor', 'Masaya'],
    ['diego.mendoza', 'diego123', 'gestor', 'Masaya'],
    ['wendy.lopez', 'wendy123', 'gestor', 'Rivas'],
  ]) {
    const res = C.autenticar(s, u, p);
    assert.ok(res.ok, `failed login for ${u}: ${res.error}`);
    assert.strictEqual(res.usuario.rol, rol);
    assert.strictEqual(res.usuario.sucursal, suc);
  }

  // Deactivated user cannot log in
  const claudia = s.usuarios.find((x) => x.username === 'claudia.suazo');
  C.toggleUsuario(s, rAdmin.usuario, claudia.id);
  assert.ok(!C.autenticar(s, 'claudia.suazo', 'claudia123').ok);
});

test('password management & duplicate username protection', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  const pro = s.usuarios.find((x) => x.username === 'lester.rocha');

  // User changes own password with valid current password
  assert.ok(!C.cambiarPassword(s, pro, pro.id, 'wrong', 'nueva1234').ok);
  assert.ok(!C.cambiarPassword(s, pro, pro.id, 'lester123', '123').ok, 'too short');
  assert.ok(C.cambiarPassword(s, pro, pro.id, 'lester123', 'lester2026').ok);
  assert.ok(C.autenticar(s, 'lester.rocha', 'lester2026').ok);

  // User cannot change another user's password; admin can reset without old password
  assert.ok(!C.cambiarPassword(s, pro, admin.id, 'admin123', 'hacked123').ok);
  assert.ok(C.cambiarPassword(s, admin, pro.id, '', 'reset123').ok);
  assert.ok(C.autenticar(s, 'lester.rocha', 'reset123').ok);

  // Duplicate username blocked in guardarUsuario
  assert.ok(!C.guardarUsuario(s, admin, { nombre: 'Otro Admin', rol: 'promotor', sucursal: 'Estelí', username: 'admin', password: '1234' }).ok);
});

test('CSV Depurador & Bulk Promoter Form Importer: classifies phones, resolves real promoters and locks origin', () => {
  const s = fresh();
  const cc = s.usuarios.find((x) => x.username === 'betsy.ruiz');
  const filas = [
    { Cliente: 'Elizabeth Lopez', Telefono: '84943179', Promotor: 'Claudia Suazo', VALOR: '15000', Negocio: 'Pulpería' },
    { Cliente: 'Juan Jose Torrez', Telefono: '8423266', Pomotor: 'Araceli Juarez', VALOR: '10000' }, // 7 digits -> longitud
    { Cliente: 'Junieth Carballo', Telefono: '89624881/ 75016969', Pomotor: 'Nydia Sanchez', VALOR: '20000' }, // especiales (recoverable)
    { Cliente: 'Sin Telefono', Telefono: 'nan', Pomotor: 'Evelia Díaz', VALOR: '5000' }, // vacios
    { Cliente: 'Con Texto', Telefono: 'NO TIENE', Pomotor: 'Evelia Díaz', VALOR: '5000' }, // texto
    { Cliente: 'Duplicado Existente', Telefono: '88451122', Pomotor: 'Lester De La Rocha', VALOR: '12000' }, // already in seed (Juana)
    { Cliente: 'Elizabeth Lopez', Telefono: '84943179', Promotor: 'Claudia Suazo', VALOR: '15000' }, // repeated in same CSV
  ];

  const clasif = C.clasificarFilasCSV(s, filas, { recuperarEspeciales: true });
  assert.strictEqual(clasif.validos.length, 2, 'Elizabeth + recovered Junieth');
  assert.strictEqual(clasif.validos[0].promotorNombre, 'Claudia Cecilia Suazo Muñoz');
  assert.strictEqual(clasif.validos[1].telefono, '89624881');
  assert.strictEqual(clasif.validos[1].telefonoSecundario, '75016969');
  assert.strictEqual(clasif.longitud.length, 1);
  assert.strictEqual(clasif.vacios.length, 1);
  assert.strictEqual(clasif.texto.length, 1);
  assert.strictEqual(clasif.duplicadosDB.length, 2);
  assert.strictEqual(clasif.repetidosTelefono.length, 1);
  assert.strictEqual(clasif.repetidosCliente.length, 1);

  const imp = C.importarFilasCSV(s, cc, filas, { recuperarEspeciales: true });
  assert.ok(imp.ok);
  assert.strictEqual(imp.importados.length, 2);
  assert.strictEqual(imp.importados[0].promotor_nombre, 'Claudia Cecilia Suazo Muñoz');
  assert.strictEqual(imp.importados[0].sucursal, 'Managua');
  assert.strictEqual(imp.importados[1].promotor_nombre, 'Nydia Yessenia Sánchez Pérez');
  assert.strictEqual(imp.importados[1].sucursal, 'Jinotepe');

  // Verify fuzzy promoter resolution for real CSV typos and Latin-1 variants
  assert.strictEqual(C.resolverPromotorCSV(s, 'Noelia Ñamendi').nombre, 'Noelia Sylvana Ñamendi Contreras');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Marha lenis centeno chavarria').nombre, 'Martha Lenys Centeno Chavarría');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Nidia Sánchez sucursal').nombre, 'Nydia Yessenia Sánchez Pérez');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Yeiling Perez Munoz').nombre, 'Yeiling Patricia Pérez Muñoz');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Aracely Juarez').nombre, 'Araceli De Jesús Juárez');
});

test('scrypt password hashing: per-user random salt, timingSafeEqual verify, and seamless migration on login', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  // Seeded user initially uses fast hash; autenticar upgrades to scrypt$salt$derived
  const r = C.autenticar(s, 'admin', 'admin123');
  assert.ok(r.ok);
  assert.ok(admin.passwordHash.startsWith('scrypt$'), `expected scrypt hash, got ${admin.passwordHash}`);
  assert.strictEqual(admin.passwordHash.split('$').length, 3);
  assert.ok(C.verifyPwd(admin, 'admin123'));
  assert.ok(!C.verifyPwd(admin, 'admin124'));
  assert.ok(!C.autenticar(s, 'admin', 'wrong').ok);

  // Two users with the same password get distinct salts & hashes
  const h1 = C.hashPwdScrypt('samepass123');
  const h2 = C.hashPwdScrypt('samepass123');
  assert.notStrictEqual(h1, h2);
  assert.ok(C.verifyPwd({ passwordHash: h1 }, 'samepass123'));
  assert.ok(C.verifyPwd({ passwordHash: h2 }, 'samepass123'));
});

test('Core.upgradeState preserves scoped mode without re-injecting secrets or hidden prospects', () => {
  const scoped = C.upgradeState({
    version: 1,
    _scoped: true,
    usuarios: [{ id: 'u-pro-mga-lester', username: 'lester.rocha', nombre: 'Lester Antonio De La Rocha Rivera', rol: 'promotor', sucursal: 'Managua', activo: true }],
    prospectos: [],
    notificaciones: [],
    auditoria: [],
  }, { scoped: true });
  assert.strictEqual(scoped.usuarios.length, 1);
  assert.strictEqual(scoped.usuarios[0].password, undefined);
  assert.strictEqual(scoped.usuarios[0].passwordHash, undefined);
  assert.strictEqual(scoped.prospectos.length, 0);
});

test('Call Center Directo: capture without promoter, branch/phone/monto normalization, idempotency & manager distribution', () => {
  const s = fresh();
  const betsy = s.usuarios.find((u) => u.username === 'betsy.ruiz');
  const gerManagua = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Managua');
  const gerLeon = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'León');
  const proManagua = s.usuarios.find((u) => u.rol === 'promotor' && u.sucursal === 'Managua' && u.activo);
  const gesManagua = s.usuarios.find((u) => u.rol === 'gestor' && u.sucursal === 'Managua' && u.activo);
  const admin = U(s, 'u-admin');

  // 1. Capture from Python app format ("Sucursal Managua", "+505 8311-2233 / 7722-3344", "C$ 20,000")
  const r1 = C.capturarCasoCallCenterDirecto(s, betsy, {
    externalId: 'cc-py-r150-abc',
    sheetRow: 150,
    agenteNombre: 'Betsy Mabell Ruíz Herrera',
    nombre: 'María Elena Torres',
    tipoCredito: 'NV(NUEVO)',
    telefono: '+505 8311-2233 / 7722-3344',
    sucursal: 'Sucursal Managua',
    emailGerente: 'gerentemanaguabolonia@gmail.com',
    monto: 'C$ 20,000',
    negocio: 'Pulpería',
    direccion: 'Barrio Bolonia 2c al sur',
    plataforma: 'Facebook',
    campana: 'Campaña Noviembre',
    origenApp: 'python_callcenter',
  });
  assert.ok(r1.ok, r1.error);
  assert.strictEqual(r1.deduplicated, false);
  const p = r1.prospecto;
  assert.strictEqual(C.esCallCenterDirecto(p), true);
  assert.strictEqual(p.sucursal, 'Managua');
  assert.strictEqual(p.telefono, '83112233');
  assert.strictEqual(p.telefonoSecundario, '77223344');
  assert.strictEqual(p.monto, 20000);
  assert.strictEqual(p.estado, 'pescado', 'arrives directly at Branch Manager inbox');
  assert.strictEqual(p.promotor_origen_id, C.ORIGEN_CC_ID);
  assert.strictEqual(p.sheetSync.status, 'synced');
  assert.strictEqual(p.sheetSync.sheetRow, 150);
  assert.ok(r1.notificaciones.some((n) => n.userId === gerManagua.id), 'notifies branch manager');

  // 2. Visibility before distribution: Gerente Managua & Call Center & Admin see it; Promoter & other branch manager do NOT
  assert.ok(C.puedeVer(gerManagua, p));
  assert.ok(C.puedeVer(betsy, p));
  assert.ok(C.puedeVer(admin, p));
  assert.ok(!C.puedeVer(proManagua, p));
  assert.ok(!C.puedeVer(gerLeon, p));

  // 3. Idempotent retry by externalId or sheetRow does NOT duplicate
  const rDupExt = C.capturarCasoCallCenterDirecto(s, betsy, {
    externalId: 'cc-py-r150-abc',
    nombre: 'María Elena Torres',
    telefono: '8311-2233',
    sucursal: 'Sucursal Managua',
  });
  assert.ok(rDupExt.ok);
  assert.strictEqual(rDupExt.deduplicated, true);
  assert.strictEqual(rDupExt.prospecto.id, p.id);

  const rDupRow = C.capturarCasoCallCenterDirecto(s, betsy, {
    sheetRow: 150,
    nombre: 'María Elena Torres',
    telefono: '8311-2233',
    sucursal: 'Sucursal Managua',
  });
  assert.ok(rDupRow.ok && rDupRow.deduplicated === true);

  // 4. Different lead with same phone is blocked as duplicate
  const rDupPhone = C.capturarCasoCallCenterDirecto(s, betsy, {
    externalId: 'cc-py-r151-xyz',
    sheetRow: 151,
    nombre: 'Otro Nombre',
    telefono: '83112233',
    sucursal: 'Sucursal Esteli',
  });
  assert.ok(!rDupPhone.ok);
  assert.strictEqual(rDupPhone.duplicate, true);
  assert.match(rDupPhone.error, /Call Center Directo/);

  // 5. Cross-branch manager cannot distribute
  assert.ok(!C.cambiarEstado(s, gerLeon, p.id, 'seguimiento', { instrucciones: 'Intento externo' }).ok);

  // 6. Branch Manager distributes to Promotor + Gestor; both see it, promoter can add follow-up note, CC agent notified
  const rDist = C.cambiarEstado(s, gerManagua, p.id, 'seguimiento', {
    asignadoPromotorId: proManagua.id,
    gestorId: gesManagua.id,
    instrucciones: 'Visitar hoy por la tarde y levantar expediente.',
  });
  assert.ok(rDist.ok, rDist.error);
  assert.strictEqual(p.asignadoPromotorId, proManagua.id);
  assert.strictEqual(p.asignadoPromotorNombre, proManagua.nombre);
  assert.strictEqual(p.gestorId, gesManagua.id);
  assert.strictEqual(p.promotor_origen_id, C.ORIGEN_CC_ID, 'origin remains Call Center Directo');
  assert.ok(C.puedeVer(proManagua, p), 'assigned promoter now sees the case');
  assert.ok(C.puedeVer(gesManagua, p), 'assigned gestor now sees the case');
  assert.ok(rDist.notificaciones.some((n) => n.userId === proManagua.id));
  assert.ok(rDist.notificaciones.some((n) => n.userId === gesManagua.id));
  assert.ok(rDist.notificaciones.some((n) => n.userId === betsy.id));

  // Assigned promoter adds follow-up note; cannot force state transitions
  assert.ok(C.agregarNota(s, proManagua, p.id, 'Visitada en pulpería, entrega cédula mañana.').ok);
  assert.ok(!C.cambiarEstado(s, proManagua, p.id, 'desembolsado', { monto: 20000 }).ok);

  // Admin cannot override Call Center origin lock either
  assert.ok(!C.adminEditarProspecto(s, admin, p.id, { promotor_origen_id: proManagua.id }).ok);

  // 7. Gestor closes as desembolsado; metrics track Call Center Directo separately from street promoter commissions
  const rClose = C.cambiarEstado(s, gesManagua, p.id, 'desembolsado', { monto: 20000 });
  assert.ok(rClose.ok, rClose.error);
  const m = C.metricas(s);
  assert.strictEqual(m.porPromotor[C.ORIGEN_CC_ID], undefined, 'CC Directo must not pollute street promoter commission table');
  assert.strictEqual(m.callCenterDirecto.total, 1);
  assert.strictEqual(m.callCenterDirecto.desembolsados, 1);
  assert.strictEqual(m.callCenterDirecto.montoDesembolsado, 20000);
  assert.strictEqual(m.callCenterDirecto.porSucursal['Managua'].desembolsado, 1);
  assert.strictEqual(m.callCenterDirecto.porAgente['Betsy Mabell Ruíz Herrera'].desembolsado, 1);

  // 8. Direct manager handling (no promoter, no gestor) & dash monto ("-") works cleanly
  const r2 = C.capturarCasoCallCenterDirecto(s, betsy, {
    nombre: 'Carlos Alberto Morales',
    telefono: '8777-1122',
    sucursal: 'Sucursal Sebaco',
    monto: '-',
    origenApp: 'alfatrack',
  });
  assert.ok(r2.ok, r2.error);
  assert.strictEqual(r2.prospecto.sucursal, 'Sébaco');
  assert.strictEqual(r2.prospecto.monto, 0);
  const gerSebaco = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Sébaco');
  const rDir = C.cambiarEstado(s, gerSebaco, r2.prospecto.id, 'seguimiento', {
    instrucciones: 'Atención directa por gerencia en oficina.',
  });
  assert.ok(rDir.ok, rDir.error);
  assert.strictEqual(r2.prospecto.gerencia.tipoDistribucion, 'gerencia_directa');
});

test('Call Center Directo adversarial edge cases: real dual phones, negative/dot montos, branch matching, atomic validation & admin sync', () => {
  const s = fresh();
  const betsy = s.usuarios.find((u) => u.username === 'betsy.ruiz');
  const gerManagua = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Managua');
  const proManagua = s.usuarios.find((u) => u.rol === 'promotor' && u.sucursal === 'Managua' && u.activo);
  const gesManagua = s.usuarios.find((u) => u.rol === 'gestor' && u.sucursal === 'Managua' && u.activo);
  const admin = U(s, 'u-admin');

  // 1. Real production phone strings from Call Center clientes_cache.json
  assert.deepStrictEqual(C.limpiarTelefonoCC('86962464 - 57962751'), { telefono: '86962464', telefonoSecundario: '57962751' });
  assert.deepStrictEqual(C.limpiarTelefonoCC('82397793-87803687'), { telefono: '82397793', telefonoSecundario: '87803687' });
  assert.deepStrictEqual(C.limpiarTelefonoCC('8888-9999 y 7777-1111'), { telefono: '88889999', telefonoSecundario: '77771111' });
  assert.deepStrictEqual(C.limpiarTelefonoCC('+505 8811 2233'), { telefono: '88112233', telefonoSecundario: '' });

  // 2. parseMonto handles negatives, dot-thousands, and decimals safely
  assert.strictEqual(C.parseMonto('-500'), '');
  assert.strictEqual(C.parseMonto('C$ -15,000'), '');
  assert.strictEqual(C.parseMonto('C$ 15.000'), 15000);
  assert.strictEqual(C.parseMonto('C$ 1.500.000'), 1500000);
  assert.strictEqual(C.parseMonto('C$ 15,000.50'), 15000.5);
  assert.strictEqual(C.parseMonto('C$0'), '');

  // 3. normalizarSucursal does not falsely match short strings to Casa Matriz, and honors custom emailsGerentes
  assert.strictEqual(C.normalizarSucursal('a', ''), '');
  assert.strictEqual(C.normalizarSucursal('ma', ''), '');
  assert.strictEqual(C.normalizarSucursal('', 'custom-esteli@alfa.ni', s.config.sucursales, { 'Estelí': 'custom-esteli@alfa.ni' }), 'Estelí');

  // 4. Validation failure on asignadoPromotorId must NOT corrupt p.gestorId
  const cap = C.capturarCasoCallCenterDirecto(s, betsy, {
    nombre: 'Cliente Atomicidad CC',
    telefono: '86962464 - 57962751',
    sucursal: 'Sucursal Managua',
    monto: 'C$ 15.000',
  });
  assert.ok(cap.ok, cap.error);
  const p = cap.prospecto;
  assert.strictEqual(p.telefono, '86962464');
  assert.strictEqual(p.telefonoSecundario, '57962751');
  assert.strictEqual(p.monto, 15000);

  const failDist = C.cambiarEstado(s, gerManagua, p.id, 'seguimiento', {
    gestorId: gesManagua.id,
    asignadoPromotorId: 'u-inexistente',
    instrucciones: 'Debe fallar sin mutar gestorId',
  });
  assert.ok(!failDist.ok);
  assert.strictEqual(p.gestorId, null, 'gestorId must remain null when asignadoPromotorId validation fails');

  // 5. Distribute cleanly, then Admin clears asignadoPromotorId & changes sucursal -> gerencia.asignadoA & notifications stay consistent
  assert.ok(C.cambiarEstado(s, gerManagua, p.id, 'seguimiento', {
    asignadoPromotorId: proManagua.id,
    instrucciones: 'Evaluar negocio',
  }).ok);
  assert.match(p.gerencia.asignadoA, /Lester Antonio De La Rocha Rivera/);

  const ed = C.adminEditarProspecto(s, admin, p.id, { asignadoPromotorId: '', sucursal: 'León' });
  assert.ok(ed.ok, ed.error);
  assert.strictEqual(p.asignadoPromotorId, null);
  assert.match(p.gerencia.asignadoA, /Gerencia directa/);
  assert.ok(ed.notificaciones.some((n) => /caso directo/i.test(n.texto)), 'new branch manager gets Call Center Directo notification template');
});

test('memory & payload bounds: auditoria and notificaciones cap at 500 while preserving unread notifications', () => {
  const s = fresh();
  const pro = U(s, 'u-pro-mas-fanny');
  for (let i = 0; i < 515; i++) {
    s.auditoria.push({ ts: new Date().toISOString(), userId: 'u-admin', usuario: 'Admin', rol: 'admin', accion: 'Old', detalle: String(i) });
  }
  C.autenticar(s, 'admin', 'admin123');
  assert.ok(s.auditoria.length <= 500, `auditoria grew to ${s.auditoria.length}`);

  // Flood read + unread notifications and verify cap <= 500 while unread survive
  for (let i = 0; i < 520; i++) {
    s.notificaciones.push({ id: `old-read-${i}`, userId: pro.id, texto: 'read', ts: new Date().toISOString(), leida: true, toasted: true });
  }
  const r = C.capturarCasoCallCenterDirecto(s, U(s, 'u-cc-betsy'), {
    nombre: 'Notif Cap Test',
    telefono: '87778899',
    sucursal: 'Masaya',
    monto: 10000,
  });
  assert.ok(r.ok);
  assert.ok(s.notificaciones.length <= 500, `notificaciones grew to ${s.notificaciones.length}`);
  assert.ok(s.notificaciones.some((n) => n.id === r.notificaciones[0].id), 'newest unread notification preserved');
});



