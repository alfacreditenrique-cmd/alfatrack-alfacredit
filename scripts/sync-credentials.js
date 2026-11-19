'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');
const DB = require('../db.js');

async function main() {
  const s = Core.seed();

  const pad = (str, len) => String(str || '').padEnd(len, ' ');
  const admins = s.usuarios.filter((u) => u.rol === 'admin');
  const ccs = s.usuarios.filter((u) => u.rol === 'callcenter');
  const gers = s.usuarios.filter((u) => u.rol === 'gerente');
  const pros = s.usuarios.filter((u) => u.rol === 'promotor');
  const gess = s.usuarios.filter((u) => u.rol === 'gestor');

  let txt = '';
  txt += '=================================================================================================================\r\n';
  txt += `   CREDENCIALES OFICIALES DE ACCESO — ALFATRACK (ALFACREDIT S.A.) · CARTILLA REAL (${s.usuarios.length} COLABORADORES)\r\n`;
  txt += '=================================================================================================================\r\n';
  txt += 'Fecha de Cartilla Oficial             : 17 de noviembre de 2026 (Solo personal real activo)\r\n';
  txt += 'URL Permanente en Producción (Vercel) : https://alfatrack-alfacredit.vercel.app\r\n';
  txt += 'URL Permanente Corta (Vercel)         : https://alfatrack.vercel.app\r\n';
  txt += 'Gestor Web Base de Datos Turso Cloud  : https://alfatrack-alfacredit.vercel.app/turso\r\n';
  txt += 'URL Servidor Local                    : http://localhost:8765\r\n';
  txt += 'Motor de Base de Datos en la Nube     : Turso Cloud SQLite (AWS us-east-2 · baseinventario)\r\n';
  txt += '=================================================================================================================\r\n\r\n';

  const sectionTxt = (title, list, includeEmail) => {
    txt += `${title} (${list.length})\r\n`;
    txt += '-----------------------------------------------------------------------------------------------------------------\r\n';
    txt += pad('SUCURSAL', 12) + ' | ' + pad('CÉDULA', 17) + ' | ' + pad('NOMBRE COMPLETO', 38) + ' | ' + pad('USUARIO (LOGIN)', 20) + ' | ' + pad('CONTRASEÑA', 13) + (includeEmail ? ' | CORREO' : '') + '\r\n';
    txt += '-----------------------------------------------------------------------------------------------------------------\r\n';
    list.forEach((u) => {
      txt += pad(u.sucursal, 12) + ' | ' + pad(u.cedula || '—', 17) + ' | ' + pad(u.nombre, 38) + ' | ' + pad(u.username, 20) + ' | ' + pad(u.password, 13) + (includeEmail ? ' | ' + (u.email || '—') : '') + '\r\n';
    });
    txt += '\r\n';
  };

  sectionTxt('1. ADMINISTRADOR GENERAL (CONTROL TOTAL Y GESTOR DE BASE DE DATOS)', admins, true);
  sectionTxt('2. AGENTES DE CALL CENTER', ccs, true);
  sectionTxt('3. GERENTES DE SUCURSAL', gers, true);
  sectionTxt('4. PROMOTORES DE CRÉDITO', pros, false);
  sectionTxt('5. OFICIALES / GESTORES DE CRÉDITO', gess, false);

  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'CREDENCIALES_ALFATRACK.txt'), txt, 'utf8');

  // Also update CREDENCIALES_USUARIOS.md
  let md = `# 🔐 Directorio Oficial de Usuarios y Contraseñas — AlfaTrack (AlfaCredit S.A.)\n\n`;
  md += `- **Cartilla Oficial**: Lista de Colaboradores Activos al 17/11/2026 (**${s.usuarios.length} usuarios reales**, sin cuentas demo)\n`;
  md += '- **URL Permanente en Producción (Vercel)**: [https://alfatrack-alfacredit.vercel.app](https://alfatrack-alfacredit.vercel.app) / [https://alfatrack.vercel.app](https://alfatrack.vercel.app)\n';
  md += '- **Gestor Web de Base de Datos Turso Cloud**: [https://alfatrack-alfacredit.vercel.app/turso](https://alfatrack-alfacredit.vercel.app/turso)\n';
  md += '- **Motor de Base de Datos en la Nube**: Turso Cloud SQLite (AWS us-east-2 · `baseinventario`)\n\n';

  const sectionMd = (title, list, includeEmail) => {
    md += `## ${title} (${list.length})\n\n`;
    if (includeEmail) {
      md += '| Sucursal | Cédula | Nombre Completo | Usuario (Login) | Contraseña | Correo |\n|---|---|---|---|---|---|\n';
      list.forEach((u) => {
        md += `| ${u.sucursal} | ${u.cedula || '—'} | ${u.nombre} | \`${u.username}\` | \`${u.password}\` | ${u.email || '—'} |\n`;
      });
    } else {
      md += '| Sucursal | Cédula | Nombre Completo | Usuario (Login) | Contraseña |\n|---|---|---|---|---|\n';
      list.forEach((u) => {
        md += `| ${u.sucursal} | ${u.cedula || '—'} | ${u.nombre} | \`${u.username}\` | \`${u.password}\` |\n`;
      });
    }
    md += '\n';
  };

  sectionMd('👑 Administrador General', admins, true);
  sectionMd('📞 Agentes de Call Center', ccs, true);
  sectionMd('🏢 Gerentes de Sucursal', gers, true);
  sectionMd('🏃 Promotores de Crédito', pros, false);
  sectionMd('📋 Oficiales / Gestores de Crédito', gess, false);
  fs.writeFileSync(path.join(root, 'CREDENCIALES_USUARIOS.md'), md, 'utf8');

  // Sync updated state to Turso Cloud SQLite and local store
  const rst = await DB.resetState();
  const stats = await DB.getDbStats();
  console.log('CREDENCIALES_ALFATRACK.txt generated. Turso synced:', rst.tursoSynced, 'Connected:', stats.tursoConnected, 'Users:', rst.state.usuarios.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
