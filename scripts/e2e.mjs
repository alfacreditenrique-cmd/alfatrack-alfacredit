// End-to-end smoke test: drives the real UI in headless Chrome via CDP (no deps).
// Usage: start a static server on :8765 (python -m http.server 8765), then: node scripts/e2e.mjs
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
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
async function shot(name, w, hgt, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync('scripts/shots', { recursive: true });
  writeFileSync(`scripts/shots/${name}.png`, Buffer.from(data, 'base64'));
}

// in-page helpers
const H = `
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const set=(el,v)=>{el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));};
const click=(sel,txt)=>{const el=$$(sel).find(e=>!txt||e.textContent.includes(txt)); if(!el) throw new Error('no '+sel+' '+txt); el.click(); return el;};
const loginAs=(u,p)=>{
  if($('[data-action=logout]')) $('[data-action=logout]').click();
  const lf=$('form[data-form=login]');
  if(!lf) throw new Error('Login form not visible');
  set(lf.username,u); set(lf.password,p); lf.requestSubmit();
};
const cardOf=n=>$$('#app .card, #app tr').find(c=>c.textContent.includes(n));
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
  await ev(`localStorage.clear(); location.reload();`).catch(() => {}); await sleep(1500);

  // dialogs (confirm) auto-accept
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });

  await shot('01-login-clean', 390, 844, true);

  // 0. Verify clean login screen: no credentials table, no quick-login buttons, no #sel-rol/#sel-user demo switcher
  let r = await ev(H + `
    return {
      hasLoginForm: !!$('form[data-form=login]'),
      hasSelRol: !!$('#sel-rol'),
      hasSelUser: !!$('#sel-user'),
      hasQuickLogin: !!$('[data-action=quick-login]'),
      hasCredTable: $$('.login-wrap table').length,
      bodyTxt: document.body.textContent,
    };`);
  assert.ok(r.hasLoginForm && !r.hasSelRol && !r.hasSelUser && !r.hasQuickLogin && r.hasCredTable === 0, JSON.stringify(r));
  assert.ok(!/admin123|Directorio Oficial de Usuarios/i.test(r.bodyTxt), 'No credentials leaked on login screen');

  // 1. Official Promotor (Fanny Ramírez — Masaya: fanny.ramirez / fanny123) logs in and registers; duplicate is blocked
  r = await ev(H + `
    loginAs('fanny.ramirez', 'fanny123');
    const noDemoSwitch = !$('#sel-rol') && !$('#sel-user');
    click('.tabs button','Registrar');
    const f=$('form[data-form=nuevo]');
    set(f.nombre,'Prueba E2E Cliente'); set(f.telefono,'8845-1122');
    const dupShown=!$('#dup-alert').hidden && $('#dup-alert').textContent;
    f.requestSubmit(); const stillForm=!!$('form[data-form=nuevo]');
    set(f.telefono,'8222-3333'); const dupCleared=$('#dup-alert').hidden;
    set(f.negocio,'Taller'); set(f.monto,'12000'); f.requestSubmit();
    return {noDemoSwitch, dupShown, stillForm, dupCleared, card: !!cardOf('Prueba E2E Cliente'), t: toasts()};`);
  assert.ok(r.noDemoSwitch, 'no demo switcher after login');
  assert.match(r.dupShown, /Carlos Rivera/, 'duplicate alert names original promotor');
  assert.ok(r.stillForm && r.dupCleared && r.card, JSON.stringify(r));
  await shot('01-promotor-mobile', 390, 844, true);

  // 2. Call Center (karla.mendoza / karla123) logs in and qualifies it
  await shot('02-cc-desktop-before', 1280, 900, false);
  r = await ev(H + `
    loginAs('karla.mendoza', 'karla123');
    const row=cardOf('Prueba E2E Cliente'); row.querySelector('[data-action=estado]').click();
    const f=$('form[data-form=estado]'); set(f.estado,'pescado');
    const visible=getComputedStyle(f.querySelector('.only-pescado')).display!=='none';
    set(f.comentarios_pescado,'Cumple requisitos'); set(f.direccionVisita,'Masaya centro'); f.requestSubmit();
    return {visible, modal: !!$('.modal'), badge: cardOf('Prueba E2E Cliente').textContent, t: toasts()};`);
  assert.ok(r.visible && !r.modal, JSON.stringify(r));
  assert.match(r.badge, /Pescado/);
  assert.ok(r.t.some((x) => /Se notificó a: .*FANNY DEL CARMEN RAMÍREZ LÓPEZ/.test(x) && /Patricia Aguirre/.test(x)), JSON.stringify(r.t));
  await shot('03-cc-desktop', 1280, 900, false);
  await shot('03b-cc-mobile', 390, 844, true);

  // 3. Promotor (fanny.ramirez) logs in and sees bell + toast
  r = await ev(H + `loginAs('fanny.ramirez', 'fanny123'); return {count: $('.bell .count')?.textContent, t: toasts()};`);
  assert.ok(Number(r.count) >= 1, JSON.stringify(r));
  assert.ok(r.t.some((x) => x.includes('¡Atención! Call Center ya calificó a tu cliente Prueba E2E Cliente y fue enviado a tu Gerente de Sucursal')), JSON.stringify(r.t));
  await shot('04-promotor-toast', 390, 844, true);

  // 4. Gerente Masaya (gerente.masaya / masaya123) logs in and assigns follow-up with a gestor
  r = await ev(H + `
    loginAs('gerente.masaya', 'masaya123');
    const c=cardOf('Prueba E2E Cliente'); const seal=c.textContent.includes('PROPIEDAD DE PROMOTOR: FANNY DEL CARMEN RAMÍREZ LÓPEZ');
    c.querySelector('[data-pre=seguimiento]').click();
    const f=$('form[data-form=estado]'); set(f.gestorId,'u-ges-masaya'); set(f.instrucciones,'Visitar el lunes'); f.requestSubmit();
    click('.tabs button','En seguimiento');
    return {seal, ok: !!cardOf('Prueba E2E Cliente'), txt: cardOf('Prueba E2E Cliente')?.textContent};`);
  assert.ok(r.seal && r.ok && /Ernesto Vílchez/.test(r.txt) && /Visitar el lunes/.test(r.txt), JSON.stringify(r));
  await shot('05-gerente', 390, 844, true);

  // 5. Gestor (ernesto.vilchez / ernesto123) logs in and closes it; timeline has all steps
  r = await ev(H + `
    loginAs('ernesto.vilchez', 'ernesto123');
    cardOf('Prueba E2E Cliente').querySelector('[data-pre=desembolsado]').click();
    $('form[data-form=estado]').requestSubmit();
    click('.tabs button','Historial'); cardOf('Prueba E2E Cliente').querySelector('[data-action=ver]').click();
    return $$('.modal .timeline li').length;`);
  assert.strictEqual(r, 4, 'timeline: created, pescado, seguimiento, desembolsado');
  await shot('06-timeline', 390, 844, true);

  // 6. Admin (admin / admin123): every tab renders; origin locked in edit; config edit applies
  r = await ev(H + `
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    loginAs('admin', 'admin123');
    const out={};
    for (const t of ['Métricas','Prospectos','Usuarios','Configuración','Auditoría']) { click('.tabs button',t); out[t]=$('#app').textContent.length; }
    click('.tabs button','Configuración');
    const f=$('form[data-form=config]'); f.estado_nuevo.value='Nuevo (Cola CC)'; f.requestSubmit();
    click('.tabs button','Prospectos');
    out.label=$('#app').textContent.includes('Nuevo (Cola CC)');
    cardOf('Prueba E2E Cliente').querySelector('[data-action=editar]').click();
    out.lock=$('.modal').textContent.includes('Candado de Origen');
    const e=$('form[data-form=editar]'); set(e.nombre,'Prueba E2E Editado'); e.requestSubmit();
    out.edited=!!cardOf('Prueba E2E Editado');
    click('.tabs button','Usuarios'); click('[data-action=usuario]','Nuevo usuario');
    const u=$('form[data-form=usuario]'); set(u.nombre,'Promotor Nuevo'); set(u.sucursal,'León'); u.requestSubmit();
    out.user=$('#app').textContent.includes('Promotor Nuevo');
    click('.tabs button','Métricas');
    return out;`);
  assert.ok(r.label && r.lock && r.edited && r.user, JSON.stringify(r));
  await shot('07-admin-desktop', 1280, 900, false);

  // 7. Logout -> Clean Login Screen -> Wrong password blocked -> Login as admin/admin123 -> DB Manager & CSV Depurador
  r = await ev(H + `
    click('[data-action=logout]');
    const onLogin = !!$('form[data-form=login]');
    const dirRows = $$('.login-wrap table tbody tr').length;
    const lf = $('form[data-form=login]');
    set(lf.username, 'admin'); set(lf.password, 'badpass'); lf.requestSubmit();
    const stillLogin = !!$('form[data-form=login]');
    set(lf.username, 'admin'); set(lf.password, 'admin123'); lf.requestSubmit();
    const loggedAdmin = !!($$('.tabs button').find(b => b.textContent.includes('Base de Datos')));
    return { onLogin, dirRows, stillLogin, loggedAdmin };`);
  assert.ok(r.onLogin && r.dirRows === 0 && r.stillLogin && r.loggedAdmin, JSON.stringify(r));

  // 8. Admin Database Manager (SQL Console + Table Explorer + Backup) & CSV Depurador
  r = await ev(H + `
    click('.tabs button', 'Base de Datos');
    click('[data-action=db-ver-tabla]', 'Explorar tabla');
    await new Promise(r => setTimeout(r, 400));
    const hasTable = $('#app').textContent.includes('Explorador de Tabla SQL');
    const sqlForm = $('form[data-form=db-sql]');
    set(sqlForm.sql, 'SELECT username, rol, sucursal FROM alfatrack_usuarios LIMIT 5');
    sqlForm.requestSubmit();
    await new Promise(r => setTimeout(r, 400));
    const hasSqlRes = $('#app').textContent.includes('Consulta ejecutada');
    click('.tabs button', 'Depurador CSV');
    click('[data-action=csv-ejemplo]');
    const beforeCount = $$('#app table tbody tr').length;
    click('[data-action=csv-importar]');
    return { hasTable, hasSqlRes, beforeCount };`);
  assert.ok(r.hasTable && r.hasSqlRes && r.beforeCount >= 2, JSON.stringify(r));
  await shot('08-admin-db-manager', 1280, 900, false);

  // 9. Logout and login as official promoters from the image (Yeiling Muñoz, Maria Jose Lopez Wilson) & Laura Varela -> sees their prospects
  r = await ev(H + `
    loginAs('yeiling.munoz', 'yeiling123');
    const seesBismarck = !!cardOf('Bismarck José López');
    const whoYeiling = $('.who')?.textContent;
    loginAs('maria.lopez', 'maria123');
    const whoMaria = $('.who')?.textContent;
    loginAs('laura.varela', 'laura123');
    const seesImported = !!cardOf('Elizabeth Lopez');
    return { seesBismarck, whoYeiling, whoMaria, seesImported, who: $('.who')?.textContent };`);
  assert.ok(r.seesBismarck && /YEILING PATRICIA PÉREZ MUÑOZ/.test(r.whoYeiling) && /Maria Jose Lopez Wilson/.test(r.whoMaria) && r.seesImported && /Laura Varela/.test(r.who), JSON.stringify(r));
  await shot('09-promotora-laura', 390, 844, true);

  // 10. Navigate directly to /turso -> verify Turso Web Database Manager loads directly for Admin without any JWT error
  const tursoUrl = targetUrl.replace(/\/index\.html$/, '/turso');
  await send('Page.navigate', { url: tursoUrl }); await sleep(1200);
  r = await ev(H + `
    loginAs('admin', 'admin123');
    await new Promise(r => setTimeout(r, 400));
    return {
      title: $('#app').textContent.includes('Gestor de Base de Datos en la Nube'),
      noRawTursoError: !document.body.textContent.includes('empty JWT token'),
    };`);
  assert.ok(r.title && r.noRawTursoError, JSON.stringify(r));

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
