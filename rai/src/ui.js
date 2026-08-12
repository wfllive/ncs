'use strict';
/* Оформление вывода. Совпадает по стилю с shell-скриптами RAI. */

const tty = process.stdout.isTTY;

const C = tty ? {
  r:   '\x1b[0m',    b:   '\x1b[1m',    d:   '\x1b[2m',
  red: '\x1b[1;31m', grn: '\x1b[1;32m', yel: '\x1b[1;33m',
  blu: '\x1b[1;34m', cya: '\x1b[1;36m',
} : new Proxy({}, { get: () => '' });

const log  = (...a) => console.log(`${C.blu}==>${C.r}`, ...a);
const ok   = (...a) => console.log(`${C.grn} OK ${C.r}`, ...a);
const warn = (...a) => console.log(`${C.yel}WARN${C.r}`, ...a);
const err  = (...a) => console.error(`${C.red}FAIL${C.r}`, ...a);
const die  = (...a) => { err(...a); process.exit(1); };
const step = (t)    => console.log(`\n${C.cya}── ${t} ${'─'.repeat(Math.max(0, 44 - t.length))}${C.r}`);

module.exports = { C, log, ok, warn, err, die, step, tty };

