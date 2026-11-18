/* AlfaTrack Local Production Server (serves static PWA + /api/* backed by Turso Cloud SQLite) */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const apiHandler = require('./api/index.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function createServer() {
  return http.createServer(async (req, res) => {
    const parsed = new URL(req.url || '/', 'http://localhost');
    if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
      return apiHandler(req, res);
    }

    let relPath = decodeURIComponent(parsed.pathname);
    if (relPath === '/' || relPath === '' || relPath === '/turso' || relPath === '/db' || relPath === '/gestor-db.html') relPath = '/index.html';
    const safePath = path.normalize(path.join(__dirname, relPath));
    if (!safePath.startsWith(__dirname) || relPath.startsWith('/storage') || relPath.startsWith('/.') || /credenciales/i.test(relPath)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }

    try {
      const stat = fs.statSync(safePath);
      const filePath = stat.isDirectory() ? path.join(safePath, 'index.html') : safePath;
      const ext = path.extname(filePath).toLowerCase();
      const data = fs.readFileSync(filePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 8765;
  const srv = createServer();
  srv.listen(PORT, () => {
    console.log(`AlfaTrack Server running on http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
