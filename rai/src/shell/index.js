'use strict';
/* =============================================================================
 *  src/shell/ — shell-модули RAI
 *
 *  Файлы лежат рядом как ОБЫЧНЫЕ .sh — их удобно править, работает подсветка
 *  синтаксиса, shellcheck и bash -n. Никаких экранированных строк внутри JS.
 *
 *  Как они попадают в защищённую сборку:
 *    • при разработке   — читаются с диска (этот модуль)
 *    • при сборке       — scripts/build.js встраивает содержимое в бандл
 *    • в готовом .sh    — берутся из встроенной таблицы и материализуются
 *                         во временный каталог при первом запуске
 *
 *  Защита при этом сохраняется: содержимое скриптов входит в общий SHA-256
 *  бандла, отдельных файлов рядом с релизом нет, подменить нечего.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

/** Список модулей. Пути относительно src/shell/. */
const MODULES = [
  // общие функции и источники
  'lib/common.sh',
  'lib/sources.sh',
  'lib/sdk.sh',
  // целостность, отчёты, версии
  'lib/integrity.sh',
  'lib/report.sh',
  'lib/version.sh',
  // установка
  'install/bootstrap.sh',
  'install/sdk.sh',
  'install/rootfs.sh',
  'install/termux.sh',
  // работа с проектом
  'project/new.sh',
  'project/prepare.sh',
  'project/keystore.sh',
  // сборка APK
  'project/build-debug.sh',
  'project/build-release.sh',
  // диагностика
  'doctor/preflight.sh',
  'doctor/full.sh',
  'doctor/fixes/java-home.sh',
  'doctor/fixes/licenses.sh',
  'doctor/fixes/abi-conflict.sh',
];

/**
 * Встроенная таблица кода.
 * Пустая в исходниках; сборщик подставляет сюда содержимое всех .sh
 * при генерации бандла.
 */
let EMBEDDED = null;
function setEmbedded(table) { EMBEDDED = table; }

/** Прочитать модуль: из встроенной таблицы или с диска. */
function read(rel) {
  if (EMBEDDED && EMBEDDED[rel] !== undefined) return EMBEDDED[rel];
  const f = path.join(__dirname, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined;
}

/** Все модули объектом: { 'lib/common.sh': '<код>', ... } */
function all() {
  if (EMBEDDED) return { ...EMBEDDED };
  const out = {};
  for (const rel of MODULES) {
    const body = read(rel);
    if (body !== undefined) out[rel] = body;
  }
  return out;
}

const list = () => Object.keys(all()).sort();
const get = (rel) => read(rel);

function stats() {
  const a = all();
  const files = Object.keys(a).length;
  const bytes = Object.values(a).reduce((s, v) => s + Buffer.byteLength(v), 0);
  return { files, bytes };
}

/** Записать модули на диск (нужно при запуске собранного .sh). */
function emit(destDir) {
  const a = all();
  let n = 0;
  for (const [rel, body] of Object.entries(a)) {
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    try { fs.chmodSync(target, 0o755); } catch {}
    n++;
  }
  return n;
}

module.exports = { MODULES, all, list, get, stats, emit, setEmbedded };
