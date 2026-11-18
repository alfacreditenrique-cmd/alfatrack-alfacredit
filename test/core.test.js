const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const fresh = () => C.seed();
const U = (s, id) => s.usuarios.find((u) => u.id === id);
const P = (s, nombre) => s.prospectos.find((p) => p.nombre === nombre);
const datos = (o) => Object.assign({ nombre: 'Cliente Prueba', telefono: '8000-0001', direccion: 'X', negocio: 'Pulpería', monto: 1000 }, o);

test('seed: >=8 prospects covering every state, all promotor branches present', () => {
  const s = fresh();
  assert.ok(s.prospectos.length >= 8);
  C.ESTADOS.forEach((e) => assert.ok(s.prospectos.some((p) => p.estado === e), e));
  ['Estelí', 'Managua', 'Masaya', 'León', 'Juigalpa', 'Sébaco', 'Jinotepe', 'Rivas'].forEach((suc) =>
    assert.ok(s.usuarios.some((u) => u.rol === 'promotor' && u.sucursal === suc), suc));
  assert.ok(s.notificaciones.some((n) => !n.leida), 'some unread notifications for the bell');
  assert.ok(JSON.parse(JSON.stringify(s)), 'serializable');
});

test('crearProspecto: origin comes from logged user, not form data', () => {
  const s = fresh();
  const pro = U(s, 'u-pro-leon');
  const r = C.crearProspecto(s, pro, datos({ promotor_origen_id: 'u-pro-esteli', promotor_nombre: 'Hacker', sucursal: 'Managua' }));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.prospecto.promotor_origen_id, 'u-pro-leon');
  assert.strictEqual(r.prospecto.promotor_nombre, 'Fernanda Castillo');
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
  assert.ok(!C.crearProspecto(s, U(s, 'u-pro-leon'), datos({ telefono: '123' })).ok);
});

test('duplicates by phone or cédula are blocked and name the original promotor', () => {
  const s = fresh();
  const otro = U(s, 'u-pro-rivas');
  let r = C.crearProspecto(s, otro, datos({ telefono: '88451122' })); // Juana, by Carlos Rivera
  assert.ok(!r.ok);
  assert.match(r.error, /Carlos Rivera/);
  r = C.crearProspecto(s, otro, datos({ cedula: '161 150385 0002k' }));
  assert.ok(!r.ok);
  assert.match(r.error, /cédula/);
  // optional cédula empty must not match other empty cédulas
  r = C.crearProspecto(s, otro, datos({ telefono: '80009999', cedula: '' }));
  assert.ok(r.ok, r.error);
});

test('only promotores can create; inactive promotor cannot', () => {
  const s = fresh();
  assert.ok(!C.crearProspecto(s, U(s, 'u-cc1'), datos()).ok);
  const pro = U(s, 'u-pro-leon');
  C.toggleUsuario(s, U(s, 'u-admin'), pro.id);
  assert.ok(!C.crearProspecto(s, pro, datos()).ok);
});

test('pescado requires confirmation fields and notifies gerente of branch + promotor', () => {
  const s = fresh();
  const cc = U(s, 'u-cc1');
  const p = P(s, 'Juana María Rodríguez');
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'pescado', { monto: 0 }).ok);
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'pescado', { monto: 100, rubro: 'x', direccionVisita: 'y' }).ok, 'comments required');
  const r = C.cambiarEstado(s, cc, p.id, 'pescado', { monto: 100, rubro: 'Pulpería', direccionVisita: 'Casa', comentarios: 'OK' });
  assert.ok(r.ok, r.error);
  const dest = r.notificaciones.map((n) => n.userId).sort();
  const gerEsteli = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Estelí').id;
  assert.deepStrictEqual(dest, [gerEsteli, 'u-pro-esteli'].sort());
  const msg = r.notificaciones.find((n) => n.userId === 'u-pro-esteli').texto;
  assert.strictEqual(msg, '¡Atención! Call Center ya calificó a tu cliente Juana María Rodríguez y fue enviado a tu Gerente de Sucursal.');
  assert.strictEqual(p.promotor_origen_id, 'u-pro-esteli');
});

