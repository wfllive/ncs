'use strict';
/* =============================================================================
 *  src/state.js — состояние: окружение, SDK, проекты
 *
 *  Всё определяется средствами Node (см. env.js), поэтому работает
 *  и при запуске из исходников, и внутри собранного .sh.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const { C } = require('./ui.js');
const env = require('./env.js');

const PROJECTS = () => process.env.RAI_PROJECTS ||
  path.join(process.env.HOME || os_home(), 'projects');
const SDK = () => process.env.ANDROID_HOME ||
  path.join(process.env.HOME || os_home(), 'android-sdk');

function os_home() {
  try { return require('os').homedir(); } catch { return '.'; }
}

const isProject = (p) =>
  !!p && (fs.existsSync(path.join(p, 'settings.gradle.kts')) ||
          fs.existsSync(path.join(p, 'settings.gradle')));

/** Имя проекта или путь → полный путь. */
function resolveProject(arg) {
  if (!arg) return process.cwd();
  let p = arg;
  if (p.startsWith('~/')) p = path.join(process.env.HOME, p.slice(2));
  if (path.isAbsolute(p)) return p;
  const inProjects = path.join(PROJECTS(), p);
  if (fs.existsSync(inProjects)) return inProjects;
  return path.resolve(process.cwd(), p);
}

/** Посчитать APK, не вызывая shell. */
function countApks(dir) {
  let n = 0;
  const walk = (d, depth) => {
    if (depth > 7) return;
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(d, it.name);
      if (it.isDirectory()) {
        if (it.name === '.gradle' || it.name === 'src') continue;
        walk(full, depth + 1);
      } else if (/\.(apk|aab)$/.test(it.name) && full.includes('outputs')) {
        n++;
      }
    }
  };
  walk(path.join(dir, 'app', 'build'), 0);
  return n;
}

function readProject(dir) {
  const gf = path.join(dir, 'app', 'build.gradle.kts');
  const txt = fs.existsSync(gf) ? fs.readFileSync(gf, 'utf8') : '';
  const rf = path.join(dir, 'build.gradle.kts');
  const rtxt = fs.existsSync(rf) ? fs.readFileSync(rf, 'utf8') : '';
  return {
    name: path.basename(dir),
    path: dir,
    compileSdk:  (txt.match(/compileSdk = (\d+)/) || [])[1] || '?',
    versionName: (txt.match(/versionName = "([^"]+)"/) || [])[1] || '?',
    versionCode: (txt.match(/versionCode = (\d+)/) || [])[1] || '?',
    agp: (rtxt.match(/com\.android\.application"\) version "([^"]+)"/) || [])[1] || '?',
    signed: fs.existsSync(path.join(dir, 'keystore.properties')),
    apks: countApks(dir),
  };
}

function collect() {
  const sdk = SDK();
  const s = {
    env: env.detect(),
    envName: env.name(),
    arch: env.arch(),
    java: null, javaHome: null,
    buildTools: [], platforms: [], maxSdk: 0, nativeArm: false,
    projects: [], sdkPath: sdk,
  };

  const j = env.findJava();
  if (j) { s.java = j.version; s.javaHome = j.home; s.hasJavac = j.hasJavac; }

  // build-tools
  const btDir = path.join(sdk, 'build-tools');
  if (fs.existsSync(btDir)) {
    try {
      s.buildTools = fs.readdirSync(btDir)
        .filter(d => /^\d/.test(d))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch {}
    if (s.buildTools.length) {
      const newest = s.buildTools[s.buildTools.length - 1];
      s.maxSdk = parseInt(newest, 10) || 0;
      s.aapt2 = path.join(btDir, newest, 'aapt2');
      s.nativeArm = env.isArm64(s.aapt2);
      s.aapt2Arch = env.elfArch(s.aapt2);
    }
  }

  const plDir = path.join(sdk, 'platforms');
  if (fs.existsSync(plDir)) {
    try { s.platforms = fs.readdirSync(plDir).sort(); } catch {}
  }

  const pr = PROJECTS();
  if (fs.existsSync(pr)) {
    let dirs = [];
    try { dirs = fs.readdirSync(pr).sort(); } catch {}
    for (const d of dirs) {
      const p = path.join(pr, d);
      if (isProject(p)) s.projects.push(readProject(p));
    }
  }
  return s;
}

/** Что делать дальше — одна конкретная команда. */
function nextStep(s) {
  if (s.env === 'termux')
    return { text: 'Вы в Termux — сборка живёт внутри Linux-образа',
             cmd: 'rai install rootfs' };
  if (!s.java)
    return { text: 'Java не установлена', cmd: 'rai install base' };
  if (!s.buildTools.length)
    return { text: 'Android SDK не установлен', cmd: 'rai install sdk' };
  if (!s.nativeArm && s.arch === 'aarch64')
    return { text: `SDK не для ARM (${s.aapt2Arch || '?'}) — сборка упадёт`,
             cmd: 'rai install sdk' };
  if (!s.projects.length)
    return { text: 'Нет проектов', cmd: 'rai new MyApp com.example.myapp --modern' };
  const p = s.projects[0];
  if (!p.apks)
    return { text: `Проект ${p.name} ещё не собирался`, cmd: `rai build ${p.name}` };
  if (!p.signed)
    return { text: `Для публикации ${p.name} нужен ключ подписи`,
             cmd: `rai keystore create ${p.name}` };
  return null;
}

module.exports = { collect, resolveProject, isProject, readProject,
                   nextStep, PROJECTS, SDK };
