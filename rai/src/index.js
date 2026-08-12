#!/usr/bin/env node
/* =============================================================================
 *  src/index.js — точка входа RAI
 *
 *  Разбирает аргументы и передаёт управление в src/commands.js.
 *  Работает и как обычный Node-скрипт (npm start), и внутри
 *  собранного .sh-бандла.
 * ========================================================================== */

'use strict';

const path = require('path');
const fs = require('fs');

// В бандле RAI_HOME задан снаружи; в исходниках вычисляем от файла.
if (!process.env.RAI_HOME) {
  process.env.RAI_HOME = path.resolve(
    path.dirname(fs.realpathSync(__filename)), '..');
}

const ui = require("./ui.js");
const commands = require("./commands.js");

// Версия: из бандла (__RAI) либо из package.json при запуске из исходников
function detectVersion() {
  try {
    if (typeof __RAI !== 'undefined' && __RAI.version) return __RAI.version;
  } catch {}
  try {
    const p = path.join(process.env.RAI_HOME, 'package.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch {}
  try {
    const v = path.join(process.env.RAI_HOME, '.version');
    if (fs.existsSync(v)) return fs.readFileSync(v, 'utf8').trim();
  } catch {}
  return '0.0.0';
}

function detectMode() {
  try {
    if (typeof __RAI !== 'undefined' && __RAI.mode) return __RAI.mode;
  } catch {}
  return process.env.RAI_DEBUG === '1' ? 'debug' : 'source';
}

const ctx = {
  version: detectVersion(),
  mode: detectMode(),
  home: process.env.RAI_HOME,
};

const [, , cmd, ...args] = process.argv;

// Фоновая проверка обновлений: не для служебных команд и не блокирует работу.
const SKIP_CHECK = ['update', 'upgrade', 'uninstall', 'remove',
                    'verify', 'integrity', '-v', '--version', 'help', '-h', '--help'];
function maybeNotify() {
  if (SKIP_CHECK.includes(cmd)) return;
  if (ctx.mode === 'source') return;
  if (!process.stdout.isTTY) return;
  try {
    require('./update.js').notifyIfOutdated(ctx.version).catch(() => {});
  } catch {}
}

try {
  const code = commands.dispatch(cmd, args, ctx);
  maybeNotify();
  if (typeof code === 'number' && code !== 0) process.exit(code);
} catch (e) {
  ui.err(e && e.message ? e.message : String(e));
  if (ctx.mode === 'debug' && e && e.stack) {
    console.error(ui.C.d + e.stack + ui.C.r);
  }
  process.exit(1);
}

