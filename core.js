/* AlfaTrack core: pure business rules over a plain state object (browser + Node). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLES = {
    promotor: 'Promotor',
    callcenter: 'Call Center',
    gerente: 'Gerente de Sucursal',
    gestor: 'Oficial / Gestor de Crédito',
    admin: 'Administrador General',
  };
  const ESTADOS = ['nuevo', 'gestion', 'pescado', 'seguimiento', 'desembolsado', 'descartado'];
  const PASO = { nuevo: 1, gestion: 2, pescado: 3, seguimiento: 4, desembolsado: 5, descartado: 0 };
  const ORIGEN_CC_ID = 'cc-directo';
  const ORIGEN_CC_NOMBRE = 'Call Center Directo';
  const CAMPOS_EDITABLES = [
    'nombre', 'telefono', 'telefonoSecundario', 'cedula', 'tipoCredito',
    'direccion', 'negocio', 'monto', 'plataforma', 'campana', 'notas', 'sucursal', 'gestorId', 'asignadoPromotorId',
  ];

  let clock = () => new Date();
  const now = () => clock().toISOString();
  function setClock(fn) { clock = fn || (() => new Date()); }

  let seq = 0;
  const uid = (p) => p + '-' + Date.now().toString(36) + '-' + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

  function defaultConfig() {
    return {
      sucursales: ['Casa Matriz', 'Estelí', 'Managua', 'Masaya', 'Jinotepe', 'Rivas', 'Juigalpa', 'Sébaco', 'León'],
      emailsGerentes: {
        'Casa Matriz': 'alfacreditenrique@gmail.com',
        'Estelí': 'gerenteesteli7@gmail.com',
        'Managua': 'gerentemanaguabolonia@gmail.com',
        'Masaya': 'gerentemasaya25@gmail.com',
        'Jinotepe': 'gerentejinotepe@gmail.com',
        'Rivas': 'gerenterivas1@gmail.com',
        'Juigalpa': 'gerentejuigalpa@gmail.com',
        'Sébaco': 'gerentesebaco@gmail.com',
        'León': 'gerenteleon8@gmail.com',
      },
      tiposCredito: ['NV(NUEVO)', 'RC(REC.INACTIVO)', 'RP(REPRESTAMO)'],
      plataformas: ['Cambaceo / Campo', 'Whatsapp', 'Facebook', 'Instagram', 'Tik tok', 'Recomendación', 'X', 'Youtube', 'Otro'],
      estados: {
        nuevo: 'Nuevo (En Cola Call Center)',
        gestion: 'En Gestión Call Center',
        pescado: 'Pescado / Calificado (En Sucursal)',
        seguimiento: 'En Seguimiento / Evaluación',
        desembolsado: 'Desembolsado (Ganado)',
        descartado: 'Descartado / No Aplica',
      },
      motivos: ['No contesta', 'Sin capacidad de pago', 'Fuera de zona', 'No le interesa', 'Mal historial crediticio', 'Datos incorrectos', 'Ya tiene crédito vigente'],
      negocios: ['Pulpería', 'Comedor / Fritanga', 'Venta de ropa', 'Taller', 'Agricultura', 'Ganadería', 'Transporte', 'Salón de belleza / Barbería', 'Panadería / Tortillería', 'Artesanía / Calzado', 'Asalariado', 'Servicios', 'Otro'],
      plantillas: {
        whatsapp: 'Hola {cliente}, le saluda {agente} de AlfaTrack. Nuestro promotor {promotor} de la sucursal {sucursal} nos compartió su interés en un crédito. ¿Tiene un momento para conversar?',
        notif_gestion: 'Call Center ({agente}) está gestionando a tu cliente {cliente}.',
        notif_pescado_promotor: '¡Atención! Call Center ya calificó a tu cliente {cliente} y fue enviado a tu Gerente de Sucursal.',
        notif_pescado_gerente: 'Nuevo cliente pescado en {sucursal}: {cliente} (Promotor de origen: {promotor}). Monto: C$ {monto}.',
        notif_cc_directo_gerente: '📞 Nuevo caso directo de Call Center ({agente}) en {sucursal}: {cliente} · Monto: C$ {monto}. Listo para distribuir.',
        notif_cc_directo_asignado: '🏢 Gerencia ({actor}) te asignó el caso directo de Call Center: {cliente} ({sucursal}). Instrucciones: {instrucciones}',
        notif_cc_directo_agente: '📌 Gerencia ({actor}) actualizó tu caso de Call Center {cliente} ({sucursal}) → {estado}. Responsable: {responsable}.',
        notif_seguimiento_promotor: 'Tu Gerente {actor} habilitó el seguimiento de {cliente}. Instrucciones: {instrucciones}',
        notif_seguimiento_gestor: 'Se te asignó como apoyo/evaluador del cliente {cliente} (Promotor de origen: {promotor}).',
        notif_desembolsado: '🎉 ¡Felicidades! El crédito de {cliente} fue DESEMBOLSADO y cuenta para tu meta.',
        notif_descartado: 'Tu cliente {cliente} fue descartado. Motivo: {motivo}.',
      },
    };
  }

  // ---------- helpers ----------
  const soloDigitos = (s) => String(s || '').replace(/\D/g, '');
  const normCedula = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const validarTelefono = (t) => /^\d{8}$/.test(soloDigitos(t));
  const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m));
  const err = (error) => ({ ok: false, error });
  const user = (s, id) => s.usuarios.find((u) => u.id === id);
  const prospecto = (s, id) => s.prospectos.find((p) => p.id === id);
  const etiqueta = (s, e) => (s.config.estados[e] || e);

  const sinAcentos = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normUser = (str) => sinAcentos(str).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const esCallCenterDirecto = (p) => Boolean(p && (p.origenTipo === 'callcenter_directo' || p.promotor_origen_id === ORIGEN_CC_ID));

  function limpiarTelefonoCC(raw) {
    const str = String(raw || '').trim();
    if (!str || str === '-' || str.toLowerCase() === 'nan') return { telefono: '', telefonoSecundario: '' };
    const cleanOne = (part) => {
      let d = soloDigitos(part);
      if (d.length === 11 && d.startsWith('505')) d = d.slice(3);
      return d;
    };
    // 1. Split explicit multi-number separators (/, ;, ,, " y ", " - ", or two 8-digit blocks separated by hyphen/space)
    const normalized = str.replace(/\b(\d{8})\s*[-–—]\s*(\d{8})\b/g, '$1 / $2');
    const parts = normalized.split(/[\/,;]+|\s+-\s+|\s+y\s+|\s{2,}/i).map(cleanOne).filter(Boolean);
    const valid = parts.filter((d) => d.length === 8);
    if (valid.length) {
      return { telefono: valid[0], telefonoSecundario: valid[1] && valid[1] !== valid[0] ? valid[1] : '' };
    }
    // 2. Fallback: extract distinct 8-digit Nicaraguan phone patterns (optionally prefixed with +505/505 or formatted XXXX-XXXX)
    const matches = str.match(/(?:\+?505[\s-]?)?\d{4}[\s-]?\d{4}/g);
    if (matches && matches.length) {
      const extracted = matches.map(cleanOne).filter((d) => d.length === 8);
      if (extracted.length) {
        return { telefono: extracted[0], telefonoSecundario: extracted[1] && extracted[1] !== extracted[0] ? extracted[1] : '' };
      }
    }
    return { telefono: cleanOne(str), telefonoSecundario: '' };
  }

  function parseMonto(raw) {
    if (raw === undefined || raw === null) return '';
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : '';
    const str = String(raw).trim();
    if (!str || str === '-' || str.toLowerCase() === 'n/a') return '';
    // Reject explicit negative amounts (e.g. "-500" or "C$ -500")
    if (/(?:^|[^\d])-\s*\d/.test(str)) return '';
    let cleaned = str.replace(/[^0-9.,]/g, '');
    if (!cleaned) return '';
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // If last separator is comma (e.g. 15.000,50), comma is decimal; otherwise comma is thousands (e.g. 15,000.50)
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes('.')) {
      // Handle Latin American thousands dots (e.g. 15.000 or 1.500.000) vs decimal (15000.50)
      if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '');
      }
    } else if (cleaned.includes(',')) {
      if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '');
      } else {
        cleaned = cleaned.replace(',', '.');
      }
    }
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : '';
  }

  function normalizarSucursal(sucursalRaw, emailRaw, sucursalesPermitidas, emailsGerentesMap) {
    const list = Array.isArray(sucursalesPermitidas) && sucursalesPermitidas.length
      ? sucursalesPermitidas
      : defaultConfig().sucursales;
    const raw = sinAcentos(sucursalRaw || '').toLowerCase().replace(/^sucursal\s+/, '').trim();
    const em = String(emailRaw || '').trim().toLowerCase();

    if (raw) {
      const exact = list.find((s) => sinAcentos(s).toLowerCase() === raw);
      if (exact) return exact;
      if (raw.includes('managua') || raw.includes('bolonia') || raw.includes('norte')) {
        const m = list.find((s) => sinAcentos(s).toLowerCase() === 'managua');
        if (m) return m;
      }
      if (raw.includes('administrador') || raw.includes('matriz')) {
        const cm = list.find((s) => sinAcentos(s).toLowerCase() === 'casa matriz');
        if (cm) return cm;
      }
      // Prefer full branch name contained in raw (e.g. "esteli centro" -> "Estelí"), or prefix/substring only for >= 4 chars
      const contained = list.find((s) => raw.includes(sinAcentos(s).toLowerCase()));
      if (contained) return contained;
      if (raw.length >= 4) {
        const prefix = list.find((s) => sinAcentos(s).toLowerCase().startsWith(raw));
        if (prefix) return prefix;
        const partial = list.find((s) => sinAcentos(s).toLowerCase().includes(raw));
        if (partial) return partial;
      }
    }

    if (em) {
      const emailsMap = Object.assign({}, defaultConfig().emailsGerentes, emailsGerentesMap || {});
      if (em.includes('managua')) {
        const m = list.find((s) => sinAcentos(s).toLowerCase() === 'managua');
        if (m) return m;
      }
      for (const [suc, mail] of Object.entries(emailsMap)) {
        if (String(mail || '').toLowerCase() === em && list.includes(suc)) return suc;
      }
    }
    return '';
  }

  function sucursalParaSheet(sucursal) {
    const map = {
      'Managua': 'Sucursal Managua',
      'Estelí': 'Sucursal Esteli',
      'Masaya': 'Sucursal Masaya',
      'Rivas': 'Sucursal Rivas',
      'Jinotepe': 'Sucursal Jinotepe',
      'Juigalpa': 'Sucursal Juigalpa',
      'Sébaco': 'Sucursal Sebaco',
      'León': 'Sucursal León',
      'Casa Matriz': 'Casa Matriz',
    };
    return map[sucursal] || (String(sucursal || '').startsWith('Sucursal') ? sucursal : `Sucursal ${sucursal}`);
  }

  const nodeCrypto = (typeof require === 'function' && typeof window === 'undefined')
    ? (() => { try { return require('node:crypto'); } catch { return null; } })()
    : null;

  function hashPwd(pwd) {
    const s = 'alfatrack_salt_2026:' + String(pwd || '');
    let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'at256$' + (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  function hashPwdScrypt(pwd, existingSalt) {
    if (!nodeCrypto || typeof nodeCrypto.scryptSync !== 'function') return hashPwd(pwd);
    const salt = existingSalt || nodeCrypto.randomBytes(16).toString('hex');
    const derived = nodeCrypto.scryptSync(String(pwd || ''), salt, 32).toString('hex');
    return `scrypt$${salt}$${derived}`;
  }

  function makePasswordHash(pwd) {
    return nodeCrypto ? hashPwdScrypt(pwd) : hashPwd(pwd);
  }

  function verifyPwd(u, pwd) {
    if (!u) return false;
    const candidate = String(pwd || '');
    const stored = String(u.passwordHash || '');
    if (stored.startsWith('scrypt$') && nodeCrypto && typeof nodeCrypto.scryptSync === 'function') {
      const parts = stored.split('$');
      if (parts.length !== 3) return false;
      const [, salt, hexHash] = parts;
      try {
        const expected = Buffer.from(hexHash, 'hex');
        const actual = nodeCrypto.scryptSync(candidate, salt, expected.length);
        return expected.length === actual.length && nodeCrypto.timingSafeEqual(expected, actual);
      } catch {
        return false;
      }
    }
    return u.password === candidate || (stored !== '' && stored === hashPwd(candidate));
  }

  function genUsername(nombre, usados) {
    const parts = sinAcentos(nombre).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const base = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : (parts[0] || 'usuario');
    let cand = base;
    let n = 2;
    while (usados && usados.has(cand)) { cand = `${base}${n++}`; }
    if (usados) usados.add(cand);
    return cand;
  }

  function genPassword(nombreOrUser) {
    const first = sinAcentos(nombreOrUser).toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/)[0] || 'alfa';
    return first + '123';
  }

  const MAX_AUDIT = 500;
  const MAX_NOTIFS = 500;

  function log(p, actor, accion, detalle) {
    p.historial.push({ ts: now(), userId: actor.id, usuario: actor.nombre, rol: actor.rol, accion, detalle: detalle || '' });
  }
  function auditar(s, actor, accion, detalle) {
    s.auditoria.push({
      ts: now(),
      userId: actor ? actor.id : 'system',
      usuario: actor ? actor.nombre : 'Sistema',
      rol: actor ? actor.rol : 'admin',
      accion,
      detalle: detalle || '',
    });
    if (s.auditoria.length > MAX_AUDIT) {
      s.auditoria.splice(0, s.auditoria.length - MAX_AUDIT);
    }
  }
  function notificar(s, userIds, texto, prospectoId) {
    const out = [];
    [...new Set(userIds)].filter(Boolean).forEach((userId) => {
      const n = { id: uid('n'), userId, texto, prospectoId, ts: now(), leida: false, toasted: false };
      s.notificaciones.push(n);
      out.push(n);
    });
    if (s.notificaciones.length > MAX_NOTIFS) {
      // Preserve unread notifications first, then newest read ones
      const unread = s.notificaciones.filter((n) => !n.leida);
      const read = s.notificaciones.filter((n) => n.leida);
      const keepRead = Math.max(0, MAX_NOTIFS - unread.length);
      s.notificaciones = unread.slice(-MAX_NOTIFS).concat(keepRead ? read.slice(-keepRead) : []);
    }
    return out;
  }
  function vars(s, p, actor, extra) {
    const g = p.gestorId && user(s, p.gestorId);
    return Object.assign({
      cliente: p.nombre, promotor: p.promotor_nombre, sucursal: p.sucursal,
      monto: Number((p.cc && p.cc.monto) || p.monto || 0).toLocaleString('es-NI'),
      agente: actor ? actor.nombre : '', actor: actor ? actor.nombre : '',
      gestor: g ? g.nombre : '', motivo: p.motivoDescarte || '', instrucciones: (p.gerencia && p.gerencia.instrucciones) || '',
    }, extra || {});
  }
  const gerentesDe = (s, suc) => s.usuarios.filter((u) => u.rol === 'gerente' && u.activo && u.sucursal === suc).map((u) => u.id);

  // ---------- authentication & credentials ----------
  function autenticar(s, identificador, password) {
    const q = String(identificador || '').trim().toLowerCase();
    const pwd = String(password || '');
    if (!q || !pwd) return err('Ingrese su usuario y contraseña.');
    const u = s.usuarios.find((x) =>
      (x.username && x.username.toLowerCase() === q) ||
      (x.email && x.email.toLowerCase() === q) ||
      sinAcentos(x.nombre).toLowerCase() === sinAcentos(q)
    );
    if (!u || !verifyPwd(u, pwd)) {
      return err('Usuario o contraseña incorrectos.');
    }
    if (!u.activo) {
      return err('Su usuario está dado de baja. Contacte al Administrador General.');
    }
    if (nodeCrypto && !String(u.passwordHash || '').startsWith('scrypt$')) {
      u.passwordHash = hashPwdScrypt(pwd);
    }
    u.ultimoAcceso = now();
    auditar(s, u, 'Inicio de sesión', `Acceso autenticado (${u.username} · ${ROLES[u.rol]} · ${u.sucursal})`);
    return { ok: true, usuario: u };
  }

  function cambiarPassword(s, actor, targetUserId, passwordActual, passwordNueva) {
    if (!actor || !actor.activo) return err('Sesión inválida.');
    const u = user(s, targetUserId || actor.id);
    if (!u) return err('Usuario no encontrado.');
    const esAdmin = actor.rol === 'admin';
    if (!esAdmin && actor.id !== u.id) return err('No tiene permiso para cambiar la contraseña de otro usuario.');
    if (!esAdmin) {
      const actual = String(passwordActual || '');
      if (!verifyPwd(u, actual)) {
        return err('La contraseña actual no es correcta.');
      }
    }
    const nueva = String(passwordNueva || '').trim();
    if (nueva.length < 4) return err('La nueva contraseña debe tener al menos 4 caracteres.');
    u.password = nueva;
    u.passwordHash = makePasswordHash(nueva);
    u.actualizado = now();
    auditar(s, actor, 'Contraseña actualizada', `Contraseña modificada para ${u.nombre} (${u.username}).`);
    return { ok: true, usuario: u };
  }

  // ---------- permissions ----------
  function puedeVer(actor, p) {
    if (!actor || !p) return false;
    switch (actor.rol) {
      case 'promotor': return p.promotor_origen_id === actor.id || (Boolean(p.asignadoPromotorId) && p.asignadoPromotorId === actor.id);
      case 'callcenter': case 'admin': return true;
      case 'gerente': return p.sucursal === actor.sucursal;
      case 'gestor': return p.gestorId === actor.id;
      default: return false;
    }
  }
  function visibles(s, actor) { return s.prospectos.filter((p) => puedeVer(actor, p)); }

  // which target states this actor may move p into
  function transiciones(actor, p) {
    if (!actor || !p || !actor.activo) return [];
    if (actor.rol === 'admin') return ESTADOS.slice();
    if (!puedeVer(actor, p)) return [];
    const e = p.estado;
    if (actor.rol === 'callcenter' && (e === 'nuevo' || e === 'gestion')) return ['gestion', 'pescado', 'descartado'];
    if (actor.rol === 'gerente' && e === 'pescado') return ['seguimiento', 'descartado'];
    if (actor.rol === 'gerente' && e === 'seguimiento') return ['seguimiento', 'desembolsado', 'descartado'];
    if (actor.rol === 'gestor' && e === 'seguimiento') return ['desembolsado', 'descartado'];
    return [];
  }

  // ---------- duplicates ----------
  function buscarDuplicado(s, telefono, cedula, excluirId) {
    const tel = soloDigitos(telefono);
    const ced = normCedula(cedula);
    for (const p of s.prospectos) {
      if (p.id === excluirId) continue;
      if (tel && soloDigitos(p.telefono) === tel) return { campo: 'teléfono', prospecto: p };
      if (ced && normCedula(p.cedula) === ced) return { campo: 'cédula', prospecto: p };
    }
    return null;
  }
  function mensajeDuplicado(d) {
    const f = new Date(d.prospecto.creado).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' });
    if (esCallCenterDirecto(d.prospecto)) {
      const ag = (d.prospecto.cc && d.prospecto.cc.agente) ? ` (${d.prospecto.cc.agente})` : '';
      return `Este ${d.campo} ya está registrado (cliente ${d.prospecto.nombre}) por Call Center Directo${ag} en ${d.prospecto.sucursal} el ${f}. No es posible registrarlo de nuevo.`;
    }
    return `Este ${d.campo} ya está registrado (cliente ${d.prospecto.nombre}) por el promotor ${d.prospecto.promotor_nombre} (${d.prospecto.sucursal}) el ${f}. No es posible registrarlo de nuevo.`;
  }

  function validarDatos(s, d, excluirId) {
    if (!String(d.nombre || '').trim() || String(d.nombre).trim().length < 3) return 'Ingrese el nombre completo del cliente.';
    if (!validarTelefono(d.telefono)) return 'El teléfono debe tener exactamente 8 dígitos.';
    if (d.telefonoSecundario && String(d.telefonoSecundario).trim() && !validarTelefono(d.telefonoSecundario)) {
      return 'El teléfono secundario debe tener 8 dígitos.';
    }
    if (d.cedula && normCedula(d.cedula).length !== 14) return 'Cédula inválida (debe tener 14 caracteres: 001-010190-0001A).';
    if (d.monto !== undefined && d.monto !== '' && !(Number(d.monto) > 0)) return 'El monto debe ser mayor a 0.';
    const dup = buscarDuplicado(s, d.telefono, d.cedula, excluirId);
    if (dup) return mensajeDuplicado(dup);
    return null;
  }

  // ---------- mutations (all return {ok, error?, ...}) ----------
  function crearProspecto(s, actor, d) {
    if (!actor || actor.rol !== 'promotor' || !actor.activo) return err('Solo un promotor activo puede registrar prospectos.');
    const e = validarDatos(s, d);
    if (e) return err(e);
    const emailsGer = (s.config && s.config.emailsGerentes) || defaultConfig().emailsGerentes;
    const p = {
      id: uid('p'),
      nombre: String(d.nombre).trim(),
      telefono: soloDigitos(d.telefono),
      telefonoSecundario: d.telefonoSecundario ? soloDigitos(d.telefonoSecundario) : '',
      cedula: d.cedula ? String(d.cedula).trim().toUpperCase() : '',
      tipoCredito: String(d.tipoCredito || 'NV(NUEVO)').trim(),
      direccion: String(d.direccion || '').trim(),
      negocio: String(d.negocio || '').trim(),
      monto: Number(d.monto) || 0,
      plataforma: String(d.plataforma || 'Cambaceo / Campo').trim(),
      campana: String(d.campana || '').trim(),
      emailGerente: emailsGer[actor.sucursal] || 'alfacreditenrique@gmail.com',
      notas: String(d.notas || '').trim(),
      // CANDADO DE ORIGEN: taken from the logged user, never from form data, never modified afterwards.
      promotor_origen_id: actor.id,
      promotor_nombre: actor.nombre,
      sucursal_origen: actor.sucursal,
      sucursal: actor.sucursal,
      estado: 'nuevo',
      creado: now(),
      actualizado: now(),
      cc: null, gerencia: null, gestorId: null, motivoDescarte: '',
      historial: [],
    };
    log(p, actor, 'Prospecto creado', `Registrado por ${actor.nombre} en ${actor.sucursal} (${p.tipoCredito} · ${p.plataforma}). Promotor de origen bloqueado.`);
    s.prospectos.push(p);
    return { ok: true, prospecto: p };
  }

  // Allows Call Center or Admin to register a lead captured from digital platforms/forms while locking the designated origin promoter,
  // OR route directly to the Branch Manager when modo === 'directo' (without a street promoter).
  function capturarProspectoCallCenter(s, actor, d) {
    if (!actor || !actor.activo || !['callcenter', 'admin', 'promotor'].includes(actor.rol)) {
      return err('No tiene permiso para capturar prospectos.');
    }
    if (actor.rol === 'promotor') return crearProspecto(s, actor, d);
    if (d && (d.modo === 'directo' || d.origenTipo === 'callcenter_directo')) {
      return capturarCasoCallCenterDirecto(s, actor, d);
    }
    const promotor = user(s, d.promotorOrigenId);
    if (!promotor || promotor.rol !== 'promotor') return err('Seleccione el Promotor de Origen válido.');
    const e = validarDatos(s, d);
    if (e) return err(e);
    const sucursalDestino = d.sucursal && s.config.sucursales.includes(d.sucursal) ? d.sucursal : promotor.sucursal;
    const emailsGer = (s.config && s.config.emailsGerentes) || defaultConfig().emailsGerentes;
    const p = {
      id: uid('p'),
      origenTipo: 'promotor',
      nombre: String(d.nombre).trim(),
      telefono: soloDigitos(d.telefono),
      telefonoSecundario: d.telefonoSecundario ? soloDigitos(d.telefonoSecundario) : '',
      cedula: d.cedula ? String(d.cedula).trim().toUpperCase() : '',
      tipoCredito: String(d.tipoCredito || 'NV(NUEVO)').trim(),
      direccion: String(d.direccion || '').trim(),
      negocio: String(d.negocio || '').trim(),
      monto: Number(d.monto) || 0,
      plataforma: String(d.plataforma || 'Whatsapp').trim(),
      campana: String(d.campana || '').trim(),
      emailGerente: emailsGer[sucursalDestino] || 'alfacreditenrique@gmail.com',
      notas: String(d.notas || '').trim(),
      promotor_origen_id: promotor.id,
      promotor_nombre: promotor.nombre,
      sucursal_origen: promotor.sucursal,
      sucursal: sucursalDestino,
      estado: 'nuevo',
      creado: now(),
      actualizado: now(),
      cc: { agenteId: actor.id, agente: actor.nombre, intentos: 0, ultimaGestion: 'Capturado en Call Center' },
      gerencia: null, gestorId: null, asignadoPromotorId: null, asignadoPromotorNombre: '', motivoDescarte: '',
      historial: [],
    };
    log(p, actor, 'Prospecto creado', `Capturado por ${actor.nombre} (${ROLES[actor.rol]}). Candado de Origen asignado a ${promotor.nombre} (${promotor.sucursal}).`);
    s.prospectos.push(p);
    const notificaciones = notificar(s, [promotor.id].filter((x) => x !== actor.id), `📋 ${actor.nombre} registró a tu prospecto ${p.nombre} (${p.plataforma}) con tu Candado de Origen.`, p.id);
    return { ok: true, prospecto: p, notificaciones };
  }

  // Direct Call Center lead (captured in AlfaTrack OR ingested from the Python Call Center desktop app):
  // No street promoter required; arrives directly at the corresponding Branch Manager in state 'pescado' for distribution & traceability.
  function capturarCasoCallCenterDirecto(s, actor, d) {
    d = d || {};
    if (!actor || !actor.activo || !['callcenter', 'admin'].includes(actor.rol)) {
      return err('Solo Call Center o Administrador puede registrar casos directos de Call Center.');
    }

    const externalId = String(d.externalId || '').trim();
    const sheetRowNum = Number(d.sheetRow) > 1 ? Math.floor(Number(d.sheetRow)) : null;

    // Idempotency guard: prevent duplicates on retries from Python app or webhook replays
    if (externalId || sheetRowNum) {
      const existing = s.prospectos.find((p) =>
        (externalId && p.externalId && p.externalId === externalId) ||
        (sheetRowNum && p.sheetSync && Number(p.sheetSync.sheetRow) === sheetRowNum)
      );
      if (existing) {
        return { ok: true, deduplicated: true, prospecto: existing, notificaciones: [] };
      }
    }

    const sucursalDestino = normalizarSucursal(
      d.sucursal,
      d.emailGerente,
      s.config && s.config.sucursales,
      s.config && s.config.emailsGerentes
    );
    if (!sucursalDestino) {
      return err('Seleccione una sucursal destino válida para enviar al Gerente.');
    }

    const telParsed = limpiarTelefonoCC(d.telefono);
    const telSecParsed = d.telefonoSecundario ? limpiarTelefonoCC(d.telefonoSecundario).telefono : telParsed.telefonoSecundario;
    const montoParsed = parseMonto(d.monto);
    const cleanData = {
      nombre: String(d.nombre || '').trim(),
      telefono: telParsed.telefono,
      telefonoSecundario: telSecParsed || '',
      cedula: d.cedula ? String(d.cedula).trim().toUpperCase() : '',
      monto: montoParsed,
    };

    const e = validarDatos(s, cleanData);
    if (e) {
      const dup = buscarDuplicado(s, cleanData.telefono, cleanData.cedula);
      if (dup) return Object.assign(err(e), { duplicate: true, existingId: dup.prospecto.id });
      return err(e);
    }

    const emailsGer = (s.config && s.config.emailsGerentes) || defaultConfig().emailsGerentes;
    const emailGerente = String(d.emailGerente || '').trim() || emailsGer[sucursalDestino] || 'alfacreditenrique@gmail.com';
    const agenteNombre = String(d.agenteNombre || d.agente || actor.nombre || 'Call Center').trim();
    const origenApp = d.origenApp === 'python_callcenter' ? 'python_callcenter' : 'alfatrack';
    const tipoCredito = String(d.tipoCredito || 'NV(NUEVO)').trim();
    const plataforma = String(d.plataforma || 'Whatsapp').trim();
    const campana = String(d.campana || d.detalle || '').trim();
    const negocio = String(d.negocio || d.tipoNegocio || '').trim();
    const direccion = String(d.direccion || d.direccionNegocio || '').trim();
    const notas = String(d.notas || '').trim();
    const montoNum = Number(montoParsed) || 0;
    const comentarioCC = notas || (campana ? `Captado vía ${plataforma} (${campana})` : `Caso directo captado por Call Center (${agenteNombre}) vía ${plataforma}.`);

    const p = {
      id: uid('p'),
      origenTipo: 'callcenter_directo',
      origenApp,
      externalId: externalId || '',
      nombre: cleanData.nombre,
      telefono: cleanData.telefono,
      telefonoSecundario: cleanData.telefonoSecundario,
      cedula: cleanData.cedula,
      tipoCredito,
      direccion: direccion === '-' ? '' : direccion,
      negocio: negocio === '-' ? '' : negocio,
      monto: montoNum,
      plataforma,
      campana: campana === '-' ? '' : campana,
      emailGerente,
      notas: notas === '-' ? '' : notas,
      // Origin locked as Call Center Directo (distinct from street-captured Promoter leads)
      promotor_origen_id: ORIGEN_CC_ID,
      promotor_nombre: ORIGEN_CC_NOMBRE,
      sucursal_origen: sucursalDestino,
      sucursal: sucursalDestino,
      estado: 'pescado',
      creado: now(),
      actualizado: now(),
      cc: {
        agenteId: actor.id,
        agente: agenteNombre,
        intentos: 1,
        monto: montoNum,
        rubro: negocio === '-' ? '' : negocio,
        direccionVisita: direccion === '-' ? '' : direccion,
        comentarios: comentarioCC,
        calificado: now(),
        origenApp,
      },
      gerencia: null,
      gestorId: null,
      asignadoPromotorId: null,
      asignadoPromotorNombre: '',
      motivoDescarte: '',
      sheetSync: sheetRowNum
        ? { status: 'synced', sheetRow: sheetRowNum, source: origenApp, syncedAt: now(), emailAlertExpected: true, lastError: '' }
        : { status: 'pending', sheetRow: null, source: origenApp, syncedAt: null, emailAlertExpected: true, lastError: '' },
      historial: [],
    };

    const viaTxt = origenApp === 'python_callcenter'
      ? `App Python Call Center${sheetRowNum ? ` (Google Sheets fila #${sheetRowNum})` : ''}`
      : 'AlfaTrack Web (Call Center Directo)';
    log(
      p,
      actor,
      'Caso Call Center Directo creado',
      `Captado por ${agenteNombre} vía ${viaTxt} (${p.plataforma} · ${p.tipoCredito}). Enviado directamente a Gerencia de ${sucursalDestino} (${emailGerente}) para distribución.`
    );
    s.prospectos.push(p);

    const tplGer = (s.config && s.config.plantillas && s.config.plantillas.notif_cc_directo_gerente) || defaultConfig().plantillas.notif_cc_directo_gerente;
    const msgGer = fill(tplGer, vars(s, p, actor, { agente: agenteNombre }));
    const notificaciones = notificar(s, gerentesDe(s, sucursalDestino).filter((x) => x !== actor.id), msgGer, p.id);
    return { ok: true, deduplicated: false, prospecto: p, notificaciones };
  }

  // ---------- CSV Depurador & Bulk Promoter Form Importer (from NUEVOS-CLIENTE.html) ----------
  function categorizarTelefonoCSV(rawTel) {
    if (rawTel === undefined || rawTel === null) return { categoria: 'vacios', limpio: '' };
    const str = String(rawTel).trim();
    if (!str || str.toLowerCase() === 'nan' || str === '-') return { categoria: 'vacios', limpio: '' };
    if (/[a-zA-Z]/.test(str)) return { categoria: 'texto', limpio: soloDigitos(str) };
    // Check if it's purely digits or standard 8-digit with a single hyphen/space vs multiple numbers/special chars
    const dig = soloDigitos(str);
    if (/[^0-9]/.test(str)) {
      // e.g. "89624881/ 75016969" or special symbols
      const parts = str.split(/[\/,;]+/).map((x) => soloDigitos(x)).filter((x) => x.length === 8);
      return {
        categoria: 'especiales',
        limpio: parts[0] || dig,
        secundario: parts[1] || '',
        recuperable: parts.length > 0 || dig.length === 8,
      };
    }
    if (dig.length === 8) return { categoria: 'validos', limpio: dig };
    return { categoria: 'longitud', limpio: dig };
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }

  function resolverPromotorCSV(s, nombreRaw, sucursalHint, fallbackPromotor) {
    const limpio = sinAcentos(nombreRaw || '')
      .toLowerCase()
      .replace(/\b(sucursal|jinotepe|managua|esteli|masaya|rivas|juigalpa|sebaco|leon)\b/g, ' ')
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const promotores = s.usuarios.filter((u) => u.rol === 'promotor');
    if (limpio && limpio !== 'promotor de credito' && limpio !== 'promotoria' && limpio !== 'ne') {
      // 1. Exact full name match
      let m = promotores.find((u) => sinAcentos(u.nombre).toLowerCase() === limpio);
      if (m) return m;
      // 2. Prefix / substring match (e.g. "Laura v" -> "Laura Varela", "Martha lenis centeno" -> "Martha Lenis Centeno Chavarría")
      const tokens = limpio.split(/\s+/).filter((t) => t.length >= 2);
      const candidatos = sucursalHint ? promotores.filter((u) => u.sucursal === sucursalHint) : promotores;
      const pool = candidatos.length ? candidatos : promotores;
      if (tokens.length) {
        m = pool.find((u) => {
          const un = sinAcentos(u.nombre).toLowerCase();
          return tokens.every((tk) => un.includes(tk));
        });
        if (m) return m;
        // 3. Majority token match when 3+ tokens are present (e.g. "María José López" -> "Maria Jose Lopez Wilson")
        if (tokens.length >= 3) {
          m = pool.find((u) => {
            const uTokens = sinAcentos(u.nombre).toLowerCase().split(/\s+/);
            const matched = tokens.filter((tk) => uTokens.includes(tk)).length;
            return matched >= 2 && (matched >= uTokens.length - 1 || matched === tokens.length);
          });
          if (m) return m;
        }
        // 4. First token + first letter of second token (e.g. "laura v") when second token is a short prefix
        if (!tokens[1] || tokens[1].length <= 3) {
          m = pool.find((u) => {
            const uTokens = sinAcentos(u.nombre).toLowerCase().split(/\s+/);
            return uTokens[0] === tokens[0] && (!tokens[1] || (uTokens[1] && uTokens[1].startsWith(tokens[1])));
          });
          if (m) return m;
        }
        // 5. Fuzzy token match (Levenshtein distance <= 1 for 4 char tokens, <= 2 for 5+ char tokens; handles "Noelia Ñamendi" -> "amendi", "Massiel Norales" -> "morales", "Tainana/Tania jarquin" -> "tatiana")
        let best = null, bestScore = 0;
        for (const u of pool) {
          const uTokens = sinAcentos(u.nombre).toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
          let score = 0, matched = 0;
          for (const tk of tokens) {
            if (uTokens.some((ut) => ut === tk)) {
              matched++;
              score += 3;
            } else if (uTokens.some((ut) => ut.includes(tk) || (tk.length >= 6 && levenshtein(tk, ut) <= 2) || (tk.length >= 4 && levenshtein(tk, ut) <= 1))) {
              matched++;
              score += 2;
            }
          }
          if (score < 4 && uTokens.some((ut) => ut.length >= 6 && tokens.includes(ut))) {
            // Single rare surname exact match when first name has a typo (e.g. "Tania jarquin" -> "Tatiana Jarquín")
            const rareSurname = uTokens.slice(1).find((ut) => ut.length >= 6 && tokens.includes(ut));
            if (rareSurname && uTokens[0][0] === tokens[0][0] && levenshtein(tokens[0], uTokens[0]) <= 3) {
              matched = Math.max(matched, 2);
              score = Math.max(score, 4);
            }
          }
          if (matched >= Math.min(2, tokens.length) && matched / tokens.length >= 0.66 && score > bestScore) {
            best = u;
            bestScore = score;
          }
        }
        if (best) return best;
        // 6. Branch manager name entered as promoter in CSV (e.g. "Haymara Roque" -> Managua, "Jorge Solorzano" -> Juigalpa)
        const mgr = s.usuarios.find((u) => u.rol === 'gerente' && tokens.every((tk) => sinAcentos(u.nombre).toLowerCase().includes(tk)));
        if (mgr) {
          const deSucMgr = promotores.find((u) => u.sucursal === mgr.sucursal && u.activo);
          if (deSucMgr) return deSucMgr;
        }
      }
    }
    if (fallbackPromotor && fallbackPromotor.rol === 'promotor') return fallbackPromotor;
    if (sucursalHint) {
      const deSuc = promotores.find((u) => u.sucursal === sucursalHint && u.activo);
      if (deSuc) return deSuc;
    }
    return promotores.find((u) => u.activo) || promotores[0] || null;
  }

  function clasificarFilasCSV(s, filas, opts) {
    opts = opts || {};
    const categorias = {
      validos: [],
      especiales: [],
      longitud: [],
      texto: [],
      vacios: [],
      duplicadosDB: [],
      repetidosTelefono: [],
      repetidosCliente: [],
    };
    const conteoTel = {};
    const conteoCli = {};
    const vistosEnArchivo = new Set();

    (Array.isArray(filas) ? filas : []).forEach((row, idx) => {
      const cliente = String(row.Cliente ?? row.cliente ?? row.Nombre ?? row.nombre ?? '').trim();
      const rawTel = String(row.Telefono ?? row[' Telefono'] ?? row.telefono ?? row.Celular ?? '').trim();
      const rawProm = String(row.Promotor ?? row.Pomotor ?? row.promotor ?? '').trim();
      const rawValor = String(row.VALOR ?? row.Valor ?? row.Monto ?? row.monto ?? '').trim();
      const negocio = String(row.Negocio ?? row.negocio ?? row.Rubro ?? '').trim();
      const direccion = String(row.Direccion ?? row.direccion ?? '').trim();
      const tipoCredito = String(row.TipoCredito ?? row.tipo_credito ?? opts.tipoCredito ?? 'NV(NUEVO)').trim();
      const plataforma = String(row.Plataforma ?? row.plataforma ?? opts.plataforma ?? 'Cambaceo / Campo').trim();
      const cedula = String(row.Cedula ?? row.cedula ?? '').trim();

      const montoNum = Number(String(rawValor).replace(/[^0-9.]/g, '')) || 0;
      const prom = resolverPromotorCSV(s, rawProm, opts.sucursal, opts.promotorDefault);
      const infoTel = categorizarTelefonoCSV(rawTel);

      const item = {
        fila: idx + 1,
        nombre: cliente,
        telefonoOriginal: rawTel,
        telefono: infoTel.limpio,
        telefonoSecundario: infoTel.secundario || '',
        cedula,
        promotorOriginal: rawProm,
        promotorId: prom ? prom.id : '',
        promotorNombre: prom ? prom.nombre : (rawProm || 'Sin asignar'),
        sucursal: (prom && prom.sucursal) || opts.sucursal || 'Managua',
        valorOriginal: rawValor,
        monto: montoNum,
        negocio,
        direccion,
        tipoCredito,
        plataforma,
        categoria: infoTel.categoria,
      };

      if (cliente) {
        const ck = sinAcentos(cliente).toUpperCase();
        if (!conteoCli[ck]) conteoCli[ck] = { nombre: cliente, count: 0, telefonos: new Set() };
        conteoCli[ck].count++;
        if (rawTel) conteoCli[ck].telefonos.add(rawTel);
      }

      const telParaConteo = infoTel.categoria === 'validos' || (infoTel.categoria === 'especiales' && infoTel.recuperable)
        ? infoTel.limpio : '';

      if (telParaConteo && telParaConteo.length === 8) {
        if (!conteoTel[telParaConteo]) conteoTel[telParaConteo] = { count: 0, clientes: new Set() };
        conteoTel[telParaConteo].count++;
        if (cliente) conteoTel[telParaConteo].clientes.add(cliente);
      }

      if (infoTel.categoria === 'validos' || (opts.recuperarEspeciales && infoTel.categoria === 'especiales' && infoTel.recuperable)) {
        const dup = buscarDuplicado(s, infoTel.limpio, cedula);
        if (dup) {
          item.motivoDuplicado = mensajeDuplicado(dup);
          categorias.duplicadosDB.push(item);
        } else if (vistosEnArchivo.has(infoTel.limpio)) {
          item.motivoDuplicado = 'Teléfono repetido dentro del mismo archivo CSV.';
          categorias.duplicadosDB.push(item);
        } else if (cliente.length >= 3) {
          vistosEnArchivo.add(infoTel.limpio);
          categorias.validos.push(item);
        } else {
          item.motivoDuplicado = 'Nombre de cliente vacío o menor a 3 caracteres.';
          categorias.vacios.push(item);
        }
      }

      if (categorias[infoTel.categoria] && infoTel.categoria !== 'validos') {
        categorias[infoTel.categoria].push(item);
      }
    });

    categorias.repetidosTelefono = Object.keys(conteoTel)
      .filter((t) => conteoTel[t].count > 1)
      .map((t) => ({ telefono: t, repeticiones: conteoTel[t].count, clientes: Array.from(conteoTel[t].clientes).join(' / ') || 'Desconocido' }))
      .sort((a, b) => b.repeticiones - a.repeticiones);

    categorias.repetidosCliente = Object.keys(conteoCli)
      .filter((k) => conteoCli[k].count > 1)
      .map((k) => ({ nombre: conteoCli[k].nombre, repeticiones: conteoCli[k].count, telefonos: Array.from(conteoCli[k].telefonos).join(' / ') || 'Sin teléfono' }))
      .sort((a, b) => b.repeticiones - a.repeticiones);

    return categorias;
  }

  function importarFilasCSV(s, actor, filas, opts) {
    if (!actor || !actor.activo) return err('Sesión inválida.');
    opts = Object.assign({ recuperarEspeciales: true }, opts);
    if (actor.rol === 'promotor') {
      opts.promotorDefault = actor;
      opts.sucursal = actor.sucursal;
    }
    const clasif = clasificarFilasCSV(s, filas, opts);
    const importados = [];
    const errores = [];

    for (const item of clasif.validos) {
      const prom = actor.rol === 'promotor' ? actor : (user(s, item.promotorId) || resolverPromotorCSV(s, item.promotorOriginal, item.sucursal));
      if (!prom) {
        errores.push(`Fila ${item.fila}: Promotor no encontrado.`);
        continue;
      }
      const res = actor.rol === 'promotor'
        ? crearProspecto(s, prom, {
          nombre: item.nombre,
          telefono: item.telefono,
          telefonoSecundario: item.telefonoSecundario,
          cedula: item.cedula,
          tipoCredito: item.tipoCredito,
          direccion: item.direccion,
          negocio: item.negocio,
          monto: item.monto,
          plataforma: item.plataforma,
          campana: 'Importación CSV Promotor',
        })
        : capturarProspectoCallCenter(s, actor, {
          promotorOrigenId: prom.id,
          sucursal: prom.sucursal,
          nombre: item.nombre,
          telefono: item.telefono,
          telefonoSecundario: item.telefonoSecundario,
          cedula: item.cedula,
          tipoCredito: item.tipoCredito,
          direccion: item.direccion,
          negocio: item.negocio,
          monto: item.monto,
          plataforma: item.plataforma,
          campana: 'Importación CSV Promotores',
        });
      if (res.ok) importados.push(res.prospecto);
      else errores.push(`Fila ${item.fila} (${item.nombre}): ${res.error}`);
    }

    if (importados.length) {
      auditar(s, actor, 'Importación masiva CSV', `${importados.length} prospectos válidos importados con Candado de Origen (${clasif.duplicadosDB.length} duplicados omitidos).`);
    }
    return {
      ok: true,
      importados,
      omitidosDuplicados: clasif.duplicadosDB.length,
      invalidos: clasif.longitud.length + clasif.texto.length + clasif.vacios.length,
      errores,
      clasificacion: clasif,
    };
  }

  function cambiarEstado(s, actor, id, estado, d) {
    d = d || {};
    const p = prospecto(s, id);
    if (!p) return err('Prospecto no encontrado.');
    if (!ESTADOS.includes(estado)) return err('Estado inválido.');
    if (!transiciones(actor, p).includes(estado)) return err('No tiene permiso para mover este prospecto a ese estado.');
    const anterior = p.estado;
    const cfg = s.config.plantillas;
    let detalle = '';
    const avisos = [];

    if (estado === 'gestion') {
      const c = String(d.comentarios || '').trim();
      p.cc = Object.assign({}, p.cc, { agenteId: actor.id, agente: actor.nombre, ultimaGestion: c, intentos: ((p.cc && p.cc.intentos) || 0) + 1 });
      detalle = `Llamada/gestión #${p.cc.intentos}${c ? ': ' + c : ''}`;
    } else if (estado === 'pescado') {
      const monto = Number(d.monto);
      if (!(monto > 0)) return err('Confirme el monto solicitado.');
      if (!String(d.rubro || '').trim()) return err('Confirme el rubro / negocio.');
      if (!String(d.direccionVisita || '').trim()) return err('Indique la dirección exacta de visita.');
      if (!String(d.comentarios || '').trim()) return err('Agregue los comentarios de Call Center.');
      if (d.tipoCredito) p.tipoCredito = String(d.tipoCredito).trim();
      if (d.plataforma) p.plataforma = String(d.plataforma).trim();
      p.cc = Object.assign({}, p.cc, {
        agenteId: actor.id, agente: actor.nombre, monto, rubro: String(d.rubro).trim(),
        direccionVisita: String(d.direccionVisita).trim(), comentarios: String(d.comentarios).trim(), calificado: now(),
      });
      detalle = `Calificado por ${actor.nombre}. Monto C$ ${monto.toLocaleString('es-NI')}, rubro ${p.cc.rubro}, visita: ${p.cc.direccionVisita}. Comentarios: ${p.cc.comentarios}`;
    } else if (estado === 'seguimiento') {
      const instrucciones = String(d.instrucciones || '').trim();
      const esCCDirecto = esCallCenterDirecto(p);
      if (!instrucciones) {
        return err(esCCDirecto ? 'Escriba las instrucciones o plan de seguimiento.' : 'Escriba las instrucciones para el promotor.');
      }
      let gestor = null;
      if (d.gestorId) {
        gestor = user(s, d.gestorId);
        if (!gestor || gestor.rol !== 'gestor' || !gestor.activo) return err('Gestor de crédito inválido.');
      }
      let promotorAsig = null;
      if (esCCDirecto && d.asignadoPromotorId) {
        promotorAsig = user(s, d.asignadoPromotorId);
        if (!promotorAsig || promotorAsig.rol !== 'promotor' || !promotorAsig.activo) {
          return err('Promotor asignado inválido o dado de baja.');
        }
      }
      const gestorPrevio = p.gestorId;
      p.gestorId = gestor ? gestor.id : null;

      if (esCCDirecto) {
        const promPrevio = p.asignadoPromotorId || null;
        p.asignadoPromotorId = promotorAsig ? promotorAsig.id : null;
        p.asignadoPromotorNombre = promotorAsig ? promotorAsig.nombre : '';

        const responsables = [];
        if (promotorAsig) responsables.push(`Promotor ${promotorAsig.nombre}`);
        if (gestor) responsables.push(`Gestor ${gestor.nombre}`);
        const responsableLabel = responsables.length ? responsables.join(' + ') : `Gerencia directa (${actor.nombre})`;
        const tipoDistribucion = promotorAsig && gestor
          ? 'promotor_y_gestor'
          : promotorAsig
            ? 'promotor'
            : gestor
              ? 'gestor'
              : 'gerencia_directa';

        p.gerencia = {
          gerenteId: actor.id,
          gerente: actor.nombre,
          instrucciones,
          asignado: now(),
          asignadoA: responsableLabel,
          tipoDistribucion,
        };
        detalle = `Caso Call Center Directo distribuido a: ${responsableLabel}. Instrucciones: ${instrucciones}`;

        const tplAsig = cfg.notif_cc_directo_asignado || defaultConfig().plantillas.notif_cc_directo_asignado;
        if (promotorAsig && (promotorAsig.id !== promPrevio || anterior !== estado)) {
          avisos.push([[promotorAsig.id], fill(tplAsig, vars(s, p, actor))]);
        }
        if (gestor && (gestor.id !== gestorPrevio || anterior !== estado)) {
          avisos.push([[gestor.id], fill(tplAsig, vars(s, p, actor))]);
        }
        if (p.cc && p.cc.agenteId && user(s, p.cc.agenteId)) {
          const tplAg = cfg.notif_cc_directo_agente || defaultConfig().plantillas.notif_cc_directo_agente;
          avisos.push([[p.cc.agenteId], fill(tplAg, vars(s, p, actor, { estado: etiqueta(s, estado), responsable: responsableLabel }))]);
        }
      } else {
        p.gerencia = { gerenteId: actor.id, gerente: actor.nombre, instrucciones, asignado: now() };
        detalle = `Seguimiento asignado al Promotor de Origen ${p.promotor_nombre}` + (gestor ? ` con apoyo del Gestor ${gestor.nombre}` : ' (sin gestor de apoyo)') + `. Instrucciones: ${instrucciones}`;
        avisos.push([[p.promotor_origen_id], fill(cfg.notif_seguimiento_promotor, vars(s, p, actor))]);
        if (gestor && gestor.id !== gestorPrevio) avisos.push([[gestor.id], fill(cfg.notif_seguimiento_gestor, vars(s, p, actor))]);
      }
    } else if (estado === 'descartado') {
      const motivo = String(d.motivo || '').trim();
      if (!motivo) return err('El motivo de descarte es obligatorio.');
      p.motivoDescarte = motivo + (d.comentarios ? ' — ' + String(d.comentarios).trim() : '');
      detalle = `Motivo: ${p.motivoDescarte}`;
    } else if (estado === 'desembolsado') {
      if (d.monto !== undefined && d.monto !== '' && !(Number(d.monto) > 0)) return err('El monto desembolsado debe ser mayor a 0.');
      const montoFinal = Number(d.monto) || (p.cc && p.cc.monto) || p.monto;
      if (!(montoFinal > 0)) return err('Indique el monto desembolsado.');
      p.desembolso = { monto: montoFinal, fecha: now(), por: actor.nombre };
      if (esCallCenterDirecto(p)) {
        const resp = (p.gerencia && p.gerencia.asignadoA) || actor.nombre;
        detalle = `Monto desembolsado C$ ${Number(p.desembolso.monto).toLocaleString('es-NI')}. Caso Call Center Directo (atendido por ${resp}).`;
      } else {
        detalle = `Monto desembolsado C$ ${Number(p.desembolso.monto).toLocaleString('es-NI')}. Comisión para ${p.promotor_nombre}.`;
      }
    } else if (estado === 'nuevo') {
      detalle = 'Regresado a cola de Call Center.';
    }

    p.estado = estado;
    p.actualizado = now();
    const accion = anterior === estado ? `Actualizado: ${etiqueta(s, estado)}` : `${etiqueta(s, anterior)} → ${etiqueta(s, estado)}`;
    log(p, actor, accion, detalle);

    // Notify stakeholders on state transition
    if (anterior !== estado) {
      const esCCDirecto = esCallCenterDirecto(p);
      const origenReal = esCCDirecto ? null : p.promotor_origen_id;
      const agenteCC = (esCCDirecto && p.cc && p.cc.agenteId && user(s, p.cc.agenteId)) ? p.cc.agenteId : null;
      if (estado === 'gestion' && origenReal) avisos.push([[origenReal], fill(cfg.notif_gestion, vars(s, p, actor))]);
      if (estado === 'pescado') {
        if (origenReal) avisos.push([[origenReal], fill(cfg.notif_pescado_promotor, vars(s, p, actor))]);
        avisos.push([gerentesDe(s, p.sucursal), fill(esCCDirecto ? (cfg.notif_cc_directo_gerente || defaultConfig().plantillas.notif_cc_directo_gerente) : cfg.notif_pescado_gerente, vars(s, p, actor))]);
      }
      if (estado === 'desembolsado') {
        avisos.push([[origenReal, p.asignadoPromotorId, p.gestorId, agenteCC].filter(Boolean), fill(cfg.notif_desembolsado, vars(s, p, actor))]);
      }
      if (estado === 'descartado') {
        avisos.push([[origenReal, p.asignadoPromotorId, p.gestorId, agenteCC].filter(Boolean), fill(cfg.notif_descartado, vars(s, p, actor))]);
      }
      if (estado === 'nuevo' && origenReal) avisos.push([[origenReal], `Tu cliente ${p.nombre} regresó a la cola de Call Center.`]);
    }
    const notificaciones = [];
    avisos.forEach(([ids, t]) => notificaciones.push(...notificar(s, ids.filter((x) => x !== actor.id), t, p.id)));
    return { ok: true, prospecto: p, notificaciones };
  }

  function agregarNota(s, actor, id, texto) {
    const p = prospecto(s, id);
    if (!p || !puedeVer(actor, p)) return err('Sin acceso a este prospecto.');
    if (!String(texto || '').trim()) return err('La nota está vacía.');
    log(p, actor, 'Nota agregada', String(texto).trim());
    p.actualizado = now();
    return { ok: true, prospecto: p };
  }

  // Admin can edit every field EXCEPT the origin lock and the audit trail.
  function adminEditarProspecto(s, actor, id, patch) {
    if (!actor || actor.rol !== 'admin') return err('Solo el administrador puede editar prospectos.');
    const p = prospecto(s, id);
    if (!p) return err('Prospecto no encontrado.');
    if (('promotor_origen_id' in patch && patch.promotor_origen_id !== p.promotor_origen_id) ||
        ('promotor_nombre' in patch && patch.promotor_nombre !== p.promotor_nombre)) {
      return err('CANDADO DE ORIGEN: el promotor captador no se puede modificar.');
    }
    const next = Object.assign({}, p);
    CAMPOS_EDITABLES.forEach((k) => { if (k in patch) next[k] = patch[k]; });
    next.telefono = soloDigitos(next.telefono);
    next.telefonoSecundario = next.telefonoSecundario ? soloDigitos(next.telefonoSecundario) : '';
    next.monto = Number(next.monto) || 0;
    next.gestorId = next.gestorId || null;
    if (esCallCenterDirecto(p)) {
      next.asignadoPromotorId = next.asignadoPromotorId || null;
    } else {
      next.asignadoPromotorId = p.asignadoPromotorId || null;
    }
    const e = validarDatos(s, next, p.id);
    if (e) return err(e);
    if (!s.config.sucursales.includes(next.sucursal)) return err('Sucursal inválida.');
    if (next.gestorId) {
      const g = user(s, next.gestorId);
      if (!g || g.rol !== 'gestor' || (next.gestorId !== p.gestorId && !g.activo)) return err('Gestor inválido o dado de baja.');
    }
    let promAsig = null;
    if (esCallCenterDirecto(p) && next.asignadoPromotorId) {
      promAsig = user(s, next.asignadoPromotorId);
      if (!promAsig || promAsig.rol !== 'promotor' || (next.asignadoPromotorId !== p.asignadoPromotorId && !promAsig.activo)) {
        return err('Promotor asignado inválido o dado de baja.');
      }
    }
    const cambios = CAMPOS_EDITABLES.filter((k) => String(p[k] ?? '') !== String(next[k] ?? ''))
      .map((k) => `${k}: "${p[k] ?? ''}" → "${next[k] ?? ''}"`);
    if (!cambios.length) return { ok: true, prospecto: p, sinCambios: true };
    const gestorNuevo = next.gestorId && next.gestorId !== p.gestorId;
    const promNuevo = esCallCenterDirecto(p) && next.asignadoPromotorId && next.asignadoPromotorId !== p.asignadoPromotorId;
    const sucursalNueva = next.sucursal !== p.sucursal;
    CAMPOS_EDITABLES.forEach((k) => { p[k] = next[k]; });
    if (esCallCenterDirecto(p)) {
      p.asignadoPromotorNombre = promAsig ? promAsig.nombre : '';
      if (p.gerencia) {
        const gCur = p.gestorId ? user(s, p.gestorId) : null;
        const respParts = [];
        if (promAsig) respParts.push(`Promotor ${promAsig.nombre}`);
        if (gCur) respParts.push(`Gestor ${gCur.nombre}`);
        p.gerencia.asignadoA = respParts.length ? respParts.join(' + ') : `Gerencia directa (${p.gerencia.gerente || actor.nombre})`;
        p.gerencia.tipoDistribucion = promAsig && gCur ? 'promotor_y_gestor' : promAsig ? 'promotor' : gCur ? 'gestor' : 'gerencia_directa';
      }
    }
    const emailsGer = (s.config && s.config.emailsGerentes) || defaultConfig().emailsGerentes;
    if (sucursalNueva && emailsGer[p.sucursal]) p.emailGerente = emailsGer[p.sucursal];
    p.actualizado = now();
    log(p, actor, 'Editado por Administrador', cambios.join('; '));
    const notificaciones = [];
    const esCC = esCallCenterDirecto(p);
    if (gestorNuevo) {
      const tplGes = esCC
        ? (s.config.plantillas.notif_cc_directo_asignado || defaultConfig().plantillas.notif_cc_directo_asignado)
        : s.config.plantillas.notif_seguimiento_gestor;
      notificaciones.push(...notificar(s, [p.gestorId].filter((x) => x !== actor.id), fill(tplGes, vars(s, p, actor)), p.id));
    }
    if (promNuevo) {
      const tplAsig = s.config.plantillas.notif_cc_directo_asignado || defaultConfig().plantillas.notif_cc_directo_asignado;
      notificaciones.push(...notificar(s, [p.asignadoPromotorId].filter((x) => x !== actor.id), fill(tplAsig, vars(s, p, actor)), p.id));
    }
    if (sucursalNueva && (p.estado === 'pescado' || p.estado === 'seguimiento')) {
      const tplGer = esCC
        ? (s.config.plantillas.notif_cc_directo_gerente || defaultConfig().plantillas.notif_cc_directo_gerente)
        : s.config.plantillas.notif_pescado_gerente;
      const ag = (p.cc && p.cc.agente) || actor.nombre;
      notificaciones.push(...notificar(s, gerentesDe(s, p.sucursal).filter((x) => x !== actor.id), fill(tplGer, vars(s, p, actor, { agente: ag })), p.id));
    }
    return { ok: true, prospecto: p, notificaciones };
  }

  function guardarUsuario(s, actor, d) {
    if (!actor || actor.rol !== 'admin') return err('Solo el administrador gestiona usuarios.');
    const nombre = String(d.nombre || '').trim();
    if (nombre.length < 3) return err('Nombre de usuario inválido.');
    if (!ROLES[d.rol]) return err('Rol inválido.');
    if (!s.config.sucursales.includes(d.sucursal)) return err('Sucursal inválida.');

    const usados = new Set(s.usuarios.filter((x) => x.id !== d.id).map((x) => (x.username || '').toLowerCase()));
    let username = d.username !== undefined && String(d.username).trim() !== ''
      ? normUser(d.username)
      : '';
    if (username && username.length < 3) return err('El usuario (login) debe tener al menos 3 caracteres.');
    if (username && usados.has(username)) return err(`El usuario "${username}" ya está en uso.`);

    const rawPwd = d.password !== undefined ? String(d.password).trim() : '';
    if (rawPwd && rawPwd.length < 4) return err('La contraseña debe tener al menos 4 caracteres.');
    const email = d.email !== undefined ? String(d.email || '').trim() : undefined;

    if (d.id) {
      const u = user(s, d.id);
      if (!u) return err('Usuario no encontrado.');
      if (u.id === actor.id && d.rol !== 'admin') return err('No puede quitarse a sí mismo el rol de administrador.');
      const antes = `${u.nombre} (${u.username || u.id})/${u.rol}/${u.sucursal}`;
      if (!username) username = u.username || genUsername(nombre, usados);
      const nextPwd = rawPwd || u.password || genPassword(nombre);
      Object.assign(u, {
        nombre,
        rol: d.rol,
        sucursal: d.sucursal,
        username,
        password: nextPwd,
        passwordHash: rawPwd || !String(u.passwordHash || '').startsWith('scrypt$') ? makePasswordHash(nextPwd) : u.passwordHash,
        actualizado: now(),
      });
      if (email !== undefined) u.email = email;
      s.prospectos.forEach((p) => {
        if (p.promotor_origen_id === u.id) p.promotor_nombre = u.nombre;
        if (p.asignadoPromotorId === u.id) p.asignadoPromotorNombre = u.nombre;
      });
      auditar(s, actor, 'Usuario modificado', `${antes} → ${u.nombre} (${u.username})/${u.rol}/${u.sucursal}`);
      return { ok: true, usuario: u };
    }

    if (!username) username = genUsername(nombre, usados);
    const pwd = rawPwd || genPassword(nombre);
    const u = {
      id: uid('u'),
      username,
      password: pwd,
      passwordHash: makePasswordHash(pwd),
      nombre,
      rol: d.rol,
      sucursal: d.sucursal,
      email: email || '',
      activo: true,
      actualizado: now(),
    };
    s.usuarios.push(u);
    auditar(s, actor, 'Usuario creado', `${u.nombre} (usuario: ${u.username}, ${ROLES[u.rol]}, ${u.sucursal})`);
    return { ok: true, usuario: u };
  }

  function toggleUsuario(s, actor, id) {
    if (!actor || actor.rol !== 'admin') return err('Solo el administrador gestiona usuarios.');
    const u = user(s, id);
    if (!u) return err('Usuario no encontrado.');
    if (u.id === actor.id) return err('No puede darse de baja a sí mismo.');
    u.activo = !u.activo;
    u.actualizado = now();
    auditar(s, actor, u.activo ? 'Usuario reactivado' : 'Usuario dado de baja', `${u.nombre} (${u.username} · ${ROLES[u.rol]}). Sus prospectos conservan el candado de origen.`);
    return { ok: true, usuario: u };
  }

  function guardarConfig(s, actor, cfg) {
    if (!actor || actor.rol !== 'admin') return err('Solo el administrador modifica la configuración.');
    const c = JSON.parse(JSON.stringify(cfg));
    const def = defaultConfig();
    const limpiar = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim()).filter(Boolean);
    c.sucursales = limpiar(c.sucursales);
    c.motivos = limpiar(c.motivos);
    c.negocios = limpiar(c.negocios);
    c.tiposCredito = c.tiposCredito ? limpiar(c.tiposCredito) : def.tiposCredito;
    c.plataformas = c.plataformas ? limpiar(c.plataformas) : def.plataformas;
    c.emailsGerentes = Object.assign({}, def.emailsGerentes, c.emailsGerentes || {});
    if (!c.sucursales.length) return err('Debe existir al menos una sucursal.');
    if (!c.motivos.length) return err('Debe existir al menos un motivo de descarte.');
    if (!c.negocios.length) return err('Debe existir al menos un tipo de negocio.');
    if (!c.tiposCredito.length) return err('Debe existir al menos un tipo de crédito.');
    if (!c.plataformas.length) return err('Debe existir al menos una plataforma.');
    const enUso = new Set([...s.usuarios.map((u) => u.sucursal), ...s.prospectos.map((p) => p.sucursal)]);
    const faltan = [...enUso].filter((x) => !c.sucursales.includes(x));
    if (faltan.length) return err(`No puede eliminar sucursales en uso: ${faltan.join(', ')}.`);
    for (const e of ESTADOS) {
      c.estados[e] = String((c.estados && c.estados[e]) || '').trim();
      if (!c.estados[e]) return err('Ningún estado puede quedar sin nombre.');
    }
    const defTpl = def.plantillas;
    c.plantillas = c.plantillas || {};
    for (const k of Object.keys(defTpl)) {
      if (!(k in c.plantillas)) {
        c.plantillas[k] = defTpl[k];
      } else {
        c.plantillas[k] = String(c.plantillas[k] || '').trim();
        if (!c.plantillas[k]) return err(`La plantilla "${k}" no puede quedar vacía.`);
      }
    }
    s.config = c;
    auditar(s, actor, 'Configuración actualizada', 'Sucursales, estados, motivos, tipos de crédito o plantillas modificados.');
    return { ok: true };
  }

  function marcarLeidas(s, userId, id) {
    s.notificaciones.forEach((n) => { if (n.userId === userId && (!id || n.id === id)) { n.leida = true; n.toasted = true; } });
    return { ok: true };
  }

  // ---------- calendar & period metrics (America/Managua UTC-6, no DST) ----------
  const TZ_OFFSET_MS = -6 * 3600000;
  const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const diasEnMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function parseFechaClave(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > diasEnMes(y, mo)) return null;
    return { y, m: mo, d, key: `${m[1]}-${m[2]}-${m[3]}` };
  }

  function parseMesClave(str) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(str || '').trim());
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), key: `${m[1]}-${m[2]}` };
  }

  function toManaguaParts(input) {
    if (input === null || input === undefined || input === '') return null;
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
      const p = parseFechaClave(input);
      if (!p) return null;
      const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
      return { y: p.y, m: p.m, d: p.d, dow, key: p.key, mesKey: `${p.y}-${pad2(p.m)}` };
    }
    const dt = input instanceof Date ? input : new Date(input);
    const ms = dt.getTime();
    if (Number.isNaN(ms)) return null;
    const shifted = new Date(ms + TZ_OFFSET_MS);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    const dow = shifted.getUTCDay();
    return { y, m, d, dow, key: `${y}-${pad2(m)}-${pad2(d)}`, mesKey: `${y}-${pad2(m)}` };
  }

  const managuaStartMs = (y, m, d) => Date.UTC(y, m - 1, d, 6, 0, 0, 0);
  const managuaEndMs = (y, m, d) => Date.UTC(y, m - 1, d, 6, 0, 0, 0) + 86400000 - 1;
  const shiftDateParts = (y, m, d, deltaDays) => {
    const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
    const yy = dt.getUTCFullYear(), mm = dt.getUTCMonth() + 1, dd = dt.getUTCDate();
    return { y: yy, m: mm, d: dd, key: `${yy}-${pad2(mm)}-${pad2(dd)}` };
  };
  const shiftMonth = (y, m, deltaMonths) => {
    const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
    const yy = dt.getUTCFullYear(), mm = dt.getUTCMonth() + 1;
    return { y: yy, m: mm, key: `${yy}-${pad2(mm)}` };
  };
  const fmtDiaCorto = (y, m, d, conAnio) => `${pad2(d)} ${MESES_CORTO[m - 1]}${conAnio ? ' ' + y : ''}`;
  const fmtMesLargo = (y, m) => `${MESES_LARGO[m - 1]} ${y}`;

  function fechaClave(isoOrDate) {
    const p = toManaguaParts(isoOrDate);
    return p ? p.key : '';
  }

  function mesClave(isoOrDate) {
    const p = toManaguaParts(isoOrDate);
    return p ? p.mesKey : '';
  }

  function semanaClave(isoOrDate) {
    const p = toManaguaParts(isoOrDate);
    if (!p) return '';
    const diffToMon = p.dow === 0 ? -6 : 1 - p.dow;
    return shiftDateParts(p.y, p.m, p.d, diffToMon).key;
  }

  function etiquetaSemana(monKey, conAnio) {
    const mon = parseFechaClave(monKey);
    if (!mon) return monKey || '';
    const sun = shiftDateParts(mon.y, mon.m, mon.d, 6);
    const suf = conAnio ? ` ${sun.y}` : '';
    if (mon.m === sun.m) return `Sem ${pad2(mon.d)}–${pad2(sun.d)} ${MESES_CORTO[mon.m - 1]}${suf}`;
    return `Sem ${pad2(mon.d)} ${MESES_CORTO[mon.m - 1]}–${pad2(sun.d)} ${MESES_CORTO[sun.m - 1]}${suf}`;
  }

  function fechaDesembolso(p) {
    if (!p || p.estado !== 'desembolsado') return '';
    return (p.desembolso && p.desembolso.fecha) || p.actualizado || p.creado || '';
  }

  function fechaCalificado(p) {
    if (!p) return '';
    return (p.cc && p.cc.calificado) || '';
  }

  function fechaAsignado(p) {
    if (!p) return '';
    return (p.gerencia && p.gerencia.asignado) || '';
  }

  function parseTimestampMs(input) {
    if (input === null || input === undefined || input === '') return NaN;
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
      const p = parseFechaClave(input);
      return p ? managuaStartMs(p.y, p.m, p.d) : NaN;
    }
    const dt = input instanceof Date ? input : new Date(input);
    return dt.getTime();
  }

  function rangoPeriodo(opts, _skipPrev) {
    opts = opts || {};
    const tipoRaw = String(opts.tipo || 'mes').trim().toLowerCase();
    const tipo = ['hoy', 'semana', 'mes', 'mes_anterior', 'rango', 'todo'].includes(tipoRaw) ? tipoRaw : 'mes';
    const ref = toManaguaParts(opts.refDate) || toManaguaParts(clock());

    if (tipo === 'todo') {
      return {
        tipo: 'todo',
        desde: '',
        hasta: '',
        startMs: null,
        endMs: null,
        mes: '',
        esMesActual: false,
        etiqueta: 'Histórico completo',
        etiquetaCorta: 'Histórico',
        anterior: null,
      };
    }

    if (tipo === 'hoy') {
      const prev = shiftDateParts(ref.y, ref.m, ref.d, -1);
      return {
        tipo: 'hoy',
        desde: ref.key,
        hasta: ref.key,
        startMs: managuaStartMs(ref.y, ref.m, ref.d),
        endMs: managuaEndMs(ref.y, ref.m, ref.d),
        mes: ref.mesKey,
        esMesActual: false,
        etiqueta: `Hoy · ${fmtDiaCorto(ref.y, ref.m, ref.d, true)}`,
        etiquetaCorta: 'Hoy',
        anterior: _skipPrev ? null : {
          tipo: 'rango',
          desde: prev.key,
          hasta: prev.key,
          startMs: managuaStartMs(prev.y, prev.m, prev.d),
          endMs: managuaEndMs(prev.y, prev.m, prev.d),
          etiqueta: `Ayer (${fmtDiaCorto(prev.y, prev.m, prev.d)})`,
        },
      };
    }

    if (tipo === 'semana') {
      const diffToMon = ref.dow === 0 ? -6 : 1 - ref.dow;
      const mon = shiftDateParts(ref.y, ref.m, ref.d, diffToMon);
      const sun = shiftDateParts(mon.y, mon.m, mon.d, 6);
      const prevMon = shiftDateParts(mon.y, mon.m, mon.d, -7);
      const prevSun = shiftDateParts(mon.y, mon.m, mon.d, -1);
      return {
        tipo: 'semana',
        desde: mon.key,
        hasta: sun.key,
        startMs: managuaStartMs(mon.y, mon.m, mon.d),
        endMs: managuaEndMs(sun.y, sun.m, sun.d),
        mes: ref.mesKey,
        esMesActual: false,
        etiqueta: `Esta semana · ${fmtDiaCorto(mon.y, mon.m, mon.d)} – ${fmtDiaCorto(sun.y, sun.m, sun.d, true)}`,
        etiquetaCorta: 'Esta semana',
        anterior: _skipPrev ? null : {
          tipo: 'rango',
          desde: prevMon.key,
          hasta: prevSun.key,
          startMs: managuaStartMs(prevMon.y, prevMon.m, prevMon.d),
          endMs: managuaEndMs(prevSun.y, prevSun.m, prevSun.d),
          etiqueta: `Semana anterior (${fmtDiaCorto(prevMon.y, prevMon.m, prevMon.d)}–${fmtDiaCorto(prevSun.y, prevSun.m, prevSun.d)})`,
        },
      };
    }

    if (tipo === 'mes' || tipo === 'mes_anterior') {
      const parsedMes = tipo === 'mes' ? parseMesClave(opts.mes) : null;
      const target = tipo === 'mes_anterior'
        ? shiftMonth(ref.y, ref.m, -1)
        : (parsedMes || { y: ref.y, m: ref.m, key: ref.mesKey });
      const lastDay = diasEnMes(target.y, target.m);
      const desde = `${target.y}-${pad2(target.m)}-01`;
      const hasta = `${target.y}-${pad2(target.m)}-${pad2(lastDay)}`;
      const esMesActual = target.y === ref.y && target.m === ref.m;
      const prevM = shiftMonth(target.y, target.m, -1);
      const prevLast = diasEnMes(prevM.y, prevM.m);
      return {
        tipo,
        desde,
        hasta,
        startMs: managuaStartMs(target.y, target.m, 1),
        endMs: managuaEndMs(target.y, target.m, lastDay),
        mes: target.key,
        esMesActual,
        etiqueta: `${fmtMesLargo(target.y, target.m)}${esMesActual ? ' (Mes actual)' : ''}`,
        etiquetaCorta: fmtMesLargo(target.y, target.m),
        anterior: _skipPrev ? null : {
          tipo: 'mes',
          mes: prevM.key,
          desde: `${prevM.y}-${pad2(prevM.m)}-01`,
          hasta: `${prevM.y}-${pad2(prevM.m)}-${pad2(prevLast)}`,
          startMs: managuaStartMs(prevM.y, prevM.m, 1),
          endMs: managuaEndMs(prevM.y, prevM.m, prevLast),
          etiqueta: fmtMesLargo(prevM.y, prevM.m),
        },
      };
    }

    // Custom date range
    let d1 = parseFechaClave(opts.desde);
    let d2 = parseFechaClave(opts.hasta);
    if (d1 && d2 && d1.key > d2.key) {
      const tmp = d1; d1 = d2; d2 = tmp;
    }
    const startMs = d1 ? managuaStartMs(d1.y, d1.m, d1.d) : null;
    const endMs = d2 ? managuaEndMs(d2.y, d2.m, d2.d) : null;
    let anterior = null;
    if (!_skipPrev && d1 && d2) {
      const spanDays = Math.max(1, Math.round((endMs - startMs + 1) / 86400000));
      const prevEnd = shiftDateParts(d1.y, d1.m, d1.d, -1);
      const prevStart = shiftDateParts(d1.y, d1.m, d1.d, -spanDays);
      anterior = {
        tipo: 'rango',
        desde: prevStart.key,
        hasta: prevEnd.key,
        startMs: managuaStartMs(prevStart.y, prevStart.m, prevStart.d),
        endMs: managuaEndMs(prevEnd.y, prevEnd.m, prevEnd.d),
        etiqueta: `${fmtDiaCorto(prevStart.y, prevStart.m, prevStart.d)}–${fmtDiaCorto(prevEnd.y, prevEnd.m, prevEnd.d)}`,
      };
    }
    const etiqueta = d1 && d2
      ? `${fmtDiaCorto(d1.y, d1.m, d1.d, true)} – ${fmtDiaCorto(d2.y, d2.m, d2.d, true)}`
      : d1
        ? `Desde ${fmtDiaCorto(d1.y, d1.m, d1.d, true)}`
        : d2
          ? `Hasta ${fmtDiaCorto(d2.y, d2.m, d2.d, true)}`
          : 'Rango personalizado';
    return {
      tipo: 'rango',
      desde: d1 ? d1.key : '',
      hasta: d2 ? d2.key : '',
      startMs,
      endMs,
      mes: d1 && d2 && d1.key.slice(0, 7) === d2.key.slice(0, 7) ? d1.key.slice(0, 7) : '',
      esMesActual: false,
      etiqueta,
      etiquetaCorta: etiqueta,
      anterior,
    };
  }

  function enRango(iso, rango) {
    if (!rango || rango.tipo === 'todo' || (rango.startMs === null && rango.endMs === null)) return true;
    if (!iso) return false;
    const ms = parseTimestampMs(iso);
    if (Number.isNaN(ms)) return false;
    if (rango.startMs !== null && ms < rango.startMs) return false;
    if (rango.endMs !== null && ms > rango.endMs) return false;
    return true;
  }

  function filtrarPorPeriodo(prospectos, rango, opts) {
    const arr = Array.isArray(prospectos) ? prospectos : [];
    const campo = (opts && opts.campo) || 'creado';
    const sinFiltroFecha = !rango || rango.tipo === 'todo' || (rango.startMs === null && rango.endMs === null);
    if (campo === 'desembolso') {
      return arr.filter((p) => p && p.estado === 'desembolsado' && (sinFiltroFecha || enRango(fechaDesembolso(p), rango)));
    }
    if (sinFiltroFecha) return arr.slice();
    if (campo === 'operativo') {
      return arr.filter((p) => p && (
        enRango(p.creado, rango) ||
        enRango(fechaCalificado(p), rango) ||
        enRango(fechaAsignado(p), rango) ||
        (p.estado === 'desembolsado' && enRango(fechaDesembolso(p), rango))
      ));
    }
    return arr.filter((p) => p && enRango(p.creado, rango));
  }

  function pendientesAnteriores(prospectos, rango) {
    const arr = Array.isArray(prospectos) ? prospectos : [];
    if (!rango || rango.startMs === null) return [];
    return arr.filter((p) => {
      if (!p || p.estado === 'desembolsado' || p.estado === 'descartado') return false;
      const ms = parseTimestampMs(p.creado);
      return !Number.isNaN(ms) && ms < rango.startMs;
    });
  }

  function mesesDisponibles(prospectos, refDate) {
    const ref = toManaguaParts(refDate) || toManaguaParts(clock());
    const set = new Set();
    if (ref) {
      set.add(ref.mesKey);
      set.add(shiftMonth(ref.y, ref.m, -1).key);
    }
    (Array.isArray(prospectos) ? prospectos : []).forEach((p) => {
      if (!p) return;
      [p.creado, fechaCalificado(p), fechaAsignado(p), fechaDesembolso(p)].forEach((f) => {
        const mk = mesClave(f);
        if (mk) set.add(mk);
      });
    });
    return [...set].sort((a, b) => b.localeCompare(a)).map((key) => {
      const pm = parseMesClave(key);
      return { key, etiqueta: pm ? fmtMesLargo(pm.y, pm.m) : key, esActual: Boolean(ref && key === ref.mesKey) };
    });
  }

  function resolverGranularidad(rango, granularidad) {
    const g = String(granularidad || 'auto').toLowerCase();
    if (['dia', 'semana', 'mes'].includes(g)) return g;
    if (!rango || rango.tipo === 'todo') return 'mes';
    if (rango.tipo === 'hoy' || rango.tipo === 'semana' || rango.tipo === 'mes' || rango.tipo === 'mes_anterior') return 'dia';
    if (rango.startMs !== null && rango.endMs !== null) {
      const days = Math.ceil((rango.endMs - rango.startMs + 1) / 86400000);
      if (days <= 45) return 'dia';
      if (days <= 180) return 'semana';
      return 'mes';
    }
    return 'mes';
  }

  function seriesTemporales(prospectos, opts) {
    opts = opts || {};
    const arr = Array.isArray(prospectos) ? prospectos : [];
    const rango = opts.periodo
      ? (opts.periodo.startMs !== undefined ? opts.periodo : rangoPeriodo(opts.periodo))
      : rangoPeriodo({ tipo: 'todo' });
    const gran = resolverGranularidad(rango, opts.granularidad);
    const keyFn = gran === 'dia' ? fechaClave : gran === 'semana' ? semanaClave : mesClave;
    const labelFn = (k) => {
      if (gran === 'dia') {
        const p = parseFechaClave(k);
        return p ? fmtDiaCorto(p.y, p.m, p.d, false) : k;
      }
      if (gran === 'semana') return etiquetaSemana(k);
      const pm = parseMesClave(k);
      return pm ? fmtMesLargo(pm.y, pm.m) : k;
    };

    const buckets = new Map();
    const getBucket = (k) => {
      if (!k) return null;
      let b = buckets.get(k);
      if (!b) {
        b = {
          clave: k,
          etiqueta: labelFn(k),
          captados: 0,
          calificados: 0,
          seguimiento: 0,
          desembolsados: 0,
          descartados: 0,
          directosCC: 0,
          montoSolicitado: 0,
          montoDesembolsado: 0,
          conversion: 0,
        };
        buckets.set(k, b);
      }
      return b;
    };

    arr.forEach((p) => {
      if (!p) return;
      if (enRango(p.creado, rango)) {
        const b = getBucket(keyFn(p.creado));
        if (b) {
          b.captados++;
          b.montoSolicitado += Number((p.cc && p.cc.monto) || p.monto || 0);
          if (p.estado === 'seguimiento') b.seguimiento++;
          if (p.estado === 'descartado') b.descartados++;
          if (esCallCenterDirecto(p)) b.directosCC++;
        }
      }
      const fCal = fechaCalificado(p) || (esCallCenterDirecto(p) ? p.creado : '');
      if (fCal && enRango(fCal, rango)) {
        const b = getBucket(keyFn(fCal));
        if (b) b.calificados++;
      }
      if (p.estado === 'desembolsado') {
        const fDes = fechaDesembolso(p);
        if (fDes && enRango(fDes, rango)) {
          const b = getBucket(keyFn(fDes));
          if (b) {
            b.desembolsados++;
            b.montoDesembolsado += Number((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto || 0);
          }
        }
      }
    });

    const items = [...buckets.values()].sort((a, b) => a.clave.localeCompare(b.clave));
    const years = new Set(items.map((x) => String(x.clave || '').slice(0, 4)).filter(Boolean));
    const multiYear = years.size > 1;
    items.forEach((b) => {
      if (multiYear && gran === 'dia') {
        const p = parseFechaClave(b.clave);
        if (p) b.etiqueta = fmtDiaCorto(p.y, p.m, p.d, true);
      } else if (multiYear && gran === 'semana') {
        b.etiqueta = etiquetaSemana(b.clave, true);
      }
      b.conversion = b.captados ? Math.min(100, Math.round((b.desembolsados / b.captados) * 100)) : 0;
    });
    return { granularidad: gran, items };
  }

  function resumenMensual(prospectos) {
    const ser = seriesTemporales(prospectos, { periodo: rangoPeriodo({ tipo: 'todo' }), granularidad: 'mes' });
    return ser.items.slice().reverse();
  }

  function metricas(s, opts) {
    opts = opts || {};
    const baseList = Array.isArray(opts.prospectos) ? opts.prospectos : ((s && s.prospectos) || []);
    const rango = opts.periodo
      ? (opts.periodo.startMs !== undefined ? opts.periodo : rangoPeriodo(opts.periodo))
      : rangoPeriodo({ tipo: 'todo' });

    const captadosList = filtrarPorPeriodo(baseList, rango, { campo: 'creado' });
    const desembolsadosList = filtrarPorPeriodo(baseList, rango, { campo: 'desembolso' });

    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
    const porSucursal = {};
    const porPromotor = {};
    const porGestor = {};
    const porAgenteCC = {};
    const porTipoCredito = {};
    const porPlataforma = {};
    const ccDirecto = {
      total: 0,
      porEstado: Object.fromEntries(ESTADOS.map((e) => [e, 0])),
      sinDistribuir: 0,
      distribuidos: 0,
      desembolsados: 0,
      descartados: 0,
      montoDesembolsado: 0,
      sincronizadosSheet: 0,
      pendientesSheet: 0,
      porSucursal: {},
      porAgente: {},
    };

    const ensureSuc = (suc) => (porSucursal[suc] = porSucursal[suc] || { total: 0, desembolsado: 0, monto: 0 });
    const ensureProm = (p) => {
      const uOrig = s && s.usuarios ? user(s, p.promotor_origen_id) : null;
      const sucOrig = p.sucursal_origen || (uOrig && uOrig.sucursal) || p.sucursal;
      return (porPromotor[p.promotor_origen_id] = porPromotor[p.promotor_origen_id] || { nombre: p.promotor_nombre, sucursal: sucOrig, total: 0, desembolsado: 0, monto: 0 });
    };
    const ensureGes = (gestorId, fallbackSuc) => {
      if (!gestorId) return null;
      const uG = s && s.usuarios ? user(s, gestorId) : null;
      return (porGestor[gestorId] = porGestor[gestorId] || { nombre: uG ? uG.nombre : gestorId, sucursal: (uG && uG.sucursal) || fallbackSuc || '', total: 0, desembolsado: 0, monto: 0 });
    };
    const ensureAgCC = (agNombre) => (porAgenteCC[agNombre] = porAgenteCC[agNombre] || { nombre: agNombre, gestionados: 0, pescados: 0, directos: 0, desembolsados: 0, descartados: 0, monto: 0, _seen: new Set() });

    let calificados = 0;
    let montoSolicitado = 0;

    // 1. Captación & Pipeline within the selected period
    captadosList.forEach((p) => {
      porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
      const tc = p.tipoCredito || 'NV(NUEVO)';
      porTipoCredito[tc] = (porTipoCredito[tc] || 0) + 1;
      const pl = p.plataforma || 'Cambaceo / Campo';
      porPlataforma[pl] = (porPlataforma[pl] || 0) + 1;
      montoSolicitado += Number((p.cc && p.cc.monto) || p.monto || 0);

      const ps = ensureSuc(p.sucursal);
      ps.total++;

      if (p.gestorId) {
        const pg = ensureGes(p.gestorId, p.sucursal);
        if (pg) pg.total++;
      }

      if (esCallCenterDirecto(p)) {
        ccDirecto.total++;
        ccDirecto.porEstado[p.estado] = (ccDirecto.porEstado[p.estado] || 0) + 1;
        if (p.estado === 'pescado') ccDirecto.sinDistribuir++;
        if (p.gerencia || p.asignadoPromotorId || p.gestorId) ccDirecto.distribuidos++;
        if (p.estado === 'descartado') ccDirecto.descartados++;
        if (p.sheetSync && p.sheetSync.status === 'synced') ccDirecto.sincronizadosSheet++;
        else ccDirecto.pendientesSheet++;

        const cs = (ccDirecto.porSucursal[p.sucursal] = ccDirecto.porSucursal[p.sucursal] || { total: 0, pendientes: 0, seguimiento: 0, desembolsado: 0, descartado: 0, monto: 0 });
        cs.total++;
        if (p.estado === 'pescado') cs.pendientes++;
        if (p.estado === 'seguimiento') cs.seguimiento++;
        if (p.estado === 'descartado') cs.descartado++;

        const agNombre = (p.cc && p.cc.agente) || 'Call Center';
        const ca = (ccDirecto.porAgente[agNombre] = ccDirecto.porAgente[agNombre] || { nombre: agNombre, total: 0, seguimiento: 0, desembolsado: 0, descartado: 0, monto: 0 });
        ca.total++;
        if (p.estado === 'seguimiento') ca.seguimiento++;
        if (p.estado === 'descartado') ca.descartado++;

        const agc = ensureAgCC(agNombre);
        agc.directos++;
        if (!agc._seen.has(p.id)) { agc._seen.add(p.id); agc.gestionados++; }
        if (p.estado === 'descartado') agc.descartados++;
      } else {
        const pp = ensureProm(p);
        pp.total++;
        if (p.cc && p.cc.agente) {
          const agc = ensureAgCC(p.cc.agente);
          if (!agc._seen.has(p.id)) { agc._seen.add(p.id); agc.gestionados++; }
          if (p.estado === 'descartado') agc.descartados++;
        }
      }
    });

    // 2. Call Center qualification activity within the period (tracks calificados even if lead was created earlier)
    baseList.forEach((p) => {
      if (!p) return;
      const fCal = fechaCalificado(p) || (esCallCenterDirecto(p) ? p.creado : '');
      if (fCal && enRango(fCal, rango)) {
        calificados++;
        const agNombre = (p.cc && p.cc.agente) || (esCallCenterDirecto(p) ? 'Call Center' : '');
        if (agNombre) {
          const agc = ensureAgCC(agNombre);
          if (!esCallCenterDirecto(p)) agc.pescados++;
          if (!agc._seen.has(p.id)) { agc._seen.add(p.id); agc.gestionados++; }
        }
      }
    });

    // 3. Disbursements closed in the period (by desembolso.fecha so monthly placement goals are exact on the 1st)
    let desembolsados = 0;
    let montoColocado = 0;
    let desembolsosArrastre = 0;
    desembolsadosList.forEach((p) => {
      const mDes = Number((p.desembolso && p.desembolso.monto) || (p.cc && p.cc.monto) || p.monto || 0);
      desembolsados++;
      montoColocado += mDes;
      if (!enRango(p.creado, rango)) desembolsosArrastre++;

      const ps = ensureSuc(p.sucursal);
      ps.desembolsado++;
      ps.monto += mDes;

      if (p.gestorId) {
        const pg = ensureGes(p.gestorId, p.sucursal);
        if (pg) { pg.desembolsado++; pg.monto += mDes; }
      }

      if (esCallCenterDirecto(p)) {
        ccDirecto.desembolsados++;
        ccDirecto.montoDesembolsado += mDes;
        const cs = (ccDirecto.porSucursal[p.sucursal] = ccDirecto.porSucursal[p.sucursal] || { total: 0, pendientes: 0, seguimiento: 0, desembolsado: 0, descartado: 0, monto: 0 });
        cs.desembolsado++;
        cs.monto += mDes;
        const agNombre = (p.cc && p.cc.agente) || 'Call Center';
        const ca = (ccDirecto.porAgente[agNombre] = ccDirecto.porAgente[agNombre] || { nombre: agNombre, total: 0, seguimiento: 0, desembolsado: 0, descartado: 0, monto: 0 });
        ca.desembolsado++;
        ca.monto += mDes;
        const agc = ensureAgCC(agNombre);
        agc.desembolsados++;
        agc.monto += mDes;
      } else {
        const pp = ensureProm(p);
        pp.desembolsado++;
        pp.monto += mDes;
        if (p.cc && p.cc.agente) {
          const agc = ensureAgCC(p.cc.agente);
          agc.desembolsados++;
          agc.monto += mDes;
        }
      }
    });

    Object.values(porAgenteCC).forEach((x) => { delete x._seen; });

    const total = captadosList.length;
    const conversion = total ? Math.round((porEstado.desembolsado / total) * 100) : 0;
    const tasaCierrePeriodo = total ? Math.min(100, Math.round((desembolsados / total) * 100)) : 0;

    let comparativo = null;
    if (opts.incluirComparativo && rango.anterior) {
      const prev = metricas(s, { prospectos: baseList, periodo: rango.anterior, incluirComparativo: false });
      comparativo = {
        etiqueta: rango.anterior.etiqueta,
        total: prev.total,
        calificados: prev.calificados,
        desembolsados: prev.desembolsados,
        montoColocado: prev.montoColocado,
        descartados: prev.porEstado.descartado || 0,
        deltaTotal: total - prev.total,
        deltaCalificados: calificados - prev.calificados,
        deltaDesembolsados: desembolsados - prev.desembolsados,
        deltaMonto: montoColocado - prev.montoColocado,
      };
    }

    const res = {
      total,
      calificados,
      desembolsados,
      desembolsosArrastre,
      montoSolicitado,
      montoColocado,
      porEstado,
      porSucursal,
      porPromotor,
      porGestor,
      porAgenteCC,
      porTipoCredito,
      porPlataforma,
      callCenterDirecto: ccDirecto,
      conversion,
      tasaCierrePeriodo,
      periodo: rango,
      comparativo,
    };
    if (opts.granularidad) {
      res.series = seriesTemporales(baseList, { periodo: rango, granularidad: opts.granularidad });
    }
    return res;
  }

  // ---------- seed ----------
  function seed() {
    const s = { version: 1, officialPromotersV2: true, realRosterV3: true, realRosterV4: true, config: defaultConfig(), usuarios: [], prospectos: [], notificaciones: [], auditoria: [] };
    const usados = new Set();
    const U = (id, nombre, rol, sucursal, username, password, email, cedula) => {
      const uname = username ? normUser(username) : genUsername(nombre, usados);
      usados.add(uname);
      const pwd = password || genPassword(uname);
      const u = {
        id,
        username: uname,
        password: pwd,
        passwordHash: hashPwd(pwd),
        nombre,
        rol,
        sucursal,
        email: email || '',
        cedula: cedula || '',
        activo: true,
        actualizado: now(),
      };
      s.usuarios.push(u);
      return u;
    };

    // 1. ADMINISTRADOR GENERAL (1 — Casa Matriz)
    const admin = U('u-admin', 'Enrique José Castillo Sobalvarro', 'admin', 'Casa Matriz', 'admin', 'admin123', 'alfacreditenrique@gmail.com', '161-280698-1001F');

    // 2. AGENTES DE CALL CENTER (3 — Casa Matriz · Cartilla Oficial RRHH)
    const cc1 = U('u-cc-betsy', 'Betsy Mabell Ruíz Herrera', 'callcenter', 'Casa Matriz', 'betsy.ruiz', 'betsy123', 'betsy.callcenter@alfacreditsa.com', '321-220493-1000N');
    const cc2 = U('u-cc-xochil', 'Xochil María Torrez Silva', 'callcenter', 'Casa Matriz', 'xochil.torrez', 'xochil123', 'xochil.callcenter@alfacreditsa.com', '441-050800-1005A');
    const cc3 = U('u-cc-eva', 'Eva Nerys Sevilla Rivera', 'callcenter', 'Casa Matriz', 'eva.sevilla', 'eva123', 'eva.callcenter@alfacreditsa.com', '241-040383-1000F');

    // 3. GERENTES DE SUCURSAL (8 — 1 por sucursal operativa · Cartilla Oficial RRHH + Mildred en Sébaco)
    const ger = {};
    [
      ['u-ger-esteli', 'Estelí', 'Lester Antonio Blandón Herrera', 'gerente.esteli', 'esteli123', 'gerenteesteli7@gmail.com', '441-300881-0016P'],
      ['u-ger-jinotepe', 'Jinotepe', 'Rodrigo José Berríos Rojas', 'gerente.jinotepe', 'jinotepe123', 'gerentejinotepe@gmail.com', '041-290681-0003D'],
      ['u-ger-juigalpa', 'Juigalpa', 'Jorge Luis Solórzano Fernández', 'gerente.juigalpa', 'juigalpa123', 'gerentejuigalpa@gmail.com', '121-160791-0004U'],
      ['u-ger-leon', 'León', 'Julio Antonio Pérez Herrera', 'gerente.leon', 'leon123', 'gerenteleon8@gmail.com', '281-270483-0004A'],
      ['u-ger-managua', 'Managua', 'Claudia Lorena Cano García', 'gerente.managua', 'managua123', 'gerentemanaguabolonia@gmail.com', '201-141279-0001B'],
      ['u-ger-masaya', 'Masaya', 'Mary Cruz Cruz Matute', 'gerente.masaya', 'masaya123', 'gerentemasaya25@gmail.com', '401-240392-0005B'],
      ['u-ger-rivas', 'Rivas', 'Rosmery Argentina López Herrera', 'gerente.rivas', 'rivas123', 'gerenterivas1@gmail.com', '561-290195-0005Q'],
      ['u-ger-sebaco', 'Sébaco', 'Mildred Castillo', 'gerente.sebaco', 'sebaco123', 'gerentesebaco@gmail.com', ''],
    ].forEach(([id, suc, n, u, p, em, ced]) => { ger[suc] = U(id, n, 'gerente', suc, u, p, em, ced); });

    // 4. PROMOTORES DE CRÉDITO (13 — 12 Promotores + Araceli Juárez en León · Cartilla Oficial RRHH)
    const pro = {
      jinotepe: U('u-pro-jin-nydia', 'Nydia Yessenia Sánchez Pérez', 'promotor', 'Jinotepe', 'nydia.sanchez', 'nydia123', '', '401-200183-0007F'),
      juigalpa: U('u-pro-jui-martha', 'Martha Lenys Centeno Chavarría', 'promotor', 'Juigalpa', 'martha.centeno', 'martha123', '', '604-240686-0000D'),
      leon: U('u-pro-leo-araceli', 'Araceli De Jesús Juárez', 'promotor', 'León', 'araceli.juarez', 'araceli123', '', '084-251276-0000F'),
      leonLorena: U('u-pro-leo-lorena', 'Lorena Mercedes Castillo Torres', 'promotor', 'León', 'lorena.castillo', 'lorena123', '', '281-020785-0005F'),
      managua: U('u-pro-mga-lester', 'Lester Antonio De La Rocha Rivera', 'promotor', 'Managua', 'lester.rocha', 'lester123', '', '001-241180-0017A'),
      managuaMarjorie: U('u-pro-mga-marjorie', 'Marjorie de los Angeles Díaz Reyes', 'promotor', 'Managua', 'marjorie.diaz', 'marjorie123', '', '561-021090-0001N'),
      managuaWendy: U('u-pro-mga-wendy', 'Wendy Nohemí Pérez Cruz', 'promotor', 'Managua', 'wendy.perez', 'wendy123', '', '003-030695-0001H'),
      managuaClaudia: U('u-pro-mga-claudia', 'Claudia Cecilia Suazo Muñoz', 'promotor', 'Managua', 'claudia.suazo', 'claudia123', '', '001-070785-0030Y'),
      masaya: U('u-pro-mas-fanny', 'Fanny Del Carmen Ramírez López', 'promotor', 'Masaya', 'fanny.ramirez', 'fanny123', '', '001-080381-0070Q'),
      masayaYeiling: U('u-pro-mas-yeiling', 'Yeiling Patricia Pérez Muñoz', 'promotor', 'Masaya', 'yeiling.perez', 'yeiling123', '', '401-110995-0004U'),
      masayaNoelia: U('u-pro-mas-noelia', 'Noelia Sylvana Ñamendi Contreras', 'promotor', 'Masaya', 'noelia.namendi', 'noelia123', '', '401-100794-0000F'),
      sebaco: U('u-pro-seb-evelia', 'Evelia del Rosario Díaz Mendoza', 'promotor', 'Sébaco', 'evelia.diaz', 'evelia123', '', '441-141275-0015M'),
      sebacoJiurem: U('u-pro-seb-jiurem', 'Jiurem Taniuska Luna Torres', 'promotor', 'Sébaco', 'jiurem.luna', 'jiurem123', '', '449-190293-0001J'),
    };

    // 5. OFICIALES / GESTORES DE CRÉDITO (54 — 43 Oficiales de Crédito + 6 Supervisores + 5 Oficiales de Desembolso · Cartilla Oficial RRHH)
    const ges = {};
    [
      // Estelí (8: 7 Oficiales + 1 Supervisor)
      ['u-ges-est-ali', 'Alí René Castellón Romero', 'Estelí', 'ali.castellon', 'ali123', '161-010382-0010M'],
      ['u-ges-est-jonathan', 'Jonathan Andrés Castillo Rocha', 'Estelí', 'jonathan.castillo', 'jonathan123', '161-070598-1005H'],
      ['u-ges-est-monica', 'Mónica María Betanco Morales', 'Estelí', 'monica.betanco', 'monica123', '161-041295-0007D'],
      ['u-ges-est-jeyson', 'Jeyson Ernesto Talavera Galeano', 'Estelí', 'jeyson.talavera', 'jeyson123', '161-170997-1004K'],
      ['u-ges-est-luis', 'Luis Fernando Montenegro Talavera', 'Estelí', 'luis.montenegro', 'luis123', '161-190303-1003K'],
      ['u-ges-est-kairo', 'Kairo Josué Espinoza Acevedo', 'Estelí', 'kairo.espinoza', 'kairo123', '161-100603-1007P'],
      ['u-ges-est-jaime', 'Jaime Enmanuel Vindel Pérez', 'Estelí', 'jaime.vindel', 'jaime123', '164-260998-1000W'],
      ['u-ges-est-janhson', 'Janhson Ariel Picado Castillo', 'Estelí', 'janhson.picado', 'janhson123', '441-070303-1003D'],
      // Jinotepe (5: 4 Oficiales + 1 Oficial de Desembolso)
      ['u-ges-jin-berman', 'Berman Leonel Baltodano Nicoya', 'Jinotepe', 'berman.baltodano', 'berman123', '042-110491-0000L'],
      ['u-ges-jin-jefferson', 'Jefferson Ariel Vivas Cortes', 'Jinotepe', 'jefferson.vivas', 'jefferson123', '202-170194-0001W'],
      ['u-ges-jin-mario', 'Mario José López Narváez', 'Jinotepe', 'mario.lopez', 'mario123', '041-070583-0001L'],
      ['u-ges-jin-naun', 'Naun Oronte Toruño Calero', 'Jinotepe', 'naun.toruno', 'naun123', '409-141290-0000H'],
      ['u-ges-jin-larry', 'Larry Alexander Bermúdez Jiménez', 'Jinotepe', 'larry.bermudez', 'larry123', '046-230394-0000J'],
      // Juigalpa (6: 4 Oficiales + 1 Supervisor + 1 Oficial de Desembolso)
      ['u-ges-jui-oscar', 'Oscar Gabriel Silva Díaz', 'Juigalpa', 'oscar.silva', 'oscar123', '121-041293-0002N'],
      ['u-ges-jui-melvin', 'Melvin Yamil Andino Guevara', 'Juigalpa', 'melvin.andino', 'melvin123', '121-190504-1008C'],
      ['u-ges-jui-adonis', 'Adonis Antonio Requénez Gaitán', 'Juigalpa', 'adonis.requenez', 'adonis123', '121-140999-1005X'],
      ['u-ges-jui-loaring', 'Loaring Esnayder Urbina Sándigo', 'Juigalpa', 'loaring.urbina', 'loaring123', '121-091001-1004A'],
      ['u-ges-jui-lesther', 'Lesther David Báez Martínez', 'Juigalpa', 'lesther.baez', 'lesther123', '121-281083-0012S'],
      ['u-ges-jui-wilmer', 'Wilmer Antonio Soza Cruz', 'Juigalpa', 'wilmer.soza', 'wilmer123', '121-140991-0002B'],
      // León (5: 4 Oficiales + 1 Supervisor)
      ['u-ges-leo-laleska', 'Laleska Fernanda Bucardo Morales', 'León', 'laleska.bucardo', 'laleska123', '281-260799-1005T'],
      ['u-ges-leo-leonidas', 'Leonidas José Urcuyo Quintero', 'León', 'leonidas.urcuyo', 'leonidas123', '281-300192-0015A'],
      ['u-ges-leo-juan', 'Juan Fernando Salinas Baldizón', 'León', 'juan.salinas', 'juan123', '281-240676-0013E'],
      ['u-ges-leo-jaqueline', 'Jaqueline del Carmen Soza Acosta', 'León', 'jaqueline.soza', 'jaqueline123', '281-041185-0014V'],
      ['u-ges-leo-darvis', 'Darvis Ivanis Pérez Armas', 'León', 'darvis.perez', 'darvis123', '281-240979-0013H'],
      // Managua (11: 9 Oficiales + 1 Supervisor + 1 Oficial de Desembolso)
      ['u-ges-mga-justin', 'Justin Azael Calderón Peña', 'Managua', 'justin.calderon', 'justin123', '001-250707-1051W'],
      ['u-ges-mga-jamilton', 'Jamilton Rodolfo Montenegro Moraga', 'Managua', 'jamilton.montenegro', 'jamilton123', '001-191187-0000H'],
      ['u-ges-mga-douglas', 'Douglas Tomás Rivas Miranda', 'Managua', 'douglas.rivas', 'douglas123', '001-100192-0019R'],
      ['u-ges-mga-carlos', 'Carlos Daniel Salinas Rayo', 'Managua', 'carlos.salinas', 'carlos123', '241-220102-1005C'],
      ['u-ges-mga-luis', 'Luis Antonio Méndez Solano', 'Managua', 'luis.mendez', 'luis123', '001-231200-1055G'],
      ['u-ges-mga-oscar', 'Oscar Danilo Aguilar Sánchez', 'Managua', 'oscar.aguilar', 'oscar123', '001-090877-0033G'],
      ['u-ges-mga-jairo', 'Jairo Esaan Picado Ruiz', 'Managua', 'jairo.picado', 'jairo123', '001-190973-0044T'],
      ['u-ges-mga-danny', 'Danny Johanci García Gutiérrez', 'Managua', 'danny.garcia', 'danny123', '001-200102-1046T'],
      ['u-ges-mga-jorge', 'Jorge Ariel Rodríguez Cabrera', 'Managua', 'jorge.rodriguez', 'jorge123', '001-220594-0017F'],
      ['u-ges-mga-elvis', 'Elvis Ernesto Castillo', 'Managua', 'elvis.castillo', 'elvis123', '001-080388-0020X'],
      ['u-ges-mga-alvaro', 'Álvaro Antonio Mora Lacayo', 'Managua', 'alvaro.mora', 'alvaro123', '001-210586-0062V'],
      // Masaya (7: 5 Oficiales + 2 Oficiales de Desembolso)
      ['u-ges-mas-pedro', 'Pedro José Góngora Martínez', 'Masaya', 'pedro.gongora', 'pedro123', '401-311289-0005R'],
      ['u-ges-mas-diego', 'Diego Armando Mendoza Ugarte', 'Masaya', 'diego.mendoza', 'diego123', '601-280694-0000R'],
      ['u-ges-mas-gerson', 'Gerson Misael Bermúdez Díaz', 'Masaya', 'gerson.bermudez', 'gerson123', '401-260490-0001T'],
      ['u-ges-mas-ramon', 'Ramón Olegario Poveda Salgado', 'Masaya', 'ramon.poveda', 'ramon123', '403-290696-0000P'],
      ['u-ges-mas-jonathan', 'Jonathan Alejandro Méndez Navarro', 'Masaya', 'jonathan.mendez', 'jonathan123', '201-110985-0003U'],
      ['u-ges-mas-julio', 'Julio César Madriz Martínez', 'Masaya', 'julio.madriz', 'julio123', '401-151297-1005A'],
      ['u-ges-mas-danny', 'Danny Valentín Zúñiga Pérez', 'Masaya', 'danny.zuniga', 'danny123', '401-140298-1007E'],
      // Rivas (6: 5 Oficiales + 1 Supervisor)
      ['u-ges-riv-luis', 'Luis Enrique Solís Solís', 'Rivas', 'luis.solis', 'luis123', '561-130695-0003L'],
      ['u-ges-riv-wendy', 'Wendy Patricia López Pérez', 'Rivas', 'wendy.lopez', 'wendy123', '561-170304-1000D'],
      ['u-ges-riv-eduardo', 'Eduardo José Rosales García', 'Rivas', 'eduardo.rosales', 'eduardo123', '561-230603-1001S'],
      ['u-ges-riv-alvaro', 'Alvaro Wuesly Ulloa Hernández', 'Rivas', 'alvaro.ulloa', 'alvaro123', '561-071092-0005S'],
      ['u-ges-riv-junior', 'Junior Condega Meza', 'Rivas', 'junior.condega', 'junior123', '569-170802-1003P'],
      ['u-ges-riv-ana', 'Ana Patricia Hernández Bonilla', 'Rivas', 'ana.hernandez', 'ana123', '561-140989-0003Q'],
      // Sébaco (6: 5 Oficiales + 1 Supervisor)
      ['u-ges-seb-jorge', 'Jorge Luis Pérez García', 'Sébaco', 'jorge.perez', 'jorge123', '523-280590-0000A'],
      ['u-ges-seb-horacio', 'Horacio Javier Vallejos Tórrez', 'Sébaco', 'horacio.vallejos', 'horacio123', '441-070994-0002K'],
      ['u-ges-seb-asbell', 'Asbell Eleazar Martínez Alarcón', 'Sébaco', 'asbell.martinez', 'asbell123', '161-141003-1003U'],
      ['u-ges-seb-jairo', 'Jairo Rappaccioli Martínez', 'Sébaco', 'jairo.rappaccioli', 'jairo123', '441-180581-0009L'],
      ['u-ges-seb-einar', 'Einar Josep Orozco Balmaceda', 'Sébaco', 'einar.orozco', 'einar123', '441-200802-1005W'],
      ['u-ges-seb-yuri', 'Yuri Cristel Herrera Arteta', 'Sébaco', 'yuri.herrera', 'yuri123', '241-211096-1002U'],
    ].forEach(([id, n, suc, u, p, ced]) => { ges[id] = U(id, n, 'gestor', suc, u, p, '', ced); });

    const base = Date.now();
    let t = 0;
    const at = (diasAtras, horas) => { setClock(() => new Date(base - diasAtras * 864e5 + (horas || 0) * 36e5 + (t++) * 6e4)); };
    const mk = (dias, p, d) => { at(dias); const r = crearProspecto(s, p, d); if (!r.ok) throw new Error(r.error); return r.prospecto.id; };
    const mv = (dias, h, a, id, e, d) => { at(dias, h); const r = cambiarEstado(s, a, id, e, d); if (!r.ok) throw new Error(r.error); };

    try {
      // 1. Nuevo
      mk(0.2, pro.managua, { nombre: 'Juana María Rodríguez', telefono: '8845-1122', cedula: '001-150385-0002K', tipoCredito: 'NV(NUEVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Bolonia, de la iglesia 2c al norte', negocio: 'Pulpería', monto: 15000, notas: 'Quiere ampliar inventario para diciembre.' });
      mk(0.1, pro.masayaNoelia, { nombre: 'Francisco Javier Ortiz', telefono: '8712-3344', tipoCredito: 'RP(REPRESTAMO)', plataforma: 'Whatsapp', direccion: 'Barrio Santa Ana, Masaya', negocio: 'Transporte', monto: 40000, notas: 'Taxista, quiere reparar motor.' });
      mk(1, pro.jinotepe, { nombre: 'Rosa Elena Calero', telefono: '5788-9900', tipoCredito: 'NV(NUEVO)', plataforma: 'Facebook', direccion: 'Barrio San Antonio, Jinotepe', negocio: 'Venta de ropa', monto: 12000, notas: 'Vende ropa americana en el mercado.' });
      // 2. En gestión
      const g1 = mk(2, pro.managuaClaudia, { nombre: 'Pedro Antonio Martínez', telefono: '8456-7788', cedula: '001-210478-0011B', tipoCredito: 'RC(REC.INACTIVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Monseñor Lezcano, casa 45', negocio: 'Taller', monto: 30000, notas: 'Taller de soldadura.' });
      mv(2, 3, cc1, g1, 'gestion', { comentarios: 'No contestó primera llamada, se deja mensaje por WhatsApp.' });
      const g2 = mk(3, pro.sebaco, { nombre: 'Martha Lorena Úbeda', telefono: '8321-4455', tipoCredito: 'NV(NUEVO)', plataforma: 'Recomendación', direccion: 'Comarca Chagüitillo, Sébaco', negocio: 'Agricultura', monto: 25000, notas: 'Siembra de cebolla.' });
      mv(3, 2, cc2, g2, 'gestion', { comentarios: 'Pide que la llamen el viernes después de las 3 pm.' });
      // 3. Pescado
      const p1 = mk(4, pro.masaya, { nombre: 'Ana Gabriela Sequeira', telefono: '8899-0011', cedula: '401-120590-0003C', tipoCredito: 'NV(NUEVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Monimbó, de la Parroquia 1c al sur', negocio: 'Comedor / Fritanga', monto: 20000, notas: 'Fritanga con 3 años de operar.' });
      mv(4, 2, cc1, p1, 'gestion', { comentarios: 'Interesada, enviará fotos del negocio.' });
      mv(3, 1, cc1, p1, 'pescado', { monto: 22000, rubro: 'Comedor / Fritanga', direccionVisita: 'Monimbó, Parroquia San Sebastián 1c al sur, portón negro', comentarios: 'Ventas diarias aprox. C$ 3,500. Tiene facturas de proveedores. Disponible por las mañanas.' });
      const p2 = mk(2, pro.leon, { nombre: 'Javier Enrique Toruño', telefono: '8777-6655', tipoCredito: 'RP(REPRESTAMO)', plataforma: 'Whatsapp', direccion: 'Barrio Sutiava, del Tamarindón 3c abajo', negocio: 'Ganadería', monto: 50000, notas: 'Engorde de 10 novillos.' });
      mv(1, 4, cc2, p2, 'pescado', { monto: 50000, rubro: 'Ganadería', direccionVisita: 'Sutiava, Tamarindón 3c abajo; finca en carretera a Poneloya km 5', comentarios: 'Tiene garantía prendaria (ganado). Cumple requisitos preliminares.' });
      // 4. En seguimiento
      const s1 = mk(7, pro.juigalpa, { nombre: 'Luisa Amanda Lacayo', telefono: '8654-3210', cedula: '121-030382-0001M', tipoCredito: 'NV(NUEVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Nuevo Amanecer, Juigalpa', negocio: 'Ganadería', monto: 60000, notas: 'Lechería artesanal.' });
      mv(6, 2, cc1, s1, 'pescado', { monto: 60000, rubro: 'Ganadería / Lácteos', direccionVisita: 'Del Museo Gregorio Aguilar 4c al este', comentarios: 'Produce 80 litros diarios, vende a quesera local.' });
      mv(5, 3, ger['Juigalpa'], s1, 'seguimiento', { gestorId: ges['u-ges-jui-oscar'].id, instrucciones: 'Martha, visitarla el jueves con Oscar para avalúo del ganado. Llevar formulario de garantía.' });
      const s2 = mk(6, pro.managuaMarjorie, { nombre: 'Carmen Isabel Flores', telefono: '8123-9876', tipoCredito: 'RC(REC.INACTIVO)', plataforma: 'Facebook', direccion: 'Mercado Oriental, tramo 120', negocio: 'Venta de ropa', monto: 18000, notas: 'Tramo propio en el mercado.' });
      mv(5, 1, cc3, s2, 'gestion', { comentarios: 'Contestó, pide información de tasas.' });
      mv(4, 2, cc3, s2, 'pescado', { monto: 18000, rubro: 'Venta de ropa', direccionVisita: 'Mercado Oriental, tramo 120, sector Ciudad Jardín', comentarios: 'Lleva 5 años en el mercado. Buena referencia.' });
      mv(3, 2, ger['Managua'], s2, 'seguimiento', { instrucciones: 'Marjorie, tú cierras este caso. Revisar recibos de alquiler del tramo.' });
      // 5. Desembolsado
      const d1 = mk(12, pro.managua, { nombre: 'José Santos Moreno', telefono: '8543-2109', cedula: '001-251170-0005P', tipoCredito: 'NV(NUEVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Bello Horizonte, Managua', negocio: 'Pulpería', monto: 25000, notas: 'Cliente recomendado.' });
      mv(11, 2, cc1, d1, 'pescado', { monto: 25000, rubro: 'Pulpería', direccionVisita: 'Bello Horizonte, de la rotonda 2c al este', comentarios: 'Negocio establecido hace 8 años.' });
      mv(10, 2, ger['Managua'], d1, 'seguimiento', { gestorId: ges['u-ges-mga-jamilton'].id, instrucciones: 'Lester lidera el cierre, Jamilton evalúa capacidad de pago.' });
      mv(8, 2, ger['Managua'], d1, 'desembolsado', { monto: 25000 });
      const d2 = mk(15, pro.masaya, { nombre: 'Esperanza del Carmen Vado', telefono: '8234-5678', tipoCredito: 'RP(REPRESTAMO)', plataforma: 'Recomendación', direccion: 'Barrio San Jerónimo, Masaya', negocio: 'Servicios', monto: 15000, notas: 'Salón de belleza.' });
      mv(14, 2, cc2, d2, 'pescado', { monto: 15000, rubro: 'Salón de belleza', direccionVisita: 'San Jerónimo, de la iglesia 1c al oeste', comentarios: 'Quiere comprar sillas y secadoras.' });
      mv(13, 2, ger['Masaya'], d2, 'seguimiento', { gestorId: ges['u-ges-mas-diego'].id, instrucciones: 'Fanny cierra, Diego evalúa.' });
      at(10); agregarNota(s, ges['u-ges-mas-diego'], d2, 'Evaluación favorable: capacidad de pago de C$ 2,800 quincenal.');
      mv(10, 3, ges['u-ges-mas-diego'], d2, 'desembolsado', { monto: 15000 });
      // 6. Descartado
      const x1 = mk(9, pro.leonLorena, { nombre: 'Mario Alberto Díaz', telefono: '8111-2233', tipoCredito: 'NV(NUEVO)', plataforma: 'Tik tok', direccion: 'Reparto Fundeci, León', negocio: 'Asalariado', monto: 35000, notas: '' });
      mv(8, 2, cc1, x1, 'gestion', { comentarios: 'Primer intento sin respuesta.' });
      mv(7, 2, cc1, x1, 'descartado', { motivo: 'No contesta', comentarios: '5 intentos en 3 días.' });
      const x2 = mk(8, pro.sebacoJiurem, { nombre: 'Yolanda Patricia Bermúdez', telefono: '8999-1234', tipoCredito: 'NV(NUEVO)', plataforma: 'Instagram', direccion: 'Barrio San Luis, Sébaco', negocio: 'Comedor / Fritanga', monto: 80000, notas: '' });
      mv(7, 3, cc3, x2, 'descartado', { motivo: 'Sin capacidad de pago', comentarios: 'Ingresos declarados no soportan el monto.' });
    } finally {
      setClock(null);
    }
    // keep a few unread so the bell shows a counter, but don't flood toasts on first open
    s.notificaciones.forEach((n) => { n.toasted = true; n.leida = Date.now() - new Date(n.ts) > 2.5 * 864e5; });
    auditar(s, admin, 'Sistema inicializado', 'Base oficial de 79 colaboradores activos (Cartilla Oficial RRHH) cargada en AlfaTrack.');
    return s;
  }

  // Unified state migration & upgrade (used by both server DB and browser client)
  function upgradeState(s, opts) {
    opts = opts || {};
    if (!s || typeof s !== 'object') return seed();
    const base = seed();
    s.version = 1;
    s.config = Object.assign({}, base.config, s.config || {});
    s.config.emailsGerentes = Object.assign({}, base.config.emailsGerentes, (s.config && s.config.emailsGerentes) || {});
    s.config.plantillas = Object.assign({}, base.config.plantillas, (s.config && s.config.plantillas) || {});
    if (!Array.isArray(s.config.tiposCredito) || !s.config.tiposCredito.length) s.config.tiposCredito = base.config.tiposCredito;
    if (!Array.isArray(s.config.plataformas) || !s.config.plataformas.length) s.config.plataformas = base.config.plataformas;

    s.usuarios = Array.isArray(s.usuarios) ? s.usuarios : [];
    const scoped = Boolean(opts.scoped || s._scoped);
    const needsRealRosterV4 = !s.realRosterV4 && !scoped;

    if (needsRealRosterV4) {
      // One-time cleanup: replace legacy roster with the verified 79-person real HR roster,
      // preserving custom passwords already configured on matching user IDs.
      const prevById = new Map(s.usuarios.map((u) => [u.id, u]));
      s.usuarios = base.usuarios.map((bu) => {
        const clone = JSON.parse(JSON.stringify(bu));
        const prev = prevById.get(bu.id);
        if (prev && prev.password && prev.password !== bu.password) {
          clone.password = prev.password;
          clone.passwordHash = prev.passwordHash || hashPwd(prev.password);
        }
        return clone;
      });
    }

    const byId = new Map(s.usuarios.map((u) => [u.id, u]));
    const usedUsernames = new Set(s.usuarios.map((u) => (u.username || '').toLowerCase()).filter(Boolean));

    for (const u of s.usuarios) {
      const seedMatch = base.usuarios.find((bu) => bu.id === u.id);
      if (!u.username) {
        u.username = (seedMatch && !usedUsernames.has(seedMatch.username))
          ? seedMatch.username
          : genUsername(u.nombre, usedUsernames);
        usedUsernames.add(u.username);
      }
      if (!scoped) {
        if (!u.password) {
          u.password = (seedMatch && seedMatch.password) || (u.id === 'u-admin' ? 'admin123' : genPassword(u.username));
        }
        if (!u.passwordHash) u.passwordHash = hashPwd(u.password);
      }
      if (u.email === undefined && seedMatch) u.email = seedMatch.email || '';
      if (u.cedula === undefined && seedMatch) u.cedula = seedMatch.cedula || '';
    }

    if (!scoped && !byId.has('u-admin')) {
      const adm = base.usuarios.find((bu) => bu.id === 'u-admin');
      if (adm) s.usuarios.unshift(JSON.parse(JSON.stringify(adm)));
    }

    s.prospectos = Array.isArray(s.prospectos) ? s.prospectos : (scoped ? [] : base.prospectos);
    if (needsRealRosterV4) {
      s.prospectos.forEach((p) => {
        const uOrig = byId.get(p.promotor_origen_id);
        if (uOrig) p.promotor_nombre = uOrig.nombre;
      });
    }
    s.officialPromotersV2 = true;
    s.realRosterV3 = true;
    s.realRosterV4 = true;
    s.notificaciones = Array.isArray(s.notificaciones) ? s.notificaciones : (scoped ? [] : base.notificaciones);
    s.auditoria = Array.isArray(s.auditoria) ? s.auditoria : (scoped ? [] : base.auditoria);
    return s;
  }

  return {
    ROLES, ESTADOS, PASO, ORIGEN_CC_ID, ORIGEN_CC_NOMBRE, CAMPOS_EDITABLES, TZ_OFFSET_MS, setClock, defaultConfig, soloDigitos, normCedula, validarTelefono, fill,
    sinAcentos, normUser, esCallCenterDirecto, limpiarTelefonoCC, parseMonto, normalizarSucursal, sucursalParaSheet,
    hashPwd, hashPwdScrypt, makePasswordHash, verifyPwd, genUsername, genPassword, autenticar, cambiarPassword,
    puedeVer, visibles, transiciones, buscarDuplicado, mensajeDuplicado, crearProspecto, capturarProspectoCallCenter, capturarCasoCallCenterDirecto,
    categorizarTelefonoCSV, resolverPromotorCSV, clasificarFilasCSV, importarFilasCSV,
    cambiarEstado, agregarNota, adminEditarProspecto, guardarUsuario, toggleUsuario, guardarConfig, marcarLeidas,
    fechaClave, mesClave, semanaClave, fechaDesembolso, fechaCalificado, fechaAsignado, rangoPeriodo, enRango, filtrarPorPeriodo, pendientesAnteriores, mesesDisponibles, seriesTemporales, resumenMensual,
    metricas, gerentesDe, seed, upgradeState,
  };
});