test('gerente assigns gestor without replacing origin; other branch gerente denied', () => {
  const s = fresh();
  const p = P(s, 'Ana Gabriela Sequeira'); // Masaya, pescado
  const gerMasaya = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Masaya');
  const gerLeon = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'León');
  assert.ok(!C.cambiarEstado(s, gerLeon, p.id, 'seguimiento', { instrucciones: 'x' }).ok);
  assert.ok(!C.cambiarEstado(s, gerMasaya, p.id, 'seguimiento', {}).ok, 'instructions required');
  const r = C.cambiarEstado(s, gerMasaya, p.id, 'seguimiento', { gestorId: 'u-ges-masaya', instrucciones: 'Visitar lunes' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(p.promotor_origen_id, 'u-pro-masaya');
  assert.strictEqual(p.gestorId, 'u-ges-masaya');
  assert.deepStrictEqual(r.notificaciones.map((n) => n.userId).sort(), ['u-ges-masaya', 'u-pro-masaya']);
  assert.match(r.notificaciones.find((n) => n.userId === 'u-pro-masaya').texto, /Visitar lunes/);
  // promoter of another branch can't see it, gestor can
  assert.ok(!C.puedeVer(U(s, 'u-pro-leon'), p));
  assert.ok(C.puedeVer(U(s, 'u-ges-masaya'), p));
  assert.ok(C.cambiarEstado(s, U(s, 'u-ges-masaya'), p.id, 'desembolsado', {}).ok);
});

test('descartado requires motivo; invalid transitions rejected', () => {
  const s = fresh();
  const cc = U(s, 'u-cc1');
  const p = P(s, 'Rosa Elena Calero');
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'descartado', {}).ok);
  assert.ok(!C.cambiarEstado(s, cc, p.id, 'desembolsado', {}).ok, 'call center cannot disburse');
  assert.ok(!C.cambiarEstado(s, U(s, 'u-pro-jinotepe'), p.id, 'pescado', {}).ok, 'promotor cannot move states');
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
  C.agregarNota(s, U(s, 'u-pro-esteli'), p.id, 'Cliente satisfecho');
  assert.strictEqual(p.historial.length, n + 1);
});

test('admin edits everything except the origin lock', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  const p = P(s, 'Rosa Elena Calero');
  assert.ok(!C.adminEditarProspecto(s, U(s, 'u-ger-0'), p.id, { nombre: 'X' }).ok);
  let r = C.adminEditarProspecto(s, admin, p.id, { promotor_origen_id: 'u-pro-leon' });
  assert.ok(!r.ok);
  assert.match(r.error, /CANDADO/);
  r = C.adminEditarProspecto(s, admin, p.id, { telefono: '88451122' });
  assert.ok(!r.ok, 'duplicate on edit');
  r = C.adminEditarProspecto(s, admin, p.id, { nombre: 'Rosa E. Calero', monto: 9000, gestorId: 'u-ges-leon' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(p.nombre, 'Rosa E. Calero');
  assert.strictEqual(p.promotor_origen_id, 'u-pro-jinotepe');
  assert.match(p.historial.at(-1).detalle, /monto/);
  assert.strictEqual(r.notificaciones[0].userId, 'u-ges-leon');
  // admin can force any state
  assert.ok(C.cambiarEstado(s, admin, p.id, 'desembolsado', { monto: 9000 }).ok);
});

test('admin users and config management', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  let r = C.guardarUsuario(s, admin, { nombre: 'Nuevo Promotor', rol: 'promotor', sucursal: 'Rivas' });
  assert.ok(r.ok);
  assert.ok(!C.guardarUsuario(s, admin, { nombre: 'X Y Z', rol: 'hacker', sucursal: 'Rivas' }).ok);
  assert.ok(!C.guardarUsuario(s, U(s, 'u-cc1'), { nombre: 'Abc', rol: 'admin', sucursal: 'Rivas' }).ok);
  assert.ok(!C.toggleUsuario(s, admin, admin.id).ok, 'cannot deactivate self');
  assert.ok(!C.guardarUsuario(s, admin, { id: admin.id, nombre: admin.nombre, rol: 'promotor', sucursal: 'Rivas' }).ok);
  const cfg = JSON.parse(JSON.stringify(s.config));
  cfg.estados.nuevo = 'Recién llegado';
  cfg.plantillas.notif_pescado_promotor = 'Calificado: {cliente}';
  assert.ok(C.guardarConfig(s, admin, cfg).ok);
  const p = P(s, 'Rosa Elena Calero');
  r = C.cambiarEstado(s, U(s, 'u-cc1'), p.id, 'pescado', { monto: 1, rubro: 'a', direccionVisita: 'b', comentarios: 'c' });
  assert.strictEqual(r.notificaciones.find((n) => n.userId === 'u-pro-jinotepe').texto, 'Calificado: Rosa Elena Calero');
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
  assert.strictEqual(m.porPromotor['u-pro-esteli'].monto, 25000);
});

