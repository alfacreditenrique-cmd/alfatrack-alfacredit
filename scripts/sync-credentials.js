'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');
const DB = require('../db.js');

async function main() {
  const s = Core.seed();

  const oficiales = [
    ['MASAYA', 'FANNY DEL CARMEN RAMÍREZ LÓPEZ', 'fanny.ramirez', 'fanny123'],
    ['MASAYA', 'NOELIA SYLVANA ÑAMENDI CONTRERAS', 'noelia.namendi', 'noelia123'],
    ['MASAYA', 'YEILING PATRICIA PÉREZ MUÑOZ', 'yeiling.munoz', 'yeiling123'],
    ['MANAGUA', 'LESTER DE LA ROCHA', 'lester.rocha', 'lester123'],
    ['MANAGUA', 'CLAUDIA SUAZO', 'claudia.suazo', 'claudia123'],
    ['MANAGUA', 'Maria Jose Lopez Wilson', 'maria.lopez', 'maria123'],
    ['MANAGUA', 'MARJORIE DE LOS ANGELES DIAZ REYES', 'marjorie.diaz', 'marjorie123'],
    ['JINOTEPE', 'NYDIA YESSENIA SÁNCHEZ PÉREZ', 'nydia.sanchez', 'nydia123'],
    ['JUIGALPA', 'MARTHA LENYS CENTENO CHAVARRÍA', 'martha.centeno', 'martha123'],
    ['LEÓN', 'ARACELY JUÁREZ', 'aracely.juarez', 'aracely123'],
    ['LEÓN', 'LORENA MERCEDES CASTILLO TORREZ', 'lorena.castillo', 'lorena123'],
    ['SÉBACO', 'EVELIA DEL ROSARIO DÍAZ MENDOZA', 'evelia.diaz', 'evelia123'],
    ['SÉBACO', 'JIUREM TANIUSKA LUNA TORRES', 'jiurem.luna', 'jiurem123'],
  ];

  const pad = (str, len) => String(str || '').padEnd(len, ' ');

  let txt = '';
  txt += '=========================================================================================\r\n';
  txt += '   CREDENCIALES OFICIALES DE ACCESO — ALFATRACK (ALFACREDIT S.A.)\r\n';
  txt += '=========================================================================================\r\n';
  txt += 'URL Permanente en Producción (Vercel) : https://alfatrack-alfacredit.vercel.app\r\n';
  txt += 'URL Permanente Corta (Vercel)         : https://alfatrack.vercel.app\r\n';
  txt += 'Gestor Web Base de Datos Turso Cloud  : https://alfatrack-alfacredit.vercel.app/turso\r\n';
  txt += 'URL Servidor Local                    : http://localhost:8765\r\n';
  txt += 'Gestor Local Base de Datos Turso      : http://localhost:8765/turso\r\n';
  txt += 'Motor de Base de Datos en la Nube     : Turso Cloud SQLite (AWS us-east-2 · baseinventario)\r\n';
  txt += '=========================================================================================\r\n\r\n';

  txt += '1. ADMINISTRADOR GENERAL (CONTROL TOTAL Y GESTOR DE BASE DE DATOS)\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  s.usuarios.filter((u) => u.rol === 'admin').forEach((u) => {
    txt += 'Nombre    : ' + u.nombre + '\r\n';
    txt += 'Sucursal  : ' + u.sucursal + '\r\n';
    txt += 'Usuario   : ' + u.username + '\r\n';
    txt += 'Contraseña: ' + u.password + '\r\n';
    txt += 'Correo    : ' + (u.email || '—') + '\r\n';
  });
  txt += '\r\n';

  txt += '2. PROMOTORES OFICIALES ACTIVOS (TABLA OFICIAL DE COLABORADORES — 13 PROMOTORES)\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  txt += pad('SUCURSAL', 12) + ' | ' + pad('COLABORADOR', 40) + ' | ' + pad('USUARIO (LOGIN)', 20) + ' | CONTRASEÑA\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  oficiales.forEach(([suc, col, usr, pwd]) => {
    txt += pad(suc, 12) + ' | ' + pad(col, 40) + ' | ' + pad(usr, 20) + ' | ' + pwd + '\r\n';
  });
  txt += '\r\n';

  txt += '3. AGENTES DE CALL CENTER (7)\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  txt += pad('SUCURSAL', 12) + ' | ' + pad('NOMBRE COMPLETO', 40) + ' | ' + pad('USUARIO (LOGIN)', 20) + ' | CONTRASEÑA\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  s.usuarios.filter((u) => u.rol === 'callcenter').forEach((u) => {
    txt += pad(u.sucursal, 12) + ' | ' + pad(u.nombre, 40) + ' | ' + pad(u.username, 20) + ' | ' + u.password + '\r\n';
  });
  txt += '\r\n';

  txt += '4. GERENTES DE SUCURSAL (9)\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  txt += pad('SUCURSAL', 12) + ' | ' + pad('NOMBRE COMPLETO', 40) + ' | ' + pad('USUARIO (LOGIN)', 20) + ' | CONTRASEÑA\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  s.usuarios.filter((u) => u.rol === 'gerente').forEach((u) => {
    txt += pad(u.sucursal, 12) + ' | ' + pad(u.nombre, 40) + ' | ' + pad(u.username, 20) + ' | ' + u.password + '\r\n';
  });
  txt += '\r\n';

  txt += '5. TODOS LOS PROMOTORES REGISTRADOS POR SUCURSAL (' + s.usuarios.filter((u) => u.rol === 'promotor').length + ')\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  txt += pad('SUCURSAL', 12) + ' | ' + pad('NOMBRE COMPLETO', 40) + ' | ' + pad('USUARIO (LOGIN)', 20) + ' | CONTRASEÑA\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  s.usuarios.filter((u) => u.rol === 'promotor').forEach((u) => {
    txt += pad(u.sucursal, 12) + ' | ' + pad(u.nombre, 40) + ' | ' + pad(u.username, 20) + ' | ' + u.password + '\r\n';
  });
  txt += '\r\n';

  txt += '6. GESTORES / OFICIALES DE CRÉDITO (' + s.usuarios.filter((u) => u.rol === 'gestor').length + ')\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  txt += pad('SUCURSAL', 12) + ' | ' + pad('NOMBRE COMPLETO', 40) + ' | ' + pad('USUARIO (LOGIN)', 20) + ' | CONTRASEÑA\r\n';
  txt += '-----------------------------------------------------------------------------------------\r\n';
  s.usuarios.filter((u) => u.rol === 'gestor').forEach((u) => {
    txt += pad(u.sucursal, 12) + ' | ' + pad(u.nombre, 40) + ' | ' + pad(u.username, 20) + ' | ' + u.password + '\r\n';
  });
  txt += '\r\n';

  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'CREDENCIALES_ALFATRACK.txt'), txt, 'utf8');

  // Also update CREDENCIALES_USUARIOS.md
  let md = '# 🔐 Directorio Oficial de Usuarios y Contraseñas — AlfaTrack (AlfaCredit S.A.)\n\n';
  md += '- **URL Permanente en Producción (Vercel)**: [https://alfatrack-alfacredit.vercel.app](https://alfatrack-alfacredit.vercel.app) / [https://alfatrack.vercel.app](https://alfatrack.vercel.app)\n';
  md += '- **Gestor Web de Base de Datos Turso Cloud**: [https://alfatrack-alfacredit.vercel.app/turso](https://alfatrack-alfacredit.vercel.app/turso)\n';
  md += '- **Motor de Base de Datos en la Nube**: Turso Cloud SQLite (AWS us-east-2 · `baseinventario`)\n\n';
  md += '## 👑 Administrador General (1)\n\n| Nombre Completo | Sucursal | Usuario (Login) | Contraseña | Correo |\n|---|---|---|---|---|\n';
  s.usuarios.filter((u) => u.rol === 'admin').forEach((u) => {
    md += `| ${u.nombre} | ${u.sucursal} | ${u.username} | ${u.password} | ${u.email || '—'} |\n`;
  });
  md += '\n## ⭐ Promotores Oficiales Activos (Tabla Oficial — 13 Colaboradores)\n\n| Sucursal | Colaborador | Usuario (Login) | Contraseña |\n|---|---|---|---|\n';
  oficiales.forEach(([suc, col, usr, pwd]) => {
    md += `| ${suc} | ${col} | ${usr} | ${pwd} |\n`;
  });
  md += '\n## 📞 Agentes de Call Center (7)\n\n| Nombre Completo | Sucursal | Usuario (Login) | Contraseña | Correo |\n|---|---|---|---|---|\n';
  s.usuarios.filter((u) => u.rol === 'callcenter').forEach((u) => {
    md += `| ${u.nombre} | ${u.sucursal} | ${u.username} | ${u.password} | ${u.email || '—'} |\n`;
  });
  md += '\n## 🏢 Gerentes de Sucursal (9)\n\n| Nombre Completo | Sucursal | Usuario (Login) | Contraseña | Correo |\n|---|---|---|---|---|\n';
  s.usuarios.filter((u) => u.rol === 'gerente').forEach((u) => {
    md += `| ${u.nombre} | ${u.sucursal} | ${u.username} | ${u.password} | ${u.email || '—'} |\n`;
  });
  md += `\n## 🏃 Todos los Promotores por Sucursal (${s.usuarios.filter((u) => u.rol === 'promotor').length})\n\n| Nombre Completo | Sucursal | Usuario (Login) | Contraseña | Correo |\n|---|---|---|---|---|\n`;
  s.usuarios.filter((u) => u.rol === 'promotor').forEach((u) => {
    md += `| ${u.nombre} | ${u.sucursal} | ${u.username} | ${u.password} | ${u.email || '—'} |\n`;
  });
  md += `\n## 📋 Gestores / Oficiales de Crédito (${s.usuarios.filter((u) => u.rol === 'gestor').length})\n\n| Nombre Completo | Sucursal | Usuario (Login) | Contraseña | Correo |\n|---|---|---|---|---|\n`;
  s.usuarios.filter((u) => u.rol === 'gestor').forEach((u) => {
    md += `| ${u.nombre} | ${u.sucursal} | ${u.username} | ${u.password} | ${u.email || '—'} |\n`;
  });
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
