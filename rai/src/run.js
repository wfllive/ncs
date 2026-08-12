'use strict';
/* =============================================================================
 *  src/run.js — запуск shell-модулей
 *
 *  Модули не лежат на диске: их код хранится в src/shell/*.js.
 *  При первом обращении они материализуются в рабочий каталог
 *  (по умолчанию ~/.rai/work/<хеш>) и запускаются оттуда.
 *
 *  Каталог привязан к хешу содержимого: правка исходников → новый каталог,
 *  устаревшие копии не используются.
 * ========================================================================== */

const { spawnSync, execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { C, err } = require('./ui.js');
const shell = require('./shell/index.js');

let WORK = null;

/** Каталог с материализованными shell-модулями. Создаётся один раз. */
function workdir() {
  if (WORK) return WORK;

  const all = shell.all();
  const hash = crypto.createHash('sha256')
    .update(Object.keys(all).sort().map(k => k + all[k]).join('')).digest('hex').slice(0, 12);

  const base = process.env.RAI_WORK ||
    path.join(process.env.HOME || os.homedir(), '.rai', 'work');
  const dir = path.join(base, hash);

  if (!fs.existsSync(path.join(dir, '.ready'))) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      shell.emit(dir, fs, path);
      fs.writeFileSync(path.join(dir, '.ready'), hash);
    } catch (e) {
      // например, нет прав — падаем во временный каталог
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rai-shell-'));
      shell.emit(tmp, fs, path);
      fs.writeFileSync(path.join(tmp, '.ready'), hash);
      WORK = tmp;
      return WORK;
    }
  }
  WORK = dir;
  return WORK;
}

function baseEnv(extra = {}) {
  const home = process.env.HOME || os.homedir();
  return {
    ...process.env,
    RAI_HOME: workdir(),                     // shell-модули ищут себя здесь
    RAI_SOURCE: process.env.RAI_HOME || '',  // где лежит сам RAI
    ANDROID_HOME: process.env.ANDROID_HOME || path.join(home, 'android-sdk'),
    RAI_PROJECTS: process.env.RAI_PROJECTS || path.join(home, 'projects'),
    ...extra,
  };
}

/** Запустить shell-модуль по логическому пути, напр. 'doctor/preflight.sh'. */
function sh(relPath, args = [], opts = {}) {
  if (!shell.get(relPath)) {
    err(`Нет shell-модуля: ${relPath}`);
    console.log(`  ${C.d}Модули встроены в сборку — вероятно, она повреждена.${C.r}`);
    return 1;
  }
  const file = path.join(workdir(), relPath);
  const res = spawnSync('bash', [file, ...args.filter(a => a !== undefined && a !== '')], {
    stdio: 'inherit',
    env: baseEnv(opts.env),
  });
  return res.status === null ? 1 : res.status;
}

/** Выполнить строку bash с подключённым lib/common.sh. */
function shInline(code) {
  const res = spawnSync('bash', ['-c', `. "$RAI_HOME/lib/common.sh"; ${code}`], {
    stdio: 'inherit', env: baseEnv(),
  });
  return res.status === null ? 1 : res.status;
}

/** Тихо получить вывод команды. */
function capture(code) {
  try {
    return execSync(`bash -c '${String(code).replace(/'/g, "'\\''")}'`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: baseEnv(),
    }).trim();
  } catch { return ''; }
}

// ---------------------------------------------------------------- install
function install(args) {
  const what = args[0];
  const rest = args.slice(1);
  switch (what) {
    case 'base':
    case 'bootstrap':  return sh('install/bootstrap.sh', rest);
    case 'sdk':        return sh('install/sdk.sh', rest);
    case 'rootfs':
    case 'ubuntu':     return sh('install/rootfs.sh', rest);
    case 'termux':     return sh('install/termux.sh', rest);
    case 'platform':
      if (!rest[0]) { err('Укажите API: rai install platform 37'); return 1; }
      return shInline(`. "$RAI_HOME/lib/sdk.sh"; rai_install_platform ${rest[0]}`);
    default:
      console.log(`rai install <что>

  base            подготовить систему (apt update, JDK 17, утилиты)
  sdk             нативный ARM Android SDK, последняя версия
  sdk <версия>    конкретная, например: rai install sdk 36.0.2
  sdk --list      какие версии доступны
  platform <API>  доустановить platforms;android-<API>
  rootfs          скачать Ubuntu-образ
  termux          подготовить Termux + proot-distro`);
      return what ? 1 : 0;
  }
}

// ---------------------------------------------------------------- fix
function fix(args) {
  const st = require('./state.js');
  const what = args[0];
  switch (what) {
    case 'java':
    case 'java-home': return sh('doctor/fixes/java-home.sh');
    case 'licenses':
    case 'lic':       return sh('doctor/fixes/licenses.sh');
    case 'abi':
    case 'splits':    return sh('doctor/fixes/abi-conflict.sh', [st.resolveProject(args[1])]);
    case 'all': {
      sh('doctor/fixes/java-home.sh');
      sh('doctor/fixes/licenses.sh');
      const p = st.resolveProject(args[1]);
      if (st.isProject(p)) sh('doctor/fixes/abi-conflict.sh', [p]);
      return 0;
    }
    default:
      console.log('rai fix <java|licenses|abi|all> [проект]');
      return what ? 1 : 0;
  }
}

module.exports = { sh, shInline, capture, install, fix, baseEnv, workdir };
