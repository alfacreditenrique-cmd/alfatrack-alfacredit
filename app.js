/* AlfaTrack UI — PWA + Real Auth + Promoter Forms & CSV Depurador + Turso Cloud SQLite Database Manager */
(function () {
  'use strict';
  const C = window.Core;
  const KEY = 'alfatrack_v1';
  const UKEY = 'alfatrack_user';
  const AKEY = 'alfatrack_auth';
  const TKEY = 'alfatrack_token';
  const $ = (sel) => document.querySelector(sel);
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'C$ ' + Number(n || 0).toLocaleString('es-NI');
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString('es-NI', { day: '2-digit', month: 'short' }) : '—');
  const telFmt = (t) => String(t || '').replace(/^(\d{4})(\d{4})$/, '$1-$2');

  let localEpoch = 0;
  let syncQueue = Promise.resolve();
  let S = load();
  const isDbManagerUrl = () => /^\/(?:turso|db|gestor-db\.html)$/i.test(location.pathname || '') || /(?:^|[?&])(?:tab|view)=(?:bd|turso|db)\b/i.test(location.search || '') || /^#(?:turso|bd|db)$/i.test(location.hash || '');
  const ui = {
    userId: localStorage.getItem(UKEY),
    autenticado: Boolean(localStorage.getItem(AKEY)),
    token: localStorage.getItem(TKEY) || '',
    showPasswords: false,
    userRoleFilter: '',
    userBranchFilter: '',
    userSearch: '',
    proFilter: '',
    proSearch: '',
    tab: isDbManagerUrl() ? { adm: 'bd' } : {},
    f: { sucursal: '', estado: '', tipoCredito: '', plataforma: '', desde: '', hasta: '', q: '' },
    csv: { filas: [], clasif: null, tab: 'validos', rawText: '' },
    db: {
      stats: null,
      activeTable: 'alfatrack_usuarios',
      tableData: null,
      sql: 'SELECT username, password, nombre, rol, sucursal, activo FROM alfatrack_usuarios ORDER BY rol, sucursal LIMIT 100',
      sqlResult: null,
      syncing: false,
      lastSync: '',
      tursoConnected: true,
    },
    bell: false,
    modal: null, // {type, id}
  };

  function upgradeLocalState(s) {
    const base = C.seed();
    s.version = 1;
    s.config = Object.assign({}, base.config, s.config || {});
    s.config.emailsGerentes = Object.assign({}, base.config.emailsGerentes, (s.config && s.config.emailsGerentes) || {});
    if (!Array.isArray(s.config.tiposCredito) || !s.config.tiposCredito.length) s.config.tiposCredito = base.config.tiposCredito;
    if (!Array.isArray(s.config.plataformas) || !s.config.plataformas.length) s.config.plataformas = base.config.plataformas;
    s.usuarios = Array.isArray(s.usuarios) ? s.usuarios : [];
    const byId = new Map(s.usuarios.map((u) => [u.id, u]));
    const used = new Set(s.usuarios.map((u) => (u.username || '').toLowerCase()).filter(Boolean));
    const OFFICIAL_IDS = new Set([
      'u-pro-managua', 'u-pro-mga-lester', 'u-pro-mga-claudia', 'u-pro-mga-marjorie',
      'u-pro-mas-fanny', 'u-pro-mas-noelia', 'u-pro-mas-yeiling',
      'u-pro-jin-nidia', 'u-pro-jui-martha',
      'u-pro-seb-evelia', 'u-pro-seb-jiurem',
      'u-pro-leo-araceli', 'u-pro-leo-lorena',
    ]);
    const needsOfficialMigration = !s.officialPromotersV2;
    s.usuarios.forEach((u) => {
      const bm = base.usuarios.find((x) => x.id === u.id);
      if (needsOfficialMigration && bm && OFFICIAL_IDS.has(u.id)) {
        used.delete((u.username || '').toLowerCase());
        u.nombre = bm.nombre;
        u.sucursal = bm.sucursal;
        u.username = bm.username;
        used.add(u.username);
      }
      if (!u.username) {
        u.username = (bm && !used.has(bm.username)) ? bm.username : C.genUsername(u.nombre, used);
        used.add(u.username);
      }
      if (!u.password) u.password = (bm && bm.password) || (u.id === 'u-admin' ? 'admin123' : C.genPassword(u.username));
      if (!u.passwordHash) u.passwordHash = C.hashPwd(u.password);
      if (u.email === undefined && bm) u.email = bm.email || '';
    });
    base.usuarios.forEach((bu) => {
      if (!byId.has(bu.id) && !used.has(bu.username)) {
        s.usuarios.push(JSON.parse(JSON.stringify(bu)));
        byId.set(bu.id, bu);
        used.add(bu.username);
      }
    });
    if (needsOfficialMigration && Array.isArray(s.prospectos)) {
      s.prospectos.forEach((p) => {
        const uOrig = byId.get(p.promotor_origen_id);
        if (uOrig && OFFICIAL_IDS.has(uOrig.id)) p.promotor_nombre = uOrig.nombre;
      });
    }
    s.officialPromotersV2 = true;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1) return upgradeLocalState(s);
      }
    } catch (e) { /* corrupted storage: fall back to seed */ }
    const s = C.seed();
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  }

  const saveLocal = () => localStorage.setItem(KEY, JSON.stringify(S));

  async function syncToCloud() {
    if (!location.protocol.startsWith('http')) return;
    const snapshot = JSON.parse(JSON.stringify(S));
    syncQueue = syncQueue.then(async () => {
      ui.db.syncing = true;
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: snapshot }),
        });
        if (res.ok) {
          const data = await res.json();
          ui.db.tursoConnected = Boolean(data.tursoSynced);
          ui.db.lastSync = new Date().toLocaleTimeString('es-NI');
        }
      } catch {} finally {
        ui.db.syncing = false;
      }
    });
    return syncQueue;
  }

  async function pullFromCloud(forceRender) {
    if (!location.protocol.startsWith('http')) return;
    const epochAtStart = localEpoch;
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && data.state && epochAtStart === localEpoch) {
        S = upgradeLocalState(data.state);
        saveLocal();
        ui.db.tursoConnected = data.source && data.source.startsWith('turso');
        ui.db.lastSync = new Date().toLocaleTimeString('es-NI');
        const typing = document.activeElement && document.activeElement.closest('form, input, select, textarea, .modal');
        if (forceRender || !typing) render();
      }
    } catch {}
  }

  async function fetchDbStats() {
    if (!location.protocol.startsWith('http')) return;
    try {
      const res = await fetch('/api/db/stats');
      if (res.ok) {
        ui.db.stats = await res.json();
        ui.db.tursoConnected = Boolean(ui.db.stats.tursoConnected);
        render();
      }
    } catch {}
  }

  async function fetchDbTable(name) {
    ui.db.activeTable = name;
    if (location.protocol.startsWith('http')) {
      try {
        const res = await fetch('/api/db/table?name=' + encodeURIComponent(name) + '&limit=200&actorId=' + encodeURIComponent(ui.userId || ''));
        if (res.ok) {
          ui.db.tableData = await res.json();
          render();
          return;
        }
      } catch {}
    }
    // Local fallback table projection
    const rows = name === 'alfatrack_usuarios'
      ? S.usuarios.map((u) => ({ id: u.id, username: u.username, password: u.password, nombre: u.nombre, rol: u.rol, sucursal: u.sucursal, email: u.email || '', activo: u.activo ? 1 : 0 }))
      : name === 'alfatrack_prospectos'
        ? S.prospectos.map((p) => ({ id: p.id, nombre: p.nombre, telefono: p.telefono, tipo_credito: p.tipoCredito || 'NV(NUEVO)', monto: p.monto, promotor_nombre: p.promotor_nombre, sucursal: p.sucursal, estado: p.estado }))
        : name === 'alfatrack_notificaciones'
          ? S.notificaciones.slice(-100)
          : S.auditoria.slice(-100);
    ui.db.tableData = { ok: true, table: name, columns: rows.length ? Object.keys(rows[0]) : [], rows };
    render();
  }

  const save = () => {
    localEpoch++;
    saveLocal();
    syncToCloud();
  };

  const user = (id) => S.usuarios.find((u) => u.id === id);
  const pro = (id) => S.prospectos.find((p) => p.id === id);
  const me = () => user(ui.userId);
  const est = (e) => S.config.estados[e] || e;

  function ensureUser() {
    const u = me();
    if (!u || !u.activo) {
      ui.userId = (S.usuarios.find((x) => x.rol === 'promotor' && x.activo) || S.usuarios.find((x) => x.activo)).id;
    }
    localStorage.setItem(UKEY, ui.userId);
  }

  function setAuthenticatedSession(u, token) {
    ui.userId = u.id;
    ui.autenticado = true;
    ui.token = token || ('at_local_' + u.id);
    localStorage.setItem(UKEY, u.id);
    localStorage.setItem(AKEY, '1');
    localStorage.setItem(TKEY, ui.token);
  }

  function logoutSession() {
    ui.autenticado = false;
    ui.token = '';
    ui.bell = false;
    ui.modal = null;
    localStorage.removeItem(AKEY);
    localStorage.removeItem(TKEY);
    render();
  }

  // Apply a core mutation; persist + rerender on success, toast on error.
  function commit(res, okMsg) {
    if (!res.ok) { toast(res.error, 'error'); return false; }
    save();
    if (okMsg) toast(okMsg, 'ok');
    render();
    return true;
  }

  // ---------- CSV helpers ----------
  function parseCSVText(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return [];
    const splitLine = (line, sep) => {
      const out = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === sep && !inQ) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const firstCols = splitLine(lines[0], sep);
    const hasHeader = firstCols.some((c) => /cliente|nombre|telefono|promotor|pomotor|valor|monto/i.test(c));
    const headers = hasHeader ? firstCols : ['Cliente', 'Telefono', 'Promotor', 'VALOR', 'Negocio', 'Direccion'];
    const startIdx = hasHeader ? 1 : 0;
    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
      const vals = splitLine(lines[i], sep);
      if (!vals.some(Boolean)) continue;
      const obj = {};
      headers.forEach((hk, idx) => { obj[hk] = vals[idx] ?? ''; });
      rows.push(obj);
    }
    return rows;
  }

  function downloadCSV(filename, headers, rows) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const content = '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- toasts ----------
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${h(msg)}</span><button aria-label="Cerrar" data-close-toast>×</button>`;
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
    setTimeout(() => el.remove(), kind === 'notif' ? 9000 : 5000);
  }
  function toastPendientes() {
    if (!ui.autenticado) return;
    let changed = false;
    S.notificaciones.filter((n) => n.userId === ui.userId && !n.toasted).forEach((n) => {
      n.toasted = true; changed = true;
      toast('🔔 ' + n.texto, 'notif');
    });
    if (changed) saveLocal();
  }

  // ---------- components ----------
  const SEM = { nuevo: 'gray', gestion: 'amber', pescado: 'lime', seguimiento: 'blue', desembolsado: 'green', descartado: 'red' };
  const badgeEstado = (e) => `<span class="badge b-${SEM[e]}">${h(est(e))}</span>`;
  const badgeTipoCredito = (tc) => {
    const v = tc || 'NV(NUEVO)';
    const cls = v.startsWith('RP') ? 'b-blue' : v.startsWith('RC') ? 'b-amber' : 'b-green';
    return `<span class="badge ${cls}" title="Tipo de crédito">${h(v)}</span>`;
  };
  const captado = (p) => `<span class="badge b-origin" title="Promotor de origen (no modificable)">🔒 Captado por: ${h(p.promotor_nombre)} — Sucursal: ${h(p.sucursal)}</span>`;
  const STEP_LBL = ['Registro', 'Call Center', 'Calificado', 'Seguimiento', 'Desembolso'];

  function progreso(p) {
    if (p.estado === 'descartado') return `<div class="progress discarded"><div class="bar"><span style="width:100%"></span></div><small>✖ ${h(p.motivoDescarte)}</small></div>`;
    const paso = C.PASO[p.estado];
    return `<div class="progress" aria-label="Paso ${paso} de 5">
      <ol class="steps">${STEP_LBL.map((l, i) => `<li class="${i + 1 < paso ? 'done' : ''} ${i + 1 === paso ? 'current' : ''}"><i>${i + 1 < paso ? '✓' : i + 1}</i><span>${l}</span></li>`).join('')}</ol>
    </div>`;
  }

  function accionesCard(p) {
    const u = me();
    const t = C.transiciones(u, p);
    const b = [];
    const wa = 'https://wa.me/505' + p.telefono + '?text=' + encodeURIComponent(C.fill(S.config.plantillas.whatsapp, { cliente: p.nombre, agente: u.nombre, promotor: p.promotor_nombre, sucursal: p.sucursal }));
    b.push(`<a class="btn sm ghost" href="tel:+505${h(p.telefono)}">📞 Llamar</a>`, `<a class="btn sm wa" target="_blank" rel="noopener" href="${h(wa)}">💬 WhatsApp</a>`);
    if (u.rol === 'callcenter' && t.length) b.push(`<button class="btn sm primary" data-action="estado" data-id="${p.id}">Gestionar llamada</button>`);
    if (u.rol === 'gerente' && p.estado === 'pescado') b.push(`<button class="btn sm primary" data-action="estado" data-id="${p.id}" data-pre="seguimiento">Asignar Seguimiento</button>`);
    if ((u.rol === 'gerente' || u.rol === 'gestor') && p.estado === 'seguimiento') b.push(`<button class="btn sm primary" data-action="estado" data-id="${p.id}" data-pre="desembolsado">Cerrar caso</button>`);
    if (u.rol === 'gerente' && p.estado === 'seguimiento') b.push(`<button class="btn sm ghost" data-action="estado" data-id="${p.id}" data-pre="seguimiento">Reasignar apoyo</button>`);
    if (u.rol === 'admin') b.push(`<button class="btn sm ghost" data-action="editar" data-id="${p.id}">✏️ Editar</button>`, `<button class="btn sm primary" data-action="estado" data-id="${p.id}">Cambiar estado</button>`);
    b.push(`<button class="btn sm ghost" data-action="ver" data-id="${p.id}">🕒 Historial</button>`);
    return `<div class="actions">${b.join('')}</div>`;
  }

  function card(p, opts) {
    opts = opts || {};
    const g = p.gestorId && user(p.gestorId);
    return `<article class="card s-${SEM[p.estado]}">
      <header>
        <div>
          <h3>${h(p.nombre)}</h3>
          <small>${fecha(p.creado)} · ${telFmt(p.telefono)}${p.telefonoSecundario ? ' / ' + telFmt(p.telefonoSecundario) : ''}</small>
        </div>
        <div class="badges-col">${badgeEstado(p.estado)} ${badgeTipoCredito(p.tipoCredito)}</div>
      </header>
      ${opts.sello ? `<div class="seal">🔒 PROPIEDAD DE PROMOTOR: <b>${h(p.promotor_nombre)}</b> <em>(No modificable)</em></div>` : captado(p)}
      <dl class="facts">
        <div><dt>Monto</dt><dd>${money((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto)}</dd></div>
        <div><dt>Negocio</dt><dd>${h((p.cc && p.cc.rubro) || p.negocio || '—')}</dd></div>
        <div><dt>Canal / Origen</dt><dd>${h(p.plataforma || 'Cambaceo / Campo')}${p.campana ? ` · <small>${h(p.campana)}</small>` : ''}</dd></div>
        <div><dt>Cédula</dt><dd>${h(p.cedula || '—')}</dd></div>
        <div class="wide"><dt>Dirección</dt><dd>${h((p.cc && p.cc.direccionVisita) || p.direccion || '—')}</dd></div>
      </dl>
      ${progreso(p)}
      ${p.cc && (p.cc.comentarios || p.cc.ultimaGestion) ? `<p class="note cc"><b>📞 Call Center (${h(p.cc.agente)}):</b> ${h(p.cc.comentarios || p.cc.ultimaGestion)}</p>` : ''}
      ${p.gerencia ? `<p class="note ger"><b>🏢 Gerente (${h(p.gerencia.gerente)}):</b> ${h(p.gerencia.instrucciones)}${g ? `<br><b>Gestor de apoyo:</b> ${h(g.nombre)}` : ''}</p>` : ''}
      ${accionesCard(p)}
    </article>`;
  }

  const lista = (arr, opts, vacio) => arr.length
    ? `<div class="grid">${arr.slice().sort((a, b) => b.actualizado.localeCompare(a.actualizado)).map((p) => card(p, opts)).join('')}</div>`
    : `<div class="empty">${h(vacio || 'No hay prospectos aquí.')}</div>`;

  function tabs(key, items) {
    const cur = ui.tab[key] || items[0][0];
    return `<nav class="tabs" role="tablist">${items.map(([k, l, n]) => `<button role="tab" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}" data-action="tab" data-key="${key}" data-val="${k}">${l}${n !== undefined ? ` <span class="pill">${n}</span>` : ''}</button>`).join('')}</nav>`;
  }
  const tabActual = (key, def) => ui.tab[key] || def;

  // ---------- filters (Call Center + Admin) ----------
  function filtrar(arr) {
    const f = ui.f;
    const q = f.q.trim().toLowerCase();
    return arr.filter((p) =>
      (!f.sucursal || p.sucursal === f.sucursal) &&
      (!f.estado || p.estado === f.estado) &&
      (!f.tipoCredito || (p.tipoCredito || 'NV(NUEVO)') === f.tipoCredito) &&
      (!f.plataforma || (p.plataforma || 'Cambaceo / Campo') === f.plataforma) &&
      (!f.desde || new Date(p.creado) >= new Date(f.desde + 'T00:00:00')) &&
      (!f.hasta || new Date(p.creado) <= new Date(f.hasta + 'T23:59:59.999')) &&
      (!q || [p.nombre, p.telefono, p.telefonoSecundario, p.cedula, p.promotor_nombre, p.negocio, p.direccion].join(' ').toLowerCase().includes(q)));
  }

  function filtrosHTML() {
    const f = ui.f;
    const tcs = S.config.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
    return `<form class="filters" data-form="filtros" onsubmit="return false">
      <input type="search" name="q" placeholder="Buscar nombre, teléfono, cédula, negocio o promotor" value="${h(f.q)}" aria-label="Buscar">
      <select name="sucursal" aria-label="Sucursal"><option value="">Todas las sucursales</option>${S.config.sucursales.map((s) => `<option ${s === f.sucursal ? 'selected' : ''}>${h(s)}</option>`).join('')}</select>
      <select name="estado" aria-label="Estado"><option value="">Todos los estados</option>${C.ESTADOS.map((e) => `<option value="${e}" ${e === f.estado ? 'selected' : ''}>${h(est(e))}</option>`).join('')}</select>
      <select name="tipoCredito" aria-label="Tipo de Crédito"><option value="">Todo Tipo Crédito</option>${tcs.map((t) => `<option value="${h(t)}" ${t === f.tipoCredito ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>
      <label>Desde <input type="date" name="desde" value="${h(f.desde)}"></label>
      <label>Hasta <input type="date" name="hasta" value="${h(f.hasta)}"></label>
      <div class="actions">
        <button type="button" class="btn sm ghost" data-action="limpiar-filtros">Limpiar</button>
        <button type="button" class="btn sm ghost" data-action="exportar-prospectos-csv">⬇️ CSV</button>
      </div>
    </form>`;
  }

  function tablaHTML(arr) {
    if (!arr.length) return '<div class="empty">Sin resultados para estos filtros.</div>';
    const rows = arr.slice().sort((a, b) => b.creado.localeCompare(a.creado));
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Teléfono</th><th>Captado por</th><th>Sucursal</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td>${fechaCorta(p.creado)}</td>
        <td><b>${h(p.nombre)}</b><br><small>${h((p.cc && p.cc.rubro) || p.negocio || '—')} · ${h(p.plataforma || 'Campo')}</small></td>
        <td>${badgeTipoCredito(p.tipoCredito)}</td>
        <td>${telFmt(p.telefono)}${p.telefonoSecundario ? `<br><small>${telFmt(p.telefonoSecundario)}</small>` : ''}</td>
        <td><span class="badge b-origin">🔒 ${h(p.promotor_nombre)}</span></td>
        <td>${h(p.sucursal)}</td>
        <td>${money((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto)}</td>
        <td>${badgeEstado(p.estado)}</td>
        <td>${accionesCard(p)}</td></tr>`).join('')}</tbody></table></div>
      <div class="cards-only">${lista(rows)}</div>`;
  }

  // ---------- Login View (Clean Production Auth) ----------
  function vistaLogin() {
    const dbRoute = isDbManagerUrl();
    return `<div class="login-wrap">
      <section class="panel login-card">
        <div class="login-header">
          <img src="icon.svg" alt="AlfaTrack" width="48" height="48">
          <div>
            <h2>${dbRoute ? '🗄️ Gestor Web Turso Cloud SQLite — AlfaTrack' : 'Acceso al Sistema — AlfaTrack'}</h2>
            <p class="hint">${dbRoute ? 'Inicia sesión con tu cuenta de Administrador General para acceder al Explorador de Tablas, Consola SQL y Respaldos en Turso Cloud.' : 'AlfaCredit S.A. · Control y Seguimiento de Prospectos'}</p>
          </div>
        </div>
        <div class="db-pill-bar">
          <span class="badge ${ui.db.tursoConnected ? 'b-green' : 'b-amber'}">
            ${ui.db.tursoConnected ? '🟢 Base de Datos Turso Cloud SQLite Conectada' : '🟡 Base de Datos Sincronizada'}
          </span>
          <small>${dbRoute ? 'Conexión JWT Autenticada' : 'Acceso Corporativo Seguro'}</small>
        </div>
        <form class="form" data-form="login" autocomplete="on">
          <label>Usuario o Correo *
            <input name="username" id="login-username" required placeholder="Ingresa tu usuario" autocomplete="username">
          </label>
          <label>Contraseña *
            <div class="pwd-row">
              <input name="password" id="login-password" type="${ui.showPasswords ? 'text' : 'password'}" required placeholder="Ingresa tu contraseña" autocomplete="current-password">
              <button type="button" class="btn sm ghost" data-action="toggle-show-pwd">${ui.showPasswords ? '🙈 Ocultar' : '👁️ Ver'}</button>
            </div>
          </label>
          <button class="btn primary block" type="submit">🔐 ${dbRoute ? 'Ingresar al Gestor de Base de Datos Turso' : 'Iniciar Sesión'}</button>
        </form>
      </section>
    </div>`;
  }

  // ---------- Depurador & Clasificador CSV Component (from NUEVOS-CLIENTE.html) ----------
  function vistaDepuradorCSV(u) {
    const cl = ui.csv.clasif || C.clasificarFilasCSV(S, ui.csv.filas, {
      promotorDefault: u.rol === 'promotor' ? u : null,
      sucursal: u.rol === 'promotor' ? u.sucursal : '',
      recuperarEspeciales: true,
    });
    const curTab = ui.csv.tab || 'validos';
    const itemsMap = {
      validos: cl.validos,
      duplicadosDB: cl.duplicadosDB,
      especiales: cl.especiales,
      longitud: cl.longitud,
      texto: cl.texto,
      vacios: cl.vacios,
      repetidosTelefono: cl.repetidosTelefono,
      repetidosCliente: cl.repetidosCliente,
    };
    const listCur = itemsMap[curTab] || [];

    return `<div class="panel">
      <div class="row">
        <div>
          <h3>📥 Depurador de Teléfonos, Duplicados y Carga de Formularios CSV</h3>
          <p class="hint">Sube o pega el archivo CSV de tus formularios de promotores (columnas: <code>Cliente, Telefono, Promotor, VALOR</code>). Clasifica teléfonos válidos de 8 dígitos, detecta duplicados y los importa respetando el <b>Candado de Origen</b> 🔒.</p>
        </div>
        <button type="button" class="btn sm ghost" data-action="csv-ejemplo">📋 Cargar Ejemplo Real de Promotores</button>
      </div>
      <div class="cols" style="margin:10px 0">
        <label class="file-drop">📂 Seleccionar archivo CSV (.csv)
          <input type="file" accept=".csv,.txt" data-change="csv-file">
        </label>
        <label style="grid-column: span 2">O pega aquí las filas CSV de tus formularios:
          <textarea rows="4" data-input="csv-text" placeholder="Cliente,Telefono,Promotor,VALOR&#10;Elizabeth Lopez,84943179,Laura Varela,15000&#10;Bismarck José López,57591567,Yeiling Muñoz,20000">${h(ui.csv.rawText)}</textarea>
        </label>
      </div>
      <div class="row" style="margin-bottom:12px">
        <div class="actions">
          <button type="button" class="btn sm primary" data-action="csv-procesar">🔍 Clasificar y Depurar Datos</button>
          ${cl.validos.length ? `<button type="button" class="btn sm wa" data-action="csv-importar">💾 Importar ${cl.validos.length} Válidos a la Base de Datos</button>` : ''}
          ${ui.csv.filas.length ? `<button type="button" class="btn sm ghost" data-action="csv-exportar-tab">⬇️ Exportar Pestaña Actual CSV</button>` : ''}
        </div>
        <small>${ui.csv.filas.length} filas analizadas</small>
      </div>

      ${ui.csv.filas.length ? `
        <div class="quick">
          <button type="button" class="chip ${curTab === 'validos' ? 'on' : ''}" data-action="csv-tab" data-val="validos">✅ Válidos (${cl.validos.length})</button>
          <button type="button" class="chip ${curTab === 'duplicadosDB' ? 'on' : ''}" data-action="csv-tab" data-val="duplicadosDB">⚠️ Ya Registrados / Duplicados (${cl.duplicadosDB.length})</button>
          <button type="button" class="chip ${curTab === 'especiales' ? 'on' : ''}" data-action="csv-tab" data-val="especiales">🔣 Caracteres Especiales (${cl.especiales.length})</button>
          <button type="button" class="chip ${curTab === 'longitud' ? 'on' : ''}" data-action="csv-tab" data-val="longitud">📏 Longitud Incorrecta (${cl.longitud.length})</button>
          <button type="button" class="chip ${curTab === 'texto' ? 'on' : ''}" data-action="csv-tab" data-val="texto">🔤 Contiene Texto (${cl.texto.length})</button>
          <button type="button" class="chip ${curTab === 'vacios' ? 'on' : ''}" data-action="csv-tab" data-val="vacios">⬜ Vacíos (${cl.vacios.length})</button>
          <button type="button" class="chip ${curTab === 'repetidosTelefono' ? 'on' : ''}" data-action="csv-tab" data-val="repetidosTelefono">🔁 Teléfonos Repetidos (${cl.repetidosTelefono.length})</button>
          <button type="button" class="chip ${curTab === 'repetidosCliente' ? 'on' : ''}" data-action="csv-tab" data-val="repetidosCliente">👥 Clientes Repetidos (${cl.repetidosCliente.length})</button>
        </div>
        <div class="table-wrap">
          ${curTab === 'repetidosTelefono' ? `
            <table class="table"><thead><tr><th>Teléfono Válido</th><th>Cant. Repeticiones</th><th>Clientes Asociados</th></tr></thead>
            <tbody>${listCur.map((r) => `<tr><td><b>${telFmt(r.telefono)}</b></td><td><span class="badge b-red">${r.repeticiones}</span></td><td>${h(r.clientes)}</td></tr>`).join('') || '<tr><td colspan="3">Sin teléfonos repetidos.</td></tr>'}</tbody></table>
          ` : curTab === 'repetidosCliente' ? `
            <table class="table"><thead><tr><th>Nombre del Cliente</th><th>Cant. Repeticiones</th><th>Teléfonos Asociados</th></tr></thead>
            <tbody>${listCur.map((r) => `<tr><td><b>${h(r.nombre)}</b></td><td><span class="badge b-red">${r.repeticiones}</span></td><td>${h(r.telefonos)}</td></tr>`).join('') || '<tr><td colspan="3">Sin clientes repetidos.</td></tr>'}</tbody></table>
          ` : `
            <table class="table"><thead><tr><th>#</th><th>Cliente</th><th>Teléfono Original</th><th>Teléfono Limpio</th><th>Promotor CSV → Candado Origen</th><th>Sucursal</th><th>Valor / Detalle</th></tr></thead>
            <tbody>${listCur.map((r) => `<tr>
              <td>${r.fila}</td>
              <td><b>${h(r.nombre)}</b></td>
              <td><code>${h(r.telefonoOriginal || '—')}</code></td>
              <td>${r.telefono ? `<b>${telFmt(r.telefono)}</b>` : '—'}${r.telefonoSecundario ? ` <small>(+${telFmt(r.telefonoSecundario)})</small>` : ''}</td>
              <td><span class="badge b-origin">🔒 ${h(r.promotorNombre)}</span>${r.promotorOriginal && r.promotorOriginal !== r.promotorNombre ? `<br><small>CSV: ${h(r.promotorOriginal)}</small>` : ''}</td>
              <td>${h(r.sucursal)}</td>
              <td>${r.motivoDuplicado ? `<span class="badge b-red">${h(r.motivoDuplicado)}</span>` : (r.monto ? money(r.monto) : h(r.valorOriginal || '—'))}</td>
            </tr>`).join('') || '<tr><td colspan="7">No hay registros en esta categoría.</td></tr>'}</tbody></table>
          `}
        </div>
      ` : ''}
    </div>`;
  }

  // ---------- views ----------
  function vistaPromotor(u) {
    const mios = C.visibles(S, u);
    const tab = tabActual('pro', 'mis');
    const activos = mios.filter((p) => !['desembolsado', 'descartado'].includes(p.estado));
    const ganados = mios.filter((p) => p.estado === 'desembolsado');
    const montoGanado = ganados.reduce((acc, p) => acc + Number((p.desembolso && p.desembolso.monto) || p.monto || 0), 0);
    const emailGer = (S.config.emailsGerentes && S.config.emailsGerentes[u.sucursal]) || 'alfacreditenrique@gmail.com';
    const tcs = S.config.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
    const plats = S.config.plataformas || ['Cambaceo / Campo', 'Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'Otro'];

    let body;
    if (tab === 'nuevo') {
      body = `<form class="panel form" data-form="nuevo" novalidate>
        <h2>Registrar prospecto</h2>
        <p class="hint">Quedarás grabado como <b>Promotor Captador (Origen)</b>: ${h(u.nombre)} · ${h(u.sucursal)} 🔒<br>
        <small>✉️ Gerencia asignada automáticamente: <b>${h(emailGer)}</b></small></p>
        <div class="cols two">
          <label>Nombre completo del cliente *<input name="nombre" required minlength="3" autocomplete="off" placeholder="Ej: Juan Carlos Pérez Gómez"></label>
          <label>Tipo de Crédito *<select name="tipoCredito">${tcs.map((t) => `<option value="${h(t)}">${h(t)}</option>`).join('')}</select></label>
        </div>
        <div class="cols two">
          <label>Teléfono / WhatsApp * <small>(8 dígitos)</small><input name="telefono" inputmode="numeric" required maxlength="9" placeholder="8888-8888" data-dup></label>
          <label>Teléfono Secundario <small>(opcional)</small><input name="telefonoSecundario" inputmode="numeric" maxlength="9" placeholder="7777-7777"></label>
        </div>
        <div class="cols two">
          <label>Cédula <small>(opcional)</small><input name="cedula" placeholder="001-010190-0001A" data-dup></label>
          <label>Monto aproximado solicitado (C$)<input name="monto" type="number" min="1" step="100" inputmode="numeric" placeholder="Ej: 15000"></label>
        </div>
        <div id="dup-alert" class="alert" hidden></div>
        <div class="cols two">
          <label>Tipo de negocio o ingreso<select name="negocio"><option value="">Seleccione…</option>${S.config.negocios.map((n) => `<option>${h(n)}</option>`).join('')}</select></label>
          <label>¿Por qué canal/plataforma se captó?<select name="plataforma">${plats.map((p) => `<option>${h(p)}</option>`).join('')}</select></label>
        </div>
        <label>Dirección exacta del negocio / Barrio<input name="direccion" placeholder="Ej: Del parque central 2c al sur, 1/2c al este"></label>
        <label>Detalle de contacto / Campaña / Referencia<input name="campana" placeholder="Ej: Visita en mercado, Referido, Feria comercial"></label>
        <label>Notas / Observaciones del Promotor<textarea name="notas" rows="3" placeholder="Horarios disponibles, referencias o detalles del negocio…"></textarea></label>
        <button class="btn primary block" type="submit">Guardar prospecto</button>
      </form>`;
    } else if (tab === 'csv') {
      body = vistaDepuradorCSV(u);
    } else if (tab === 'ganados') {
      body = lista(ganados, {}, 'Aún no tienes créditos desembolsados.');
    } else {
      const q = ui.proSearch.trim().toLowerCase();
      const filtradosMios = mios.filter((p) =>
        (!ui.proFilter || p.estado === ui.proFilter) &&
        (!q || [p.nombre, p.telefono, p.negocio, p.direccion].join(' ').toLowerCase().includes(q))
      );
      body = `<div class="quick">
          <button type="button" class="chip ${!ui.proFilter ? 'on' : ''}" data-action="pf" data-val="">Todos (${mios.length})</button>
          <button type="button" class="chip ${ui.proFilter === 'nuevo' ? 'on' : ''}" data-action="pf" data-val="nuevo">En cola (${mios.filter((x) => x.estado === 'nuevo').length})</button>
          <button type="button" class="chip ${ui.proFilter === 'pescado' ? 'on' : ''}" data-action="pf" data-val="pescado">Pescados (${mios.filter((x) => x.estado === 'pescado').length})</button>
          <button type="button" class="chip ${ui.proFilter === 'seguimiento' ? 'on' : ''}" data-action="pf" data-val="seguimiento">En seguimiento (${mios.filter((x) => x.estado === 'seguimiento').length})</button>
        </div>
        ${lista(filtradosMios, {}, 'Aún no has registrado prospectos. Toca "+ Registrar".')}`;
    }
    return `<section class="kpis four">
        <div class="kpi"><b>${mios.length}</b><span>Mis prospectos</span></div>
        <div class="kpi amber"><b>${activos.length}</b><span>En proceso</span></div>
        <div class="kpi green"><b>${ganados.length}</b><span>Desembolsados</span></div>
        <div class="kpi lime"><b>${money(montoGanado)}</b><span>Mi colocación</span></div>
      </section>
      ${tabs('pro', [['mis', 'Mis Prospectos', mios.length], ['nuevo', '+ Registrar'], ['csv', '📥 Importar CSV'], ['ganados', 'Ganados', ganados.length]])}
      ${body}`;
  }

  function vistaCallCenter(u) {
    const todos = C.visibles(S, u);
    const cola = todos.filter((p) => p.estado === 'nuevo').length;
    const gest = todos.filter((p) => p.estado === 'gestion').length;
    const pesc = todos.filter((p) => p.estado === 'pescado').length;
    const desem = todos.filter((p) => p.estado === 'desembolsado').length;
    const tab = tabActual('cc', 'bandeja');
    const tcs = S.config.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
    const plats = S.config.plataformas || ['Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'Cambaceo / Campo', 'Otro'];
    const promotoresActivos = S.usuarios.filter((x) => x.rol === 'promotor' && x.activo).sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre));

    let body = '';
    if (tab === 'captura') {
      body = `<form class="panel form" data-form="captura-cc" novalidate>
        <h2>📝 Captura de Prospectos — Call Center AlfaCredit</h2>
        <p class="hint">Registra un prospecto atendido por Call Center (<b>${h(u.nombre)}</b>) asignando el <b>Promotor de Origen</b> y la <b>Sucursal Destino</b>.</p>
        <div class="cols two">
          <label>Promotor de Origen (Candado de Origen 🔒) *
            <select name="promotorOrigenId" required>
              ${promotoresActivos.map((p) => `<option value="${p.id}">${h(p.nombre)} — ${h(p.sucursal)}</option>`).join('')}
            </select>
          </label>
          <label>Tipo de Crédito *
            <select name="tipoCredito">${tcs.map((t) => `<option value="${h(t)}">${h(t)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="cols two">
          <label>Nombre Completo del Cliente *<input name="nombre" required minlength="3" placeholder="Ej: Juan Carlos Pérez Gómez"></label>
          <label>Teléfono de Contacto * <small>(8 dígitos)</small><input name="telefono" inputmode="numeric" required maxlength="9" placeholder="8888-9999" data-dup></label>
        </div>
        <div class="cols two">
          <label>Teléfono Secundario <small>(opcional)</small><input name="telefonoSecundario" inputmode="numeric" maxlength="9" placeholder="7777-1111"></label>
          <label>Cédula <small>(opcional)</small><input name="cedula" placeholder="001-010190-0001A" data-dup></label>
        </div>
        <div id="dup-alert" class="alert" hidden></div>
        <div class="cols two">
          <label>Monto Solicitado (C$) *<input name="monto" type="number" min="1" step="100" required placeholder="15000"></label>
          <label>Tipo de Negocio *<select name="negocio">${S.config.negocios.map((n) => `<option>${h(n)}</option>`).join('')}</select></label>
        </div>
        <div class="cols two">
          <label>¿Por qué plataforma nos contactó?<select name="plataforma">${plats.map((p) => `<option>${h(p)}</option>`).join('')}</select></label>
          <label>Detalle de Contacto / Campaña<input name="campana" placeholder="Ej: Campaña Facebook / WhatsApp"></label>
        </div>
        <label>Dirección del Negocio / Domicilio *<input name="direccion" required placeholder="Ej: Del parque 2c al sur, 1c al este"></label>
        <label>Notas iniciales de Call Center<textarea name="notas" rows="2"></textarea></label>
        <button class="btn primary block" type="submit">💾 Registrar Cliente en Cola</button>
      </form>`;
    } else if (tab === 'csv') {
      body = vistaDepuradorCSV(u);
    } else {
      body = `<div class="quick">
          <button class="chip ${ui.f.estado === 'nuevo' ? 'on' : ''}" data-action="qf" data-val="nuevo">Cola nueva (${cola})</button>
          <button class="chip ${ui.f.estado === 'gestion' ? 'on' : ''}" data-action="qf" data-val="gestion">En gestión (${gest})</button>
          <button class="chip ${ui.f.estado === 'pescado' ? 'on' : ''}" data-action="qf" data-val="pescado">Pescados (${pesc})</button>
          <button class="chip ${!ui.f.estado ? 'on' : ''}" data-action="qf" data-val="">Todos (${todos.length})</button>
        </div>
        ${filtrosHTML()}
        <div id="list">${tablaHTML(filtrar(todos))}</div>`;
    }

    return `<section class="kpis four">
        <div class="kpi"><b>${cola}</b><span>En cola</span></div>
        <div class="kpi amber"><b>${gest}</b><span>En gestión</span></div>
        <div class="kpi lime"><b>${pesc}</b><span>Pescados</span></div>
        <div class="kpi green"><b>${desem}</b><span>Desembolsados</span></div>
      </section>
      ${tabs('cc', [['bandeja', '📞 Bandeja de Llamadas', cola + gest], ['captura', '📝 Captura Call Center'], ['csv', '📥 Depurador CSV Promotores']])}
      ${body}`;
  }

  function vistaGerente(u) {
    const mios = C.visibles(S, u);
    const pesc = mios.filter((p) => p.estado === 'pescado');
    const seg = mios.filter((p) => p.estado === 'seguimiento');
    const desem = mios.filter((p) => p.estado === 'desembolsado');
    const montoSuc = desem.reduce((a, p) => a + Number((p.desembolso && p.desembolso.monto) || p.monto || 0), 0);
    const emailGer = (S.config.emailsGerentes && S.config.emailsGerentes[u.sucursal]) || u.email || 'alfacreditenrique@gmail.com';
    const equipo = S.usuarios.filter((x) => x.sucursal === u.sucursal && x.activo && ['promotor', 'gestor'].includes(x.rol));
    const tab = tabActual('ger', 'pescados');

    let body;
    if (tab === 'pescados') body = lista(pesc, { sello: true }, 'No hay clientes pescados pendientes. ✔');
    else if (tab === 'seguimiento') body = lista(seg, { sello: true }, 'No hay casos en seguimiento.');
    else if (tab === 'equipo') {
      body = `<div class="panel">
        <h3>👥 Equipo Comercial — Sucursal ${h(u.sucursal)} (${equipo.length} integrantes)</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Usuario</th><th>Captados / Asignados</th><th>Desembolsados</th><th>Monto Colocado</th></tr></thead>
          <tbody>${equipo.map((x) => {
            const pros = x.rol === 'promotor'
              ? S.prospectos.filter((p) => p.promotor_origen_id === x.id)
              : S.prospectos.filter((p) => p.gestorId === x.id);
            const gan = pros.filter((p) => p.estado === 'desembolsado');
            const m = gan.reduce((a, p) => a + Number((p.desembolso && p.desembolso.monto) || 0), 0);
            return `<tr>
              <td><b>${h(x.nombre)}</b></td>
              <td><span class="badge ${x.rol === 'promotor' ? 'b-green' : 'b-blue'}">${h(C.ROLES[x.rol])}</span></td>
              <td><code>${h(x.username)}</code></td>
              <td>${pros.length}</td>
              <td>${gan.length}</td>
              <td>${money(m)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
    } else body = lista(mios, { sello: true });

    return `<div class="row"><h2 class="title">Sucursal ${h(u.sucursal)}</h2><span class="badge b-blue">✉️ ${h(emailGer)}</span></div>
      <section class="kpis four">
        <div class="kpi lime"><b>${pesc.length}</b><span>Pescados pendientes</span></div>
        <div class="kpi blue"><b>${seg.length}</b><span>En seguimiento</span></div>
        <div class="kpi green"><b>${desem.length}</b><span>Desembolsados</span></div>
        <div class="kpi"><b>${money(montoSuc)}</b><span>Monto sucursal</span></div>
      </section>
      ${tabs('ger', [['pescados', 'Clientes Pescados por Call Center', pesc.length], ['seguimiento', 'En seguimiento', seg.length], ['todos', 'Todos', mios.length], ['equipo', '👥 Mi Equipo', equipo.length]])}
      ${body}`;
  }

  function vistaGestor(u) {
    const mios = C.visibles(S, u);
    const act = mios.filter((p) => p.estado === 'seguimiento');
    const gan = mios.filter((p) => p.estado === 'desembolsado');
    const tab = tabActual('ges', 'act');
    return `<h2 class="title">Casos de apoyo / evaluación — ${h(u.sucursal)}</h2>
      <p class="hint">Apoyas el cierre y evaluación en campo; el crédito siempre conserva el <b>Promotor de Origen</b> 🔒.</p>
      <section class="kpis">
        <div class="kpi blue"><b>${act.length}</b><span>Por evaluar</span></div>
        <div class="kpi green"><b>${gan.length}</b><span>Desembolsados</span></div>
        <div class="kpi"><b>${mios.length}</b><span>Total asignados</span></div>
      </section>
      ${tabs('ges', [['act', 'Por evaluar', act.length], ['todos', 'Historial', mios.length]])}
      ${lista(tab === 'act' ? act : mios, { sello: true }, 'No tienes casos asignados.')}`;
  }

  function vistaBaseDatos() {
    const webDbLink = (location.origin && location.origin !== 'null' ? location.origin : 'https://alfatrack-alfacredit.vercel.app') + '/turso';
    const stats = ui.db.stats || {
      engine: ui.db.tursoConnected ? 'Turso Cloud SQLite (libSQL AWS us-east-2)' : 'Local JSON/SQLite Engine',
      tursoUrl: 'Turso Cloud SQLite (AWS us-east-2 · baseinventario)',
      tursoConnected: ui.db.tursoConnected,
      latencyMs: 90,
      tables: [
        { name: 'alfatrack_usuarios', rows: S.usuarios.length, desc: 'Usuarios, roles, sucursales y contraseñas (hash + gestión)' },
        { name: 'alfatrack_prospectos', rows: S.prospectos.length, desc: 'Prospectos, candado de origen, pipeline y bitácora' },
        { name: 'alfatrack_notificaciones', rows: S.notificaciones.length, desc: 'Alertas en tiempo real por usuario' },
        { name: 'alfatrack_auditoria', rows: S.auditoria.length, desc: 'Bitácora global de seguridad y sesiones' },
        { name: 'alfatrack_config', rows: 1, desc: 'Sucursales, correos de gerentes, estados y plantillas' },
        { name: 'alfatrack_backups', rows: 0, desc: 'Puntos de restauración e instantáneas en la nube' },
      ],
      backups: [],
    };
    const tblData = ui.db.tableData;
    const sqlRes = ui.db.sqlResult;

    return `<section class="kpis four">
        <div class="kpi green"><b>${stats.tursoConnected ? '🟢 ONLINE' : '🟡 LOCAL'}</b><span>Motor Turso Cloud SQLite</span></div>
        <div class="kpi blue"><b>${S.usuarios.length}</b><span>Credenciales en BD</span></div>
        <div class="kpi lime"><b>${S.prospectos.length}</b><span>Prospectos en BD</span></div>
        <div class="kpi"><b>${stats.latencyMs || 1} ms</b><span>Latencia SQL</span></div>
      </section>

      <div class="panel">
        <div class="row">
          <div>
            <h3>🗄️ Gestor de Base de Datos en la Nube — Turso libSQL (SQLite Distribuido)</h3>
            <p class="hint">Clúster autenticado con JWT: <b>Turso Cloud SQLite (AWS us-east-2 · baseinventario)</b> · Link directo a este Gestor Web: <a href="/turso"><code>${h(webDbLink)}</code></a></p>
          </div>
          <div class="actions">
            <button type="button" class="btn sm primary" data-action="db-sync-now">☁️ Sincronizar con Turso Ahora</button>
            <button type="button" class="btn sm ghost" data-action="db-download-json">⬇️ Descargar Respaldo (.JSON)</button>
            <label class="btn sm ghost" style="margin:0;cursor:pointer">📂 Importar JSON<input type="file" accept=".json" data-change="db-import-json" hidden></label>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:10px">
          <table class="table">
            <thead><tr><th>Tabla SQL</th><th>Registros</th><th>Descripción</th><th>Acción</th></tr></thead>
            <tbody>
              ${stats.tables.map((t) => `<tr>
                <td><code><b>${h(t.name)}</b></code></td>
                <td><span class="badge b-blue">${t.rows} filas</span></td>
                <td>${h(t.desc)}</td>
                <td><button type="button" class="btn sm ghost" data-action="db-ver-tabla" data-table="${h(t.name)}">🔍 Explorar tabla</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${tblData && tblData.rows ? `
        <div class="panel">
          <div class="row">
            <h3>📋 Explorador de Tabla SQL: <code>${h(tblData.table)}</code> (${tblData.rows.length} filas)</h3>
            <button type="button" class="btn sm ghost" data-action="db-cerrar-tabla">Cerrar vista</button>
          </div>
          <div class="table-wrap" style="max-height:360px;overflow:auto">
            <table class="table">
              <thead><tr>${(tblData.columns || []).map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead>
              <tbody>${tblData.rows.map((r) => `<tr>${(tblData.columns || []).map((c) => `<td>${h(typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '').slice(0, 120))}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <div class="panel">
        <h3>💻 Consola SQL de Diagnóstico (Turso Cloud libSQL)</h3>
        <p class="hint">Ejecuta consultas SQL en tiempo real sobre las tablas <code>alfatrack_usuarios</code>, <code>alfatrack_prospectos</code>, <code>alfatrack_notificaciones</code> y <code>alfatrack_auditoria</code>.</p>
        <div class="quick">
          <button type="button" class="chip" data-action="db-preset-sql" data-sql="SELECT username, password, nombre, rol, sucursal, activo FROM alfatrack_usuarios ORDER BY rol, sucursal">Usuarios y Contraseñas</button>
          <button type="button" class="chip" data-action="db-preset-sql" data-sql="SELECT sucursal, estado, COUNT(*) AS total, SUM(monto) AS monto_total FROM alfatrack_prospectos GROUP BY sucursal, estado">Resumen por Sucursal</button>
          <button type="button" class="chip" data-action="db-preset-sql" data-sql="SELECT promotor_nombre, sucursal_origen, COUNT(*) AS captados, SUM(monto) AS monto FROM alfatrack_prospectos GROUP BY promotor_origen_id ORDER BY captados DESC">Ranking Promotores SQL</button>
          <button type="button" class="chip" data-action="db-preset-sql" data-sql="SELECT ts, usuario, rol, accion, detalle FROM alfatrack_auditoria ORDER BY id DESC LIMIT 50">Última Auditoría</button>
        </div>
        <form class="form" data-form="db-sql">
          <textarea name="sql" rows="3" style="font-family:monospace">${h(ui.db.sql)}</textarea>
          <button class="btn sm primary" type="submit">▶️ Ejecutar Consulta SQL</button>
        </form>
        ${sqlRes ? (sqlRes.ok ? `
          <div class="table-wrap" style="max-height:360px;overflow:auto;margin-top:10px">
            <small>✅ Consulta ejecutada en ${sqlRes.latencyMs || 1} ms (${(sqlRes.rows || []).length} filas)</small>
            <table class="table">
              <thead><tr>${(sqlRes.columns || []).map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead>
              <tbody>${(sqlRes.rows || []).map((r) => `<tr>${(sqlRes.columns || []).map((c) => `<td>${h(r[c])}</td>`).join('')}</tr>`).join('') || '<tr><td>Sin filas</td></tr>'}</tbody>
            </table>
          </div>
        ` : `<div class="alert" style="margin-top:10px">⚠️ ${h(sqlRes.error)}</div>`) : ''}
      </div>

      <div class="panel">
        <div class="row">
          <div>
            <h3>🛡️ Puntos de Restauración en la Nube (Cloud Backups)</h3>
            <p class="hint">Guarda instantáneas completas de usuarios, contraseñas y prospectos directamente en Turso Cloud.</p>
          </div>
          <form data-form="db-backup-create" class="form inline" style="margin:0">
            <input name="nombre" placeholder="Etiqueta del respaldo (ej: Cierre Mensual)" required>
            <button class="btn sm primary" type="submit">➕ Crear Respaldo Cloud</button>
          </form>
        </div>
        <div class="table-wrap" style="margin-top:10px">
          <table class="table">
            <thead><tr><th>ID</th><th>Nombre</th><th>Fecha</th><th>Autor</th><th>Resumen</th><th></th></tr></thead>
            <tbody>
              ${(stats.backups || []).map((b) => `<tr>
                <td><code>${h(b.id)}</code></td>
                <td><b>${h(b.nombre)}</b></td>
                <td>${fecha(b.creado)}</td>
                <td>${h(b.autor)}</td>
                <td>${h(b.resumen)}</td>
                <td><button type="button" class="btn sm danger" data-action="db-restore-backup" data-id="${h(b.id)}">⏪ Restaurar</button></td>
              </tr>`).join('') || '<tr><td colspan="6">No hay respaldos manuales creados aún.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function vistaAdmin(u) {
    const tab = tabActual('adm', 'metricas');
    const nav = tabs('adm', [
      ['metricas', '📊 Métricas'],
      ['prospectos', '📋 Prospectos', S.prospectos.length],
      ['usuarios', '👥 Usuarios', S.usuarios.length],
      ['bd', '🗄️ Base de Datos'],
      ['csv', '📥 Depurador CSV'],
      ['config', '⚙️ Configuración'],
      ['auditoria', '🛡️ Auditoría'],
    ]);
    let body = '';
    if (tab === 'metricas') {
      const m = C.metricas(S);
      const max = Math.max(1, ...Object.values(m.porEstado));
      const monto = Object.values(m.porSucursal).reduce((a, x) => a + x.monto, 0);
      body = `<section class="kpis four">
          <div class="kpi"><b>${m.total}</b><span>Prospectos</span></div>
          <div class="kpi green"><b>${m.porEstado.desembolsado}</b><span>Desembolsados</span></div>
          <div class="kpi blue"><b>${m.conversion}%</b><span>Conversión</span></div>
          <div class="kpi lime"><b>${money(monto)}</b><span>Monto colocado</span></div>
        </section>
        <div class="cols two">
          <div class="panel"><h3>Embudo por estado</h3>${C.ESTADOS.map((e) => `<div class="hbar"><span>${h(est(e))}</span><div><i class="b-${SEM[e]}" style="width:${(m.porEstado[e] / max) * 100}%"></i></div><b>${m.porEstado[e]}</b></div>`).join('')}</div>
          <div class="panel">
            <h3>Por Tipo de Crédito y Canal</h3>
            ${Object.entries(m.porTipoCredito || {}).map(([k, v]) => `<div class="hbar"><span>${h(k)}</span><div><i class="b-blue" style="width:${(v / Math.max(1, m.total)) * 100}%"></i></div><b>${v}</b></div>`).join('')}
            <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
            ${Object.entries(m.porPlataforma || {}).map(([k, v]) => `<div class="hbar"><span>${h(k)}</span><div><i class="b-green" style="width:${(v / Math.max(1, m.total)) * 100}%"></i></div><b>${v}</b></div>`).join('')}
          </div>
        </div>
        <div class="panel"><h3>Por sucursal</h3><div class="table-wrap"><table class="table"><thead><tr><th>Sucursal</th><th>Correo Gerencia</th><th>Prospectos</th><th>Desembolsados</th><th>Monto</th></tr></thead><tbody>
          ${Object.entries(m.porSucursal).sort((a, b) => b[1].total - a[1].total).map(([s, x]) => `<tr><td><b>${h(s)}</b></td><td><small>${h((S.config.emailsGerentes && S.config.emailsGerentes[s]) || '—')}</small></td><td>${x.total}</td><td>${x.desembolsado}</td><td>${money(x.monto)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><h3>Ranking de promotores (comisión por origen)</h3><div class="table-wrap"><table class="table"><thead><tr><th>Promotor</th><th>Sucursal</th><th>Captados</th><th>Desembolsados</th><th>Monto</th></tr></thead><tbody>
          ${Object.values(m.porPromotor).sort((a, b) => b.monto - a.monto || b.total - a.total).map((x) => `<tr><td>🔒 ${h(x.nombre)}</td><td>${h(x.sucursal)}</td><td>${x.total}</td><td>${x.desembolsado}</td><td>${money(x.monto)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if (tab === 'prospectos') {
      body = `${filtrosHTML()}<div id="list">${tablaHTML(filtrar(S.prospectos))}</div>`;
    } else if (tab === 'usuarios') {
      const q = ui.userSearch.trim().toLowerCase();
      const usuariosFiltrados = S.usuarios.filter((x) =>
        (!ui.userRoleFilter || x.rol === ui.userRoleFilter) &&
        (!ui.userBranchFilter || x.sucursal === ui.userBranchFilter) &&
        (!q || [x.nombre, x.username, x.sucursal, x.email, C.ROLES[x.rol]].join(' ').toLowerCase().includes(q))
      ).sort((a, b) => (a.rol === 'admin' ? -1 : b.rol === 'admin' ? 1 : a.rol.localeCompare(b.rol) || a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre)));

      body = `<div class="panel">
        <div class="row">
          <div>
            <h3>👥 Gestión de Usuarios, Promotores y Contraseñas (${usuariosFiltrados.length} de ${S.usuarios.length})</h3>
            <p class="hint">Administra usuarios y contraseñas de todos los promotores actuales, agentes de Call Center, gerentes y gestores.</p>
          </div>
          <div class="actions">
            <button type="button" class="btn sm ghost" data-action="toggle-show-pwd">${ui.showPasswords ? '🙈 Ocultar Claves' : '👁️ Mostrar Claves'}</button>
            <button type="button" class="btn sm ghost" data-action="exportar-usuarios-csv">⬇️ Exportar Credenciales CSV</button>
            <button class="btn sm primary" data-action="usuario">+ Nuevo usuario</button>
          </div>
        </div>
        <div class="filters" style="margin-top:10px">
          <input type="search" placeholder="Buscar por nombre, usuario, correo o sucursal…" value="${h(ui.userSearch)}" data-input="user-search">
          <select data-change="user-role"><option value="">Todos los roles</option>${Object.entries(C.ROLES).map(([k, l]) => `<option value="${k}" ${k === ui.userRoleFilter ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>
          <select data-change="user-branch"><option value="">Todas las sucursales</option>${S.config.sucursales.map((s) => `<option ${s === ui.userBranchFilter ? 'selected' : ''}>${h(s)}</option>`).join('')}</select>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Sucursal</th><th>Usuario (Login)</th><th>Contraseña</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
          ${usuariosFiltrados.map((x) => `<tr class="${x.activo ? '' : 'off'}">
            <td><b>${h(x.nombre)}</b>${x.email ? `<br><small>${h(x.email)}</small>` : ''}</td>
            <td>${h(C.ROLES[x.rol])}</td>
            <td>${h(x.sucursal)}</td>
            <td><code><b>${h(x.username)}</b></code></td>
            <td><code>${ui.showPasswords ? h(x.password) : '••••••••'}</code></td>
            <td>${x.activo ? '<span class="badge b-green">Activo</span>' : '<span class="badge b-red">De baja</span>'}</td>
            <td class="actions">
              <button class="btn sm ghost" data-action="copiar-cred" data-user="${h(x.username)}" data-pass="${h(x.password)}" data-nombre="${h(x.nombre)}" title="Copiar usuario y contraseña">📋 Copiar</button>
              <button class="btn sm ghost" data-action="usuario" data-id="${x.id}">Editar / Clave</button>
              ${x.id === u.id ? '' : `<button class="btn sm ${x.activo ? 'danger' : 'ghost'}" data-action="toggle-usuario" data-id="${x.id}">${x.activo ? 'Dar de baja' : 'Reactivar'}</button>`}
            </td></tr>`).join('')}
          </tbody></table></div></div>`;
    } else if (tab === 'bd') {
      body = vistaBaseDatos();
    } else if (tab === 'csv') {
      body = vistaDepuradorCSV(u);
    } else if (tab === 'config') {
      const c = S.config;
      const ta = (name, arr) => `<textarea name="${name}" rows="6">${h((arr || []).join('\n'))}</textarea>`;
      body = `<form class="panel form" data-form="config">
        <h3>Configuración del sistema</h3>
        <fieldset><legend>Nombres de estados del pipeline</legend>${C.ESTADOS.map((e, i) => `<label>${i + 1}. ${e}<input name="estado_${e}" value="${h(c.estados[e])}" required></label>`).join('')}</fieldset>
        <div class="cols">
          <label>Sucursales (una por línea)${ta('sucursales', c.sucursales)}</label>
          <label>Motivos de descarte${ta('motivos', c.motivos)}</label>
          <label>Tipos de negocio${ta('negocios', c.negocios)}</label>
        </div>
        <div class="cols two">
          <label>Tipos de Crédito (uno por línea)${ta('tiposCredito', c.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'])}</label>
          <label>Plataformas de Captación${ta('plataformas', c.plataformas || ['Cambaceo / Campo', 'Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'Otro'])}</label>
        </div>
        <fieldset><legend>Plantillas de mensajes</legend>
          <p class="hint">Variables: {cliente} {promotor} {sucursal} {monto} {agente} {actor} {gestor} {motivo} {instrucciones}</p>
          ${Object.keys(c.plantillas).map((k) => `<label>${h(k)}<textarea name="tpl_${k}" rows="2">${h(c.plantillas[k])}</textarea></label>`).join('')}
        </fieldset>
        <div class="row"><button class="btn primary" type="submit">Guardar configuración</button>
        <button class="btn danger" type="button" data-action="reset">Restablecer base de datos inicial</button></div>
      </form>`;
    } else {
      const ev = [];
      S.prospectos.forEach((p) => p.historial.forEach((x) => ev.push(Object.assign({ obj: p.nombre, pid: p.id }, x))));
      S.auditoria.forEach((x) => ev.push(Object.assign({ obj: 'Sistema' }, x)));
      ev.sort((a, b) => b.ts.localeCompare(a.ts));
      body = `<div class="panel"><h3>Bitácora global (${ev.length} eventos, solo lectura)</h3>${timeline(ev.slice(0, 300), true)}</div>`;
    }
    return nav + body;
  }

  function timeline(items, conObjeto) {
    return `<ol class="timeline">${items.map((x) => `<li><time>${fecha(x.ts)}</time>
      <div><b>${h(x.accion)}</b>${conObjeto ? ` · <a href="#" ${x.pid ? `data-action="ver" data-id="${x.pid}"` : ''}>${h(x.obj)}</a>` : ''}
      <small>👤 ${h(x.usuario)} (${h(C.ROLES[x.rol] || x.rol)})</small>${x.detalle ? `<p>${h(x.detalle)}</p>` : ''}</div></li>`).join('')}</ol>`;
  }

  // ---------- modals ----------
  function modalHTML() {
    const m = ui.modal;
    if (!m) return '';
    const u = me();
    let inner = '';
    if (m.type === 'ver') {
      const p = pro(m.id);
      if (!p || !C.puedeVer(u, p)) { ui.modal = null; return ''; }
      const g = p.gestorId && user(p.gestorId);
      inner = `<h2>${h(p.nombre)}</h2>
        <div class="actions">${badgeEstado(p.estado)} ${badgeTipoCredito(p.tipoCredito)}</div>
        <div class="seal">🔒 PROPIEDAD DE PROMOTOR: <b>${h(p.promotor_nombre)}</b> · ${h(p.sucursal)} <em>(No modificable)</em></div>
        ${progreso(p)}
        <dl class="facts">
          <div><dt>Teléfono</dt><dd>${telFmt(p.telefono)}${p.telefonoSecundario ? ' / ' + telFmt(p.telefonoSecundario) : ''}</dd></div>
          <div><dt>Cédula</dt><dd>${h(p.cedula || '—')}</dd></div>
          <div><dt>Monto</dt><dd>${money((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto)}</dd></div>
          <div><dt>Negocio</dt><dd>${h((p.cc && p.cc.rubro) || p.negocio || '—')}</dd></div>
          <div><dt>Canal / Plataforma</dt><dd>${h(p.plataforma || 'Cambaceo / Campo')}${p.campana ? ' · ' + h(p.campana) : ''}</dd></div>
          <div><dt>Email Gerencia</dt><dd>${h(p.emailGerente || (S.config.emailsGerentes && S.config.emailsGerentes[p.sucursal]) || '—')}</dd></div>
          <div class="wide"><dt>Dirección</dt><dd>${h((p.cc && p.cc.direccionVisita) || p.direccion || '—')}</dd></div>
          ${p.notas ? `<div class="wide"><dt>Notas del promotor</dt><dd>${h(p.notas)}</dd></div>` : ''}
          ${g ? `<div class="wide"><dt>Gestor de apoyo</dt><dd>${h(g.nombre)}</dd></div>` : ''}
        </dl>
        ${p.cc && (p.cc.comentarios || p.cc.ultimaGestion) ? `<p class="note cc"><b>📞 Call Center (${h(p.cc.agente)}):</b> ${h(p.cc.comentarios || p.cc.ultimaGestion)}</p>` : ''}
        ${p.gerencia ? `<p class="note ger"><b>🏢 Gerente (${h(p.gerencia.gerente)}):</b> ${h(p.gerencia.instrucciones)}${g ? `<br><b>Gestor de apoyo:</b> ${h(g.nombre)}` : ''}</p>` : ''}
        <h3>Bitácora inmutable</h3>${timeline(p.historial.slice().reverse())}
        <form data-form="nota" data-id="${p.id}" class="form inline"><input name="texto" placeholder="Agregar nota a la bitácora…" aria-label="Nota"><button class="btn sm primary">Agregar</button></form>`;
    } else if (m.type === 'estado') {
      const p = pro(m.id);
      const t = p ? C.transiciones(u, p) : [];
      if (!t.length) { ui.modal = null; return ''; }
      const sel = t.includes(m.pre) ? m.pre : t[0];
      const gestores = S.usuarios.filter((x) => x.rol === 'gestor' && x.activo).sort((a, b) => (b.sucursal === p.sucursal) - (a.sucursal === p.sucursal));
      inner = `<h2>${u.rol === 'callcenter' ? 'Gestión de llamada' : 'Actualizar prospecto'}</h2>
        <p><b>${h(p.nombre)}</b> · ${telFmt(p.telefono)} · ${badgeEstado(p.estado)} ${badgeTipoCredito(p.tipoCredito)}</p>${captado(p)}
        <form class="form" data-form="estado" data-id="${p.id}" data-estado="${sel}">
          <label>Nuevo estado<select name="estado" data-estado-select>${t.map((e) => `<option value="${e}" ${e === sel ? 'selected' : ''}>${h(est(e))}</option>`).join('')}</select></label>
          <div class="only only-gestion"><label>Resultado de la llamada<textarea name="comentarios_gestion" rows="2" placeholder="Ej. No contestó, volver a llamar mañana"></textarea></label></div>
          <div class="only only-pescado">
            <p class="hint">Confirme los datos. Se notificará al Gerente de ${h(p.sucursal)} (${h((S.config.emailsGerentes && S.config.emailsGerentes[p.sucursal]) || '')}) y al promotor ${h(p.promotor_nombre)}.</p>
            <label>Monto solicitado (C$) *<input name="monto" type="number" min="1" value="${h((p.cc && p.cc.monto) || p.monto || '')}"></label>
            <label>Rubro / Negocio *<input name="rubro" value="${h((p.cc && p.cc.rubro) || p.negocio)}"></label>
            <label>Dirección exacta de visita *<input name="direccionVisita" value="${h((p.cc && p.cc.direccionVisita) || p.direccion)}"></label>
            <label>Comentarios de Call Center *<textarea name="comentarios_pescado" rows="3"></textarea></label>
          </div>
          <div class="only only-seguimiento">
            <div class="seal">🔒 El cierre queda a cargo del Promotor de Origen: <b>${h(p.promotor_nombre)}</b> (no se reemplaza)</div>
            <label>Gestor de Crédito de apoyo (opcional)<select name="gestorId"><option value="">— Sin gestor, solo el promotor —</option>
              ${gestores.map((x) => `<option value="${x.id}" ${x.id === p.gestorId ? 'selected' : ''}>${h(x.nombre)} (${h(x.sucursal)})</option>`).join('')}</select></label>
            <label>Instrucciones para el promotor *<textarea name="instrucciones" rows="3">${h((p.gerencia && p.gerencia.instrucciones) || '')}</textarea></label>
          </div>
          <div class="only only-desembolsado"><label>Monto desembolsado (C$)<input name="monto_desembolso" type="number" min="1" value="${h((p.cc && p.cc.monto) || p.monto || '')}"></label></div>
          <div class="only only-descartado">
            <label>Motivo *<select name="motivo"><option value="">Seleccione…</option>${S.config.motivos.map((x) => `<option>${h(x)}</option>`).join('')}</select></label>
            <label>Comentario<textarea name="comentarios_descarte" rows="2"></textarea></label>
          </div>
          <button class="btn primary block">Guardar</button>
        </form>`;
    } else if (m.type === 'editar') {
      const p = pro(m.id);
      if (!p || u.rol !== 'admin') { ui.modal = null; return ''; }
      const tcs = S.config.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
      const plats = S.config.plataformas || ['Cambaceo / Campo', 'Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'Otro'];
      inner = `<h2>Editar prospecto</h2>
        <div class="seal">🔒 Promotor de origen: <b>${h(p.promotor_nombre)}</b> — bloqueado por Candado de Origen</div>
        <form class="form" data-form="editar" data-id="${p.id}">
          <div class="cols two">
            <label>Nombre<input name="nombre" value="${h(p.nombre)}"></label>
            <label>Tipo de Crédito<select name="tipoCredito">${tcs.map((t) => `<option ${t === (p.tipoCredito || 'NV(NUEVO)') ? 'selected' : ''}>${h(t)}</option>`).join('')}</select></label>
          </div>
          <div class="cols two">
            <label>Teléfono<input name="telefono" value="${h(p.telefono)}"></label>
            <label>Teléfono Secundario<input name="telefonoSecundario" value="${h(p.telefonoSecundario || '')}"></label>
          </div>
          <div class="cols two">
            <label>Cédula<input name="cedula" value="${h(p.cedula)}"></label>
            <label>Monto<input name="monto" type="number" value="${h(p.monto)}"></label>
          </div>
          <div class="cols two">
            <label>Negocio<input name="negocio" value="${h(p.negocio)}"></label>
            <label>Plataforma<select name="plataforma">${plats.map((pl) => `<option ${pl === (p.plataforma || 'Cambaceo / Campo') ? 'selected' : ''}>${h(pl)}</option>`).join('')}</select></label>
          </div>
          <label>Dirección<input name="direccion" value="${h(p.direccion)}"></label>
          <div class="cols two">
            <label>Sucursal<select name="sucursal">${S.config.sucursales.map((s) => `<option ${s === p.sucursal ? 'selected' : ''}>${h(s)}</option>`).join('')}</select></label>
            <label>Gestor asignado<select name="gestorId"><option value="">— Ninguno —</option>${S.usuarios.filter((x) => x.rol === 'gestor' && (x.activo || x.id === p.gestorId)).map((x) => `<option value="${x.id}" ${x.id === p.gestorId ? 'selected' : ''}>${h(x.nombre)} (${h(x.sucursal)})${x.activo ? '' : ' [baja]'}</option>`).join('')}</select></label>
          </div>
          <label>Notas<textarea name="notas" rows="2">${h(p.notas)}</textarea></label>
          <button class="btn primary block">Guardar cambios</button>
        </form>`;
    } else if (m.type === 'usuario') {
      const x = m.id ? user(m.id) : { nombre: '', rol: 'promotor', sucursal: S.config.sucursales[0], username: '', password: '', email: '' };
      inner = `<h2>${m.id ? 'Editar' : 'Nuevo'} usuario y credenciales</h2>
        <form class="form" data-form="usuario" data-id="${m.id || ''}">
          <label>Nombre completo *<input name="nombre" value="${h(x.nombre)}" required></label>
          <div class="cols two">
            <label>Rol *<select name="rol">${Object.entries(C.ROLES).map(([k, l]) => `<option value="${k}" ${k === x.rol ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></label>
            <label>Sucursal *<select name="sucursal">${S.config.sucursales.map((s) => `<option ${s === x.sucursal ? 'selected' : ''}>${h(s)}</option>`).join('')}</select></label>
          </div>
          <div class="cols two">
            <label>Usuario (Login) <small>(se autogenera si lo deja vacío)</small><input name="username" value="${h(x.username || '')}" placeholder="ej: nombre.apellido"></label>
            <label>Contraseña <small>(mín. 4 caracteres)</small><input name="password" value="${h(x.password || '')}" placeholder="ej: clave123"></label>
          </div>
          <label>Correo electrónico <small>(opcional)</small><input name="email" type="email" value="${h(x.email || '')}" placeholder="usuario@alfacreditsa.com"></label>
          <button class="btn primary block">Guardar</button>
        </form>`;
    } else if (m.type === 'mi-clave') {
      inner = `<h2>🔑 Cambiar mi contraseña</h2>
        <p class="hint">Usuario: <code><b>${h(u.username)}</b></code> · ${h(u.nombre)} (${h(C.ROLES[u.rol])})</p>
        <form class="form" data-form="mi-clave">
          ${u.rol === 'admin' ? '' : '<label>Contraseña actual *<input name="passwordActual" type="password" required></label>'}
          <label>Nueva contraseña * <small>(mínimo 4 caracteres)</small><input name="passwordNueva" type="text" required minlength="4" placeholder="Escribe tu nueva contraseña"></label>
          <button class="btn primary block" type="submit">Actualizar contraseña</button>
        </form>`;
    }
    return `<div class="modal-bg" data-action="cerrar-modal"><div class="modal" role="dialog" aria-modal="true" data-stop>
      <button class="x" data-action="cerrar-modal" aria-label="Cerrar">×</button>${inner}</div></div>`;
  }

  // ---------- render ----------
  function render() {
    ensureUser();
    const u = me();
    const mis = ui.autenticado ? S.notificaciones.filter((n) => n.userId === u.id).sort((a, b) => b.ts.localeCompare(a.ts)) : [];
    const sinLeer = mis.filter((n) => !n.leida).length;
    $('#topbar').innerHTML = `
      <div class="brand">
        <img src="icon.svg" alt="" width="32" height="32">
        <div>
          <b>AlfaTrack <span class="cloud-dot" title="${ui.db.tursoConnected ? 'Conectado a Turso Cloud SQLite' : 'Modo Local'}">${ui.db.tursoConnected ? '🟢' : '🟡'}</span></b>
          <small>Control y Seguimiento de Prospectos · AlfaCredit S.A.</small>
        </div>
      </div>
      ${ui.autenticado ? `
        <div class="top-session">
          <span class="badge b-green">${h(C.ROLES[u.rol])}</span>
          <b>${h(u.nombre)}</b>
          <small>(${h(u.sucursal)})</small>
        </div>
        <div class="top-actions">
          <button class="btn sm ghost top-btn" data-action="mi-clave" title="Cambiar mi contraseña">🔑 Clave</button>
          <button class="btn sm ghost top-btn" data-action="logout" title="Cerrar sesión (${h(u.username)})">🚪 Salir</button>
          <div class="bell-wrap">
            <button class="bell" data-action="bell" aria-label="Notificaciones (${sinLeer} sin leer)" aria-expanded="${ui.bell}">🔔${sinLeer ? `<span class="count">${sinLeer > 99 ? '99+' : sinLeer}</span>` : ''}</button>
            ${ui.bell ? `<div class="bell-panel"><div class="row"><b>Notificaciones</b>${sinLeer ? '<button class="link" data-action="leer-todas">Marcar todas leídas</button>' : ''}</div>
              ${mis.length ? `<ul>${mis.slice(0, 50).map((n) => `<li class="${n.leida ? '' : 'unread'}" data-action="notif" data-id="${n.id}"><p>${h(n.texto)}</p><time>${fecha(n.ts)}</time></li>`).join('')}</ul>` : '<p class="empty">Sin notificaciones.</p>'}</div>` : ''}
          </div>
        </div>
      ` : ''}`;

    if (!ui.autenticado) {
      $('#app').innerHTML = vistaLogin();
    } else {
      const vistas = { promotor: vistaPromotor, callcenter: vistaCallCenter, gerente: vistaGerente, gestor: vistaGestor, admin: vistaAdmin };
      $('#app').innerHTML = `<div class="who">
        <span>${h(C.ROLES[u.rol])} · <b>${h(u.nombre)}</b> (<code>${h(u.username)}</code>) · ${h(u.sucursal)}</span>
        <small>${ui.db.tursoConnected ? '☁️ Sincronizado con Turso Cloud SQLite' : '💾 Guardado Local'}${ui.db.lastSync ? ' · ' + ui.db.lastSync : ''}</small>
      </div>` + vistas[u.rol](u);
    }
    $('#modal').innerHTML = modalHTML();
    document.body.classList.toggle('no-scroll', !!ui.modal);
    toastPendientes();
  }

  const refrescarLista = () => {
    const el = $('#list');
    if (!el) return;
    el.innerHTML = tablaHTML(filtrar(me().rol === 'admin' ? S.prospectos : C.visibles(S, me())));
  };

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close-toast]')) { e.target.closest('.toast').remove(); return; }
    const el = e.target.closest('[data-action]');
    if (!el) {
      if (ui.bell && !e.target.closest('.bell-wrap')) { ui.bell = false; render(); }
      return;
    }
    if (el.dataset.action === 'cerrar-modal' && el.classList.contains('modal-bg') && e.target.closest('[data-stop]')) return;
    const { action, id } = el.dataset;
    const u = me();
    switch (action) {
      case 'tab':
        ui.tab[el.dataset.key] = el.dataset.val;
        if (el.dataset.key === 'adm' && el.dataset.val === 'bd' && !ui.db.stats) fetchDbStats();
        render();
        break;
      case 'bell': ui.bell = !ui.bell; render(); break;
      case 'leer-todas': C.marcarLeidas(S, u.id); save(); render(); break;
      case 'notif': {
        const n = S.notificaciones.find((x) => x.id === id);
        C.marcarLeidas(S, u.id, id); save(); ui.bell = false;
        if (n && n.prospectoId && C.puedeVer(u, pro(n.prospectoId))) ui.modal = { type: 'ver', id: n.prospectoId };
        render(); break;
      }
      case 'ver': e.preventDefault(); ui.modal = { type: 'ver', id }; render(); break;
      case 'estado': ui.modal = { type: 'estado', id, pre: el.dataset.pre }; render(); break;
      case 'editar': ui.modal = { type: 'editar', id }; render(); break;
      case 'usuario': ui.modal = { type: 'usuario', id }; render(); break;
      case 'mi-clave': ui.modal = { type: 'mi-clave' }; render(); break;
      case 'logout': logoutSession(); toast('Sesión cerrada correctamente.', 'info'); break;
      case 'toggle-show-pwd': ui.showPasswords = !ui.showPasswords; render(); break;
      case 'copiar-cred': {
        const txt = `AlfaTrack AlfaCredit S.A.\nNombre: ${el.dataset.nombre}\nUsuario: ${el.dataset.user}\nContraseña: ${el.dataset.pass}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(() => toast(`Credenciales de ${el.dataset.nombre} copiadas.`, 'ok')).catch(() => toast(txt, 'info'));
        } else toast(`Usuario: ${el.dataset.user} | Clave: ${el.dataset.pass}`, 'info');
        break;
      }
      case 'exportar-usuarios-csv': {
        const rows = S.usuarios.map((x) => [x.nombre, C.ROLES[x.rol], x.sucursal, x.username, x.password, x.email || '', x.activo ? 'ACTIVO' : 'DE BAJA']);
        downloadCSV('Credenciales_Usuarios_AlfaTrack.csv', ['Nombre Completo', 'Rol', 'Sucursal', 'Usuario', 'Contraseña', 'Email', 'Estado'], rows);
        toast('Archivo CSV de usuarios y contraseñas descargado.', 'ok');
        break;
      }
      case 'exportar-prospectos-csv': {
        const listaExp = filtrar(u.rol === 'admin' ? S.prospectos : C.visibles(S, u));
        const rows = listaExp.map((p) => [
          fecha(p.creado), p.nombre, p.tipoCredito || 'NV(NUEVO)', p.telefono, p.telefonoSecundario || '',
          p.cedula || '', p.promotor_nombre, p.sucursal, (p.cc && p.cc.monto) || p.monto || 0,
          (p.cc && p.cc.rubro) || p.negocio || '', (p.cc && p.cc.direccionVisita) || p.direccion || '',
          p.plataforma || 'Cambaceo / Campo', est(p.estado), (p.desembolso && p.desembolso.monto) || '',
        ]);
        downloadCSV('Prospectos_AlfaTrack.csv', ['Fecha', 'Cliente', 'Tipo Crédito', 'Teléfono', 'Teléfono 2', 'Cédula', 'Promotor Origen', 'Sucursal', 'Monto Solicitado', 'Negocio', 'Dirección', 'Plataforma', 'Estado', 'Monto Desembolsado'], rows);
        toast('Reporte CSV de prospectos descargado.', 'ok');
        break;
      }
      case 'csv-ejemplo': {
        ui.csv.rawText = [
          'Cliente,Telefono,Promotor,VALOR,Negocio,Direccion',
          'Elizabeth Lopez,84943179,Laura Varela,15000,Pulpería,Barrio Bolonia Managua',
          'Bismarck José López,57591567,Yeiling Muñoz,20000,Taller,Monimbó Masaya',
          'María Lopez,85273671,Darling Elieth Galeano,18000,Comedor / Fritanga,Barrio El Calvario Estelí',
          'Junieth Carballo,89624881/ 75016969,Massiel Morales,25000,Venta de ropa,Jinotepe Mercado',
          'Juan Jose Torrez,8423266,Cristell Calderon,10000,Agricultura,Estelí (7 dígitos - inválido)',
          'Juana María Rodríguez,88451122,Carlos Rivera,15000,Pulpería,Estelí (Ya existe en BD)',
        ].join('\n');
        ui.csv.filas = parseCSVText(ui.csv.rawText);
        ui.csv.clasif = C.clasificarFilasCSV(S, ui.csv.filas, { promotorDefault: u.rol === 'promotor' ? u : null, sucursal: u.rol === 'promotor' ? u.sucursal : '', recuperarEspeciales: true });
        ui.csv.tab = 'validos';
        render();
        toast('Ejemplo de formulario CSV de promotores cargado y clasificado.', 'ok');
        break;
      }
      case 'csv-procesar': {
        ui.csv.filas = parseCSVText(ui.csv.rawText);
        if (!ui.csv.filas.length) { toast('Pegue o seleccione un archivo CSV con datos.', 'error'); break; }
        ui.csv.clasif = C.clasificarFilasCSV(S, ui.csv.filas, { promotorDefault: u.rol === 'promotor' ? u : null, sucursal: u.rol === 'promotor' ? u.sucursal : '', recuperarEspeciales: true });
        ui.csv.tab = 'validos';
        render();
        toast(`Clasificados: ${ui.csv.clasif.validos.length} válidos, ${ui.csv.clasif.duplicadosDB.length} duplicados.`, 'ok');
        break;
      }
      case 'csv-tab':
        ui.csv.tab = el.dataset.val;
        render();
        break;
      case 'csv-importar': {
        if (!ui.csv.filas.length) break;
        const r = C.importarFilasCSV(S, u, ui.csv.filas, { recuperarEspeciales: true });
        if (r.ok) {
          ui.csv.clasif = C.clasificarFilasCSV(S, ui.csv.filas, { promotorDefault: u.rol === 'promotor' ? u : null, sucursal: u.rol === 'promotor' ? u.sucursal : '', recuperarEspeciales: true });
          commit(r, `✅ Se importaron ${r.importados.length} prospectos válidos con Candado de Origen.`);
        } else toast(r.error, 'error');
        break;
      }
      case 'csv-exportar-tab': {
        const cl = ui.csv.clasif;
        if (!cl) break;
        const cur = ui.csv.tab || 'validos';
        const rows = (cl[cur] || []).map((r) => [r.fila || '', r.nombre || r.clientes || '', r.telefonoOriginal || r.telefono || '', r.telefono || r.repeticiones || '', r.promotorNombre || '', r.sucursal || '', r.monto || r.motivoDuplicado || '']);
        downloadCSV(`Reporte_CSV_${cur.toUpperCase()}.csv`, ['Fila', 'Cliente', 'Teléfono Original', 'Teléfono / Repeticiones', 'Promotor', 'Sucursal', 'Valor / Observación'], rows);
        break;
      }
      case 'db-sync-now': {
        toast('Sincronizando con Turso Cloud SQLite…', 'info');
        await syncToCloud();
        await fetchDbStats();
        toast('Base de datos sincronizada con Turso Cloud SQLite.', 'ok');
        break;
      }
      case 'db-ver-tabla':
        await fetchDbTable(el.dataset.table);
        break;
      case 'db-cerrar-tabla':
        ui.db.tableData = null;
        render();
        break;
      case 'db-preset-sql':
        ui.db.sql = el.dataset.sql;
        render();
        break;
      case 'db-download-json':
        downloadJSON(`Respaldo_AlfaTrack_${new Date().toISOString().slice(0, 10)}.json`, S);
        toast('Respaldo completo JSON descargado.', 'ok');
        break;
      case 'db-restore-backup': {
        if (!confirm('¿Restaurar la base de datos a este punto de respaldo?')) break;
        try {
          const res = await fetch('/api/db/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actorId: u.id, action: 'restore', backupId: id }),
          });
          const data = await res.json();
          if (data.ok && data.state) {
            S = upgradeLocalState(data.state);
            saveLocal();
            ui.db.stats = data.stats;
            toast('Base de datos restaurada con éxito.', 'ok');
            render();
          } else toast(data.error || 'No se pudo restaurar.', 'error');
        } catch (err) { toast('Error al restaurar respaldo.', 'error'); }
        break;
      }
      case 'cerrar-modal': ui.modal = null; render(); break;
      case 'toggle-usuario': {
        const x = user(id);
        if (x && (!x.activo || confirm(`¿Dar de baja a ${x.nombre}? Sus prospectos conservan el candado de origen.`))) commit(C.toggleUsuario(S, u, id), 'Usuario actualizado.');
        break;
      }
      case 'qf': ui.f.estado = el.dataset.val; render(); break;
      case 'pf': ui.proFilter = el.dataset.val; render(); break;
      case 'limpiar-filtros': ui.f = { sucursal: '', estado: '', tipoCredito: '', plataforma: '', desde: '', hasta: '', q: '' }; render(); break;
      case 'reset':
        if (confirm('Esto restablece la base de datos inicial. ¿Continuar?')) { S = C.seed(); save(); ui.modal = null; toast('Base de datos restablecida.', 'ok'); render(); }
        break;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-estado-select]')) t.form.dataset.estado = t.value;
    else if (t.form && t.form.dataset.form === 'filtros' && t.name !== 'q') { ui.f[t.name] = t.value; render(); }
    else if (t.dataset.change === 'user-role') { ui.userRoleFilter = t.value; render(); }
    else if (t.dataset.change === 'user-branch') { ui.userBranchFilter = t.value; render(); }
    else if (t.dataset.change === 'csv-file' && t.files && t.files[0]) {
      const file = t.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const buf = reader.result;
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buf);
        ui.csv.rawText = text;
        ui.csv.filas = parseCSVText(ui.csv.rawText);
        const u = me();
        ui.csv.clasif = C.clasificarFilasCSV(S, ui.csv.filas, { promotorDefault: u.rol === 'promotor' ? u : null, sucursal: u.rol === 'promotor' ? u.sucursal : '', recuperarEspeciales: true });
        ui.csv.tab = 'validos';
        render();
        toast(`Archivo CSV cargado (${ui.csv.filas.length} filas).`, 'ok');
      };
      reader.readAsArrayBuffer(file);
    } else if (t.dataset.change === 'db-import-json' && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(String(reader.result || ''));
          const st = parsed.state || parsed;
          if (!st || !Array.isArray(st.usuarios) || !Array.isArray(st.prospectos)) {
            toast('El archivo JSON no es un respaldo válido de AlfaTrack.', 'error');
            return;
          }
          S = upgradeLocalState(st);
          save();
          toast('Base de datos importada y sincronizada con Turso Cloud.', 'ok');
          render();
        } catch { toast('Archivo JSON inválido.', 'error'); }
      };
      reader.readAsText(t.files[0], 'UTF-8');
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.form && t.form.dataset.form === 'filtros' && t.name === 'q') { ui.f.q = t.value; refrescarLista(); }
    else if (t.dataset.input === 'user-search') { ui.userSearch = t.value; render(); $('#app [data-input="user-search"]')?.focus(); }
    else if (t.dataset.input === 'csv-text') { ui.csv.rawText = t.value; }
    if (t.matches('[data-dup]')) {
      const f = t.form;
      const d = C.buscarDuplicado(S, C.validarTelefono(f.telefono.value) ? f.telefono.value : '', f.cedula && C.normCedula(f.cedula.value).length === 14 ? f.cedula.value : '');
      const box = f.querySelector('#dup-alert') || $('#dup-alert');
      if (box) {
        box.hidden = !d;
        box.textContent = d ? '⚠️ ' + C.mensajeDuplicado(d) : '';
      }
    }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target;
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const u = me();

    if (kind === 'login') {
      const r = C.autenticar(S, d.username, d.password);
      if (!r.ok) { toast(r.error, 'error'); return; }
      setAuthenticatedSession(r.usuario);
      if (isDbManagerUrl() && r.usuario.rol === 'admin') {
        ui.tab.adm = 'bd';
        fetchDbStats();
      }
      save();
      toast(`Bienvenido(a), ${r.usuario.nombre} (${C.ROLES[r.usuario.rol]}).`, 'ok');
      render();
      return;
    }

    if (kind === 'mi-clave') {
      const r = C.cambiarPassword(S, u, u.id, d.passwordActual, d.passwordNueva);
      if (r.ok) ui.modal = null;
      commit(r, 'Tu contraseña ha sido actualizada en la base de datos.');
      return;
    }

    if (kind === 'nuevo') {
      const r = C.crearProspecto(S, u, d);
      if (!r.ok) {
        toast(r.error, 'error');
        const box = f.querySelector('#dup-alert') || $('#dup-alert');
        if (box) { box.hidden = false; box.textContent = '⚠️ ' + r.error; }
        return;
      }
      ui.tab.pro = 'mis';
      commit(r, `Prospecto ${r.prospecto.nombre} registrado. Ya está en la cola de Call Center.`);
    } else if (kind === 'captura-cc') {
      const r = C.capturarProspectoCallCenter(S, u, d);
      if (!r.ok) {
        toast(r.error, 'error');
        const box = f.querySelector('#dup-alert') || $('#dup-alert');
        if (box) { box.hidden = false; box.textContent = '⚠️ ' + r.error; }
        return;
      }
      ui.tab.cc = 'bandeja';
      commit(r, `Prospecto ${r.prospecto.nombre} registrado con Candado de Origen (${r.prospecto.promotor_nombre}).`);
    } else if (kind === 'estado') {
      const estado = d.estado;
      const datos = {
        gestion: { comentarios: d.comentarios_gestion },
        pescado: { monto: d.monto, rubro: d.rubro, direccionVisita: d.direccionVisita, comentarios: d.comentarios_pescado },
        seguimiento: { gestorId: d.gestorId, instrucciones: d.instrucciones },
        desembolsado: { monto: d.monto_desembolso },
        descartado: { motivo: d.motivo, comentarios: d.comentarios_descarte },
      }[estado] || {};
      const r = C.cambiarEstado(S, u, f.dataset.id, estado, datos);
      if (r.ok) ui.modal = null;
      const avisos = r.ok && r.notificaciones.length ? ` Se notificó a: ${[...new Set(r.notificaciones.map((n) => user(n.userId).nombre))].join(', ')}.` : '';
      commit(r, `Guardado: ${est(estado)}.${avisos}`);
    } else if (kind === 'nota') {
      if (commit(C.agregarNota(S, u, f.dataset.id, d.texto), 'Nota agregada a la bitácora.')) ui.modal = { type: 'ver', id: f.dataset.id };
      render();
    } else if (kind === 'editar') {
      const r = C.adminEditarProspecto(S, u, f.dataset.id, d);
      if (r.ok) ui.modal = null;
      commit(r, r.sinCambios ? 'Sin cambios.' : 'Prospecto actualizado (registrado en bitácora).');
    } else if (kind === 'usuario') {
      const r = C.guardarUsuario(S, u, Object.assign(d, { id: f.dataset.id || undefined }));
      if (r.ok) ui.modal = null;
      commit(r, r.ok ? `Usuario guardado (${r.usuario.username} / ${r.usuario.password}).` : '');
    } else if (kind === 'config') {
      const lines = (s) => String(s || '').split('\n');
      const cfg = JSON.parse(JSON.stringify(S.config));
      cfg.sucursales = lines(d.sucursales); cfg.motivos = lines(d.motivos); cfg.negocios = lines(d.negocios);
      if (d.tiposCredito) cfg.tiposCredito = lines(d.tiposCredito);
      if (d.plataformas) cfg.plataformas = lines(d.plataformas);
      C.ESTADOS.forEach((x) => { cfg.estados[x] = d['estado_' + x]; });
      Object.keys(cfg.plantillas).forEach((k) => { cfg.plantillas[k] = d['tpl_' + k]; });
      commit(C.guardarConfig(S, u, cfg), 'Configuración guardada.');
    } else if (kind === 'db-sql') {
      ui.db.sql = d.sql;
      const localSqlFallback = (q) => {
        const str = String(q || '').trim();
        if (!/^(SELECT|PRAGMA|EXPLAIN)\b/i.test(str) || /\b(DROP|DELETE|UPDATE|INSERT|ALTER)\b/i.test(str)) {
          return { ok: false, error: 'Solo se permiten consultas SELECT de lectura.' };
        }
        const m = str.match(/FROM\s+(alfatrack_\w+)/i);
        const tbl = m ? m[1].toLowerCase() : 'alfatrack_usuarios';
        const rows = tbl === 'alfatrack_prospectos'
          ? S.prospectos.map((p) => ({ id: p.id, nombre: p.nombre, telefono: p.telefono, tipo_credito: p.tipoCredito || 'NV(NUEVO)', monto: p.monto, promotor_nombre: p.promotor_nombre, sucursal: p.sucursal, estado: p.estado }))
          : tbl === 'alfatrack_auditoria'
            ? S.auditoria.slice(-50)
            : S.usuarios.map((x) => ({ id: x.id, username: x.username, password: x.password, nombre: x.nombre, rol: x.rol, sucursal: x.sucursal, activo: x.activo ? 1 : 0 }));
        return { ok: true, columns: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, 100), latencyMs: 1 };
      };
      try {
        const res = await fetch('/api/db/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: u.id, sql: d.sql }),
        });
        if (res.ok) ui.db.sqlResult = await res.json();
        else ui.db.sqlResult = localSqlFallback(d.sql);
      } catch (err) {
        ui.db.sqlResult = localSqlFallback(d.sql);
      }
      render();
    } else if (kind === 'db-backup-create') {
      try {
        await syncToCloud();
        const res = await fetch('/api/db/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: u.id, action: 'create', nombre: d.nombre }),
        });
        const data = await res.json();
        if (data.ok) {
          ui.db.stats = data.stats;
          toast(`Respaldo "${data.backup.nombre}" creado en Turso Cloud.`, 'ok');
          render();
        } else toast(data.error || 'Error al crear respaldo.', 'error');
      } catch {
        toast('Error de conexión al crear respaldo en nube.', 'error');
      }
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (ui.modal || ui.bell)) { ui.modal = null; ui.bell = false; render(); } });

  // Real-time sync between open tabs/windows.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try { S = upgradeLocalState(JSON.parse(e.newValue)); } catch (err) { return; }
    const typing = document.activeElement && document.activeElement.closest('form[data-form="nuevo"], .modal form');
    if (typing) toastPendientes(); else render();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js?v=5', { updateViaCache: 'none' }).then((reg) => { try { reg.update(); } catch {} }).catch(() => {});
  }
  if (isDbManagerUrl() && ui.autenticado) fetchDbStats();
  render();
  // Pull latest cloud state if no local edits have started
  pullFromCloud(false);
})();