test('adversarial edge cases: cédula length, disbursement amount, inactive gestor, user rename & config guardrails', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  const pro = U(s, 'u-pro-esteli');

  // 1. Cédula must be exactly 14 normalized chars (rejects >14 as well as <14)
  assert.ok(!C.crearProspecto(s, pro, datos({ telefono: '80001111', cedula: '001-010190-0001A-EXTRA' })).ok);
  assert.ok(C.crearProspecto(s, pro, datos({ telefono: '80001111', cedula: '001-010190-0001A' })).ok);

  // 2. Desembolsado rejects negative or zero explicit monto, or 0 fallback monto
  const pSeg = P(s, 'Luisa Amanda Lacayo'); // en seguimiento
  const gerJui = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'Juigalpa');
  assert.ok(!C.cambiarEstado(s, gerJui, pSeg.id, 'desembolsado', { monto: -500 }).ok);
  assert.ok(!C.cambiarEstado(s, gerJui, pSeg.id, 'desembolsado', { monto: 0 }).ok);

  // 3. Admin cannot assign an inactive gestor to a prospect
  const ges = U(s, 'u-ges-leon');
  C.toggleUsuario(s, admin, ges.id);
  const pRosa = P(s, 'Rosa Elena Calero');
  assert.ok(!C.adminEditarProspecto(s, admin, pRosa.id, { gestorId: ges.id }).ok);

  // 4. Admin moving a 'pescado' prospect to another branch notifies the new branch's gerente and keeps promoter's origin branch in metrics
  const pAna = P(s, 'Ana Gabriela Sequeira'); // Masaya, pescado
  const rEdit = C.adminEditarProspecto(s, admin, pAna.id, { sucursal: 'León' });
  assert.ok(rEdit.ok, rEdit.error);
  const gerLeon = s.usuarios.find((u) => u.rol === 'gerente' && u.sucursal === 'León');
  assert.ok(rEdit.notificaciones.some((n) => n.userId === gerLeon.id));
  assert.strictEqual(C.metricas(s).porPromotor['u-pro-masaya'].sucursal, 'Masaya');

  // 5. Admin renaming a promoter updates promotor_nombre on their prospects while keeping promotor_origen_id locked
  C.guardarUsuario(s, admin, { id: 'u-pro-esteli', nombre: 'Carlos A. Rivera', rol: 'promotor', sucursal: 'Estelí' });
  assert.strictEqual(P(s, 'Juana María Rodríguez').promotor_nombre, 'Carlos A. Rivera');
  assert.strictEqual(P(s, 'Juana María Rodríguez').promotor_origen_id, 'u-pro-esteli');

  // 6. Admin config rejects empty negocios or empty notification templates
  const badNeg = JSON.parse(JSON.stringify(s.config));
  badNeg.negocios = [];
  assert.ok(!C.guardarConfig(s, admin, badNeg).ok);
  const badTpl = JSON.parse(JSON.stringify(s.config));
  badTpl.plantillas.notif_pescado_promotor = '   ';
  assert.ok(!C.guardarConfig(s, admin, badTpl).ok);
});

test('authentication & credentials: admin/admin123 + all real promoters and agents have unique username & password', () => {
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

  // Wrong password rejected
  assert.ok(!C.autenticar(s, 'admin', 'wrongpass').ok);
  assert.ok(!C.autenticar(s, 'nonexistent', 'admin123').ok);
  assert.ok(!C.autenticar(s, '', '').ok);

  // Real agents and official promoters from user table authenticate properly
  for (const [u, p, rol, suc] of [
    ['betsy.ruiz', 'betsy123', 'callcenter', 'Casa Matriz'],
    ['xochilt', 'xochilt123', 'callcenter', 'Casa Matriz'],
    ['eva', 'eva123', 'callcenter', 'Casa Matriz'],
    ['fanny.ramirez', 'fanny123', 'promotor', 'Masaya'],
    ['noelia.namendi', 'noelia123', 'promotor', 'Masaya'],
    ['yeiling.munoz', 'yeiling123', 'promotor', 'Masaya'],
    ['lester.rocha', 'lester123', 'promotor', 'Managua'],
    ['claudia.suazo', 'claudia123', 'promotor', 'Managua'],
    ['maria.lopez', 'maria123', 'promotor', 'Managua'],
    ['marjorie.diaz', 'marjorie123', 'promotor', 'Managua'],
    ['nydia.sanchez', 'nydia123', 'promotor', 'Jinotepe'],
    ['martha.centeno', 'martha123', 'promotor', 'Juigalpa'],
    ['aracely.juarez', 'aracely123', 'promotor', 'León'],
    ['lorena.castillo', 'lorena123', 'promotor', 'León'],
    ['evelia.diaz', 'evelia123', 'promotor', 'Sébaco'],
    ['jiurem.luna', 'jiurem123', 'promotor', 'Sébaco'],
    ['laura.varela', 'laura123', 'promotor', 'Managua'],
    ['cristell.calderon', 'cristell123', 'promotor', 'Estelí'],
    ['massiel.morales', 'massiel123', 'promotor', 'Jinotepe'],
    ['keyner.fajardo', 'keyner123', 'promotor', 'Rivas'],
  ]) {
    const res = C.autenticar(s, u, p);
    assert.ok(res.ok, `failed login for ${u}: ${res.error}`);
    assert.strictEqual(res.usuario.rol, rol);
    assert.strictEqual(res.usuario.sucursal, suc);
  }

  // Deactivated user cannot log in
  const laura = s.usuarios.find((x) => x.username === 'laura.varela');
  C.toggleUsuario(s, rAdmin.usuario, laura.id);
  assert.ok(!C.autenticar(s, 'laura.varela', 'laura123').ok);
});

