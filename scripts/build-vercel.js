/* Copies ONLY safe public PWA assets into dist/ for Vercel Git builds (and optionally .vercel/output when --prebuilt is passed). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PREBUILT = process.argv.includes('--prebuilt');

const staticFiles = [
  'index.html',
  'styles.css',
  'core.js',
  'sound.js',
  'app.js',
  'icon.svg',
  'manifest.webmanifest',
  'sw.js',
];

fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });
for (const file of staticFiles) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST_DIR, file));
}
console.log(`Built ${staticFiles.length} public PWA assets into dist/`);

if (!PREBUILT) process.exit(0);

const OUT = path.join(ROOT, '.vercel', 'output');
const STATIC_DIR = path.join(OUT, 'static');
const FUNC_DIR = path.join(OUT, 'functions', 'api', 'index.func');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(STATIC_DIR, { recursive: true });
fs.mkdirSync(FUNC_DIR, { recursive: true });

for (const file of staticFiles) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(STATIC_DIR, file));
}

// 2. Copy serverless function files into api/index.func
fs.copyFileSync(path.join(ROOT, 'core.js'), path.join(FUNC_DIR, 'core.js'));
fs.copyFileSync(path.join(ROOT, 'db.js'), path.join(FUNC_DIR, 'db.js'));

const apiCode = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8')
  .replace("require('../core.js')", "require('./core.js')")
  .replace("require('../db.js')", "require('./db.js')");

fs.writeFileSync(path.join(FUNC_DIR, 'index.js'), apiCode, 'utf8');
fs.writeFileSync(path.join(FUNC_DIR, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2), 'utf8');

fs.writeFileSync(
  path.join(FUNC_DIR, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 30,
    },
    null,
    2
  ),
  'utf8'
);

// 3. Write Build Output API v3 config.json
fs.writeFileSync(
  path.join(OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(?:/(.*))?$', dest: '/api/index' },
        { src: '^/(?:turso|db|gestor-db\\.html)$', dest: '/index.html' },
        { handle: 'filesystem' },
      ],
    },
    null,
    2
  ),
  'utf8'
);

console.log('Vercel Build Output v3 generated in .vercel/output');
