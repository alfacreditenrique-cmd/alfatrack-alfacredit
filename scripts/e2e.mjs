// End-to-end smoke test: drives the real UI in headless Chrome via CDP (no deps).
// Usage: node scripts/e2e.mjs   (or APP_URL=https://... node scripts/e2e.mjs)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_APP = process.env.APP_URL || '';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let localSrv = null;
let targetUrl = URL_APP;
if (!targetUrl) {
  process.env.ALFATRACK_DB_MODE = process.env.ALFATRACK_DB_MODE || 'local';
  process.env.ALFATRACK_DB_FILE = join(tmpdir(), `alfatrack_e2e_${Date.now()}.json`);
  const mod = await import('../server.js');
  localSrv = mod.createServer();
  await new Promise((r) => localSrv.listen(0, '127.0.0.1', r));
  targetUrl = `http://127.0.0.1:${localSrv.address().port}/index.html`;
}
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'at-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const errors = [];
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function shot(name, w, hgt, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
  await sleep(250);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync('scripts/shots', { recursive: true });
  writeFileSync(`scripts/shots/${name}.png`, Buffer.from(data, 'base64'));
}

// in-page async helpers
const H = `
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const waitFor=async(fn, timeout=8000)=>{
  const t0=Date.now();
  while(Date.now()-t0<timeout){
    const v=fn();
    if(v) return v;
    await new Promise(r=>setTimeout(r,60));
  }
  throw new Error('waitFor timeout: '+fn.toString());
};
const set=(el,v)=>{el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));};
const click=(sel,txt)=>{const el=$$(sel).find(e=>!txt||e.textContent.includes(txt)); if(!el) throw new Error('no '+sel+' '+txt); el.click(); return el;};
const loginAs=async(u,p)=>{
  if($('[data-action=logout]')) { $('[data-action=logout]').click(); await waitFor(()=>$('form[data-form=login]')); }
  const lf=$('form[data-form=login]');
  if(!lf) throw new Error('Login form not visible');
  set(lf.username,u); set(lf.password,p); lf.requestSubmit();
  await waitFor(()=>$('[data-action=logout]') && $('.who'));
  await new Promise(r=>setTimeout(r,80));
};
const cardOf=n=>$$('#app .card, #app tr, #app .kanban-card').find(c=>c.textContent.includes(n));
const toasts=()=>$$('#toasts .toast').map(t=>t.textContent);
`;

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: targetUrl }); await sleep(1200);
  await ev(`localStorage.clear(); location.reload();`).catch(() => {}); await sleep(1200);

  // auto-accept confirm dialogs
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });

  await shot('01-login-clean', 390, 844, true);

  // 0. Clean login screen: no credentials leaked, password toggle preserves input
  let r = await ev(H + `
    const lf = $('form[data-form=login]');
    set(lf.username, 'admin');
    set(lf.password, 'secret123');
    const toggleBtn = $('[data-action=toggle-login-pwd]');
    toggleBtn.click();
    const preservedAfterShow = lf.username.value === 'admin' && lf.password.value === 'secret123' && lf.password.type === 'text';
    toggleBtn.click();
    const preservedAfterHide = lf.username.value === 'admin' && lf.password.value === 'secret123' && lf.password.type === 'password';
    set(lf.username, '');
    set(lf.password, '');
    return {
      hasLoginForm: !!lf,
      hasSelRol: !!$('#sel-rol'),
      hasSelUser: !!$('#sel-user'),
      hasQuickLogin: !!$('[data-action=quick-login]'),
      hasCredTable: $$('.login-wrap table').length,
      preservedAfterShow,
      preservedAfterHide,
      bodyTxt: document.body.textContent,
    };`);
  assert.ok(r.hasLoginForm && !r.hasSelRol && !r.hasSelUser && !r.hasQuickLogin && r.hasCredTable === 0 && r.preservedAfterShow && r.preservedAfterHide, JSON.stringify(r));
  assert.ok(!/admin123|Directorio Oficial de Usuarios/i.test(r.bodyTxt), 'No credentials leaked on login screen');

  // 1. Official Promotor (fanny.ramirez) logs in: signed token, live phone formatting, live /api/check-dup disables submit, registers prospect, promoter search bar works without focus loss
  r = await ev(H + `
    await loginAs('fanny.ramirez', 'fanny123');
    const tok = localStorage.getItem('alfatrack_token') || '';
    const hasMobileNav = !!$('.mobile-nav');
    const hasFab = !!$('.fab');
    click('.tabs button','Registrar');
    const f=$('form[data-form=nuevo]');
    set(f.nombre,'Prueba E2E Cliente');
    set(f.telefono,'88451122');
    const formattedTel = f.telefono.value;
    const telStatus = $('#tel-status')?.textContent;
    await waitFor(() => !$('#dup-alert').hidden && $('#dup-alert').textContent.includes('Lester Antonio De La Rocha Rivera'));
    const dupShown = $('#dup-alert').textContent;
    const submitDisabledOnDup = f.querySelector('button[type=submit]').disabled;
    set(f.telefono,'82223333');
    await waitFor(() => $('#dup-alert').hidden && !f.querySelector('button[type=submit]').disabled);
    const dupCleared = $('#dup-alert').hidden;
    set(f.negocio,'Taller'); set(f.monto,'12000'); f.requestSubmit();
    await waitFor(() => !!cardOf('Prueba E2E Cliente'));
    // Test Promoter search bar without focus loss
    const ps = $('[data-input=pro-search]');
    ps.focus();
    set(ps, 'Prueba E2E');
    const focusKept = document.activeElement === ps;
    const foundBySearch = !!cardOf('Prueba E2E Cliente');
    set(ps, '');
    return {
      signedTok: tok.startsWith('at_tok_') && tok.includes('.'),
      hasMobileNav, hasFab, formattedTel, telStatus, dupShown, submitDisabledOnDup, dupCleared,
      focusKept, foundBySearch, card: !!cardOf('Prueba E2E Cliente'), t: toasts()
    };`);
  assert.ok(r.signedTok && r.hasMobileNav && r.hasFab, JSON.stringify(r));
  assert.strictEqual(r.formattedTel, '8845-1122');
  assert.match(r.telStatus, /8 dígitos/);
  assert.match(r.dupShown, /Lester Antonio De La Rocha Rivera/);
  assert.ok(r.submitDisabledOnDup && r.dupCleared && r.focusKept && r.foundBySearch && r.card, JSON.stringify(r));
  await shot('01-promotor-mobile', 390, 844, true);

  // 2. Call Center (betsy.ruiz): View Switcher (Tabla / Kanban with C$ totals & SLA badges) + qualify to pescado
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  r = await ev(H + `
    await loginAs('betsy.ruiz', 'betsy123');
    // Switch to Kanban board and verify pipeline columns + totals + SLA badges
    click('[data-action=view-mode]', 'Kanban');
    const kanbanCols = $$('.kanban-col').length;
    const kanbanHasTotals = $$('.kanban-total').every(el => el.textContent.includes('C$'));
    const hasSlaBadge = $$('.sla').length > 0;
    // Switch back to Tabla and qualify prospect
    click('[data-action=view-mode]', 'Tabla');
    const row = cardOf('Prueba E2E Cliente');
    row.querySelector('[data-action=estado]').click();
    const f=$('form[data-form=estado]'); set(f.estado,'pescado');
    const visible=getComputedStyle(f.querySelector('.only-pescado')).display!=='none';
    set(f.comentarios_pescado,'Cumple requisitos'); set(f.direccionVisita,'Masaya centro'); f.requestSubmit();
    await waitFor(() => !$('.modal') && cardOf('Prueba E2E Cliente')?.textContent.includes('Pescado'));
    return { kanbanCols, kanbanHasTotals, hasSlaBadge, visible, badge: cardOf('Prueba E2E Cliente').textContent, t: toasts() };`);
  assert.ok(r.kanbanCols === 6 && r.kanbanHasTotals && r.hasSlaBadge && r.visible, JSON.stringify(r));
  assert.match(r.badge, /Pescado/);
  assert.ok(r.t.some((x) => /Se notificó a: .*Fanny Del Carmen Ramírez López/.test(x) && /Mary Cruz Cruz Matute/.test(x)), JSON.stringify(r.t));
  await shot('03-cc-desktop', 1280, 900, false);

  // 3. Promotor (fanny.ramirez) logs in and sees bell + notification toast
  r = await ev(H + `
    await loginAs('fanny.ramirez', 'fanny123');
    return { count: $('.bell .count')?.textContent, t: toasts() };`);
  assert.ok(Number(r.count) >= 1, JSON.stringify(r));
  assert.ok(r.t.some((x) => x.includes('¡Atención! Call Center ya calificó a tu cliente Prueba E2E Cliente y fue enviado a tu Gerente de Sucursal')), JSON.stringify(r.t));
  await shot('04-promotor-toast', 390, 844, true);

  // 4. Gerente Masaya (Mary Cruz Cruz Matute) assigns follow-up with Oficial/Gestor (Diego Armando Mendoza Ugarte)
  r = await ev(H + `
    await loginAs('gerente.masaya', 'masaya123');
    const c=cardOf('Prueba E2E Cliente'); const seal=c.textContent.includes('PROPIEDAD DE PROMOTOR: Fanny Del Carmen Ramírez López');
    c.querySelector('[data-pre=seguimiento]').click();
    const f=$('form[data-form=estado]'); set(f.gestorId,'u-ges-mas-diego'); set(f.instrucciones,'Visitar el lunes'); f.requestSubmit();
    await waitFor(() => !$('.modal'));
    click('.tabs button','En seguimiento');
    await waitFor(() => !!cardOf('Prueba E2E Cliente'));
    return { seal, ok: !!cardOf('Prueba E2E Cliente'), txt: cardOf('Prueba E2E Cliente')?.textContent };`);
  assert.ok(r.seal && r.ok && /Diego Armando Mendoza Ugarte/.test(r.txt) && /Visitar el lunes/.test(r.txt), JSON.stringify(r));
  await shot('05-gerente', 390, 844, true);

  // 5. Oficial/Gestor (diego.mendoza) closes case -> Slide-Over Detail Drawer shows 4 timeline steps
  r = await ev(H + `
    await loginAs('diego.mendoza', 'diego123');
    cardOf('Prueba E2E Cliente').querySelector('[data-pre=desembolsado]').click();
    $('form[data-form=estado]').requestSubmit();
    await waitFor(() => !$('.modal'));
    click('.tabs button','Historial');
    cardOf('Prueba E2E Cliente').querySelector('[data-action=ver]').click();
    return { isDrawer: !!$('.modal.drawer'), steps: $$('.modal .timeline li').length };`);
  assert.ok(r.isDrawer && r.steps === 4, JSON.stringify(r));
  await shot('06-drawer-timeline', 1280, 900, false);

  // 6. Admin: tabs, user search without focus loss, dark mode, sound prefs modal, origin lock, config edit
  r = await ev(H + `
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    await loginAs('admin', 'admin123');
    // Toggle dark mode and verify persistence
    click('[data-action=toggle-theme]');
    const darkOn = document.documentElement.dataset.theme === 'dark';
    click('[data-action=toggle-theme]');
    const lightBack = !document.documentElement.dataset.theme;
    // Open sound prefs modal and test sound cue
    click('[data-action=sound-prefs]');
    const hasSoundModal = !!$('[data-action=test-sound]');
    $('[data-action=test-sound]')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    // Verify tabs + user search without focus loss
    const out = { darkOn, lightBack, hasSoundModal };
    for (const t of ['Métricas','Prospectos','Usuarios','Configuración','Auditoría']) { click('.tabs button',t); out[t]=$('#app').textContent.length; }
    click('.tabs button','Configuración');
    const f=$('form[data-form=config]'); f.estado_nuevo.value='Nuevo (Cola CC)'; f.requestSubmit();
    await waitFor(() => toasts().some(x => x.includes('Configuración guardada')));
    click('.tabs button','Prospectos');
    out.label=$('#app').textContent.includes('Nuevo (Cola CC)');
    cardOf('Prueba E2E Cliente').querySelector('[data-action=editar]').click();
    out.lock=$('.modal').textContent.includes('Candado de Origen');
    const e=$('form[data-form=editar]'); set(e.nombre,'Prueba E2E Editado'); e.requestSubmit();
    await waitFor(() => !$('.modal') && !!cardOf('Prueba E2E Editado'));
    out.edited=!!cardOf('Prueba E2E Editado');
    click('.tabs button','Usuarios');
    const us = $('[data-input=user-search]');
    us.focus(); set(us, 'fanny');
    out.userSearchKeptFocus = document.activeElement === us && $('#users-tbody').textContent.includes('fanny.ramirez');
    set(us, '');
    click('[data-action=usuario]','Nuevo usuario');
    const u=$('form[data-form=usuario]'); set(u.nombre,'Promotor Nuevo'); set(u.sucursal,'León'); u.requestSubmit();
    await waitFor(() => !$('.modal') && $('#app').textContent.includes('Promotor Nuevo'));
    out.user=$('#app').textContent.includes('Promotor Nuevo');
    click('.tabs button','Métricas');
    return out;`);
  assert.ok(r.darkOn && r.lightBack && r.hasSoundModal && r.label && r.lock && r.edited && r.userSearchKeptFocus && r.user, JSON.stringify(r));
  await shot('07-admin-desktop', 1280, 900, false);

  // 7. Admin DB Manager: real HTTP 400 SQL error displayed (no silent fake fallback!) + valid SELECT + CSV Depurador
  r = await ev(H + `
    click('.tabs button', 'Base de Datos');
    click('[data-action=db-ver-tabla]', 'Explorar tabla');
    await waitFor(() => $('#app').textContent.includes('Explorador de Tabla SQL'));
    const hasTable = true;
    // Test invalid/destructive SQL displays real server error
    const sqlForm = $('form[data-form=db-sql]');
    set(sqlForm.sql, 'DROP TABLE alfatrack_usuarios');
    sqlForm.requestSubmit();
    await waitFor(() => $('#app .alert')?.textContent.includes('lectura'));
    const realSqlError = $('#app .alert').textContent;
    // Test valid SELECT
    const sqlForm2 = $('form[data-form=db-sql]');
    set(sqlForm2.sql, 'SELECT username, rol, sucursal FROM alfatrack_usuarios LIMIT 5');
    sqlForm2.requestSubmit();
    await waitFor(() => $('#app').textContent.includes('Consulta ejecutada'));
    const hasSqlRes = true;
    // CSV Depurador layout + import via /api/mutate
    click('.tabs button', 'Depurador CSV');
    const hasStyledCsvTa = !!$('.csv-textarea');
    click('[data-action=csv-ejemplo]');
    const beforeCount = $$('#app table tbody tr').length;
    click('[data-action=csv-importar]');
    await waitFor(() => toasts().some(x => x.includes('importaron')));
    return { hasTable, realSqlError, hasSqlRes, hasStyledCsvTa, beforeCount };`);
  assert.ok(r.hasTable && /lectura/i.test(r.realSqlError) && r.hasSqlRes && r.hasStyledCsvTa && r.beforeCount >= 2, JSON.stringify(r));
  await shot('08-admin-db-manager', 1280, 900, false);

  // 8. Official real promoters (Yeiling Pérez, Araceli Juárez, Claudia Suazo) see their imported prospects
  r = await ev(H + `
    await loginAs('yeiling.perez', 'yeiling123');
    const seesBismarck = !!cardOf('Bismarck José López');
    const whoYeiling = $('.who')?.textContent;
    await loginAs('araceli.juarez', 'araceli123');
    const whoAraceli = $('.who')?.textContent;
    await loginAs('claudia.suazo', 'claudia123');
    const seesImported = !!cardOf('Elizabeth Lopez');
    return { seesBismarck, whoYeiling, whoAraceli, seesImported, who: $('.who')?.textContent };`);
  assert.ok(r.seesBismarck && /Yeiling Patricia Pérez Muñoz/.test(r.whoYeiling) && /Araceli De Jesús Juárez/.test(r.whoAraceli) && r.seesImported && /Claudia Cecilia Suazo Muñoz/.test(r.who), JSON.stringify(r));
  await shot('09-promotora-claudia', 390, 844, true);

  // 9. Direct /turso route opens DB Manager for Admin
  const tursoUrl = targetUrl.replace(/\/index\.html$/, '').replace(/\/+$/, '') + '/turso';
  await send('Page.navigate', { url: tursoUrl }); await sleep(1000);
  r = await ev(H + `
    await loginAs('admin', 'admin123');
    await waitFor(() => $('#app').textContent.includes('Gestor de Base de Datos en la Nube'));
    return {
      title: $('#app').textContent.includes('Gestor de Base de Datos en la Nube'),
      noRawTursoError: !document.body.textContent.includes('empty JWT token'),
    };`);
  assert.ok(r.title && r.noRawTursoError, JSON.stringify(r));

  // 10. Unified Call Center Directo -> Branch Manager Distribution -> Assigned Promoter Note -> Admin Traceability Metrics
  await send('Page.navigate', { url: targetUrl }); await sleep(900);
  r = await ev(H + `
    // 10a. Call Center (betsy.ruiz) registers a Directo a Gerencia lead (no street promoter)
    await loginAs('betsy.ruiz', 'betsy123');
    click('.tabs button', 'Captura Call Center');
    const fc = $('form[data-form=captura-cc-directo]');
    if (!fc) throw new Error('Directo form not shown by default');
    set(fc.sucursal, 'Managua');
    const autoEmail = fc.emailGerente.value;
    set(fc.nombre, 'Cliente Directo CC E2E');
    set(fc.telefono, '83334455');
    set(fc.monto, '22000');
    set(fc.negocio, 'Pulpería');
    set(fc.direccion, 'Managua, barrio Bolonia');
    set(fc.notas, 'Interesada vía Facebook');
    fc.requestSubmit();
    await waitFor(() => !!cardOf('Cliente Directo CC E2E'));

    // 10b. Gerente Managua (Claudia Lorena Cano García) sees Directo case, filters by Directo Call Center, distributes to Lester + Jamilton
    await loginAs('gerente.managua', 'managua123');
    click('[data-action=ger-origen][data-val=callcenter_directo]');
    const gc = cardOf('Cliente Directo CC E2E');
    if (!gc) throw new Error('Gerente Managua did not see Directo CC case');
    const hasCCSeal = gc.textContent.includes('CASO DIRECTO CALL CENTER');
    gc.querySelector('[data-pre=seguimiento]').click();
    const fe = $('form[data-form=estado]');
    set(fe.asignadoPromotorId, 'u-pro-mga-lester');
    set(fe.gestorId, 'u-ges-mga-jamilton');
    set(fe.instrucciones, 'Lester y Jamilton coordinar visita hoy.');
    fe.requestSubmit();
    await waitFor(() => !$('.modal'));

    // 10c. Assigned promoter (lester.rocha) sees distributed CC Directo case and adds follow-up note
    await loginAs('lester.rocha', 'lester123');
    const pc = cardOf('Cliente Directo CC E2E');
    if (!pc) throw new Error('Assigned promoter did not see distributed CC Directo case');
    pc.querySelector('[data-action=ver]').click();
    const fn = $('form[data-form=nota]');
    set(fn.texto, 'Cliente contactada, visita confirmada 3pm.');
    fn.requestSubmit();
    await waitFor(() => $('.modal .timeline').textContent.includes('visita confirmada 3pm'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    // 10d. Admin sees Call Center Directo traceability section in Métricas
    await loginAs('admin', 'admin123');
    click('.tabs button', 'Métricas');
    const hasCCMetrics = $('#app').textContent.includes('Trazabilidad Call Center Directo') && $('#app').textContent.includes('Betsy Mabell Ruíz Herrera');
    return { autoEmail, hasCCSeal, hasCCMetrics };`);
  assert.strictEqual(r.autoEmail, 'gerentemanaguabolonia@gmail.com');
  assert.ok(r.hasCCSeal && r.hasCCMetrics, JSON.stringify(r));

  assert.deepStrictEqual(errors, [], 'no console errors');
  console.log('E2E OK');
} catch (e) {
  console.error('E2E FAIL', e, errors);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
  if (localSrv) try { localSrv.close(); } catch {}
}