test('password management & duplicate username protection', () => {
  const s = fresh();
  const admin = U(s, 'u-admin');
  const pro = s.usuarios.find((x) => x.username === 'carlos.rivera');

  // User changes own password with valid current password
  assert.ok(!C.cambiarPassword(s, pro, pro.id, 'wrong', 'nueva1234').ok);
  assert.ok(!C.cambiarPassword(s, pro, pro.id, 'carlos123', '123').ok, 'too short');
  assert.ok(C.cambiarPassword(s, pro, pro.id, 'carlos123', 'carlos2026').ok);
  assert.ok(C.autenticar(s, 'carlos.rivera', 'carlos2026').ok);

  // User cannot change another user's password; admin can reset without old password
  assert.ok(!C.cambiarPassword(s, pro, admin.id, 'admin123', 'hacked123').ok);
  assert.ok(C.cambiarPassword(s, admin, pro.id, '', 'reset123').ok);
  assert.ok(C.autenticar(s, 'carlos.rivera', 'reset123').ok);

  // Duplicate username blocked in guardarUsuario
  assert.ok(!C.guardarUsuario(s, admin, { nombre: 'Otro Admin', rol: 'promotor', sucursal: 'Estelí', username: 'admin', password: '1234' }).ok);
});

test('CSV Depurador & Bulk Promoter Form Importer: classifies phones, resolves promoters and locks origin', () => {
  const s = fresh();
  const cc = s.usuarios.find((x) => x.username === 'betsy.ruiz');
  const filas = [
    { Cliente: 'Elizabeth Lopez', Telefono: '84943179', Promotor: 'Laura v', VALOR: '15000', Negocio: 'Pulpería' },
    { Cliente: 'Juan Jose Torrez', Telefono: '8423266', Pomotor: 'Cristell Calderon', VALOR: '10000' }, // 7 digits -> longitud
    { Cliente: 'Junieth Carballo', Telefono: '89624881/ 75016969', Pomotor: 'Massiel Morales', VALOR: '20000' }, // especiales (recoverable)
    { Cliente: 'Sin Telefono', Telefono: 'nan', Pomotor: 'Evelia Díaz', VALOR: '5000' }, // vacios
    { Cliente: 'Con Texto', Telefono: 'NO TIENE', Pomotor: 'Evelia Díaz', VALOR: '5000' }, // texto
    { Cliente: 'Duplicado Existente', Telefono: '88451122', Pomotor: 'Carlos Rivera', VALOR: '12000' }, // already in seed (Juana)
    { Cliente: 'Elizabeth Lopez', Telefono: '84943179', Promotor: 'Laura Varela', VALOR: '15000' }, // repeated in same CSV
  ];

  const clasif = C.clasificarFilasCSV(s, filas, { recuperarEspeciales: true });
  assert.strictEqual(clasif.validos.length, 2, 'Elizabeth + recovered Junieth');
  assert.strictEqual(clasif.validos[0].promotorNombre, 'Laura Varela');
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
  assert.strictEqual(imp.importados[0].promotor_nombre, 'Laura Varela');
  assert.strictEqual(imp.importados[0].sucursal, 'Managua');
  assert.strictEqual(imp.importados[1].promotor_nombre, 'Massiel Morales');
  assert.strictEqual(imp.importados[1].sucursal, 'Jinotepe');

  // Verify fuzzy promoter resolution for real CSV typos and Latin-1 variants
  assert.strictEqual(C.resolverPromotorCSV(s, 'Noelia Ñamendi').nombre, 'NOELIA SYLVANA ÑAMENDI CONTRERAS');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Massiel Norales').nombre, 'Massiel Morales');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Tainana jarquin').nombre, 'Tatiana Jarquín');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Tania jarquin').nombre, 'Tatiana Jarquín');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Marha lenis centeno chavarria').nombre, 'MARTHA LENYS CENTENO CHAVARRÍA');
  assert.strictEqual(C.resolverPromotorCSV(s, 'Nidia Sánchez sucursal').nombre, 'NYDIA YESSENIA SÁNCHEZ PÉREZ');
  assert.strictEqual(C.resolverPromotorCSV(s, 'María José López Wilson').nombre, 'Maria Jose Lopez Wilson');
});

