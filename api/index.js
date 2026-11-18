/* AlfaTrack Unified Serverless API (Vercel /api/* + Node HTTP Server) */
'use strict';

const Core = require('../core.js');
const DB = require('../db.js');

let writeLock = Promise.resolve();
function withWriteLock(fn) {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {});
  return next;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  try {
    const parsedUrl = new URL(req.url || '/api/health', 'http://localhost');
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/api';
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    // 1. Health & DB Status
    if (pathname === '/api/health' || pathname === '/api') {
      const stats = await DB.getDbStats();
      return sendJson(res, 200, stats);
    }

    // 2. Get full synchronized state
    if (pathname === '/api/state' && method === 'GET') {
      const { state, source, latencyMs } = await DB.getState();
      return sendJson(res, 200, { ok: true, state, source, latencyMs });
    }

    // 3. Authenticate user with username & password against DB
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const { state } = await DB.getState();
      const auth = Core.autenticar(state, body.username, body.password);
      if (!auth.ok) return sendJson(res, 401, auth);
      await DB.saveState(state);
      const token = 'at_tok_' + Buffer.from(`${auth.usuario.id}:${auth.usuario.username}:${Date.now()}`).toString('base64');
      return sendJson(res, 200, {
        ok: true,
        token,
        usuario: auth.usuario,
        state,
      });
    }

    // 4. Change or reset password
    if (pathname === '/api/auth/password' && method === 'POST') {
      const body = await readBody(req);
      return withWriteLock(async () => {
        const { state } = await DB.getState();
        const actor = state.usuarios.find((u) => u.id === body.actorId);
        const r = Core.cambiarPassword(state, actor, body.targetUserId, body.passwordActual, body.passwordNueva);
        if (!r.ok) return sendJson(res, 400, r);
        await DB.saveState(state);
        return sendJson(res, 200, { ok: true, usuario: r.usuario, state });
      });
    }

    // 5. Atomic domain mutation persisted to Turso Cloud SQLite
    if (pathname === '/api/mutate' && method === 'POST') {
      const body = await readBody(req);
      return withWriteLock(async () => {
        const { action, actorId, payload } = body || {};
        const { state } = await DB.getState();
        const actor = state.usuarios.find((u) => u.id === actorId);
        let result;

        switch (action) {
          case 'crearProspecto':
            result = Core.crearProspecto(state, actor, payload || {});
            break;
          case 'capturarProspectoCallCenter':
            result = Core.capturarProspectoCallCenter(state, actor, payload || {});
            break;
          case 'importarFilasCSV':
            result = Core.importarFilasCSV(state, actor, (payload && payload.filas) || [], (payload && payload.opts) || {});
            break;
          case 'cambiarEstado':
            result = Core.cambiarEstado(state, actor, payload.id, payload.estado, payload.datos || {});
            break;
          case 'agregarNota':
            result = Core.agregarNota(state, actor, payload.id, payload.texto);
            break;
          case 'adminEditarProspecto':
            result = Core.adminEditarProspecto(state, actor, payload.id, payload.patch || {});
            break;
          case 'guardarUsuario':
            result = Core.guardarUsuario(state, actor, payload || {});
            break;
          case 'toggleUsuario':
            result = Core.toggleUsuario(state, actor, payload.id);
            break;
          case 'cambiarPassword':
            result = Core.cambiarPassword(state, actor, payload.targetUserId, payload.passwordActual, payload.passwordNueva);
            break;
          case 'guardarConfig':
            result = Core.guardarConfig(state, actor, payload.config || {});
            break;
          case 'marcarLeidas':
            result = Core.marcarLeidas(state, actorId, payload && payload.id);
            break;
          case 'reset': {
            if (!actor || actor.rol !== 'admin') {
              return sendJson(res, 403, { ok: false, error: 'Solo el administrador puede restablecer la base de datos.' });
            }
            const rst = await DB.resetState();
            return sendJson(res, 200, { ok: true, result: { ok: true }, state: rst.state });
          }
          default:
            return sendJson(res, 400, { ok: false, error: `Acción desconocida: ${action}` });
        }

        if (!result || !result.ok) {
          return sendJson(res, 400, { ok: false, error: (result && result.error) || 'Error en la operación.', result });
        }

        const syncInfo = await DB.saveState(state);
        return sendJson(res, 200, { ok: true, result, state, tursoSynced: syncInfo.tursoSynced });
      });
    }

    // 6. Full state sync from client to cloud DB
    if (pathname === '/api/sync' && method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.state || !Array.isArray(body.state.usuarios)) {
        return sendJson(res, 400, { ok: false, error: 'Estado inválido para sincronización.' });
      }
      return withWriteLock(async () => {
        const syncInfo = await DB.saveState(body.state);
        const { state } = await DB.getState();
        return sendJson(res, 200, { ok: true, state, tursoSynced: syncInfo.tursoSynced, latencyMs: syncInfo.latencyMs });
      });
    }

    // 7. Database Manager endpoints
    if (pathname === '/api/db/stats' && method === 'GET') {
      const stats = await DB.getDbStats();
      return sendJson(res, 200, stats);
    }

    if (pathname === '/api/db/table' && method === 'GET') {
      const actorId = parsedUrl.searchParams.get('actorId') || '';
      const { state } = await DB.getState();
      const actor = state.usuarios.find((u) => u.id === actorId);
      if (!actor || actor.rol !== 'admin') {
        return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General puede explorar tablas SQL.' });
      }
      const name = parsedUrl.searchParams.get('name') || 'alfatrack_usuarios';
      const limit = parsedUrl.searchParams.get('limit') || '200';
      const data = await DB.queryTable(name, limit);
      return sendJson(res, data.ok ? 200 : 400, data);
    }

    if (pathname === '/api/db/query' && method === 'POST') {
      const body = await readBody(req);
      const { state } = await DB.getState();
      const actor = state.usuarios.find((u) => u.id === body.actorId);
      if (!actor || actor.rol !== 'admin') {
        return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General puede ejecutar consultas SQL.' });
      }
      const out = await DB.runSafeSQL(body.sql);
      return sendJson(res, out.ok ? 200 : 400, out);
    }

    if (pathname === '/api/db/backup' && method === 'POST') {
      const body = await readBody(req);
      const { state } = await DB.getState();
      const actor = state.usuarios.find((u) => u.id === body.actorId);
      if (!actor || actor.rol !== 'admin') {
        return sendJson(res, 403, { ok: false, error: 'Solo el Administrador General gestiona respaldos de base de datos.' });
      }
      if (body.action === 'create') {
        const bk = await DB.createBackup(actor, body.nombre);
        const stats = await DB.getDbStats();
        return sendJson(res, 200, { ok: true, backup: bk.backup, stats });
      }
      if (body.action === 'restore') {
        const rst = await DB.restoreBackup(actor, body.backupId);
        if (!rst.ok) return sendJson(res, 400, rst);
        const stats = await DB.getDbStats();
        return sendJson(res, 200, { ok: true, state: rst.state, stats });
      }
      if (body.action === 'import') {
        if (!body.state || !Array.isArray(body.state.usuarios) || !Array.isArray(body.state.prospectos)) {
          return sendJson(res, 400, { ok: false, error: 'El archivo JSON no tiene una estructura válida de AlfaTrack.' });
        }
        await DB.createBackup(actor, 'Auto-respaldo previo a importación JSON');
        await DB.saveState(body.state);
        const { state: nextState } = await DB.getState();
        const stats = await DB.getDbStats();
        return sendJson(res, 200, { ok: true, state: nextState, stats });
      }
      return sendJson(res, 400, { ok: false, error: 'Acción de respaldo inválida.' });
    }

    return sendJson(res, 404, { ok: false, error: `Ruta API no encontrada: ${pathname}` });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message || 'Error interno del servidor' });
  }
};
