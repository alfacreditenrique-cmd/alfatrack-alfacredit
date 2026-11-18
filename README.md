# AlfaTrack — Control y Seguimiento de Prospectos (AlfaCredit S.A.)

Sistema corporativo PWA mobile-first de seguimiento comercial, Candado de Origen inmutable, Depurador CSV y Gestor de Base de Datos en la Nube (**Turso Cloud SQLite**).

## Ejecutar localmente
```bash
npm start
```
Abrir `http://localhost:8765`. Cada colaborador inicia sesión exclusivamente con su usuario y contraseña para ingresar directo a su rol y sucursal.

## Arquitectura
- `core.js` — Reglas de negocio puras (autenticación con hash, Candado de Origen, duplicados, pipeline de estados, permisos por rol, depurador CSV, métricas y bitácora inmutable).
- `db.js` — Motor de persistencia híbrido sincronizado con **Turso Cloud SQLite** (`libSQL HTTP v2/pipeline`) + espejo local y puntos de restauración en la nube.
- `api/index.js` & `server.js` — API Serverless unificada (`/api/state`, `/api/auth/login`, `/api/auth/password`, `/api/mutate`, `/api/sync`, `/api/db/stats`, `/api/db/table`, `/api/db/query`, `/api/db/backup`).
- `app.js`, `styles.css`, `index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg` — Interfaz PWA por rol con Gestor de Base de Datos SQL integrado para Administración General.

## Pruebas
```bash
npm test             # Pruebas unitarias y de API (node:test)
npm run e2e          # Flujo E2E completo multi-rol en Chrome headless
```
