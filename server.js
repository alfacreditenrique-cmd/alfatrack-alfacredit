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

const PUBLIC_STATIC_FILES = new Set([
  '/index.html',
  '/styles.css',
  '/core.js',
  '/sound.js',
  '/app.js',
  '/icon.svg',
  '/manifest.webmanifest',
  '/sw.js',
]);

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
        return await apiHandler(req, res);
      }

      let relPath;
      try {
        relPath = decodeURIComponent(parsed.pathname);
      } catch {
        res.statusCode = 400;
        return res.end('Bad Request');
      }
      if (relPath === '/' || relPath === '' || relPath === '/turso' || relPath === '/db' || relPath === '/gestor-db.html') relPath = '/index.html';
      if (!PUBLIC_STATIC_FILES.has(relPath)) {
        res.statusCode = 403;
        return res.end('Forbidden');
      }
      const safePath = path.normalize(path.join(__dirname, relPath));
      if (!safePath.startsWith(__dirname)) {
        res.statusCode = 403;
        return res.end('Forbidden');
      }

      const ext = path.extname(safePath).toLowerCase();
      const data = fs.readFileSync(safePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
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
