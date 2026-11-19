/* AlfaTrack UI — Vanguardist PWA + Signed Auth + Atomic Mutations + Real-Time Sync + Kanban/Drawer + Role Sound */
(function () {
  'use strict';
  const C = window.Core;
  const SND = window.Sound || { isMuted: () => true, toggleMute: () => true, play: () => {}, playForNotification: () => {}, playForAction: () => {}, CUES: {}, ROLE_CUES: {} };
  const KEY = 'alfatrack_v1';
  const UKEY = 'alfatrack_user';
  const AKEY = 'alfatrack_auth';
  const TKEY = 'alfatrack_token';
  const THEME_KEY = 'alfatrack_theme';
  const VIEW_KEY = 'alfatrack_view';
  const $ = (sel) => document.querySelector(sel);
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'C$ ' + Number(n || 0).toLocaleString('es-NI');
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString('es-NI', { day: '2-digit', month: 'short' }) : '—');
  const telFmt = (t) => {
    let d = C.soloDigitos(t);
    if (d.length === 11 && d.startsWith('505')) d = d.slice(3);
    d = d.slice(0, 8);
    return d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
  };
  const cedFmt = (c) => {
    const raw = C.normCedula(c).slice(0, 14);
    if (raw.length <= 3) return raw;
    if (raw.length <= 9) return `${raw.slice(0, 3)}-${raw.slice(3)}`;
    return `${raw.slice(0, 3)}-${raw.slice(3, 9)}-${raw.slice(9)}`;
  };
  const iniciales = (nombre) => {
    const pts = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    return ((pts[0]?.[0] || '') + (pts[1]?.[0] || pts[0]?.[1] || '')).toUpperCase() || 'AT';
  };
  const isHttp = () => location.protocol.startsWith('http');
  const isDbManagerUrl = () => /^\/(?:turso|db|gestor-db\.html)$/i.test(location.pathname || '') || /(?:^|[?&])(?:tab|view)=(?:bd|turso|db)\b/i.test(location.search || '') || /^#(?:turso|bd|db)$/i.test(location.hash || '');

  let S = load();
  let knownNotifIds = new Set();
  let knownProspects = new Map();
  let toastedNotifIds = new Set();
  let lastPollTs = 0;
  let dupCheckSeq = 0;
  let lastDupAlertKey = '';

  function loadToastedIds(userId) {
    if (!userId) return new Set();
    try {
      const raw = sessionStorage.getItem('alfatrack_toasted_' + userId);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
  function saveToastedIds(userId) {
    if (!userId) return;
    try {
      sessionStorage.setItem('alfatrack_toasted_' + userId, JSON.stringify([...toastedNotifIds].slice(-300)));
    } catch {}
  }
  function hydrateToasted(state) {
    (state.notificaciones || []).forEach((n) => {
      if (n.toasted) toastedNotifIds.add(n.id);
      else if (toastedNotifIds.has(n.id)) n.toasted = true;
    });
  }

  const savedView = localStorage.getItem(VIEW_KEY);
  const defaultView = () => (window.innerWidth >= 1024 ? 'tabla' : 'tarjetas');

  const ui = {
    userId: localStorage.getItem(UKEY) || '',
    autenticado: Boolean(localStorage.getItem(AKEY) && localStorage.getItem(TKEY)),
    token: localStorage.getItem(TKEY) || '',
    theme: localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light',
    viewMode: savedView && ['tabla', 'tarjetas', 'kanban'].includes(savedView) ? savedView : defaultView(),
    rev: 0,
    busy: false,
    showPasswords: false,
    userRoleFilter: '',
    userBranchFilter: '',
    userSearch: '',
    proFilter: '',
    proSearch: '',
    ccModo: 'directo',
    gerOrigen: '',
    ccSyncStatus: null,
    tab: isDbManagerUrl() ? { adm: 'bd' } : {},
    f: { sucursal: '', estado: '', origen: '', tipoCredito: '', plataforma: '', desde: '', hasta: '', q: '' },
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
    modal: null, // {type, id, pre}
  };

  function applyTheme(t) {
    ui.theme = t === 'dark' ? 'dark' : 'light';
    if (ui.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, ui.theme); } catch {}
  }
  applyTheme(ui.theme);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1) return C.upgradeState(s, { scoped: Boolean(s._scoped) });
      }
    } catch {}
    if (!isHttp()) {
      const s = C.seed();
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
      return s;
    }
    return { version: 1, officialPromotersV2: true, _scoped: true, config: C.defaultConfig(), usuarios: [], prospectos: [], notificaciones: [], auditoria: [] };
  }

  const saveLocal = () => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
  };

  function snapshotKnown(state) {
    knownNotifIds = new Set((state.notificaciones || []).map((n) => n.id));
    knownProspects = new Map((state.prospectos || []).map((p) => [p.id, p.estado]));
  }
  if (ui.autenticado) {
    toastedNotifIds = loadToastedIds(ui.userId);
    hydrateToasted(S);
    snapshotKnown(S);
  }

  const user = (id) => (S.usuarios || []).find((u) => u.id === id);
  const pro = (id) => (S.prospectos || []).find((p) => p.id === id);
  const me = () => user(ui.userId);
  const est = (e) => (S.config && S.config.estados && S.config.estados[e]) || e;

  function isFormProtected() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    if (ui.modal && !['ver', 'sonido'].includes(ui.modal.type)) return true;
    if (ui.modal && ui.modal.type === 'ver') {
      const notaInp = $('form[data-form="nota"] input[name="texto"]');
      if (notaInp && notaInp.value.trim()) return true;
    }
    if ($('form[data-form="config"]')) return true;
    const createForm = $('form[data-form="nuevo"], form[data-form="captura-cc"], form[data-form="captura-cc-directo"]');
    if (createForm) {
      for (const name of ['nombre', 'telefono', 'telefonoSecundario', 'cedula', 'monto', 'direccion', 'campana', 'notas']) {
        const fld = createForm.elements[name];
        if (fld && String(fld.value || '').trim()) return true;
      }
    }
    return false;
  }

  function setAuthenticatedSession(u, token, state, rev) {
    ui.userId = u.id;
    ui.autenticado = true;
    ui.token = token || ('at_local_' + u.id);
    toastedNotifIds = loadToastedIds(u.id);
    if (state) {
      S = C.upgradeState(state, { scoped: Boolean(state._scoped) });
      hydrateToasted(S);
      saveToastedIds(u.id);
    }
    if (rev) ui.rev = rev;
    localStorage.setItem(UKEY, u.id);
    localStorage.setItem(AKEY, '1');
    localStorage.setItem(TKEY, ui.token);
    saveLocal();
    snapshotKnown(S);
  }

  function logoutSession(silent) {
    if (isHttp() && ui.token) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + ui.token } }).catch(() => {});
    }
    ui.autenticado = false;
    ui.token = '';
    ui.userId = '';
    ui.rev = 0;
    ui.bell = false;
    ui.modal = null;
    ui.showPasswords = false;
    ui.userRoleFilter = '';
    ui.userBranchFilter = '';
    ui.userSearch = '';
    ui.proFilter = '';
    ui.proSearch = '';
    ui.ccModo = 'directo';
    ui.gerOrigen = '';
    ui.ccSyncStatus = null;
    ui.tab = isDbManagerUrl() ? { adm: 'bd' } : {};
    ui.f = { sucursal: '', estado: '', origen: '', tipoCredito: '', plataforma: '', desde: '', hasta: '', q: '' };
    ui.csv = { filas: [], clasif: null, tab: 'validos', rawText: '' };
    ui.db.stats = null;
    ui.db.tableData = null;
    ui.db.sqlResult = null;
    knownNotifIds = new Set();
    knownProspects = new Map();
    toastedNotifIds = new Set();
    lastDupAlertKey = '';
    const toastBox = $('#toasts');
    if (toastBox) toastBox.innerHTML = '';
    localStorage.removeItem(AKEY);
    localStorage.removeItem(TKEY);
    localStorage.removeItem(UKEY);
    if (isHttp()) {
      localStorage.removeItem(KEY);
      S = { version: 1, officialPromotersV2: true, _scoped: true, config: C.defaultConfig(), usuarios: [], prospectos: [], notificaciones: [], auditoria: [] };
    }
    render();
    if (!silent) toast('Sesión cerrada correctamente.', 'info');
  }

  async function apiFetch(url, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (ui.token) headers.Authorization = 'Bearer ' + ui.token;
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401 && ui.autenticado && !url.includes('/api/auth/login')) {
      logoutSession(true);
      toast('Tu sesión expiró. Inicia sesión nuevamente.', 'error');
    }
    return { res, data: data || { ok: false, error: `Error HTTP ${res.status}` } };
  }

  async function checkHealth() {
    if (!isHttp()) return;
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const d = await res.json();
        ui.db.tursoConnected = Boolean(d && d.tursoConnected);
        if (!ui.autenticado) {
          const pill = $('.db-pill-bar .badge');
          if (pill) {
            pill.className = 'badge ' + (ui.db.tursoConnected ? 'b-green' : 'b-amber');
            pill.textContent = ui.db.tursoConnected ? '🟢 Base de Datos Turso Cloud SQLite Conectada' : '🟡 Base de Datos Sincronizada';
          }
          const dot = $('.cloud-dot');
          if (dot) dot.textContent = ui.db.tursoConnected ? '🟢' : '🟡';
        }
      }
    } catch {}
  }

  async function pullFromCloud(forceRender, isPoll) {
    if (!isHttp() || !ui.autenticado || !ui.token) return false;
    if (isPoll && Date.now() - lastPollTs < 2000) return false;
    lastPollTs = Date.now();
    try {
      const { res, data } = await apiFetch('/api/state', { method: 'GET' });
      if (!res.ok || !data || !data.ok || !data.state) return false;

      const uPrev = me() || data.usuario;
      const incoming = C.upgradeState(data.state, { scoped: Boolean(data.state._scoped) });
      hydrateToasted(incoming);
      const prevRev = ui.rev;
      ui.rev = data.rev || ui.rev;
      ui.db.tursoConnected = Boolean(data.source && data.source.startsWith('turso'));
      ui.db.lastSync = new Date().toLocaleTimeString('es-NI');

      // Detect cross-device real-time notifications & queue arrivals
      if (isPoll && prevRev > 0 && uPrev) {
        const newNotifs = (incoming.notificaciones || []).filter((n) => n.userId === uPrev.id && !n.leida && !knownNotifIds.has(n.id) && !toastedNotifIds.has(n.id));
        if (newNotifs.length) {
          newNotifs.slice(-2).forEach((n) => {
            n.toasted = true;
            toastedNotifIds.add(n.id);
            toast('🔔 ' + n.texto, 'notif');
            SND.playForNotification(uPrev.rol, n.texto);
          });
          newNotifs.forEach((n) => { n.toasted = true; toastedNotifIds.add(n.id); });
          saveToastedIds(uPrev.id);
        } else if (uPrev.rol === 'callcenter') {
          const nuevos = (incoming.prospectos || []).filter((p) => p.estado === 'nuevo' && !knownProspects.has(p.id));
          if (nuevos.length) {
            toast(`📞 Nuevo prospecto en cola: ${nuevos[0].nombre} (${nuevos[0].sucursal})`, 'notif');
            SND.play('new_queue');
          }
        } else if (uPrev.rol === 'gerente') {
          const pescados = (incoming.prospectos || []).filter((p) => p.estado === 'pescado' && knownProspects.get(p.id) !== 'pescado');
          if (pescados.length) {
            toast(`🏢 Nuevo cliente pescado en ${uPrev.sucursal}: ${pescados[0].nombre}`, 'notif');
            SND.play('pescado_branch');
          }
        } else if (uPrev.rol === 'gestor') {
          const asignados = (incoming.prospectos || []).filter((p) => p.estado === 'seguimiento' && knownProspects.get(p.id) !== 'seguimiento');
          if (asignados.length) {
            toast(`📋 Caso asignado para evaluación: ${asignados[0].nombre}`, 'notif');
            SND.play('assigned_support');
          }
        }
      }

      S = incoming;
      if (data.usuario) ui.userId = data.usuario.id;
      snapshotKnown(S);
      saveLocal();

      if (forceRender || (!isFormProtected() && prevRev !== ui.rev)) {
        render();
      } else {
        updateBellBadgeOnly();
      }
      return true;
    } catch {
      return false;
    }
  }

  function updateBellBadgeOnly() {
    const u = me();
    if (!u) return;
    const sinLeer = (S.notificaciones || []).filter((n) => n.userId === u.id && !n.leida).length;
    const bell = $('.bell');
    if (bell) {
      let badge = bell.querySelector('.count');
      if (sinLeer > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'count';
          bell.appendChild(badge);
        }
        badge.textContent = sinLeer > 99 ? '99+' : String(sinLeer);
      } else if (badge) {
        badge.remove();
      }
    }
  }

  async function mutate(action, payload, localFallbackFn, okMsg, opts) {
    opts = opts || {};
    const u = me();
    const rol = u ? u.rol : 'promotor';
    if (!isHttp()) {
      const r = localFallbackFn();
      if (!r || !r.ok) {
        toast((r && r.error) || 'Error en la operación.', 'error');
        SND.playForAction(rol, action, false);
        return { ok: false, error: r && r.error };
      }
      saveLocal();
      snapshotKnown(S);
      if (opts.onSuccess) opts.onSuccess(r);
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok');
      SND.play(opts.soundCue || (action === 'crearProspecto' ? 'prospect_created' : 'call_saved'));
      render();
      return { ok: true, result: r };
    }

    ui.busy = true;
    try {
      const { res, data } = await apiFetch('/api/mutate', {
        method: 'POST',
        body: JSON.stringify({ action, payload }),
      });
      if (!res.ok || !data || !data.ok) {
        const msg = (data && data.error) || 'Error al guardar en el servidor.';
        toast(msg, 'error');
        SND.playForAction(rol, action, false);
        return { ok: false, error: msg, result: data && data.result };
      }
      if (data.state) {
        S = C.upgradeState(data.state, { scoped: Boolean(data.state._scoped) });
        hydrateToasted(S);
        ui.rev = data.rev || ui.rev;
        ui.db.tursoConnected = Boolean(data.tursoSynced);
        ui.db.lastSync = new Date().toLocaleTimeString('es-NI');
        saveLocal();
        snapshotKnown(S);
      }
      if (opts.onSuccess) opts.onSuccess(data.result);
      if (okMsg) {
        const finalMsg = typeof okMsg === 'function' ? okMsg(data.result) : okMsg;
        if (finalMsg) toast(finalMsg, 'ok');
      }
      if (opts.soundCue) SND.play(opts.soundCue);
      else SND.playForAction(rol, action, true);
      render();
      return { ok: true, result: data.result };
    } catch {
      toast('Error de conexión con el servidor.', 'error');
      SND.playForAction(rol, action, false);
      return { ok: false, error: 'Error de conexión.' };
    } finally {
      ui.busy = false;
    }
  }

  async function fetchCcSyncStatus() {
    if (!isHttp() || !ui.autenticado) return;
    try {
      const { res, data } = await apiFetch('/api/integrations/callcenter/status', { method: 'GET' });
      if (res.ok && data && data.ok) {
        ui.ccSyncStatus = data;
        render();
      }
    } catch {}
  }

  async function fetchDbStats() {
    if (!isHttp() || !ui.autenticado) return;
    try {
      const { res, data } = await apiFetch('/api/db/stats', { method: 'GET' });
      if (res.ok && data && data.ok) {
        ui.db.stats = data;
        ui.db.tursoConnected = Boolean(data.tursoConnected);
        render();
      }
    } catch {}
  }

  async function fetchDbTable(name) {
    ui.db.activeTable = name;
    if (isHttp()) {
      try {
        const { res, data } = await apiFetch('/api/db/table?name=' + encodeURIComponent(name) + '&limit=200', { method: 'GET' });
        if (res.ok && data && data.ok) {
          ui.db.tableData = data;
          render();
          return;
        }
        toast((data && data.error) || 'No se pudo cargar la tabla SQL.', 'error');
        SND.play('admin_warn');
        return;
      } catch {}
    }
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

  function setFormBusy(form, busy, label) {
    if (!form) return;
    const btn = form.querySelector('button[type="submit"], button:not([type])');
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spin"></span> ${h(label || 'Guardando…')}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    }
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

  // ---------- compact non-intrusive top toasts (max 2, deduplicated) ----------
  function toast(msg, kind) {
    const box = $('#toasts');
    if (!box || !msg) return;
    const text = String(msg);
    const existing = [...box.children].find((el) => el.dataset.msg === text);
    if (existing) {
      clearTimeout(Number(existing.dataset.tid));
      existing.dataset.tid = String(setTimeout(() => existing.remove(), kind === 'notif' ? 6000 : 3500));
      return;
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.dataset.msg = text;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${h(text)}</span><button aria-label="Cerrar" data-close-toast>×</button>`;
    box.appendChild(el);
    while (box.children.length > 2) box.firstChild.remove();
    el.dataset.tid = String(setTimeout(() => el.remove(), kind === 'notif' ? 6000 : 3500));
  }

  function toastPendientes() {
    if (!ui.autenticado) return;
    const u = me();
    if (!u) return;
    let changed = false;
    const pending = (S.notificaciones || []).filter((n) => n.userId === u.id && !n.toasted && !toastedNotifIds.has(n.id));
    pending.slice(-2).forEach((n) => {
      n.toasted = true;
      toastedNotifIds.add(n.id);
      changed = true;
      toast('🔔 ' + n.texto, 'notif');
      SND.playForNotification(u.rol, n.texto);
    });
    pending.forEach((n) => { n.toasted = true; toastedNotifIds.add(n.id); });
    if (changed) {
      saveToastedIds(u.id);
      saveLocal();
    }
  }

  // ---------- UI components ----------
  const SEM = { nuevo: 'gray', gestion: 'amber', pescado: 'lime', seguimiento: 'blue', desembolsado: 'green', descartado: 'red' };
  const badgeEstado = (e) => `<span class="badge b-${SEM[e]}">${h(est(e))}</span>`;
  const badgeTipoCredito = (tc) => {
    const v = tc || 'NV(NUEVO)';
    const cls = v.startsWith('RP') ? 'b-blue' : v.startsWith('RC') ? 'b-amber' : 'b-green';
    return `<span class="badge ${cls}" title="Tipo de crédito">${h(v)}</span>`;
  };

  // SLA Aging traffic-light badge for active pipeline prospects
  function badgeSLA(p) {
    if (!p || p.estado === 'desembolsado' || p.estado === 'descartado') return '';
    const ref = new Date(p.actualizado || p.creado).getTime();
    if (!ref || Number.isNaN(ref)) return '';
    const hrs = Math.max(0, (Date.now() - ref) / 3600000);
    let cls = 'sla-ok', dot = '🟢', lbl;
    if (hrs < 1) {
      lbl = Math.max(1, Math.round(hrs * 60)) + 'm';
    } else if (hrs < 4) {
      lbl = Math.floor(hrs) + 'h';
    } else if (hrs <= 24) {
      cls = 'sla-warn'; dot = '🟡';
      lbl = Math.floor(hrs) + 'h';
    } else {
      cls = 'sla-hot'; dot = '🔴';
      const d = Math.floor(hrs / 24);
      const rem = Math.floor(hrs % 24);
      lbl = rem ? `${d}d ${rem}h` : `${d}d`;
    }
    return `<span class="sla ${cls}" title="Tiempo en etapa actual">${dot} ${lbl}</span>`;
  }

  function sheetSyncBadge(p) {
    if (!C.esCallCenterDirecto(p)) return '';
    const ss = p.sheetSync || {};
    if (ss.status === 'synced' && ss.sheetRow) {
      const errNote = ss.lastFollowUpError ? ' · ⚠️ seguimiento pendiente' : '';
      return `<span class="badge b-green" title="Sincronizado con Google Sheets (fila #${ss.sheetRow}) · Alerta correo a ${h(p.emailGerente || '')}${h(errNote)}">📊 Sheet #${ss.sheetRow} ✉️</span>`;
    }
    if (ss.status === 'error') {
      return `<span class="badge b-red" title="${h(ss.lastError || 'Error sincronizando con Google Sheets')}">⚠️ Sheet error</span>`;
    }
    return `<span class="badge b-amber" title="${h(ss.lastError || 'Pendiente de sincronización con Google Sheets')}">⏳ Sheet pend.</span>`;
  }

  function responsableTexto(p) {
    const parts = [];
    const prom = p.asignadoPromotorId && user(p.asignadoPromotorId);
    const gest = p.gestorId && user(p.gestorId);
    if (prom || p.asignadoPromotorNombre) parts.push(`Promotor: ${prom ? prom.nombre : p.asignadoPromotorNombre}`);
    if (gest) parts.push(`Gestor: ${gest.nombre}`);
    if (!parts.length && p.gerencia && p.gerencia.asignadoA) return p.gerencia.asignadoA;
    return parts.join(' + ');
  }

  function originBadge(p, withBranch) {
    const branchTxt = withBranch ? ` · ${h(p.sucursal)}` : '';
    if (C.esCallCenterDirecto(p)) {
      const ag = (p.cc && p.cc.agente) || 'Call Center';
      const via = p.origenApp === 'python_callcenter' ? '🐍' : '🌐';
      return `<span class="b-origin b-origin-cc" title="Caso Directo Call Center (enviado a Gerencia para distribución)">
        <span class="origin-av">CC</span>
        <span class="origin-txt">📞 ${h(ag)} ${via}${branchTxt}</span>
      </span>`;
    }
    return `<span class="b-origin" title="Candado de Origen — Promotor captador (no modificable)">
      <span class="origin-av">${h(iniciales(p.promotor_nombre))}</span>
      <span class="origin-txt">🔒 ${h(p.promotor_nombre)}${branchTxt}</span>
    </span>`;
  }

  const STEP_LBL = ['Registro', 'Call Center', 'Calificado', 'Seguimiento', 'Desembolso'];
  function progreso(p) {
    if (p.estado === 'descartado') return `<div class="progress discarded"><div class="bar"><span style="width:100%"></span></div><small>✖ ${h(p.motivoDescarte)}</small></div>`;
    const paso = C.PASO[p.estado];
    return `<div class="progress" aria-label="Paso ${paso} de 5">
      <ol class="steps">${STEP_LBL.map((l, i) => `<li class="${i + 1 < paso ? 'done' : ''} ${i + 1 === paso ? 'current' : ''}"><i>${i + 1 < paso ? '✓' : i + 1}</i><span>${l}</span></li>`).join('')}</ol>
    </div>`;
  }

  function accionesCard(p, opts) {
    opts = opts || {};
    const u = me();
    if (!u) return '';
    const t = C.transiciones(u, p);
    const b = [];
    const esCC = C.esCallCenterDirecto(p);
    const waTpl = esCC
      ? 'Hola {cliente}, le saluda {agente} de AlfaCredit (sucursal {sucursal}) en seguimiento a su solicitud de crédito atendida por nuestro Call Center. ¿Tiene un momento para conversar?'
      : S.config.plantillas.whatsapp;
    const wa = 'https://wa.me/505' + p.telefono + '?text=' + encodeURIComponent(C.fill(waTpl, { cliente: p.nombre, agente: u.nombre, promotor: p.promotor_nombre, sucursal: p.sucursal }));
    b.push(`<a class="btn sm ghost" href="tel:+505${h(p.telefono)}">📞 Llamar</a>`, `<a class="btn sm wa" target="_blank" rel="noopener" href="${h(wa)}">💬 WhatsApp</a>`);
    if (u.rol === 'callcenter' && t.length) b.push(`<button class="btn sm primary" data-action="estado" data-id="${p.id}">Gestionar llamada</button>`);
    if (u.rol === 'gerente' && p.estado === 'pescado') b.push(`<button class="btn sm primary" data-action="estado" data-id="${p.id}" data-pre="seguimiento">${esCC ? 'Distribuir caso' : 'Asignar Seguimiento'}</button>`);
    if ((u.rol === 'gerente' || u.rol === 'gestor') && p.estado === 'seguimiento') b.push(`<button class="btn sm primary" data-action="estado" data-id="${p.id}" data-pre="desembolsado">Cerrar caso</button>`);
    if (u.rol === 'gerente' && p.estado === 'seguimiento') b.push(`<button class="btn sm ghost" data-action="estado" data-id="${p.id}" data-pre="seguimiento">${esCC ? 'Redistribuir' : 'Reasignar apoyo'}</button>`);
    if (u.rol === 'admin') b.push(`<button class="btn sm ghost" data-action="editar" data-id="${p.id}">✏️ Editar</button>`, `<button class="btn sm primary" data-action="estado" data-id="${p.id}">Cambiar estado</button>`);
    if (opts.inDrawer && esCC && ['callcenter', 'gerente', 'admin'].includes(u.rol) && (!p.sheetSync || p.sheetSync.status !== 'synced' || p.sheetSync.lastFollowUpError)) {
      b.push(`<button class="btn sm ghost" data-action="retry-sheet" data-id="${p.id}">🔄 Sync Google Sheets</button>`);
    }
    if (!opts.inDrawer) b.push(`<button class="btn sm ghost" data-action="ver" data-id="${p.id}">🕒 Historial</button>`);
    return `<div class="actions">${b.join('')}</div>`;
  }

  function card(p, opts) {
    opts = opts || {};
    const g = p.gestorId && user(p.gestorId);
    const esCC = C.esCallCenterDirecto(p);
    const resp = esCC ? responsableTexto(p) : '';
    const ag = (p.cc && p.cc.agente) || 'Call Center';
    const viaLbl = p.origenApp === 'python_callcenter' ? 'App Python' : 'AlfaTrack Web';
    const originHeader = esCC
      ? `<div class="seal seal-cc">📞 CASO DIRECTO CALL CENTER · Agente: <b>${h(ag)}</b> <small>(${viaLbl})</small> ${sheetSyncBadge(p)}${resp ? `<div style="margin-top:3px">👤 <b>Distribuido a:</b> ${h(resp)}</div>` : '<div style="margin-top:3px">🏢 <em>Enviado a Gerencia para distribución</em></div>'}</div>`
      : (opts.sello ? `<div class="seal">🔒 PROPIEDAD DE PROMOTOR: <b>${h(p.promotor_nombre)}</b> <em>(No modificable)</em></div>` : originBadge(p, true));
    return `<article class="card s-${SEM[p.estado]}">
      <header>
        <div>
          <h3>${h(p.nombre)}</h3>
          <small class="tel-num">${fecha(p.creado)} · ${telFmt(p.telefono)}${p.telefonoSecundario ? ' / ' + telFmt(p.telefonoSecundario) : ''}</small>
        </div>
        <div class="badges-col">${badgeEstado(p.estado)} <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${badgeSLA(p)} ${badgeTipoCredito(p.tipoCredito)}</div></div>
      </header>
      ${originHeader}
      <dl class="facts">
        <div><dt>Monto</dt><dd class="money">${money((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto)}</dd></div>
        <div><dt>Negocio</dt><dd>${h((p.cc && p.cc.rubro) || p.negocio || '—')}</dd></div>
        <div><dt>Canal / Origen</dt><dd>${h(p.plataforma || 'Cambaceo / Campo')}${p.campana ? ` · <small>${h(p.campana)}</small>` : ''}</dd></div>
        <div><dt>Cédula</dt><dd>${h(p.cedula || '—')}</dd></div>
        <div class="wide"><dt>Dirección</dt><dd>${h((p.cc && p.cc.direccionVisita) || p.direccion || '—')}</dd></div>
      </dl>
      ${progreso(p)}
      ${p.cc && (p.cc.comentarios || p.cc.ultimaGestion) ? `<p class="note cc"><b>📞 Call Center (${h(p.cc.agente)}):</b> ${h(p.cc.comentarios || p.cc.ultimaGestion)}</p>` : ''}
      ${p.gerencia ? `<p class="note ger"><b>🏢 Gerente (${h(p.gerencia.gerente)}):</b> ${h(p.gerencia.instrucciones)}${esCC && resp ? `<br><b>Responsable asignado:</b> ${h(resp)}` : (g ? `<br><b>Gestor de apoyo:</b> ${h(g.nombre)}` : '')}</p>` : ''}
      ${accionesCard(p)}
    </article>`;
  }

  const lista = (arr, opts, vacio) => arr.length
    ? `<div class="grid">${arr.slice().sort((a, b) => b.actualizado.localeCompare(a.actualizado)).map((p) => card(p, opts)).join('')}</div>`
    : `<div class="empty">${h(vacio || 'No hay prospectos aquí.')}</div>`;

  function viewSwitcherHTML() {
    return `<div class="view-switch" role="group" aria-label="Modo de visualización">
      <button type="button" class="${ui.viewMode === 'tabla' ? 'on' : ''}" data-action="view-mode" data-val="tabla">📋 Tabla</button>
      <button type="button" class="${ui.viewMode === 'tarjetas' ? 'on' : ''}" data-action="view-mode" data-val="tarjetas">🗂️ Tarjetas</button>
      <button type="button" class="${ui.viewMode === 'kanban' ? 'on' : ''}" data-action="view-mode" data-val="kanban">📊 Kanban</button>
    </div>`;
  }

  function kanbanHTML(arr, opts) {
    opts = opts || {};
    const stages = opts.stages || C.ESTADOS;
    return `<div class="kanban">
      ${stages.map((st) => {
        const items = arr.filter((p) => p.estado === st).sort((a, b) => b.actualizado.localeCompare(a.actualizado));
        const totalMonto = items.reduce((sum, p) => sum + Number((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto || 0), 0);
        return `<section class="kanban-col">
          <div class="kanban-head">
            <div class="kanban-head-top">
              <span class="kanban-title"><i class="k-dot ${SEM[st]}"></i> ${h(est(st))}</span>
              <span class="pill">${items.length}</span>
            </div>
            <span class="kanban-total">${money(totalMonto)}</span>
          </div>
          <div class="kanban-cards">
            ${items.length ? items.map((p) => {
              const monto = (p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto || 0;
              return `<div class="kanban-card" tabindex="0" role="button" data-action="ver" data-id="${p.id}">
                <div class="kanban-card-top">
                  <h4>${h(p.nombre)}</h4>
                  ${badgeSLA(p)}
                </div>
                <div class="kanban-meta">
                  <span class="money">${money(monto)}</span>
                  <span class="tel-num">${telFmt(p.telefono)}</span>
                </div>
                <div class="kanban-meta">
                  <span>${h(p.sucursal)} · ${h((p.cc && p.cc.rubro) || p.negocio || '—')}</span>
                </div>
                ${originBadge(p, false)}
              </div>`;
            }).join('') : '<div class="kanban-empty">Sin prospectos</div>'}
          </div>
        </section>`;
      }).join('')}
    </div>`;
  }

  function prospectosViewHTML(arr, opts) {
    opts = opts || {};
    if (ui.viewMode === 'kanban') return kanbanHTML(arr, opts);
    if (ui.viewMode === 'tarjetas') return lista(arr, opts, 'Sin resultados para estos filtros.');
    if (!arr.length) return '<div class="empty">Sin resultados para estos filtros.</div>';
    const rows = arr.slice().sort((a, b) => b.creado.localeCompare(a.creado));
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Fecha / SLA</th><th>Cliente</th><th>Tipo</th><th>Teléfono</th><th>Captado por</th><th>Sucursal</th><th>Monto</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td><div>${fechaCorta(p.creado)}</div>${badgeSLA(p)}</td>
        <td><b>${h(p.nombre)}</b><br><small>${h((p.cc && p.cc.rubro) || p.negocio || '—')} · ${h(p.plataforma || 'Campo')}</small></td>
        <td>${badgeTipoCredito(p.tipoCredito)}</td>
        <td class="tel-num">${telFmt(p.telefono)}${p.telefonoSecundario ? `<br><small>${telFmt(p.telefonoSecundario)}</small>` : ''}</td>
        <td>${originBadge(p, false)}${C.esCallCenterDirecto(p) ? `<div style="margin-top:3px">${sheetSyncBadge(p)}${responsableTexto(p) ? `<br><small>👤 ${h(responsableTexto(p))}</small>` : ''}</div>` : ''}</td>
        <td>${h(p.sucursal)}</td>
        <td class="money"><b>${money((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto)}</b></td>
        <td>${badgeEstado(p.estado)}</td>
        <td>${accionesCard(p)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function tabs(key, items) {
    const cur = ui.tab[key] || items[0][0];
    const covered = key !== 'adm' ? '1' : '0';
    return `<nav class="tabs" role="tablist" data-mobile-covered="${covered}">${items.map(([k, l, n]) => `<button role="tab" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}" data-action="tab" data-key="${key}" data-val="${k}">${l}${n !== undefined ? ` <span class="pill">${n}</span>` : ''}</button>`).join('')}</nav>`;
  }
  const tabActual = (key, def) => ui.tab[key] || def;

  // ---------- filters (Call Center + Admin) ----------
  function filtrar(arr) {
    const f = ui.f;
    const q = f.q.trim().toLowerCase();
    return arr.filter((p) =>
      (!f.sucursal || p.sucursal === f.sucursal) &&
      (!f.estado || p.estado === f.estado) &&
      (!f.origen || (f.origen === 'callcenter_directo' ? C.esCallCenterDirecto(p) : !C.esCallCenterDirecto(p))) &&
      (!f.tipoCredito || (p.tipoCredito || 'NV(NUEVO)') === f.tipoCredito) &&
      (!f.plataforma || (p.plataforma || 'Cambaceo / Campo') === f.plataforma) &&
      (!f.desde || new Date(p.creado) >= new Date(f.desde + 'T00:00:00')) &&
      (!f.hasta || new Date(p.creado) <= new Date(f.hasta + 'T23:59:59.999')) &&
      (!q || [p.nombre, p.telefono, p.telefonoSecundario, p.cedula, p.promotor_nombre, p.asignadoPromotorNombre, (p.cc && p.cc.agente), p.negocio, p.direccion].join(' ').toLowerCase().includes(q)));
  }

  function filtrosHTML() {
    const f = ui.f;
    const tcs = (S.config && S.config.tiposCredito) || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
    return `<form class="filters" data-form="filtros" onsubmit="return false">
      <input type="search" name="q" placeholder="Buscar nombre, teléfono, cédula, negocio, agente o promotor" value="${h(f.q)}" aria-label="Buscar">
      <select name="sucursal" aria-label="Sucursal"><option value="">Todas las sucursales</option>${(S.config.sucursales || []).map((s) => `<option ${s === f.sucursal ? 'selected' : ''}>${h(s)}</option>`).join('')}</select>
      <select name="estado" aria-label="Estado"><option value="">Todos los estados</option>${C.ESTADOS.map((e) => `<option value="${e}" ${e === f.estado ? 'selected' : ''}>${h(est(e))}</option>`).join('')}</select>
      <select name="origen" aria-label="Origen"><option value="">Todos los orígenes</option><option value="callcenter_directo" ${f.origen === 'callcenter_directo' ? 'selected' : ''}>📞 Call Center Directo</option><option value="promotor" ${f.origen === 'promotor' ? 'selected' : ''}>🔒 Promotor (Candado)</option></select>
      <select name="tipoCredito" aria-label="Tipo de Crédito"><option value="">Todo Tipo Crédito</option>${tcs.map((t) => `<option value="${h(t)}" ${t === f.tipoCredito ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>
      <label>Desde <input type="date" name="desde" value="${h(f.desde)}"></label>
      <label>Hasta <input type="date" name="hasta" value="${h(f.hasta)}"></label>
      <div class="actions">
        <button type="button" class="btn sm ghost" data-action="limpiar-filtros">Limpiar</button>
        <button type="button" class="btn sm ghost" data-action="exportar-prospectos-csv">⬇️ CSV</button>
      </div>
    </form>`;
  }

  // ---------- Login View (Clean Production Auth) ----------
  function vistaLogin() {
    const dbRoute = isDbManagerUrl();
    return `<div class="login-wrap">
      <section class="panel login-card">
        <div class="login-header">
          <img src="icon.svg" alt="AlfaTrack" width="46" height="46">
          <div>
            <h2>${dbRoute ? '🗄️ Gestor Web Turso Cloud SQLite — AlfaTrack' : 'Acceso al Sistema — AlfaTrack'}</h2>
            <p class="hint">${dbRoute ? 'Inicia sesión con tu cuenta de Administrador General para acceder al Explorador de Tablas, Consola SQL y Respaldos en Turso Cloud.' : 'AlfaCredit S.A. · Control y Seguimiento de Prospectos'}</p>
          </div>
        </div>
        <div class="db-pill-bar">
          <span class="badge ${ui.db.tursoConnected ? 'b-green' : 'b-amber'}">
            ${ui.db.tursoConnected ? '🟢 Base de Datos Turso Cloud SQLite Conectada' : '🟡 Base de Datos Sincronizada'}
          </span>
          <small>${dbRoute ? 'Sesión Firmada HMAC-SHA256' : 'Acceso Corporativo Seguro'}</small>
        </div>
        <form class="form" data-form="login" autocomplete="on">
          <label>Usuario o Correo *
            <input name="username" id="login-username" required placeholder="Ingresa tu usuario" autocomplete="username">
          </label>
          <label>Contraseña *
            <div class="pwd-row">
              <input name="password" id="login-password" type="password" required placeholder="Ingresa tu contraseña" autocomplete="current-password">
              <button type="button" class="btn sm ghost" data-action="toggle-login-pwd">👁️ Ver</button>
            </div>
          </label>
          <button class="btn primary block" type="submit">🔐 ${dbRoute ? 'Ingresar al Gestor de Base de Datos Turso' : 'Iniciar Sesión'}</button>
        </form>
      </section>
    </div>`;
  }

  // ---------- Depurador & Clasificador CSV Component ----------
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
      <div class="csv-grid">
        <label class="file-drop">
          <span>📂 Seleccionar archivo CSV (.csv)</span>
          <input type="file" accept=".csv,.txt" data-change="csv-file">
          <small>Soporta UTF-8 y Windows-1252 (Excel)</small>
        </label>
        <label class="csv-textarea-wrap">O pega aquí las filas CSV de tus formularios:
          <textarea class="csv-textarea" rows="5" data-input="csv-text" placeholder="Cliente,Telefono,Promotor,VALOR&#10;Elizabeth Lopez,84943179,Claudia Suazo,15000&#10;Bismarck José López,57591567,Yeiling Pérez,20000">${h(ui.csv.rawText)}</textarea>
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
          <button type="button" class="chip ${curTab === 'especiales' ? 'on' : ''}" data-action="csv-tab" data-val="especiales">🔣 Especiales (${cl.especiales.length})</button>
          <button type="button" class="chip ${curTab === 'longitud' ? 'on' : ''}" data-action="csv-tab" data-val="longitud">📏 Longitud (${cl.longitud.length})</button>
          <button type="button" class="chip ${curTab === 'texto' ? 'on' : ''}" data-action="csv-tab" data-val="texto">🔤 Texto (${cl.texto.length})</button>
          <button type="button" class="chip ${curTab === 'vacios' ? 'on' : ''}" data-action="csv-tab" data-val="vacios">⬜ Vacíos (${cl.vacios.length})</button>
          <button type="button" class="chip ${curTab === 'repetidosTelefono' ? 'on' : ''}" data-action="csv-tab" data-val="repetidosTelefono">🔁 Tel. Repetidos (${cl.repetidosTelefono.length})</button>
          <button type="button" class="chip ${curTab === 'repetidosCliente' ? 'on' : ''}" data-action="csv-tab" data-val="repetidosCliente">👥 Clientes Repetidos (${cl.repetidosCliente.length})</button>
        </div>
        <div class="table-wrap">
          ${curTab === 'repetidosTelefono' ? `
            <table class="table"><thead><tr><th>Teléfono Válido</th><th>Cant. Repeticiones</th><th>Clientes Asociados</th></tr></thead>
            <tbody>${listCur.map((r) => `<tr><td class="tel-num"><b>${telFmt(r.telefono)}</b></td><td><span class="badge b-red">${r.repeticiones}</span></td><td>${h(r.clientes)}</td></tr>`).join('') || '<tr><td colspan="3">Sin teléfonos repetidos.</td></tr>'}</tbody></table>
          ` : curTab === 'repetidosCliente' ? `
            <table class="table"><thead><tr><th>Nombre del Cliente</th><th>Cant. Repeticiones</th><th>Teléfonos Asociados</th></tr></thead>
            <tbody>${listCur.map((r) => `<tr><td><b>${h(r.nombre)}</b></td><td><span class="badge b-red">${r.repeticiones}</span></td><td>${h(r.telefonos)}</td></tr>`).join('') || '<tr><td colspan="3">Sin clientes repetidos.</td></tr>'}</tbody></table>
          ` : `
            <table class="table"><thead><tr><th>#</th><th>Cliente</th><th>Teléfono Original</th><th>Teléfono Limpio</th><th>Promotor CSV → Candado Origen</th><th>Sucursal</th><th>Valor / Detalle</th></tr></thead>
            <tbody>${listCur.map((r) => `<tr>
              <td>${r.fila}</td>
              <td><b>${h(r.nombre)}</b></td>
              <td><code>${h(r.telefonoOriginal || '—')}</code></td>
              <td class="tel-num">${r.telefono ? `<b>${telFmt(r.telefono)}</b>` : '—'}${r.telefonoSecundario ? ` <small>(+${telFmt(r.telefonoSecundario)})</small>` : ''}</td>
              <td>${originBadge({ promotor_nombre: r.promotorNombre, sucursal: r.sucursal }, false)}${r.promotorOriginal && r.promotorOriginal !== r.promotorNombre ? `<br><small>CSV: ${h(r.promotorOriginal)}</small>` : ''}</td>
              <td>${h(r.sucursal)}</td>
              <td class="money">${r.motivoDuplicado ? `<span class="badge b-red">${h(r.motivoDuplicado)}</span>` : (r.monto ? money(r.monto) : h(r.valorOriginal || '—'))}</td>
            </tr>`).join('') || '<tr><td colspan="7">No hay registros en esta categoría.</td></tr>'}</tbody></table>
          `}
        </div>
      ` : ''}
    </div>`;
  }

  // ---------- views ----------
  function filtrarPromotor(u) {
    const mios = C.visibles(S, u);
    const q = ui.proSearch.trim().toLowerCase();
    return mios.filter((p) =>
      (!ui.proFilter || p.estado === ui.proFilter) &&
      (!q || [p.nombre, p.telefono, p.telefonoSecundario, p.cedula, p.negocio, p.direccion].join(' ').toLowerCase().includes(q))
    );
  }

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
          <label><span class="field-head"><span>Teléfono / WhatsApp *</span><span class="field-status" id="tel-status">0/8 dígitos</span></span><input name="telefono" inputmode="numeric" required maxlength="16" placeholder="8888-8888" data-dup data-fmt="tel"></label>
          <label>Teléfono Secundario <small>(opcional)</small><input name="telefonoSecundario" inputmode="numeric" maxlength="16" placeholder="7777-7777" data-fmt="tel"></label>
        </div>
        <div class="cols two">
          <label><span class="field-head"><span>Cédula <small>(opcional)</small></span><span class="field-status" id="ced-status"></span></span><input name="cedula" maxlength="16" placeholder="001-010190-0001A" data-dup data-fmt="ced"></label>
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
      const filtradosMios = filtrarPromotor(u);
      body = `<div class="search-bar">
          <input type="search" data-input="pro-search" value="${h(ui.proSearch)}" placeholder="🔍 Buscar por cliente, teléfono, cédula, negocio o dirección…" aria-label="Buscar en mis prospectos">
        </div>
        <div class="quick">
          <button type="button" class="chip ${!ui.proFilter ? 'on' : ''}" data-action="pf" data-val="">Todos (${mios.length})</button>
          <button type="button" class="chip ${ui.proFilter === 'nuevo' ? 'on' : ''}" data-action="pf" data-val="nuevo">En cola (${mios.filter((x) => x.estado === 'nuevo').length})</button>
          <button type="button" class="chip ${ui.proFilter === 'pescado' ? 'on' : ''}" data-action="pf" data-val="pescado">Pescados (${mios.filter((x) => x.estado === 'pescado').length})</button>
          <button type="button" class="chip ${ui.proFilter === 'seguimiento' ? 'on' : ''}" data-action="pf" data-val="seguimiento">En seguimiento (${mios.filter((x) => x.estado === 'seguimiento').length})</button>
        </div>
        <div id="pro-list">${lista(filtradosMios, {}, ui.proSearch ? 'Sin coincidencias para tu búsqueda.' : 'Aún no has registrado prospectos. Toca "+ Registrar".')}</div>`;
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
    const directos = todos.filter((p) => C.esCallCenterDirecto(p)).length;
    const tab = tabActual('cc', 'bandeja');
    const tcs = S.config.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
    const plats = S.config.plataformas || ['Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'Cambaceo / Campo', 'Otro'];
    const promotoresActivos = S.usuarios.filter((x) => x.rol === 'promotor' && x.activo).sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre));
    const sucursalesDestino = (S.config.sucursales || []).filter((s) => s !== 'Casa Matriz');
    const sucDefault = sucursalesDestino[0] || (S.config.sucursales && S.config.sucursales[0]) || 'Managua';
    const emailDefault = (S.config.emailsGerentes && S.config.emailsGerentes[sucDefault]) || 'alfacreditenrique@gmail.com';

    let body = '';
    if (tab === 'captura') {
      const modo = ui.ccModo || 'directo';
      const modeSwitch = `<div class="quick" style="margin-bottom:12px">
        <button type="button" class="chip ${modo === 'directo' ? 'on' : ''}" data-action="cc-modo" data-val="directo">📞 Directo a Gerencia (Sin Promotor · Google Sheets + Correo)</button>
        <button type="button" class="chip ${modo === 'promotor' ? 'on' : ''}" data-action="cc-modo" data-val="promotor">🔒 Con Promotor de Origen (Candado)</button>
      </div>`;
      if (modo === 'directo') {
        body = `<form class="panel form" data-form="captura-cc-directo" novalidate>
          <h2>📞 Nuevo Caso Directo Call Center → Gerencia</h2>
          ${modeSwitch}
          <p class="hint">Registra un cliente interesado captado por Call Center (<b>${h(u.nombre)}</b>) <b>sin promotor de calle</b>. El caso llega directo al <b>Gerente de Sucursal</b> en AlfaTrack para su distribución y se sincroniza automáticamente con <b>Google Sheets ("Clientes")</b> para disparar la alerta por correo electrónico.</p>
          <div class="cols two">
            <label>Sucursal Destino (Gerencia) *
              <select name="sucursal" data-change="cc-sucursal" required>
                ${(S.config.sucursales || []).map((s) => `<option value="${h(s)}" ${s === sucDefault ? 'selected' : ''}>${h(s)}</option>`).join('')}
              </select>
            </label>
            <label>Email Gerente (Notificación Google Sheets)
              <input name="emailGerente" id="cc-email-gerente" value="${h(emailDefault)}" readonly>
            </label>
          </div>
          <div class="cols two">
            <label>Nombre Completo del Cliente *<input name="nombre" required minlength="3" placeholder="Ej: Juan Carlos Pérez Gómez"></label>
            <label><span class="field-head"><span>Teléfono de Contacto *</span><span class="field-status" id="tel-status">0/8 dígitos</span></span><input name="telefono" inputmode="numeric" required maxlength="16" placeholder="8888-9999" data-dup data-fmt="tel"></label>
          </div>
          <div class="cols two">
            <label>Tipo de Crédito *
              <select name="tipoCredito">${tcs.map((t) => `<option value="${h(t)}">${h(t)}</option>`).join('')}</select>
            </label>
            <label>Monto Solicitado (C$) <small>(opcional)</small><input name="monto" type="number" min="1" step="100" placeholder="15000"></label>
          </div>
          <div class="cols two">
            <label>Teléfono Secundario <small>(opcional)</small><input name="telefonoSecundario" inputmode="numeric" maxlength="16" placeholder="7777-1111" data-fmt="tel"></label>
            <label><span class="field-head"><span>Cédula <small>(opcional)</small></span><span class="field-status" id="ced-status"></span></span><input name="cedula" maxlength="16" placeholder="001-010190-0001A" data-dup data-fmt="ced"></label>
          </div>
          <div id="dup-alert" class="alert" hidden></div>
          <div class="cols two">
            <label>Tipo de Negocio<select name="negocio"><option value="">Seleccione…</option>${S.config.negocios.map((n) => `<option>${h(n)}</option>`).join('')}</select></label>
            <label>¿Por qué plataforma nos contactó?<select name="plataforma">${plats.map((p) => `<option ${p === 'Whatsapp' ? 'selected' : ''}>${h(p)}</option>`).join('')}</select></label>
          </div>
          <div class="cols two">
            <label>Dirección del Negocio / Domicilio<input name="direccion" placeholder="Ej: Del parque 2c al sur, 1c al este"></label>
            <label>Detalle de Contacto / Campaña<input name="campana" placeholder="Ej: Campaña Facebook / WhatsApp"></label>
          </div>
          <label>Notas / Observaciones de Call Center<textarea name="notas" rows="2" placeholder="Detalles relevantes para el Gerente de Sucursal…"></textarea></label>
          <button class="btn primary block" type="submit">💾 Registrar y Enviar a Gerencia (+ Google Sheets)</button>
        </form>`;
      } else {
        body = `<form class="panel form" data-form="captura-cc" novalidate>
          <h2>📝 Captura de Prospectos — Con Promotor de Origen</h2>
          ${modeSwitch}
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
            <label><span class="field-head"><span>Teléfono de Contacto *</span><span class="field-status" id="tel-status">0/8 dígitos</span></span><input name="telefono" inputmode="numeric" required maxlength="16" placeholder="8888-9999" data-dup data-fmt="tel"></label>
          </div>
          <div class="cols two">
            <label>Teléfono Secundario <small>(opcional)</small><input name="telefonoSecundario" inputmode="numeric" maxlength="16" placeholder="7777-1111" data-fmt="tel"></label>
            <label><span class="field-head"><span>Cédula <small>(opcional)</small></span><span class="field-status" id="ced-status"></span></span><input name="cedula" maxlength="16" placeholder="001-010190-0001A" data-dup data-fmt="ced"></label>
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
      }
    } else if (tab === 'csv') {
      body = vistaDepuradorCSV(u);
    } else {
      body = `<div class="toolbar-row">
          <div class="quick" style="margin:0">
            <button class="chip ${ui.f.estado === 'nuevo' && !ui.f.origen ? 'on' : ''}" data-action="qf" data-val="nuevo">Cola nueva (${cola})</button>
            <button class="chip ${ui.f.estado === 'gestion' && !ui.f.origen ? 'on' : ''}" data-action="qf" data-val="gestion">En gestión (${gest})</button>
            <button class="chip ${ui.f.estado === 'pescado' && !ui.f.origen ? 'on' : ''}" data-action="qf" data-val="pescado">Pescados (${pesc})</button>
            <button class="chip ${ui.f.origen === 'callcenter_directo' ? 'on' : ''}" data-action="q-origen" data-val="callcenter_directo">📞 Directo Gerencia (${directos})</button>
            <button class="chip ${!ui.f.estado && !ui.f.origen ? 'on' : ''}" data-action="qf" data-val="">Todos (${todos.length})</button>
          </div>
          ${viewSwitcherHTML()}
        </div>
        ${filtrosHTML()}
        <div id="list">${prospectosViewHTML(filtrar(todos))}</div>`;
    }

    return `<section class="kpis four">
        <div class="kpi"><b>${cola}</b><span>En cola</span></div>
        <div class="kpi amber"><b>${gest}</b><span>En gestión</span></div>
        <div class="kpi lime"><b>${pesc}</b><span>Pescados / Directos</span></div>
        <div class="kpi green"><b>${desem}</b><span>Desembolsados</span></div>
      </section>
      ${tabs('cc', [['bandeja', '📞 Bandeja de Llamadas', cola + gest], ['captura', '📝 Captura Call Center'], ['csv', '📥 Depurador CSV']])}
      ${body}`;
  }

  function vistaGerente(u) {
    const todosSuc = C.visibles(S, u);
    const mios = !ui.gerOrigen
      ? todosSuc
      : todosSuc.filter((p) => (ui.gerOrigen === 'callcenter_directo' ? C.esCallCenterDirecto(p) : !C.esCallCenterDirecto(p)));
    const pesc = mios.filter((p) => p.estado === 'pescado');
    const seg = mios.filter((p) => p.estado === 'seguimiento');
    const desem = mios.filter((p) => p.estado === 'desembolsado');
    const ccDirectosTotal = todosSuc.filter((p) => C.esCallCenterDirecto(p)).length;
    const montoSuc = desem.reduce((a, p) => a + Number((p.desembolso && p.desembolso.monto) || p.monto || 0), 0);
    const emailGer = (S.config.emailsGerentes && S.config.emailsGerentes[u.sucursal]) || u.email || 'alfacreditenrique@gmail.com';
    const equipo = S.usuarios.filter((x) => x.sucursal === u.sucursal && x.activo && ['promotor', 'gestor'].includes(x.rol));
    const tab = tabActual('ger', 'pescados');

    const origenFilterBar = `<div class="quick" style="margin-bottom:10px">
      <button type="button" class="chip ${!ui.gerOrigen ? 'on' : ''}" data-action="ger-origen" data-val="">Todos (${todosSuc.length})</button>
      <button type="button" class="chip ${ui.gerOrigen === 'callcenter_directo' ? 'on' : ''}" data-action="ger-origen" data-val="callcenter_directo">📞 Directo Call Center (${ccDirectosTotal})</button>
      <button type="button" class="chip ${ui.gerOrigen === 'promotor' ? 'on' : ''}" data-action="ger-origen" data-val="promotor">🔒 Con Promotor (${todosSuc.length - ccDirectosTotal})</button>
    </div>`;

    let body;
    if (tab === 'pescados') body = origenFilterBar + lista(pesc, { sello: true }, 'No hay clientes pescados pendientes. ✔');
    else if (tab === 'seguimiento') body = origenFilterBar + lista(seg, { sello: true }, 'No hay casos en seguimiento.');
    else if (tab === 'equipo') {
      body = `<div class="panel">
        <h3>👥 Equipo Comercial — Sucursal ${h(u.sucursal)} (${equipo.length} integrantes)</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Usuario</th><th>Origen / Asignados</th><th>CC Directo Asign.</th><th>Desembolsados</th><th>Monto Colocado</th></tr></thead>
          <tbody>${equipo.map((x) => {
            const pros = x.rol === 'promotor'
              ? todosSuc.filter((p) => p.promotor_origen_id === x.id || p.asignadoPromotorId === x.id)
              : todosSuc.filter((p) => p.gestorId === x.id);
            const ccAsig = x.rol === 'promotor'
              ? todosSuc.filter((p) => C.esCallCenterDirecto(p) && p.asignadoPromotorId === x.id).length
              : todosSuc.filter((p) => C.esCallCenterDirecto(p) && p.gestorId === x.id).length;
            const gan = pros.filter((p) => p.estado === 'desembolsado');
            const m = gan.reduce((a, p) => a + Number((p.desembolso && p.desembolso.monto) || 0), 0);
            return `<tr>
              <td><b>${h(x.nombre)}</b></td>
              <td><span class="badge ${x.rol === 'promotor' ? 'b-green' : 'b-blue'}">${h(C.ROLES[x.rol])}</span></td>
              <td><code>${h(x.username)}</code></td>
              <td class="tnum">${pros.length}</td>
              <td class="tnum">${ccAsig}</td>
              <td class="tnum">${gan.length}</td>
              <td class="money">${money(m)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
    } else {
      body = `${origenFilterBar}<div class="toolbar-row"><h3 style="margin:0">Pipeline Sucursal ${h(u.sucursal)}</h3>${viewSwitcherHTML()}</div>
        <div id="list">${prospectosViewHTML(mios, { sello: true })}</div>`;
    }

    return `<div class="row" style="margin-bottom:8px"><h2 class="title" style="margin:0">Sucursal ${h(u.sucursal)}</h2><span class="badge b-blue">✉️ ${h(emailGer)}</span></div>
      <section class="kpis four">
        <div class="kpi lime"><b>${pesc.length}</b><span>Pescados / Por distribuir</span></div>
        <div class="kpi blue"><b>${seg.length}</b><span>En seguimiento</span></div>
        <div class="kpi green"><b>${desem.length}</b><span>Desembolsados</span></div>
        <div class="kpi"><b>${money(montoSuc)}</b><span>Monto sucursal</span></div>
      </section>
      ${tabs('ger', [['pescados', 'Clientes Pescados por Call Center', pesc.length], ['seguimiento', 'En seguimiento', seg.length], ['todos', 'Pipeline / Todos', mios.length], ['equipo', '👥 Mi Equipo', equipo.length]])}
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
        { name: 'alfatrack_usuarios', rows: S.usuarios.length, desc: 'Usuarios, roles, sucursales y contraseñas (hash scrypt + gestión)' },
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
            <p class="hint">Clúster autenticado: <b>Turso Cloud SQLite (AWS us-east-2 · baseinventario)</b> · Link directo: <a href="/turso"><code>${h(webDbLink)}</code></a></p>
          </div>
          <div class="actions">
            <button type="button" class="btn sm primary" data-action="db-sync-now">☁️ Sincronizar con Turso</button>
            <button type="button" class="btn sm ghost" data-action="db-download-json">⬇️ Respaldo (.JSON)</button>
            <label class="btn sm ghost" style="margin:0;cursor:pointer">📂 Importar JSON<input type="file" accept=".json" data-change="db-import-json" hidden></label>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:10px">
          <table class="table">
            <thead><tr><th>Tabla SQL</th><th>Registros</th><th>Descripción</th><th>Acción</th></tr></thead>
            <tbody>
              ${stats.tables.map((t) => `<tr>
                <td><code><b>${h(t.name)}</b></code></td>
                <td><span class="badge b-blue tnum">${t.rows} filas</span></td>
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
        <p class="hint">Ejecuta consultas SQL de lectura (<code>SELECT / PRAGMA / EXPLAIN</code>) en tiempo real sobre Turso Cloud.</p>
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
            <div style="padding:6px 10px"><small>✅ Consulta ejecutada en ${sqlRes.latencyMs || 1} ms (${(sqlRes.rows || []).length} filas)</small></div>
            <table class="table">
              <thead><tr>${(sqlRes.columns || []).map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead>
              <tbody>${(sqlRes.rows || []).map((r) => `<tr>${(sqlRes.columns || []).map((c) => `<td>${h(r[c])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${(sqlRes.columns || []).length || 1}">Sin filas</td></tr>`}</tbody>
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

  function filtrarUsuarios() {
    const q = ui.userSearch.trim().toLowerCase();
    return S.usuarios.filter((x) =>
      (!ui.userRoleFilter || x.rol === ui.userRoleFilter) &&
      (!ui.userBranchFilter || x.sucursal === ui.userBranchFilter) &&
      (!q || [x.nombre, x.username, x.sucursal, x.email, C.ROLES[x.rol]].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => (a.rol === 'admin' ? -1 : b.rol === 'admin' ? 1 : a.rol.localeCompare(b.rol) || a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre)));
  }

  function renderUsuariosRows(usuariosFiltrados, u) {
    return usuariosFiltrados.map((x) => `<tr class="${x.activo ? '' : 'off'}">
      <td><b>${h(x.nombre)}</b>${x.email ? `<br><small>${h(x.email)}</small>` : ''}</td>
      <td>${h(C.ROLES[x.rol])}</td>
      <td>${h(x.sucursal)}</td>
      <td><code><b>${h(x.username)}</b></code></td>
      <td><code>${ui.showPasswords ? h(x.password || '') : '••••••••'}</code></td>
      <td>${x.activo ? '<span class="badge b-green">Activo</span>' : '<span class="badge b-red">De baja</span>'}</td>
      <td class="actions">
        <button class="btn sm ghost" data-action="copiar-cred" data-user="${h(x.username)}" data-pass="${h(x.password || '')}" data-nombre="${h(x.nombre)}" title="Copiar usuario y contraseña">📋 Copiar</button>
        <button class="btn sm ghost" data-action="usuario" data-id="${x.id}">Editar / Clave</button>
        ${x.id === u.id ? '' : `<button class="btn sm ${x.activo ? 'danger' : 'ghost'}" data-action="toggle-usuario" data-id="${x.id}">${x.activo ? 'Dar de baja' : 'Reactivar'}</button>`}
      </td></tr>`).join('') || '<tr><td colspan="7">Sin usuarios que coincidan con el filtro.</td></tr>';
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
          <div class="panel"><h3>Embudo por estado</h3>${C.ESTADOS.map((e) => `<div class="hbar"><span>${h(est(e))}</span><div><i class="b-${SEM[e]}" style="width:${(m.porEstado[e] / max) * 100}%"></i></div><b class="tnum">${m.porEstado[e]}</b></div>`).join('')}</div>
          <div class="panel">
            <h3>Por Tipo de Crédito y Canal</h3>
            ${Object.entries(m.porTipoCredito || {}).map(([k, v]) => `<div class="hbar"><span>${h(k)}</span><div><i class="b-blue" style="width:${(v / Math.max(1, m.total)) * 100}%"></i></div><b class="tnum">${v}</b></div>`).join('')}
            <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
            ${Object.entries(m.porPlataforma || {}).map(([k, v]) => `<div class="hbar"><span>${h(k)}</span><div><i class="b-green" style="width:${(v / Math.max(1, m.total)) * 100}%"></i></div><b class="tnum">${v}</b></div>`).join('')}
          </div>
        </div>
        <div class="panel"><h3>Por sucursal</h3><div class="table-wrap"><table class="table"><thead><tr><th>Sucursal</th><th>Correo Gerencia</th><th>Prospectos</th><th>Desembolsados</th><th>Monto</th></tr></thead><tbody>
          ${Object.entries(m.porSucursal).sort((a, b) => b[1].total - a[1].total).map(([s, x]) => `<tr><td><b>${h(s)}</b></td><td><small>${h((S.config.emailsGerentes && S.config.emailsGerentes[s]) || '—')}</small></td><td class="tnum">${x.total}</td><td class="tnum">${x.desembolsado}</td><td class="money">${money(x.monto)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><h3>Ranking de promotores (comisión por origen)</h3><div class="table-wrap"><table class="table"><thead><tr><th>Promotor</th><th>Sucursal</th><th>Captados</th><th>Desembolsados</th><th>Monto</th></tr></thead><tbody>
          ${Object.values(m.porPromotor).sort((a, b) => b.monto - a.monto || b.total - a.total).map((x) => `<tr><td>${originBadge({ promotor_nombre: x.nombre, sucursal: x.sucursal }, false)}</td><td>${h(x.sucursal)}</td><td class="tnum">${x.total}</td><td class="tnum">${x.desembolsado}</td><td class="money">${money(x.monto)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel">
          <h3>📞 Trazabilidad Call Center Directo (Unificado con Google Sheets · Distribución por Gerencia)</h3>
          <section class="kpis four" style="margin-top:8px">
            <div class="kpi"><b>${m.callCenterDirecto.total}</b><span>Total Directos CC</span></div>
            <div class="kpi amber"><b>${m.callCenterDirecto.sinDistribuir}</b><span>Por distribuir (Gerencia)</span></div>
            <div class="kpi blue"><b>${m.callCenterDirecto.porEstado.seguimiento || 0}</b><span>En seguimiento</span></div>
            <div class="kpi green"><b>${m.callCenterDirecto.desembolsados} (${money(m.callCenterDirecto.montoDesembolsado)})</b><span>Desembolsados CC</span></div>
          </section>
          ${m.callCenterDirecto.total ? `<div class="cols two">
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Sucursal (CC Directo)</th><th>Total</th><th>Pend.</th><th>Seguim.</th><th>Desemb.</th><th>Monto</th></tr></thead>
              <tbody>${Object.entries(m.callCenterDirecto.porSucursal).sort((a, b) => b[1].total - a[1].total).map(([s, x]) => `<tr><td><b>${h(s)}</b></td><td class="tnum">${x.total}</td><td class="tnum">${x.pendientes}</td><td class="tnum">${x.seguimiento}</td><td class="tnum">${x.desembolsado}</td><td class="money">${money(x.monto)}</td></tr>`).join('')}</tbody>
            </table></div>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Agente Call Center</th><th>Captados</th><th>Seguim.</th><th>Desemb.</th><th>Deneg.</th><th>Monto</th></tr></thead>
              <tbody>${Object.values(m.callCenterDirecto.porAgente).sort((a, b) => b.total - a.total).map((x) => `<tr><td><b>${h(x.nombre)}</b></td><td class="tnum">${x.total}</td><td class="tnum">${x.seguimiento}</td><td class="tnum">${x.desembolsado}</td><td class="tnum">${x.descartado}</td><td class="money">${money(x.monto)}</td></tr>`).join('')}</tbody>
            </table></div>
          </div>` : '<p class="hint" style="margin-top:8px">Aún no se han registrado nuevos casos directos de Call Center desde la unificación. Los nuevos casos creados desde la App Python o desde AlfaTrack aparecerán aquí con trazabilidad completa.</p>'}
        </div>`;
    } else if (tab === 'prospectos') {
      body = `<div class="toolbar-row"><h3 style="margin:0">Pipeline Global (${S.prospectos.length})</h3>${viewSwitcherHTML()}</div>
        ${filtrosHTML()}
        <div id="list">${prospectosViewHTML(filtrar(S.prospectos))}</div>`;
    } else if (tab === 'usuarios') {
      const usuariosFiltrados = filtrarUsuarios();
      body = `<div class="panel">
        <div class="row">
          <div>
            <h3>👥 Gestión de Usuarios, Promotores y Contraseñas (<span id="users-count">${usuariosFiltrados.length}</span> de ${S.usuarios.length})</h3>
            <p class="hint">Administra usuarios y contraseñas de todos los promotores actuales, agentes de Call Center, gerentes y gestores.</p>
          </div>
          <div class="actions">
            <button type="button" class="btn sm ghost" data-action="toggle-show-pwd">${ui.showPasswords ? '🙈 Ocultar Claves' : '👁️ Mostrar Claves'}</button>
            <button type="button" class="btn sm ghost" data-action="exportar-usuarios-csv">⬇️ Exportar CSV</button>
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
          <tbody id="users-tbody">${renderUsuariosRows(usuariosFiltrados, u)}</tbody></table></div></div>`;
    } else if (tab === 'bd') {
      body = vistaBaseDatos();
    } else if (tab === 'csv') {
      body = vistaDepuradorCSV(u);
    } else if (tab === 'config') {
      const c = S.config;
      const ta = (name, arr) => `<textarea name="${name}" rows="6">${h((arr || []).join('\n'))}</textarea>`;
      const stCC = ui.ccSyncStatus;
      const apiBase = location.origin && location.origin !== 'null' ? location.origin : 'https://alfatrack-alfacredit.vercel.app';
      const integPanel = `<div class="panel" style="margin-bottom:12px">
        <div class="row">
          <div>
            <h3>🔗 Integración Call Center Hub (Python) ↔ Google Sheets ↔ AlfaTrack</h3>
            <p class="hint">Los casos nuevos captados por Call Center (desde la app de Python o desde AlfaTrack) se sincronizan sin duplicados con la hoja <b>"base de datos" → "Clientes"</b> conservando las alertas de correo a Gerentes.</p>
          </div>
          <button type="button" class="btn sm ghost" data-action="check-cc-sync">🔄 Verificar Estado</button>
        </div>
        <dl class="facts" style="margin-top:8px">
          <div class="wide"><dt>Webhook Ingesta Python App</dt><dd><code>POST ${h(apiBase)}/api/integrations/callcenter/ingest</code></dd></div>
          <div><dt>Puente Google Sheets</dt><dd>${stCC ? (stCC.sheets.enabled ? `<span class="badge b-green">🟢 Activo (${h(stCC.sheets.spreadsheetName)} / ${h(stCC.sheets.tabName)})</span>` : `<span class="badge b-amber">🟡 ${h(stCC.sheets.mode)}</span>`) : '<span class="badge b-gray">Toca "Verificar Estado"</span>'}</dd></div>
          <div><dt>Clave de Integración (API Key)</dt><dd>${stCC ? (stCC.integrationKeyConfigured ? '<span class="badge b-green">🔒 Configurada en Servidor</span>' : '<span class="badge b-amber">⚠️ Usar sesión Call Center / configurar ALFATRACK_INTEGRATION_KEY</span>') : '—'}</dd></div>
          ${stCC ? `<div class="wide"><dt>Resumen Call Center Directo</dt><dd>${stCC.stats.totalDirectos} casos directos · ${stCC.stats.syncedToSheet} sincronizados en Sheet · ${stCC.stats.pendingSheetSync + stCC.stats.errorSheetSync} pendientes · ${stCC.stats.fromPythonApp} desde App Python · ${stCC.stats.fromWebApp} desde Web</dd></div>` : ''}
        </dl>
      </div>`;
      body = integPanel + `<form class="panel form" data-form="config">
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

  // ---------- modals & Slide-Over Detail Drawer ----------
  function modalHTML() {
    const m = ui.modal;
    if (!m) return '';
    const u = me();
    if (!u) { ui.modal = null; return ''; }
    let inner = '';
    const isDrawer = m.type === 'ver';

    if (m.type === 'ver') {
      const p = pro(m.id);
      if (!p || !C.puedeVer(u, p)) { ui.modal = null; return ''; }
      const g = p.gestorId && user(p.gestorId);
      const esCC = C.esCallCenterDirecto(p);
      const resp = esCC ? responsableTexto(p) : '';
      const ag = (p.cc && p.cc.agente) || 'Call Center';
      const sealBlock = esCC
        ? `<div class="seal seal-cc">📞 CASO DIRECTO CALL CENTER · Agente: <b>${h(ag)}</b> · ${h(p.sucursal)} ${sheetSyncBadge(p)}${resp ? `<div style="margin-top:3px">👤 <b>Distribuido a:</b> ${h(resp)}</div>` : '<div style="margin-top:3px">🏢 <em>Pendiente de distribución por Gerencia</em></div>'}</div>`
        : `<div class="seal">🔒 PROPIEDAD DE PROMOTOR: <b>${h(p.promotor_nombre)}</b> · ${h(p.sucursal)} <em>(No modificable)</em></div>`;
      inner = `<h2>${h(p.nombre)}</h2>
        <div class="actions" style="margin-bottom:8px">${badgeEstado(p.estado)} ${badgeSLA(p)} ${badgeTipoCredito(p.tipoCredito)}</div>
        ${sealBlock}
        ${accionesCard(p, { inDrawer: true })}
        ${progreso(p)}
        <dl class="facts">
          <div><dt>Teléfono</dt><dd class="tel-num">${telFmt(p.telefono)}${p.telefonoSecundario ? ' / ' + telFmt(p.telefonoSecundario) : ''}</dd></div>
          <div><dt>Cédula</dt><dd>${h(p.cedula || '—')}</dd></div>
          <div><dt>Monto</dt><dd class="money">${money((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto)}</dd></div>
          <div><dt>Negocio</dt><dd>${h((p.cc && p.cc.rubro) || p.negocio || '—')}</dd></div>
          <div><dt>Canal / Plataforma</dt><dd>${h(p.plataforma || 'Cambaceo / Campo')}${p.campana ? ' · ' + h(p.campana) : ''}</dd></div>
          <div><dt>Email Gerencia</dt><dd>${h(p.emailGerente || (S.config.emailsGerentes && S.config.emailsGerentes[p.sucursal]) || '—')}</dd></div>
          <div class="wide"><dt>Dirección</dt><dd>${h((p.cc && p.cc.direccionVisita) || p.direccion || '—')}</dd></div>
          ${p.notas ? `<div class="wide"><dt>Notas</dt><dd>${h(p.notas)}</dd></div>` : ''}
          ${esCC && resp ? `<div class="wide"><dt>Distribución / Responsable</dt><dd>${h(resp)}</dd></div>` : (g ? `<div class="wide"><dt>Gestor de apoyo</dt><dd>${h(g.nombre)}</dd></div>` : '')}
          ${esCC && p.sheetSync ? `<div class="wide"><dt>Sincronización Google Sheets</dt><dd>${sheetSyncBadge(p)}${p.sheetSync.lastError ? ` <small style="color:var(--red)">${h(p.sheetSync.lastError)}</small>` : (p.sheetSync.lastFollowUpSyncAt ? ` <small>Seguimiento sincronizado: ${fecha(p.sheetSync.lastFollowUpSyncAt)}</small>` : '')}</dd></div>` : ''}
        </dl>
        ${p.cc && (p.cc.comentarios || p.cc.ultimaGestion) ? `<p class="note cc"><b>📞 Call Center (${h(p.cc.agente)}):</b> ${h(p.cc.comentarios || p.cc.ultimaGestion)}</p>` : ''}
        ${p.gerencia ? `<p class="note ger"><b>🏢 Gerente (${h(p.gerencia.gerente)}):</b> ${h(p.gerencia.instrucciones)}${esCC && resp ? `<br><b>Responsable asignado:</b> ${h(resp)}` : (g ? `<br><b>Gestor de apoyo:</b> ${h(g.nombre)}` : '')}</p>` : ''}
        <h3>Bitácora inmutable</h3>${timeline((p.historial || []).slice().reverse())}
        <form data-form="nota" data-id="${p.id}" class="form inline"><input name="texto" placeholder="Agregar nota a la bitácora…" aria-label="Nota"><button class="btn sm primary" type="submit">Agregar</button></form>`;
    } else if (m.type === 'estado') {
      const p = pro(m.id);
      const t = p ? C.transiciones(u, p) : [];
      if (!t.length) { ui.modal = null; return ''; }
      const sel = t.includes(m.pre) ? m.pre : t[0];
      const esCC = C.esCallCenterDirecto(p);
      const gestores = S.usuarios.filter((x) => x.rol === 'gestor' && x.activo).sort((a, b) => (b.sucursal === p.sucursal) - (a.sucursal === p.sucursal));
      const promotoresSuc = S.usuarios.filter((x) => x.rol === 'promotor' && x.activo).sort((a, b) => (b.sucursal === p.sucursal) - (a.sucursal === p.sucursal) || a.nombre.localeCompare(b.nombre));
      inner = `<h2>${u.rol === 'callcenter' ? 'Gestión de llamada' : (esCC && sel === 'seguimiento' ? 'Distribuir caso Call Center Directo' : 'Actualizar prospecto')}</h2>
        <p><b>${h(p.nombre)}</b> · <span class="tel-num">${telFmt(p.telefono)}</span> · ${badgeEstado(p.estado)} ${badgeTipoCredito(p.tipoCredito)}</p>${originBadge(p, true)}
        <form class="form" data-form="estado" data-id="${p.id}" data-estado="${sel}" style="margin-top:10px">
          <label>Nuevo estado<select name="estado" data-estado-select>${t.map((e) => `<option value="${e}" ${e === sel ? 'selected' : ''}>${h(est(e))}</option>`).join('')}</select></label>
          <div class="only only-gestion"><label>Resultado de la llamada<textarea name="comentarios_gestion" rows="2" placeholder="Ej. No contestó, volver a llamar mañana"></textarea></label></div>
          <div class="only only-pescado">
            <p class="hint">Confirme los datos. Se notificará al Gerente de ${h(p.sucursal)} (${h((S.config.emailsGerentes && S.config.emailsGerentes[p.sucursal]) || '')})${esCC ? '.' : ` y al promotor ${h(p.promotor_nombre)}.`}</p>
            <label>Monto solicitado (C$) *<input name="monto" type="number" min="1" value="${h((p.cc && p.cc.monto) || p.monto || '')}"></label>
            <label>Rubro / Negocio *<input name="rubro" value="${h((p.cc && p.cc.rubro) || p.negocio)}"></label>
            <label>Dirección exacta de visita *<input name="direccionVisita" value="${h((p.cc && p.cc.direccionVisita) || p.direccion)}"></label>
            <label>Comentarios de Call Center *<textarea name="comentarios_pescado" rows="3"></textarea></label>
          </div>
          <div class="only only-seguimiento">
            ${esCC ? `
              <div class="seal seal-cc">📞 <b>Caso Directo de Call Center</b> — Distribúyelo a un Promotor, a un Gestor/Oficial de Crédito, a ambos, o atiéndelo directamente desde Gerencia.</div>
              <label>Asignar a Promotor (opcional)<select name="asignadoPromotorId"><option value="">— Ningún promotor asignado —</option>
                ${promotoresSuc.map((x) => `<option value="${x.id}" ${x.id === p.asignadoPromotorId ? 'selected' : ''}>${h(x.nombre)} (${h(x.sucursal)})</option>`).join('')}</select></label>
              <label>Asignar a Gestor / Oficial de Crédito (opcional)<select name="gestorId"><option value="">— Ningún gestor asignado —</option>
                ${gestores.map((x) => `<option value="${x.id}" ${x.id === p.gestorId ? 'selected' : ''}>${h(x.nombre)} (${h(x.sucursal)})</option>`).join('')}</select></label>
              <label>Instrucciones / Plan de Seguimiento *<textarea name="instrucciones" rows="3" placeholder="Ej. Contactar hoy, visitar negocio y verificar documentación…">${h((p.gerencia && p.gerencia.instrucciones) || '')}</textarea></label>
            ` : `
              <div class="seal">🔒 El cierre queda a cargo del Promotor de Origen: <b>${h(p.promotor_nombre)}</b> (no se reemplaza)</div>
              <label>Gestor de Crédito de apoyo (opcional)<select name="gestorId"><option value="">— Sin gestor, solo el promotor —</option>
                ${gestores.map((x) => `<option value="${x.id}" ${x.id === p.gestorId ? 'selected' : ''}>${h(x.nombre)} (${h(x.sucursal)})</option>`).join('')}</select></label>
              <label>Instrucciones para el promotor *<textarea name="instrucciones" rows="3">${h((p.gerencia && p.gerencia.instrucciones) || '')}</textarea></label>
            `}
          </div>
          <div class="only only-desembolsado"><label>Monto desembolsado (C$)<input name="monto_desembolso" type="number" min="1" value="${h((p.cc && p.cc.monto) || p.monto || '')}"></label></div>
          <div class="only only-descartado">
            <label>Motivo *<select name="motivo"><option value="">Seleccione…</option>${S.config.motivos.map((x) => `<option>${h(x)}</option>`).join('')}</select></label>
            <label>Comentario<textarea name="comentarios_descarte" rows="2"></textarea></label>
          </div>
          <button class="btn primary block" type="submit">Guardar</button>
        </form>`;
    } else if (m.type === 'editar') {
      const p = pro(m.id);
      if (!p || u.rol !== 'admin') { ui.modal = null; return ''; }
      const esCC = C.esCallCenterDirecto(p);
      const tcs = S.config.tiposCredito || ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'];
      const plats = S.config.plataformas || ['Cambaceo / Campo', 'Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'Otro'];
      inner = `<h2>Editar prospecto</h2>
        ${esCC
          ? `<div class="seal seal-cc">📞 Origen: <b>Call Center Directo</b> (${h((p.cc && p.cc.agente) || 'Call Center')}) — Candado de Origen bloqueado</div>`
          : `<div class="seal">🔒 Promotor de origen: <b>${h(p.promotor_nombre)}</b> — bloqueado por Candado de Origen</div>`}
        <form class="form" data-form="editar" data-id="${p.id}">
          <div class="cols two">
            <label>Nombre<input name="nombre" value="${h(p.nombre)}"></label>
            <label>Tipo de Crédito<select name="tipoCredito">${tcs.map((t) => `<option ${t === (p.tipoCredito || 'NV(NUEVO)') ? 'selected' : ''}>${h(t)}</option>`).join('')}</select></label>
          </div>
          <div class="cols two">
            <label>Teléfono<input name="telefono" value="${h(p.telefono)}" data-fmt="tel"></label>
            <label>Teléfono Secundario<input name="telefonoSecundario" value="${h(p.telefonoSecundario || '')}" data-fmt="tel"></label>
          </div>
          <div class="cols two">
            <label>Cédula<input name="cedula" value="${h(p.cedula)}" data-fmt="ced"></label>
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
          ${esCC ? `<label>Promotor asignado por Gerencia (opcional)<select name="asignadoPromotorId"><option value="">— Ninguno —</option>${S.usuarios.filter((x) => x.rol === 'promotor' && (x.activo || x.id === p.asignadoPromotorId)).map((x) => `<option value="${x.id}" ${x.id === p.asignadoPromotorId ? 'selected' : ''}>${h(x.nombre)} (${h(x.sucursal)})${x.activo ? '' : ' [baja]'}</option>`).join('')}</select></label>` : ''}
          <label>Notas<textarea name="notas" rows="2">${h(p.notas)}</textarea></label>
          <button class="btn primary block" type="submit">Guardar cambios</button>
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
          <button class="btn primary block" type="submit">Guardar</button>
        </form>`;
    } else if (m.type === 'mi-clave') {
      inner = `<h2>🔑 Cambiar mi contraseña</h2>
        <p class="hint">Usuario: <code><b>${h(u.username)}</b></code> · ${h(u.nombre)} (${h(C.ROLES[u.rol])})</p>
        <form class="form" data-form="mi-clave">
          ${u.rol === 'admin' ? '' : '<label>Contraseña actual *<input name="passwordActual" type="password" required></label>'}
          <label>Nueva contraseña * <small>(mínimo 4 caracteres)</small><input name="passwordNueva" type="text" required minlength="4" placeholder="Escribe tu nueva contraseña"></label>
          <button class="btn primary block" type="submit">Actualizar contraseña</button>
        </form>`;
    } else if (m.type === 'sonido') {
      const muted = SND.isMuted();
      const cues = SND.ROLE_CUES[u.rol] || ['notify', 'error'];
      inner = `<h2>🎵 Preferencias de Sonido y Vibración</h2>
        <p class="hint">Sonoridad diseñada para tu rol: <b>${h(C.ROLES[u.rol])}</b>. Usa tonos armónicos suaves de Web Audio API + vibración táctil en móvil.</p>
        <div class="row" style="margin-bottom:10px">
          <span>Estado del audio: <b>${muted ? '🔇 Silenciado' : '🔊 Activo'}</b></span>
          <button type="button" class="btn sm ${muted ? 'primary' : 'ghost'}" data-action="toggle-sound">${muted ? '🔊 Activar sonido' : '🔇 Silenciar'}</button>
        </div>
        <div class="sound-list">
          ${cues.map((key) => {
            const info = SND.CUES[key];
            return info ? `<div class="sound-row">
              <span><b>${h(info.label)}</b></span>
              <button type="button" class="btn sm ghost" data-action="test-sound" data-cue="${h(key)}">▶️ Probar</button>
            </div>` : '';
          }).join('')}
        </div>`;
    }
    return `<div class="modal-bg ${isDrawer ? 'drawer-bg' : ''}" data-action="cerrar-modal"><div class="modal ${isDrawer ? 'drawer' : ''}" role="dialog" aria-modal="true" data-stop>
      <button class="x" data-action="cerrar-modal" aria-label="Cerrar">×</button>${inner}</div></div>`;
  }

  // ---------- Mobile Bottom Navigation + FAB ----------
  function renderMobileNav(u) {
    const holder = $('#mobile-nav');
    if (!holder) return;
    if (!ui.autenticado || !u) { holder.innerHTML = ''; return; }
    let key = '', items = [], fab = null;
    if (u.rol === 'promotor') {
      key = 'pro';
      const cur = tabActual('pro', 'mis');
      const mios = C.visibles(S, u);
      const gan = mios.filter((p) => p.estado === 'desembolsado').length;
      items = [
        ['mis', '📋', 'Mis Leads', mios.length],
        ['nuevo', '➕', 'Registrar'],
        ['csv', '📥', 'CSV'],
        ['ganados', '🏆', 'Ganados', gan],
      ];
      if (cur !== 'nuevo') fab = { key: 'pro', val: 'nuevo', label: '+ Nuevo' };
    } else if (u.rol === 'callcenter') {
      key = 'cc';
      const cur = tabActual('cc', 'bandeja');
      const cola = C.visibles(S, u).filter((p) => p.estado === 'nuevo' || p.estado === 'gestion').length;
      items = [
        ['bandeja', '📞', 'Bandeja', cola],
        ['captura', '📝', 'Capturar'],
        ['csv', '📥', 'CSV'],
      ];
      if (cur !== 'captura') fab = { key: 'cc', val: 'captura', label: '+ Capturar' };
    } else if (u.rol === 'gerente') {
      key = 'ger';
      const mios = C.visibles(S, u);
      items = [
        ['pescados', '🐟', 'Pescados', mios.filter((p) => p.estado === 'pescado').length],
        ['seguimiento', '📌', 'Seguim.', mios.filter((p) => p.estado === 'seguimiento').length],
        ['todos', '📊', 'Pipeline'],
        ['equipo', '👥', 'Equipo'],
      ];
    } else if (u.rol === 'gestor') {
      key = 'ges';
      const mios = C.visibles(S, u);
      items = [
        ['act', '📋', 'Evaluar', mios.filter((p) => p.estado === 'seguimiento').length],
        ['todos', '🕒', 'Historial', mios.length],
      ];
    } else if (u.rol === 'admin') {
      key = 'adm';
      items = [
        ['metricas', '📊', 'Métricas'],
        ['prospectos', '📋', 'Leads', S.prospectos.length],
        ['usuarios', '👥', 'Usuarios'],
        ['bd', '🗄️', 'Turso BD'],
        ['config', '⚙️', 'Config'],
      ];
    }
    const cur = tabActual(key, items[0] ? items[0][0] : '');
    holder.innerHTML = `
      ${fab ? `<button type="button" class="fab" data-action="tab" data-key="${fab.key}" data-val="${fab.val}">${h(fab.label)}</button>` : ''}
      <nav class="mobile-nav" aria-label="Navegación rápida">
        ${items.map(([v, ico, lbl, cnt]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-action="tab" data-key="${key}" data-val="${v}">
          <span class="m-ico">${ico}</span><span>${h(lbl)}</span>${cnt ? `<span class="m-badge">${cnt > 99 ? '99+' : cnt}</span>` : ''}
        </button>`).join('')}
      </nav>`;
  }

  // ---------- render ----------
  function render() {
    const u = ui.autenticado ? me() : null;
    if (ui.autenticado && !u) {
      // Waiting for initial /api/state or invalid cached user
      $('#topbar').innerHTML = `<div class="brand"><img src="icon.svg" alt="" width="30" height="30"><div><b>AlfaTrack</b></div></div>`;
      $('#app').innerHTML = vistaLogin();
      renderMobileNav(null);
      $('#modal').innerHTML = '';
      return;
    }
    const mis = u ? (S.notificaciones || []).filter((n) => n.userId === u.id).sort((a, b) => b.ts.localeCompare(a.ts)) : [];
    const sinLeer = mis.filter((n) => !n.leida).length;
    const muted = SND.isMuted();

    $('#topbar').innerHTML = `
      <div class="brand">
        <img src="icon.svg" alt="" width="30" height="30">
        <div>
          <b>AlfaTrack <span class="cloud-dot" title="${ui.db.tursoConnected ? 'Conectado a Turso Cloud SQLite' : 'Modo Local'}">${ui.db.tursoConnected ? '🟢' : '🟡'}</span></b>
          <small>Control y Seguimiento · AlfaCredit S.A.</small>
        </div>
      </div>
      ${u ? `
        <div class="top-session">
          <span class="badge b-green">${h(C.ROLES[u.rol])}</span>
          <b>${h(u.nombre)}</b>
          <small>(${h(u.sucursal)})</small>
        </div>
      ` : ''}
      <div class="top-actions">
        <button class="icon-btn" data-action="toggle-theme" title="${ui.theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}" aria-label="Cambiar tema">${ui.theme === 'dark' ? '☀️' : '🌙'}</button>
        ${u ? `
          <button class="icon-btn" data-action="toggle-sound" title="${muted ? 'Activar sonidos' : 'Silenciar sonidos'}" aria-label="Alternar sonido">${muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-action="sound-prefs" title="Probar sonidos por rol" aria-label="Preferencias de sonido">🎵</button>
          <button class="btn sm ghost top-btn" data-action="mi-clave" title="Cambiar mi contraseña">🔑<span class="lbl"> Clave</span></button>
          <button class="btn sm ghost top-btn" data-action="logout" title="Cerrar sesión (${h(u.username)})">🚪<span class="lbl"> Salir</span></button>
          <div class="bell-wrap">
            <button class="bell" data-action="bell" aria-label="Notificaciones (${sinLeer} sin leer)" aria-expanded="${ui.bell}">🔔${sinLeer ? `<span class="count">${sinLeer > 99 ? '99+' : sinLeer}</span>` : ''}</button>
            ${ui.bell ? `<div class="bell-panel"><div class="row"><b>Notificaciones</b>${sinLeer ? '<button class="link" data-action="leer-todas">Marcar todas leídas</button>' : ''}</div>
              ${mis.length ? `<ul>${mis.slice(0, 50).map((n) => `<li class="${n.leida ? '' : 'unread'}" data-action="notif" data-id="${n.id}"><p>${h(n.texto)}</p><time>${fecha(n.ts)}</time></li>`).join('')}</ul>` : '<p class="empty">Sin notificaciones.</p>'}</div>` : ''}
          </div>
        ` : ''}
      </div>`;

    if (!u) {
      $('#app').innerHTML = vistaLogin();
    } else {
      const vistas = { promotor: vistaPromotor, callcenter: vistaCallCenter, gerente: vistaGerente, gestor: vistaGestor, admin: vistaAdmin };
      $('#app').innerHTML = `<div class="who">
        <span>${h(C.ROLES[u.rol])} · <b>${h(u.nombre)}</b> (<code>${h(u.username)}</code>) · ${h(u.sucursal)}</span>
        <small>${ui.db.tursoConnected ? '☁️ Turso Cloud' : '💾 Local'}${ui.db.lastSync ? ' · ' + ui.db.lastSync : ''}</small>
      </div>` + vistas[u.rol](u);
    }
    renderMobileNav(u);
    $('#modal').innerHTML = modalHTML();
    document.body.classList.toggle('no-scroll', !!ui.modal);
    toastPendientes();
  }

  const refrescarLista = () => {
    const el = $('#list');
    const u = me();
    if (!el || !u) return;
    const base = u.rol === 'admin' ? S.prospectos : C.visibles(S, u);
    const items = u.rol === 'gerente' ? base : filtrar(base);
    el.innerHTML = prospectosViewHTML(items, u.rol === 'gerente' ? { sello: true } : {});
  };

  const refrescarProLista = () => {
    const el = $('#pro-list');
    const u = me();
    if (!el || !u) return;
    const filtradosMios = filtrarPromotor(u);
    el.innerHTML = lista(filtradosMios, {}, ui.proSearch ? 'Sin coincidencias para tu búsqueda.' : 'Aún no has registrado prospectos. Toca "+ Registrar".');
  };

  const refrescarUsuarios = () => {
    const tbody = $('#users-tbody');
    const cnt = $('#users-count');
    const u = me();
    if (!tbody || !u) return;
    const filtrados = filtrarUsuarios();
    tbody.innerHTML = renderUsuariosRows(filtrados, u);
    if (cnt) cnt.textContent = String(filtrados.length);
  };

  // ---------- live duplicate & smart field feedback ----------
  function setFormDupState(form, dupMsg) {
    if (!form) return;
    const box = form.querySelector('#dup-alert') || $('#dup-alert');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (box) {
      box.hidden = !dupMsg;
      box.textContent = dupMsg ? '⚠️ ' + dupMsg : '';
    }
    if (submitBtn) submitBtn.disabled = Boolean(dupMsg);
    if (dupMsg) {
      if (lastDupAlertKey !== dupMsg) {
        lastDupAlertKey = dupMsg;
        SND.play('error');
      }
    } else {
      lastDupAlertKey = '';
    }
  }

  async function runDuplicateCheck(form) {
    if (!form) return;
    const telRaw = form.telefono ? form.telefono.value : '';
    const cedRaw = form.cedula ? form.cedula.value : '';
    const telOk = C.validarTelefono(telRaw) ? telRaw : '';
    const cedOk = C.normCedula(cedRaw).length === 14 ? cedRaw : '';
    if (!telOk && !cedOk) {
      setFormDupState(form, '');
      return;
    }
    const localDup = C.buscarDuplicado(S, telOk, cedOk);
    if (localDup) {
      setFormDupState(form, C.mensajeDuplicado(localDup));
      return;
    }
    if (!isHttp() || !ui.token) {
      setFormDupState(form, '');
      return;
    }
    const seq = ++dupCheckSeq;
    try {
      const qs = new URLSearchParams();
      if (telOk) qs.set('telefono', telOk);
      if (cedOk) qs.set('cedula', cedOk);
      const { res, data } = await apiFetch('/api/check-dup?' + qs.toString(), { method: 'GET' });
      if (seq !== dupCheckSeq) return;
      if (res.ok && data && data.ok && data.duplicate) {
        setFormDupState(form, data.duplicate.mensaje);
      } else {
        setFormDupState(form, '');
      }
    } catch {
      if (seq === dupCheckSeq) setFormDupState(form, '');
    }
  }

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
      case 'toggle-theme':
        applyTheme(ui.theme === 'dark' ? 'light' : 'dark');
        render();
        break;
      case 'toggle-sound': {
        const nowMuted = SND.toggleMute();
        if (!nowMuted) SND.play('call_saved', { force: true });
        render();
        toast(nowMuted ? '🔇 Sonidos silenciados.' : '🔊 Sonidos activados.', 'info');
        break;
      }
      case 'sound-prefs':
        ui.modal = { type: 'sonido' };
        render();
        break;
      case 'test-sound':
        SND.play(el.dataset.cue, { force: true });
        break;
      case 'view-mode':
        ui.viewMode = el.dataset.val;
        try { localStorage.setItem(VIEW_KEY, ui.viewMode); } catch {}
        render();
        break;
      case 'tab':
        ui.tab[el.dataset.key] = el.dataset.val;
        if (el.dataset.key === 'adm' && el.dataset.val === 'bd' && !ui.db.stats) fetchDbStats();
        if (el.dataset.key === 'adm' && el.dataset.val === 'config' && !ui.ccSyncStatus) fetchCcSyncStatus();
        render();
        break;
      case 'cc-modo':
        ui.ccModo = el.dataset.val === 'promotor' ? 'promotor' : 'directo';
        render();
        break;
      case 'ger-origen':
        ui.gerOrigen = el.dataset.val || '';
        render();
        break;
      case 'q-origen':
        ui.f.origen = ui.f.origen === el.dataset.val ? '' : el.dataset.val;
        if (ui.f.origen) ui.f.estado = '';
        render();
        break;
      case 'check-cc-sync':
        await fetchCcSyncStatus();
        toast('Estado de integración Call Center / Google Sheets actualizado.', 'info');
        break;
      case 'retry-sheet': {
        el.disabled = true;
        await mutate(
          'reintentarSyncSheet',
          { id },
          () => ({ ok: false, error: 'La sincronización con Google Sheets requiere conexión al servidor.' }),
          (res) => {
            const ss = res && res.sheetSync;
            if (ss && ss.ok) return `✅ Sincronizado con Google Sheets (fila #${ss.sheetRow}).`;
            return (ss && ss.error) ? `⚠️ ${ss.error}` : 'Sincronización con Google Sheets intentada.';
          },
          { soundCue: 'admin_ok' }
        );
        break;
      }
      case 'bell': ui.bell = !ui.bell; render(); break;
      case 'leer-todas':
        await mutate('marcarLeidas', {}, () => C.marcarLeidas(S, u.id), null, { soundCue: 'call_saved' });
        break;
      case 'notif': {
        const n = S.notificaciones.find((x) => x.id === id);
        ui.bell = false;
        await mutate('marcarLeidas', { id }, () => C.marcarLeidas(S, u.id, id), null, { soundCue: 'call_saved' });
        if (n && n.prospectoId && C.puedeVer(u, pro(n.prospectoId))) {
          ui.modal = { type: 'ver', id: n.prospectoId };
          render();
        }
        break;
      }
      case 'ver': e.preventDefault(); ui.modal = { type: 'ver', id }; render(); break;
      case 'estado': ui.modal = { type: 'estado', id, pre: el.dataset.pre }; render(); break;
      case 'editar': ui.modal = { type: 'editar', id }; render(); break;
      case 'usuario': ui.modal = { type: 'usuario', id }; render(); break;
      case 'mi-clave': ui.modal = { type: 'mi-clave' }; render(); break;
      case 'logout': logoutSession(false); break;
      case 'toggle-login-pwd': {
        const inp = $('#login-password');
        if (inp) {
          const isPwd = inp.type === 'password';
          inp.type = isPwd ? 'text' : 'password';
          el.textContent = isPwd ? '🙈 Ocultar' : '👁️ Ver';
          inp.focus();
        }
        break;
      }
      case 'toggle-show-pwd': ui.showPasswords = !ui.showPasswords; render(); break;
      case 'copiar-cred': {
        const txt = `AlfaTrack AlfaCredit S.A.\nNombre: ${el.dataset.nombre}\nUsuario: ${el.dataset.user}\nContraseña: ${el.dataset.pass}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(() => toast(`Credenciales de ${el.dataset.nombre} copiadas.`, 'ok')).catch(() => toast(txt, 'info'));
        } else toast(`Usuario: ${el.dataset.user} | Clave: ${el.dataset.pass}`, 'info');
        break;
      }
      case 'exportar-usuarios-csv': {
        const rows = S.usuarios.map((x) => [x.nombre, C.ROLES[x.rol], x.sucursal, x.username, x.password || '', x.email || '', x.activo ? 'ACTIVO' : 'DE BAJA']);
        downloadCSV('Credenciales_Usuarios_AlfaTrack.csv', ['Nombre Completo', 'Rol', 'Sucursal', 'Usuario', 'Contraseña', 'Email', 'Estado'], rows);
        toast('Archivo CSV de usuarios y contraseñas descargado.', 'ok');
        break;
      }
      case 'exportar-prospectos-csv': {
        const listaExp = filtrar(u.rol === 'admin' ? S.prospectos : C.visibles(S, u));
        const rows = listaExp.map((p) => [
          fecha(p.creado), p.nombre, p.tipoCredito || 'NV(NUEVO)', p.telefono, p.telefonoSecundario || '',
          p.cedula || '', C.esCallCenterDirecto(p) ? 'Call Center Directo' : 'Promotor',
          C.esCallCenterDirecto(p) ? ((p.cc && p.cc.agente) || 'Call Center') : p.promotor_nombre,
          responsableTexto(p) || (p.gestorId && user(p.gestorId) ? user(p.gestorId).nombre : ''),
          p.sucursal, (p.cc && p.cc.monto) || p.monto || 0,
          (p.cc && p.cc.rubro) || p.negocio || '', (p.cc && p.cc.direccionVisita) || p.direccion || '',
          p.plataforma || 'Cambaceo / Campo', est(p.estado), (p.desembolso && p.desembolso.monto) || '',
          (p.sheetSync && p.sheetSync.sheetRow) ? `#${p.sheetSync.sheetRow}` : '',
        ]);
        downloadCSV('Prospectos_AlfaTrack.csv', ['Fecha', 'Cliente', 'Tipo Crédito', 'Teléfono', 'Teléfono 2', 'Cédula', 'Tipo Origen', 'Captado Por', 'Distribuido / Gestor', 'Sucursal', 'Monto Solicitado', 'Negocio', 'Dirección', 'Plataforma', 'Estado', 'Monto Desembolsado', 'Fila Google Sheet'], rows);
        toast('Reporte CSV de prospectos descargado.', 'ok');
        break;
      }
      case 'csv-ejemplo': {
        ui.csv.rawText = [
          'Cliente,Telefono,Promotor,VALOR,Negocio,Direccion',
          'Elizabeth Lopez,84943179,Claudia Suazo,15000,Pulpería,Barrio Bolonia Managua',
          'Bismarck José López,57591567,Yeiling Pérez Muñoz,20000,Taller,Monimbó Masaya',
          'María Lopez,85273671,Araceli Juárez,18000,Comedor / Fritanga,Barrio Sutiava León',
          'Junieth Carballo,89624881/ 75016969,Nydia Sánchez,25000,Venta de ropa,Jinotepe Mercado',
          'Juan Jose Torrez,8423266,Martha Centeno,10000,Agricultura,Juigalpa (7 dígitos - inválido)',
          'Juana María Rodríguez,88451122,Lester De La Rocha,15000,Pulpería,Managua (Ya existe en BD)',
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
        if (!ui.csv.filas.length) { toast('Pegue o seleccione un archivo CSV con datos.', 'error'); SND.play('error'); break; }
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
        el.disabled = true;
        const r = await mutate(
          'importarFilasCSV',
          { filas: ui.csv.filas, opts: { recuperarEspeciales: true } },
          () => C.importarFilasCSV(S, u, ui.csv.filas, { recuperarEspeciales: true }),
          (res) => `✅ Se importaron ${(res.importados || []).length} prospectos válidos con Candado de Origen.`,
          {
            onSuccess: (res) => {
              ui.csv.clasif = (res && res.clasificacion) || C.clasificarFilasCSV(S, ui.csv.filas, { promotorDefault: u.rol === 'promotor' ? u : null, sucursal: u.rol === 'promotor' ? u.sucursal : '', recuperarEspeciales: true });
            },
          }
        );
        if (!r.ok) el.disabled = false;
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
        const okSync = await pullFromCloud(true, false);
        if (okSync) {
          await fetchDbStats();
          SND.play('admin_ok');
          toast('Base de datos sincronizada con Turso Cloud SQLite.', 'ok');
        } else {
          SND.play('admin_warn');
          toast('No se pudo sincronizar con Turso Cloud SQLite.', 'error');
        }
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
        SND.play('admin_ok');
        toast('Respaldo completo JSON descargado.', 'ok');
        break;
      case 'db-restore-backup': {
        if (!confirm('¿Restaurar la base de datos a este punto de respaldo?')) break;
        try {
          const { res, data } = await apiFetch('/api/db/backup', {
            method: 'POST',
            body: JSON.stringify({ action: 'restore', backupId: id }),
          });
          if (res.ok && data.ok && data.state) {
            S = C.upgradeState(data.state, { scoped: Boolean(data.state._scoped) });
            saveLocal();
            snapshotKnown(S);
            ui.db.stats = data.stats;
            SND.play('admin_ok');
            toast('Base de datos restaurada con éxito.', 'ok');
            render();
          } else {
            SND.play('admin_warn');
            toast((data && data.error) || 'No se pudo restaurar.', 'error');
          }
        } catch {
          SND.play('admin_warn');
          toast('Error al restaurar respaldo.', 'error');
        }
        break;
      }
      case 'cerrar-modal': ui.modal = null; render(); break;
      case 'toggle-usuario': {
        const x = user(id);
        if (x && (!x.activo || confirm(`¿Dar de baja a ${x.nombre}? Sus prospectos conservan el candado de origen.`))) {
          await mutate('toggleUsuario', { id }, () => C.toggleUsuario(S, u, id), 'Usuario actualizado.');
        }
        break;
      }
      case 'qf': ui.f.estado = el.dataset.val; ui.f.origen = ''; render(); break;
      case 'pf': ui.proFilter = el.dataset.val; render(); break;
      case 'limpiar-filtros': ui.f = { sucursal: '', estado: '', origen: '', tipoCredito: '', plataforma: '', desde: '', hasta: '', q: '' }; render(); break;
      case 'reset':
        if (confirm('Esto restablece la base de datos inicial. ¿Continuar?')) {
          await mutate('reset', {}, () => { S = C.seed(); return { ok: true }; }, 'Base de datos restablecida.', {
            onSuccess: () => { ui.modal = null; },
          });
        }
        break;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-estado-select]')) t.form.dataset.estado = t.value;
    else if (t.dataset.change === 'cc-sucursal') {
      const emailInp = t.form && t.form.querySelector('#cc-email-gerente');
      if (emailInp) emailInp.value = (S.config.emailsGerentes && S.config.emailsGerentes[t.value]) || 'alfacreditenrique@gmail.com';
    }
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
            SND.play('admin_warn');
            return;
          }
          if (isHttp()) {
            const { res, data } = await apiFetch('/api/db/backup', {
              method: 'POST',
              body: JSON.stringify({ action: 'import', state: st }),
            });
            if (res.ok && data.ok && data.state) {
              S = C.upgradeState(data.state, { scoped: Boolean(data.state._scoped) });
              saveLocal();
              snapshotKnown(S);
              ui.db.stats = data.stats;
              SND.play('admin_ok');
              toast('Base de datos importada y sincronizada con Turso Cloud.', 'ok');
              render();
            } else {
              SND.play('admin_warn');
              toast((data && data.error) || 'Error al importar JSON.', 'error');
            }
          } else {
            S = C.upgradeState(st);
            saveLocal();
            toast('Base de datos importada localmente.', 'ok');
            render();
          }
        } catch {
          SND.play('admin_warn');
          toast('Archivo JSON inválido.', 'error');
        }
      };
      reader.readAsText(t.files[0], 'UTF-8');
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.form && t.form.dataset.form === 'filtros' && t.name === 'q') {
      ui.f.q = t.value;
      refrescarLista();
      return;
    }
    if (t.dataset.input === 'pro-search') {
      ui.proSearch = t.value;
      refrescarProLista();
      return;
    }
    if (t.dataset.input === 'user-search') {
      ui.userSearch = t.value;
      refrescarUsuarios();
      return;
    }
    if (t.dataset.input === 'csv-text') {
      ui.csv.rawText = t.value;
      return;
    }

    // Smart ergonomic formatting & live inline counters
    if (t.dataset.fmt === 'tel') {
      const formatted = telFmt(t.value);
      if (t.value !== formatted) t.value = formatted;
      if (t.name === 'telefono') {
        const digits = C.soloDigitos(t.value).length;
        const st = t.form && t.form.querySelector('#tel-status');
        if (st) {
          if (digits === 8) { st.textContent = '✓ 8 dígitos'; st.className = 'field-status ok'; t.classList.add('input-ok'); t.classList.remove('input-err'); }
          else if (digits > 0) { st.textContent = `${digits}/8 dígitos`; st.className = 'field-status warn'; t.classList.remove('input-ok'); }
          else { st.textContent = '0/8 dígitos'; st.className = 'field-status'; t.classList.remove('input-ok', 'input-err'); }
        }
      }
    }
    if (t.dataset.fmt === 'ced') {
      const formatted = cedFmt(t.value);
      if (t.value !== formatted) t.value = formatted;
      const len = C.normCedula(t.value).length;
      const st = t.form && t.form.querySelector('#ced-status');
      if (st) {
        if (!len) { st.textContent = ''; st.className = 'field-status'; t.classList.remove('input-ok', 'input-err'); }
        else if (len === 14) { st.textContent = '✓ 14 caracteres'; st.className = 'field-status ok'; t.classList.add('input-ok'); t.classList.remove('input-err'); }
        else { st.textContent = `${len}/14`; st.className = 'field-status warn'; t.classList.remove('input-ok'); }
      }
    }
    if (t.matches('[data-dup]')) {
      runDuplicateCheck(t.form);
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
      setFormBusy(f, true, 'Verificando…');
      try {
        if (isHttp()) {
          const { res, data } = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: d.username, password: d.password }),
          });
          if (!res.ok || !data || !data.ok) {
            SND.play('error');
            toast((data && data.error) || 'Usuario o contraseña incorrectos.', 'error');
            setFormBusy(f, false);
            return;
          }
          setAuthenticatedSession(data.usuario, data.token, data.state, data.rev);
          if (isDbManagerUrl() && data.usuario.rol === 'admin') {
            ui.tab.adm = 'bd';
            fetchDbStats();
          }
          SND.play(data.usuario.rol === 'admin' ? 'admin_ok' : 'prospect_created');
          toast(`Bienvenido(a), ${data.usuario.nombre} (${C.ROLES[data.usuario.rol]}).`, 'ok');
          render();
          return;
        }
        const r = C.autenticar(S, d.username, d.password);
        if (!r.ok) { SND.play('error'); toast(r.error, 'error'); setFormBusy(f, false); return; }
        setAuthenticatedSession(r.usuario, null, S, 1);
        toast(`Bienvenido(a), ${r.usuario.nombre} (${C.ROLES[r.usuario.rol]}).`, 'ok');
        render();
      } catch {
        SND.play('error');
        toast('Error de conexión al iniciar sesión.', 'error');
        setFormBusy(f, false);
      }
      return;
    }

    if (kind === 'mi-clave') {
      setFormBusy(f, true, 'Actualizando…');
      const r = await mutate(
        'cambiarPassword',
        { targetUserId: u.id, passwordActual: d.passwordActual, passwordNueva: d.passwordNueva },
        () => C.cambiarPassword(S, u, u.id, d.passwordActual, d.passwordNueva),
        'Tu contraseña ha sido actualizada en la base de datos.',
        { onSuccess: () => { ui.modal = null; } }
      );
      if (!r.ok) setFormBusy(f, false);
      return;
    }

    if (kind === 'nuevo') {
      setFormBusy(f, true, 'Guardando…');
      const r = await mutate(
        'crearProspecto',
        d,
        () => C.crearProspecto(S, u, d),
        (res) => `Prospecto ${res.prospecto.nombre} registrado. Ya está en la cola de Call Center.`,
        {
          soundCue: 'prospect_created',
          onSuccess: () => { ui.tab.pro = 'mis'; },
        }
      );
      if (!r.ok) {
        setFormBusy(f, false);
        const box = f.querySelector('#dup-alert') || $('#dup-alert');
        if (box) { box.hidden = false; box.textContent = '⚠️ ' + r.error; }
      }
      return;
    }

    if (kind === 'captura-cc-directo') {
      setFormBusy(f, true, 'Enviando a Gerencia…');
      const r = await mutate(
        'capturarCasoCallCenterDirecto',
        d,
        () => C.capturarCasoCallCenterDirecto(S, u, d),
        (res) => {
          const p = res && res.prospecto;
          const ss = p && p.sheetSync;
          const sheetTxt = ss && ss.status === 'synced' && ss.sheetRow
            ? ` · Google Sheets fila #${ss.sheetRow} (alerta de correo activada)`
            : (ss && ss.status === 'error'
              ? ` · ⚠️ Error sync Google Sheets (reintentar en Historial)`
              : ' · Guardado en AlfaTrack');
          return `📞 Caso ${p ? p.nombre : ''} enviado al Gerente de ${p ? p.sucursal : ''}${sheetTxt}.`;
        },
        {
          soundCue: 'pescado',
          onSuccess: () => { ui.tab.cc = 'bandeja'; },
        }
      );
      if (!r.ok) {
        setFormBusy(f, false);
        const box = f.querySelector('#dup-alert') || $('#dup-alert');
        if (box) { box.hidden = false; box.textContent = '⚠️ ' + r.error; }
      }
      return;
    }

    if (kind === 'captura-cc') {
      setFormBusy(f, true, 'Guardando…');
      const r = await mutate(
        'capturarProspectoCallCenter',
        d,
        () => C.capturarProspectoCallCenter(S, u, d),
        (res) => `Prospecto ${res.prospecto.nombre} registrado con Candado de Origen (${res.prospecto.promotor_nombre}).`,
        {
          soundCue: 'call_saved',
          onSuccess: () => { ui.tab.cc = 'bandeja'; },
        }
      );
      if (!r.ok) {
        setFormBusy(f, false);
        const box = f.querySelector('#dup-alert') || $('#dup-alert');
        if (box) { box.hidden = false; box.textContent = '⚠️ ' + r.error; }
      }
      return;
    }

    if (kind === 'estado') {
      const estado = d.estado;
      const datos = {
        gestion: { comentarios: d.comentarios_gestion },
        pescado: { monto: d.monto, rubro: d.rubro, direccionVisita: d.direccionVisita, comentarios: d.comentarios_pescado },
        seguimiento: { gestorId: d.gestorId, asignadoPromotorId: d.asignadoPromotorId, instrucciones: d.instrucciones },
        desembolsado: { monto: d.monto_desembolso },
        descartado: { motivo: d.motivo, comentarios: d.comentarios_descarte },
      }[estado] || {};
      const cue = estado === 'desembolsado' ? 'desembolsado' : estado === 'pescado' ? 'pescado' : u.rol === 'callcenter' ? 'call_saved' : 'prospect_created';
      setFormBusy(f, true, 'Guardando…');
      const r = await mutate(
        'cambiarEstado',
        { id: f.dataset.id, estado, datos },
        () => C.cambiarEstado(S, u, f.dataset.id, estado, datos),
        (res) => {
          const notifs = (res && res.notificaciones) || [];
          const nombres = [...new Set(notifs.map((n) => (user(n.userId) && user(n.userId).nombre) || n.userId))].filter(Boolean);
          const avisos = nombres.length ? ` Se notificó a: ${nombres.join(', ')}.` : '';
          return `Guardado: ${est(estado)}.${avisos}`;
        },
        { soundCue: cue, onSuccess: () => { ui.modal = null; } }
      );
      if (!r.ok) setFormBusy(f, false);
      return;
    }

    if (kind === 'nota') {
      setFormBusy(f, true, 'Guardando…');
      const r = await mutate(
        'agregarNota',
        { id: f.dataset.id, texto: d.texto },
        () => C.agregarNota(S, u, f.dataset.id, d.texto),
        'Nota agregada a la bitácora.',
        { onSuccess: () => { ui.modal = { type: 'ver', id: f.dataset.id }; } }
      );
      if (!r.ok) setFormBusy(f, false);
      return;
    }

    if (kind === 'editar') {
      setFormBusy(f, true, 'Guardando…');
      const r = await mutate(
        'adminEditarProspecto',
        { id: f.dataset.id, patch: d },
        () => C.adminEditarProspecto(S, u, f.dataset.id, d),
        (res) => (res && res.sinCambios ? 'Sin cambios.' : 'Prospecto actualizado (registrado en bitácora).'),
        { onSuccess: () => { ui.modal = null; } }
      );
      if (!r.ok) setFormBusy(f, false);
      return;
    }

    if (kind === 'usuario') {
      setFormBusy(f, true, 'Guardando…');
      const payload = Object.assign({}, d, { id: f.dataset.id || undefined });
      const r = await mutate(
        'guardarUsuario',
        payload,
        () => C.guardarUsuario(S, u, payload),
        (res) => (res && res.usuario ? `Usuario guardado (${res.usuario.username} / ${res.usuario.password || '••••'}).` : 'Usuario guardado.'),
        { onSuccess: () => { ui.modal = null; } }
      );
      if (!r.ok) setFormBusy(f, false);
      return;
    }

    if (kind === 'config') {
      const lines = (s) => String(s || '').split('\n');
      const cfg = JSON.parse(JSON.stringify(S.config));
      cfg.sucursales = lines(d.sucursales);
      cfg.motivos = lines(d.motivos);
      cfg.negocios = lines(d.negocios);
      if (d.tiposCredito) cfg.tiposCredito = lines(d.tiposCredito);
      if (d.plataformas) cfg.plataformas = lines(d.plataformas);
      C.ESTADOS.forEach((x) => { cfg.estados[x] = d['estado_' + x]; });
      Object.keys(cfg.plantillas).forEach((k) => { cfg.plantillas[k] = d['tpl_' + k]; });
      setFormBusy(f, true, 'Guardando…');
      const r = await mutate('guardarConfig', { config: cfg }, () => C.guardarConfig(S, u, cfg), 'Configuración guardada.');
      if (!r.ok) setFormBusy(f, false);
      return;
    }

    if (kind === 'db-sql') {
      ui.db.sql = d.sql;
      setFormBusy(f, true, 'Ejecutando…');
      if (isHttp()) {
        try {
          const { res, data } = await apiFetch('/api/db/query', {
            method: 'POST',
            body: JSON.stringify({ sql: d.sql }),
          });
          // Always show the real HTTP 400/403 error message instead of silently falling back to fake rows
          if (res.ok && data && data.ok) {
            ui.db.sqlResult = data;
            SND.play('admin_ok');
          } else {
            ui.db.sqlResult = { ok: false, error: (data && data.error) || `Error SQL (HTTP ${res.status})` };
            SND.play('admin_warn');
          }
        } catch {
          ui.db.sqlResult = { ok: false, error: 'Error de red al conectar con el servidor SQL.' };
          SND.play('admin_warn');
        }
      } else {
        ui.db.sqlResult = { ok: false, error: 'La consola SQL requiere conexión con el servidor.' };
      }
      render();
      return;
    }

    if (kind === 'db-backup-create') {
      setFormBusy(f, true, 'Creando…');
      try {
        const { res, data } = await apiFetch('/api/db/backup', {
          method: 'POST',
          body: JSON.stringify({ action: 'create', nombre: d.nombre }),
        });
        if (res.ok && data.ok) {
          ui.db.stats = data.stats;
          SND.play('admin_ok');
          toast(`Respaldo "${data.backup.nombre}" creado en Turso Cloud.`, 'ok');
          render();
        } else {
          SND.play('admin_warn');
          toast((data && data.error) || 'Error al crear respaldo.', 'error');
          setFormBusy(f, false);
        }
      } catch {
        SND.play('admin_warn');
        toast('Error de conexión al crear respaldo en nube.', 'error');
        setFormBusy(f, false);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (ui.modal || ui.bell)) {
      ui.modal = null;
      ui.bell = false;
      render();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches('.kanban-card[data-action="ver"]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // Cross-tab instant sync
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue || !ui.autenticado) return;
    try {
      const parsed = JSON.parse(e.newValue);
      S = C.upgradeState(parsed, { scoped: Boolean(parsed._scoped) });
      hydrateToasted(S);
    } catch { return; }
    if (isFormProtected()) {
      updateBellBadgeOnly();
      toastPendientes();
    } else render();
  });

  // True Cross-Device Real-Time Sync: lightweight polling every 12s when visible + instant sync on focus/visibility
  setInterval(() => {
    if (ui.autenticado && document.visibilityState === 'visible' && !ui.busy) {
      pullFromCloud(false, true);
    }
  }, 12000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.autenticado && !ui.busy) {
      pullFromCloud(false, true);
    }
  });

  window.addEventListener('focus', () => {
    if (ui.autenticado && !ui.busy) {
      pullFromCloud(false, true);
    }
  });

  if ('serviceWorker' in navigator && isHttp()) {
    navigator.serviceWorker.register('sw.js?v=10', { updateViaCache: 'none' }).then((reg) => { try { reg.update(); } catch {} }).catch(() => {});
  }

  render();
  if (ui.autenticado && ui.token) {
    pullFromCloud(true, false).then(() => {
      if (isDbManagerUrl() && me() && me().rol === 'admin') fetchDbStats();
    });
  } else {
    checkHealth();
  }
})();
