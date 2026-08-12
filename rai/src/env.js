'use strict';
/* =============================================================================
 *  src/env.js — определение окружения средствами Node
 *
 *  Раньше это делали shell-функции, но при запуске из исходников
 *  (`yarn start`) их может не быть — получалось «среда: unknown»,
 *  «Java: нет» и ложное «не ARM».
 *
 *  Здесь всё определяется самим Node:
 *    • среда      — по файловой системе
 *    • Java       — поиск JDK без вызова shell
 *    • ELF-тип    — чтением заголовка файла (команда `file` не нужна,
 *                   в Termux её обычно нет)
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const TERMUX_PREFIX = '/data/data/com.termux/files/usr';

// ---------------------------------------------------------------- среда
function detect() {
  const hasTermux = fs.existsSync(TERMUX_PREFIX);
  const hasOsRelease = fs.existsSync('/etc/os-release');

  if (hasTermux && (process.env.PREFIX === TERMUX_PREFIX || !hasOsRelease))
    return 'termux';

  if (hasOsRelease) {
    // гостевой Linux поверх Android: proot-distro, свой rootfs, chroot
    let kernel = '';
    try { kernel = fs.readFileSync('/proc/version', 'utf8'); } catch {}
    let init = '';
    try { init = fs.readFileSync('/proc/1/cmdline', 'utf8'); } catch {}
    if (/android/i.test(kernel) || /proot/.test(init) ||
        fs.existsSync('/data/data/com.termux/files') ||
        process.env.PROOT_NO_SECCOMP || process.env.PROOT_TMP_DIR)
      return 'proot';
    return 'linux';
  }
  return 'unknown';
}

function osName() {
  try {
    const t = fs.readFileSync('/etc/os-release', 'utf8');
    const m = t.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (m) return m[1];
  } catch {}
  return `${os.type()} ${os.release()}`;
}

function name() {
  switch (detect()) {
    case 'termux': return 'Termux (Android)';
    case 'proot':  return `${osName()} (гостевой образ на Android)`;
    case 'linux':  return `Linux: ${osName()}`;
    default:       return 'неизвестно';
  }
}

function arch() {
  const m = { arm64: 'aarch64', x64: 'x86_64', arm: 'armv7l' };
  return m[process.arch] || process.arch;
}

// ---------------------------------------------------------------- ELF
/**
 * Архитектура ELF-файла по заголовку.
 * Не требует команды `file`, которой в Termux обычно нет.
 */
function elfArch(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(20);
    if (fs.readSync(fd, b, 0, 20, 0) < 20) return null;
    if (b.toString('binary', 0, 4) !== '\x7fELF') return null;
    const le = b[5] === 1;
    const machine = le ? b.readUInt16LE(18) : b.readUInt16BE(18);
    switch (machine) {
      case 183: return 'aarch64';
      case 62:  return 'x86_64';
      case 40:  return 'arm';
      case 3:   return 'x86';
      case 243: return 'riscv';
      default:  return 'other';
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

const isArm64 = (file) => elfArch(file) === 'aarch64';

// ---------------------------------------------------------------- Java
/** Найти JDK. Возвращает { home, version } или null. */
function findJava() {
  const candidates = [];

  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  const jvmDirs = ['/usr/lib/jvm', '/usr/java',
                   path.join(TERMUX_PREFIX, 'opt/openjdk'),
                   path.join(TERMUX_PREFIX, 'lib/jvm')];
  for (const d of jvmDirs) {
    if (!fs.existsSync(d)) continue;
    // сначала JDK 17, затем остальные по убыванию
    let entries = [];
    try { entries = fs.readdirSync(d); } catch { continue; }
    entries.sort((a, b) => {
      const s = (x) => (/17/.test(x) ? 0 : /21/.test(x) ? 1 : 2);
      return s(a) - s(b) || b.localeCompare(a);
    });
    for (const e of entries) candidates.push(path.join(d, e));
  }

  // Termux ставит java прямо в $PREFIX/bin
  candidates.push(TERMUX_PREFIX);
  candidates.push('/usr');

  for (const home of candidates) {
    const javac = path.join(home, 'bin', 'javac');
    const java = path.join(home, 'bin', 'java');
    if (!fs.existsSync(java)) continue;
    const version = javaVersion(java);
    if (!version) continue;
    return { home, version, hasJavac: fs.existsSync(javac) };
  }

  // последний шанс: java в PATH
  const r = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (r.status === 0 || r.stderr) {
    const v = parseVersion(r.stderr || r.stdout);
    if (v) return { home: process.env.JAVA_HOME || '', version: v, hasJavac: false };
  }
  return null;
}

function javaVersion(javaBin) {
  const r = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  return parseVersion((r.stderr || '') + (r.stdout || ''));
}

function parseVersion(text) {
  if (!text) return null;
  const clean = text.replace(/Picked up [^\n]*\n?/g, '');
  const m = clean.match(/version "([^"]+)"/) || clean.match(/openjdk (\d[\d._]*)/i);
  return m ? m[1] : null;
}

module.exports = { detect, name, osName, arch, elfArch, isArm64, findJava };
