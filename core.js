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
    gestor: 'Gestor de Crédito',
    admin: 'Administrador General',
  };
  const ESTADOS = ['nuevo', 'gestion', 'pescado', 'seguimiento', 'desembolsado', 'descartado'];
  const PASO = { nuevo: 1, gestion: 2, pescado: 3, seguimiento: 4, desembolsado: 5, descartado: 0 };
  const CAMPOS_EDITABLES = [
    'nombre', 'telefono', 'telefonoSecundario', 'cedula', 'tipoCredito',
    'direccion', 'negocio', 'monto', 'plataforma', 'campana', 'notas', 'sucursal', 'gestorId',
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
  }
  function notificar(s, userIds, texto, prospectoId) {
    const out = [];
    [...new Set(userIds)].filter(Boolean).forEach((userId) => {
      const n = { id: uid('n'), userId, texto, prospectoId, ts: now(), leida: false, toasted: false };
      s.notificaciones.push(n);
      out.push(n);
    });
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
    if (!u || (u.password !== pwd && u.passwordHash !== hashPwd(pwd))) {
      return err('Usuario o contraseña incorrectos.');
    }
    if (!u.activo) {
      return err('Su usuario está dado de baja. Contacte al Administrador General.');
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
      if (u.password !== actual && u.passwordHash !== hashPwd(actual)) {
        return err('La contraseña actual no es correcta.');
      }
    }
    const nueva = String(passwordNueva || '').trim();
    if (nueva.length < 4) return err('La nueva contraseña debe tener al menos 4 caracteres.');
    u.password = nueva;
    u.passwordHash = hashPwd(nueva);
    u.actualizado = now();
    auditar(s, actor, 'Contraseña actualizada', `Contraseña modificada para ${u.nombre} (${u.username}).`);
    return { ok: true, usuario: u };
  }

  // ---------- permissions ----------
  function puedeVer(actor, p) {
    if (!actor || !p) return false;
    switch (actor.rol) {
      case 'promotor': return p.promotor_origen_id === actor.id;
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

  // Allows Call Center or Admin to register a lead captured from digital platforms/forms while locking the designated origin promoter.
  function capturarProspectoCallCenter(s, actor, d) {
    if (!actor || !actor.activo || !['callcenter', 'admin', 'promotor'].includes(actor.rol)) {
      return err('No tiene permiso para capturar prospectos.');
    }
    if (actor.rol === 'promotor') return crearProspecto(s, actor, d);
    const promotor = user(s, d.promotorOrigenId);
    if (!promotor || promotor.rol !== 'promotor') return err('Seleccione el Promotor de Origen válido.');
    const e = validarDatos(s, d);
    if (e) return err(e);
    const sucursalDestino = d.sucursal && s.config.sucursales.includes(d.sucursal) ? d.sucursal : promotor.sucursal;
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
      gerencia: null, gestorId: null, motivoDescarte: '',
      historial: [],
    };
    log(p, actor, 'Prospecto creado', `Capturado por ${actor.nombre} (${ROLES[actor.rol]}). Candado de Origen asignado a ${promotor.nombre} (${promotor.sucursal}).`);
    s.prospectos.push(p);
    const notificaciones = notificar(s, [promotor.id].filter((x) => x !== actor.id), `📋 ${actor.nombre} registró a tu prospecto ${p.nombre} (${p.plataforma}) con tu Candado de Origen.`, p.id);
    return { ok: true, prospecto: p, notificaciones };
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
      if (!instrucciones) return err('Escriba las instrucciones para el promotor.');
      let gestor = null;
      if (d.gestorId) {
        gestor = user(s, d.gestorId);
        if (!gestor || gestor.rol !== 'gestor' || !gestor.activo) return err('Gestor de crédito inválido.');
      }
      const gestorPrevio = p.gestorId;
      p.gestorId = gestor ? gestor.id : null;
      p.gerencia = { gerenteId: actor.id, gerente: actor.nombre, instrucciones, asignado: now() };
      detalle = `Seguimiento asignado al Promotor de Origen ${p.promotor_nombre}` + (gestor ? ` con apoyo del Gestor ${gestor.nombre}` : ' (sin gestor de apoyo)') + `. Instrucciones: ${instrucciones}`;
      avisos.push([[p.promotor_origen_id], fill(cfg.notif_seguimiento_promotor, vars(s, p, actor))]);
      if (gestor && gestor.id !== gestorPrevio) avisos.push([[gestor.id], fill(cfg.notif_seguimiento_gestor, vars(s, p, actor))]);
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
      detalle = `Monto desembolsado C$ ${Number(p.desembolso.monto).toLocaleString('es-NI')}. Comisión para ${p.promotor_nombre}.`;
    } else if (estado === 'nuevo') {
      detalle = 'Regresado a cola de Call Center.';
    }

    p.estado = estado;
    p.actualizado = now();
    const accion = anterior === estado ? `Actualizado: ${etiqueta(s, estado)}` : `${etiqueta(s, anterior)} → ${etiqueta(s, estado)}`;
    log(p, actor, accion, detalle);

    // Promotor de origen is notified every time the stage changes.
    if (anterior !== estado) {
      if (estado === 'gestion') avisos.push([[p.promotor_origen_id], fill(cfg.notif_gestion, vars(s, p, actor))]);
      if (estado === 'pescado') {
        avisos.push([[p.promotor_origen_id], fill(cfg.notif_pescado_promotor, vars(s, p, actor))]);
        avisos.push([gerentesDe(s, p.sucursal), fill(cfg.notif_pescado_gerente, vars(s, p, actor))]);
      }
      if (estado === 'desembolsado') avisos.push([[p.promotor_origen_id, p.gestorId], fill(cfg.notif_desembolsado, vars(s, p, actor))]);
      if (estado === 'descartado') avisos.push([[p.promotor_origen_id], fill(cfg.notif_descartado, vars(s, p, actor))]);
      if (estado === 'nuevo') avisos.push([[p.promotor_origen_id], `Tu cliente ${p.nombre} regresó a la cola de Call Center.`]);
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
    const e = validarDatos(s, next, p.id);
    if (e) return err(e);
    if (!s.config.sucursales.includes(next.sucursal)) return err('Sucursal inválida.');
    if (next.gestorId) {
      const g = user(s, next.gestorId);
      if (!g || g.rol !== 'gestor' || (next.gestorId !== p.gestorId && !g.activo)) return err('Gestor inválido o dado de baja.');
    }
    const cambios = CAMPOS_EDITABLES.filter((k) => String(p[k] ?? '') !== String(next[k] ?? ''))
      .map((k) => `${k}: "${p[k] ?? ''}" → "${next[k] ?? ''}"`);
    if (!cambios.length) return { ok: true, prospecto: p, sinCambios: true };
    const gestorNuevo = next.gestorId && next.gestorId !== p.gestorId;
    const sucursalNueva = next.sucursal !== p.sucursal;
    CAMPOS_EDITABLES.forEach((k) => { p[k] = next[k]; });
    const emailsGer = (s.config && s.config.emailsGerentes) || defaultConfig().emailsGerentes;
    if (sucursalNueva && emailsGer[p.sucursal]) p.emailGerente = emailsGer[p.sucursal];
    p.actualizado = now();
    log(p, actor, 'Editado por Administrador', cambios.join('; '));
    const notificaciones = [];
    if (gestorNuevo) notificaciones.push(...notificar(s, [p.gestorId].filter((x) => x !== actor.id), fill(s.config.plantillas.notif_seguimiento_gestor, vars(s, p, actor)), p.id));
    if (sucursalNueva && (p.estado === 'pescado' || p.estado === 'seguimiento')) {
      notificaciones.push(...notificar(s, gerentesDe(s, p.sucursal).filter((x) => x !== actor.id), fill(s.config.plantillas.notif_pescado_gerente, vars(s, p, actor)), p.id));
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
        passwordHash: hashPwd(nextPwd),
        actualizado: now(),
      });
      if (email !== undefined) u.email = email;
      s.prospectos.forEach((p) => { if (p.promotor_origen_id === u.id) p.promotor_nombre = u.nombre; });
      auditar(s, actor, 'Usuario modificado', `${antes} → ${u.nombre} (${u.username})/${u.rol}/${u.sucursal}`);
      return { ok: true, usuario: u };
    }

    if (!username) username = genUsername(nombre, usados);
    const pwd = rawPwd || genPassword(nombre);
    const u = {
      id: uid('u'),
      username,
      password: pwd,
      passwordHash: hashPwd(pwd),
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
      c.plantillas[k] = String(c.plantillas[k] || '').trim();
      if (!c.plantillas[k]) return err(`La plantilla "${k}" no puede quedar vacía.`);
    }
    s.config = c;
    auditar(s, actor, 'Configuración actualizada', 'Sucursales, estados, motivos, tipos de crédito o plantillas modificados.');
    return { ok: true };
  }

  function marcarLeidas(s, userId, id) {
    s.notificaciones.forEach((n) => { if (n.userId === userId && (!id || n.id === id)) { n.leida = true; n.toasted = true; } });
    return { ok: true };
  }

  function metricas(s) {
    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
    const porSucursal = {};
    const porPromotor = {};
    const porTipoCredito = {};
    const porPlataforma = {};
    s.prospectos.forEach((p) => {
      porEstado[p.estado]++;
      const tc = p.tipoCredito || 'NV(NUEVO)';
      porTipoCredito[tc] = (porTipoCredito[tc] || 0) + 1;
      const pl = p.plataforma || 'Cambaceo / Campo';
      porPlataforma[pl] = (porPlataforma[pl] || 0) + 1;
      const ps = (porSucursal[p.sucursal] = porSucursal[p.sucursal] || { total: 0, desembolsado: 0, monto: 0 });
      ps.total++;
      const uOrig = user(s, p.promotor_origen_id);
      const sucOrig = p.sucursal_origen || (uOrig && uOrig.sucursal) || p.sucursal;
      const pp = (porPromotor[p.promotor_origen_id] = porPromotor[p.promotor_origen_id] || { nombre: p.promotor_nombre, sucursal: sucOrig, total: 0, desembolsado: 0, monto: 0 });
      pp.total++;
      if (p.estado === 'desembolsado') {
        const m = Number((p.desembolso && p.desembolso.monto) || 0);
        ps.desembolsado++; ps.monto += m; pp.desembolsado++; pp.monto += m;
      }
    });
    const total = s.prospectos.length;
    return { total, porEstado, porSucursal, porPromotor, porTipoCredito, porPlataforma, conversion: total ? Math.round((porEstado.desembolsado / total) * 100) : 0 };
  }

  // ---------- seed ----------
  function seed() {
    const s = { version: 1, officialPromotersV2: true, config: defaultConfig(), usuarios: [], prospectos: [], notificaciones: [], auditoria: [] };
    const usados = new Set();
    const U = (id, nombre, rol, sucursal, username, password, email) => {
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
        activo: true,
        actualizado: now(),
      };
      s.usuarios.push(u);
      return u;
    };

    // 1. ADMINISTRADOR GENERAL (admin / admin123)
    const admin = U('u-admin', 'Ana Lucía Zeledón (Enrique AlfaCredit)', 'admin', 'Casa Matriz', 'admin', 'admin123', 'alfacreditenrique@gmail.com');

    // 2. AGENTES DE CALL CENTER (del sistema Call Center AlfaCredit + seed base)
    const cc1 = U('u-cc1', 'Karla Mendoza', 'callcenter', 'Casa Matriz', 'karla.mendoza', 'karla123', 'callcenter1@alfacreditsa.com');
    const cc2 = U('u-cc2', 'José Ruiz', 'callcenter', 'Casa Matriz', 'jose.ruiz', 'jose123', 'callcenter2@alfacreditsa.com');
    U('u-cc-betsy', 'Betsy Ruiz', 'callcenter', 'Casa Matriz', 'betsy.ruiz', 'betsy123', 'betsy.callcenter@alfacreditsa.com');
    U('u-cc-xochilt', 'Xochilt', 'callcenter', 'Casa Matriz', 'xochilt', 'xochilt123', 'xochilt.callcenter@alfacreditsa.com');
    U('u-cc-eva', 'Eva', 'callcenter', 'Casa Matriz', 'eva', 'eva123', 'eva.callcenter@alfacreditsa.com');
    U('u-cc-cindy', 'Cindy', 'callcenter', 'Casa Matriz', 'cindy', 'cindy123', 'cindy.callcenter@alfacreditsa.com');
    U('u-cc-elena', 'Elena', 'callcenter', 'Casa Matriz', 'elena', 'elena123', 'elena.callcenter@alfacreditsa.com');

    // 3. PROMOTORES ACTUALES POR SUCURSAL (Tabla Oficial de Colaboradores Activos + IDs base)
    const pro = {
      esteli: U('u-pro-esteli', 'Carlos Rivera', 'promotor', 'Estelí', 'carlos.rivera', 'carlos123'),
      managua: U('u-pro-managua', 'Maria Jose Lopez Wilson', 'promotor', 'Managua', 'maria.lopez', 'maria123'),
      masaya: U('u-pro-masaya', 'Luis Gutiérrez', 'promotor', 'Masaya', 'luis.gutierrez', 'luis123'),
      leon: U('u-pro-leon', 'Fernanda Castillo', 'promotor', 'León', 'fernanda.castillo', 'fernanda123'),
      juigalpa: U('u-pro-juigalpa', 'Roberto Obando', 'promotor', 'Juigalpa', 'roberto.obando', 'roberto123'),
      sebaco: U('u-pro-sebaco', 'Yader Blandón', 'promotor', 'Sébaco', 'yader.blandon', 'yader123'),
      jinotepe: U('u-pro-jinotepe', 'Heysel Martínez', 'promotor', 'Jinotepe', 'heysel.martinez', 'heysel123'),
      rivas: U('u-pro-rivas', 'Kevin Sánchez', 'promotor', 'Rivas', 'kevin.sanchez', 'kevin123'),
    };
    U('u-pro-managua2', 'Darling Pérez', 'promotor', 'Managua', 'darling.perez', 'darling123');

    // Promotores Oficiales de Managua (Tabla Oficial + NUEVOC_BOLONIA.csv / NUEVOC_NORTE.csv)
    [
      ['u-pro-mga-lester', 'LESTER DE LA ROCHA', 'lester.rocha', 'lester123'],
      ['u-pro-mga-claudia', 'CLAUDIA SUAZO', 'claudia.suazo', 'claudia123'],
      ['u-pro-mga-marjorie', 'MARJORIE DE LOS ANGELES DIAZ REYES', 'marjorie.diaz', 'marjorie123'],
      ['u-pro-mga-laura', 'Laura Varela', 'laura.varela', 'laura123'],
      ['u-pro-mga-eveling', 'Eveling Mendoza', 'eveling.mendoza', 'eveling123'],
      ['u-pro-mga-cristhian', 'Cristhian Rodríguez', 'cristhian.rodriguez', 'cristhian123'],
      ['u-pro-mga-luisa', 'Luisa Guadalupe García Díaz', 'luisa.garcia', 'luisa123'],
      ['u-pro-mga-rosa', 'Rosa Mélida Cárcamo', 'rosa.carcamo', 'rosa123'],
      ['u-pro-mga-manuela', 'Manuela Amador', 'manuela.amador', 'manuela123'],
      ['u-pro-mga-carlos', 'Carlos Arauz', 'carlos.arauz', 'carlos123'],
      ['u-pro-mga-erick', 'Erick Mejía', 'erick.mejia', 'erick123'],
      ['u-pro-mga-reyna', 'Reyna Isabel Bermúdez Jarquín', 'reyna.bermudez', 'reyna123'],
      ['u-pro-mga-roy', 'Roy Herrera', 'roy.herrera', 'roy123'],
      ['u-pro-mga-yasira', 'Yasira Ruiz', 'yasira.ruiz', 'yasira123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Managua', u, p));

    // Promotores reales de NUEVOC_ESTELI.csv (Estelí)
    [
      ['u-pro-est-cristell', 'Cristell Massiel Calderón Osorio', 'cristell.calderon', 'cristell123'],
      ['u-pro-est-darling', 'Darling Elieth Galeano Rojas', 'darling.galeano', 'darling123'],
      ['u-pro-est-diana', 'Diana Carolina Fuentes Castillo', 'diana.fuentes', 'diana123'],
      ['u-pro-est-ayda', 'Ayda Padilla', 'ayda.padilla', 'ayda123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Estelí', u, p));

    // Promotores Oficiales de Masaya (Tabla Oficial + NUEVOC_MASAYA.csv)
    [
      ['u-pro-mas-fanny', 'FANNY DEL CARMEN RAMÍREZ LÓPEZ', 'fanny.ramirez', 'fanny123'],
      ['u-pro-mas-noelia', 'NOELIA SYLVANA ÑAMENDI CONTRERAS', 'noelia.namendi', 'noelia123'],
      ['u-pro-mas-yeiling', 'YEILING PATRICIA PÉREZ MUÑOZ', 'yeiling.munoz', 'yeiling123'],
      ['u-pro-mas-manuel', 'Manuel de Jesús Muñoz', 'manuel.munoz', 'manuel123'],
      ['u-pro-mas-vicenta', 'Vicenta Gaitán', 'vicenta.gaitan', 'vicenta123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Masaya', u, p));

    // Promotores Oficiales de Jinotepe (Tabla Oficial + NUEVOC_JINOTEPE.csv)
    [
      ['u-pro-jin-nidia', 'NYDIA YESSENIA SÁNCHEZ PÉREZ', 'nydia.sanchez', 'nydia123'],
      ['u-pro-jin-massiel', 'Massiel Morales', 'massiel.morales', 'massiel123'],
      ['u-pro-jin-tatiana', 'Tatiana Jarquín', 'tatiana.jarquin', 'tatiana123'],
      ['u-pro-jin-berta', 'Berta Guerrero', 'berta.guerrero', 'berta123'],
      ['u-pro-jin-eliezer', 'Eliezer Díaz', 'eliezer.diaz', 'eliezer123'],
      ['u-pro-jin-eliodoro', 'Eliodoro Hernández', 'eliodoro.hernandez', 'eliodoro123'],
      ['u-pro-jin-ernesto', 'Ernesto Miranda', 'ernesto.miranda', 'ernesto123'],
      ['u-pro-jin-jose', 'José Ramón Calero', 'jose.calero', 'jose123'],
      ['u-pro-jin-sara', 'Sara Valle', 'sara.valle', 'sara123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Jinotepe', u, p));

    // Promotores Oficiales de Juigalpa (Tabla Oficial + NUEVOC_JUIGALPA.csv)
    [
      ['u-pro-jui-martha', 'MARTHA LENYS CENTENO CHAVARRÍA', 'martha.centeno', 'martha123'],
      ['u-pro-jui-oscar', 'Oscar Gabriel Silva Díaz', 'oscar.silva', 'oscar123'],
      ['u-pro-jui-melvin', 'Melvin Yamil Andino Guevara', 'melvin.andino', 'melvin123'],
      ['u-pro-jui-adonis', 'Adonis Antonio Requénez Gaitán', 'adonis.requenez', 'adonis123'],
      ['u-pro-jui-carlos', 'Carlos Alejandro Chacón Castilla', 'carlos.chacon', 'carlos123'],
      ['u-pro-jui-nohelia', 'Nohelia María Solórzano Rodríguez', 'nohelia.solorzano', 'nohelia123'],
      ['u-pro-jui-rubelexis', 'Rubelexis Báez', 'rubelexis.baez', 'rubelexis123'],
      ['u-pro-jui-ruddi', 'Ruddi Eliezer Toledo', 'ruddi.toledo', 'ruddi123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Juigalpa', u, p));

    // Promotores reales de NUEVOC_RIVAS.csv (Rivas)
    [
      ['u-pro-riv-keyner', 'Keyner de Jesús Fajardo Víctor', 'keyner.fajardo', 'keyner123'],
      ['u-pro-riv-ernesto', 'Ernesto Miguel Gaitán', 'ernesto.gaitan', 'ernesto123'],
      ['u-pro-riv-jerry', 'Jerry José Condega', 'jerry.condega', 'jerry123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Rivas', u, p));

    // Promotores Oficiales de Sébaco (Tabla Oficial + NUEVOC_SEBACO.csv)
    [
      ['u-pro-seb-evelia', 'EVELIA DEL ROSARIO DÍAZ MENDOZA', 'evelia.diaz', 'evelia123'],
      ['u-pro-seb-jiurem', 'JIUREM TANIUSKA LUNA TORRES', 'jiurem.luna', 'jiurem123'],
      ['u-pro-seb-jorge', 'Jorge Luis Pravia', 'jorge.pravia', 'jorge123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'Sébaco', u, p));

    // Promotores Oficiales de León y Casa Matriz (Tabla Oficial)
    [
      ['u-pro-leo-araceli', 'ARACELY JUÁREZ', 'aracely.juarez', 'aracely123'],
      ['u-pro-leo-lorena', 'LORENA MERCEDES CASTILLO TORREZ', 'lorena.castillo', 'lorena123'],
      ['u-pro-leo-juan', 'Juan Salinas', 'juan.salinas', 'juan123'],
      ['u-pro-leo-laleska', 'Laleska Bucardo', 'laleska.bucardo', 'laleska123'],
    ].forEach(([id, n, u, p]) => U(id, n, 'promotor', 'León', u, p));
    U('u-pro-matriz', 'Promotor Casa Matriz', 'promotor', 'Casa Matriz', 'promotor.matriz', 'matriz123');

    // 4. GERENTES DE SUCURSAL (1 por sucursal con su correo oficial de Gerentes/app.py)
    const ger = {};
    [
      ['Casa Matriz', 'Ricardo Solórzano (Yesser García)', 'gerente.matriz', 'matriz123', 'alfacreditenrique@gmail.com'],
      ['Estelí', 'Martha Lanuza (Víctor Briones)', 'gerente.esteli', 'esteli123', 'gerenteesteli7@gmail.com'],
      ['Managua', 'Óscar Téllez (Haymara Roque)', 'gerente.managua', 'managua123', 'gerentemanaguabolonia@gmail.com'],
      ['Masaya', 'Patricia Aguirre (Enrique Páramo)', 'gerente.masaya', 'masaya123', 'gerentemasaya25@gmail.com'],
      ['Jinotepe', 'Julio Mercado (Rodrigo Berríos)', 'gerente.jinotepe', 'jinotepe123', 'gerentejinotepe@gmail.com'],
      ['Rivas', 'Silvia Espinoza (Rosmery López)', 'gerente.rivas', 'rivas123', 'gerenterivas1@gmail.com'],
      ['Juigalpa', 'Mauricio Duarte (Jorge Solórzano)', 'gerente.juigalpa', 'juigalpa123', 'gerentejuigalpa@gmail.com'],
      ['Sébaco', 'Lesbia Rugama (Mildret Castillo)', 'gerente.sebaco', 'sebaco123', 'gerentesebaco@gmail.com'],
      ['León', 'Álvaro Pallais (Charlotte Castillo)', 'gerente.leon', 'leon123', 'gerenteleon8@gmail.com'],
    ].forEach(([suc, n, u, p, em], i) => { ger[suc] = U('u-ger-' + i, n, 'gerente', suc, u, p, em); });

    // 5. GESTORES / OFICIALES DE CRÉDITO POR SUCURSAL
    const ges = {
      esteli: U('u-ges-esteli', 'Danilo Herrera', 'gestor', 'Estelí', 'danilo.herrera', 'danilo123'),
      managua: U('u-ges-managua', 'Gabriela Chamorro', 'gestor', 'Managua', 'gabriela.chamorro', 'gabriela123'),
      masaya: U('u-ges-masaya', 'Ernesto Vílchez', 'gestor', 'Masaya', 'ernesto.vilchez', 'ernesto123'),
      leon: U('u-ges-leon', 'Claudia Reyes', 'gestor', 'León', 'claudia.reyes', 'claudia123'),
      juigalpa: U('u-ges-juigalpa', 'Pedro Arróliga', 'gestor', 'Juigalpa', 'pedro.arroliga', 'pedro123'),
    };
    [
      ['u-ges-est-monica', 'Mónica Betanco', 'Estelí', 'monica.betanco', 'monica123'],
      ['u-ges-est-ali', 'Ali Castellón', 'Estelí', 'ali.castellon', 'ali123'],
      ['u-ges-est-luis', 'Luis Montenegro', 'Estelí', 'luis.montenegro', 'luis123'],
      ['u-ges-mga-jamilton', 'Jamilton', 'Managua', 'jamilton.managua', 'jamilton123'],
      ['u-ges-mga-geovanny', 'Geovanny Hernández', 'Managua', 'geovanny.hernandez', 'geovanny123'],
      ['u-ges-mas-diego', 'Diego Armando Mendoza', 'Masaya', 'diego.mendoza', 'diego123'],
      ['u-ges-mas-gerson', 'Gerson', 'Masaya', 'gerson.masaya', 'gerson123'],
      ['u-ges-jin-berman', 'Berman Leonel Baltodano', 'Jinotepe', 'berman.baltodano', 'berman123'],
      ['u-ges-jin-jefferson', 'Jefferson', 'Jinotepe', 'jefferson.jinotepe', 'jefferson123'],
      ['u-ges-riv-wendy', 'Wendy Patricia López', 'Rivas', 'wendy.lopez', 'wendy123'],
      ['u-ges-seb-donaldo', 'Donaldo José Villagra', 'Sébaco', 'donaldo.villagra', 'donaldo123'],
      ['u-ges-leo-uriel', 'Uriel Adalberto Sánchez', 'León', 'uriel.sanchez', 'uriel123'],
    ].forEach(([id, n, suc, u, p]) => U(id, n, 'gestor', suc, u, p));

    const base = Date.now();
    let t = 0;
    const at = (diasAtras, horas) => { setClock(() => new Date(base - diasAtras * 864e5 + (horas || 0) * 36e5 + (t++) * 6e4)); };
    const mk = (dias, p, d) => { at(dias); const r = crearProspecto(s, p, d); if (!r.ok) throw new Error(r.error); return r.prospecto.id; };
    const mv = (dias, h, a, id, e, d) => { at(dias, h); const r = cambiarEstado(s, a, id, e, d); if (!r.ok) throw new Error(r.error); };

    try {
      // 1. Nuevo
      mk(0.2, pro.esteli, { nombre: 'Juana María Rodríguez', telefono: '8845-1122', cedula: '161-150385-0002K', tipoCredito: 'NV(NUEVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio El Calvario, de la iglesia 2c al norte', negocio: 'Pulpería', monto: 15000, notas: 'Quiere ampliar inventario para diciembre.' });
      mk(0.1, pro.rivas, { nombre: 'Francisco Javier Ortiz', telefono: '8712-3344', tipoCredito: 'RP(REPRESTAMO)', plataforma: 'Whatsapp', direccion: 'Barrio Santa Ana, frente al parque', negocio: 'Transporte', monto: 40000, notas: 'Taxista, quiere reparar motor.' });
      mk(1, pro.jinotepe, { nombre: 'Rosa Elena Calero', telefono: '5788-9900', tipoCredito: 'NV(NUEVO)', plataforma: 'Facebook', direccion: 'Barrio San Antonio, Jinotepe', negocio: 'Venta de ropa', monto: 12000, notas: 'Vende ropa americana en el mercado.' });
      // 2. En gestión
      const g1 = mk(2, pro.managua, { nombre: 'Pedro Antonio Martínez', telefono: '8456-7788', cedula: '001-210478-0011B', tipoCredito: 'RC(REC.INACTIVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Monseñor Lezcano, casa 45', negocio: 'Taller', monto: 30000, notas: 'Taller de soldadura.' });
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
      mv(5, 3, ger['Juigalpa'], s1, 'seguimiento', { gestorId: ges.juigalpa.id, instrucciones: 'Roberto, visitarla el jueves con Pedro para avalúo del ganado. Llevar formulario de garantía.' });
      const s2 = mk(6, pro.managua, { nombre: 'Carmen Isabel Flores', telefono: '8123-9876', tipoCredito: 'RC(REC.INACTIVO)', plataforma: 'Facebook', direccion: 'Mercado Oriental, tramo 120', negocio: 'Venta de ropa', monto: 18000, notas: 'Tramo propio en el mercado.' });
      mv(5, 1, cc2, s2, 'gestion', { comentarios: 'Contestó, pide información de tasas.' });
      mv(4, 2, cc2, s2, 'pescado', { monto: 18000, rubro: 'Venta de ropa', direccionVisita: 'Mercado Oriental, tramo 120, sector Ciudad Jardín', comentarios: 'Lleva 5 años en el mercado. Buena referencia.' });
      mv(3, 2, ger['Managua'], s2, 'seguimiento', { instrucciones: 'María José, tú cierras este caso. Revisar recibos de alquiler del tramo.' });
      // 5. Desembolsado
      const d1 = mk(12, pro.esteli, { nombre: 'José Santos Moreno', telefono: '8543-2109', cedula: '161-251170-0005P', tipoCredito: 'NV(NUEVO)', plataforma: 'Cambaceo / Campo', direccion: 'Barrio Oscar Gámez, Estelí', negocio: 'Pulpería', monto: 25000, notas: 'Cliente recomendado.' });
      mv(11, 2, cc1, d1, 'pescado', { monto: 25000, rubro: 'Pulpería', direccionVisita: 'Barrio Oscar Gámez, del colegio 2c al este', comentarios: 'Negocio establecido hace 8 años.' });
      mv(10, 2, ger['Estelí'], d1, 'seguimiento', { gestorId: ges.esteli.id, instrucciones: 'Carlos lidera el cierre, Danilo evalúa capacidad de pago.' });
      mv(8, 2, ger['Estelí'], d1, 'desembolsado', { monto: 25000 });
      const d2 = mk(15, pro.masaya, { nombre: 'Esperanza del Carmen Vado', telefono: '8234-5678', tipoCredito: 'RP(REPRESTAMO)', plataforma: 'Recomendación', direccion: 'Barrio San Jerónimo, Masaya', negocio: 'Servicios', monto: 15000, notas: 'Salón de belleza.' });
      mv(14, 2, cc2, d2, 'pescado', { monto: 15000, rubro: 'Salón de belleza', direccionVisita: 'San Jerónimo, de la iglesia 1c al oeste', comentarios: 'Quiere comprar sillas y secadoras.' });
      mv(13, 2, ger['Masaya'], d2, 'seguimiento', { gestorId: ges.masaya.id, instrucciones: 'Luis cierra, Ernesto evalúa.' });
      at(10); agregarNota(s, ges.masaya, d2, 'Evaluación favorable: capacidad de pago de C$ 2,800 quincenal.');
      mv(10, 3, ges.masaya, d2, 'desembolsado', { monto: 15000 });
      // 6. Descartado
      const x1 = mk(9, pro.leon, { nombre: 'Mario Alberto Díaz', telefono: '8111-2233', tipoCredito: 'NV(NUEVO)', plataforma: 'Tik tok', direccion: 'Reparto Fundeci, León', negocio: 'Asalariado', monto: 35000, notas: '' });
      mv(8, 2, cc1, x1, 'gestion', { comentarios: 'Primer intento sin respuesta.' });
      mv(7, 2, cc1, x1, 'descartado', { motivo: 'No contesta', comentarios: '5 intentos en 3 días.' });
      const x2 = mk(8, pro.rivas, { nombre: 'Yolanda Patricia Bermúdez', telefono: '8999-1234', tipoCredito: 'NV(NUEVO)', plataforma: 'Instagram', direccion: 'San Juan del Sur, Barrio Frente Sur', negocio: 'Comedor / Fritanga', monto: 80000, notas: '' });
      mv(7, 3, cc2, x2, 'descartado', { motivo: 'Sin capacidad de pago', comentarios: 'Ingresos declarados no soportan el monto.' });
    } finally {
      setClock(null);
    }
    // keep a few unread so the bell shows a counter, but don't flood toasts on first open
    s.notificaciones.forEach((n) => { n.toasted = true; n.leida = Date.now() - new Date(n.ts) > 2.5 * 864e5; });
    auditar(s, admin, 'Sistema inicializado', 'Base de datos de usuarios, promotores actuales y prospectos cargada.');
    return s;
  }

  return {
    ROLES, ESTADOS, PASO, CAMPOS_EDITABLES, setClock, defaultConfig, soloDigitos, normCedula, validarTelefono, fill,
    sinAcentos, normUser, hashPwd, genUsername, genPassword, autenticar, cambiarPassword,
    puedeVer, visibles, transiciones, buscarDuplicado, mensajeDuplicado, crearProspecto, capturarProspectoCallCenter,
    categorizarTelefonoCSV, resolverPromotorCSV, clasificarFilasCSV, importarFilasCSV,
    cambiarEstado, agregarNota, adminEditarProspecto, guardarUsuario, toggleUsuario, guardarConfig, marcarLeidas, metricas, gerentesDe, seed,
  };
});
