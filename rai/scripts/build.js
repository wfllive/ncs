#!/usr/bin/env node
/* =============================================================================
 *  scripts/build.js — СБОРЩИК RAI
 *
 *      npm run build:debug     → build/debug/rai-debug.sh
 *      npm run build:release   → build/release/rai-<версия>.sh
 *
 *  ЧТО ВАЖНО ПОНИМАТЬ:
 *  Отдельных .sh файлов в проекте нет. Весь shell-код хранится внутри
 *  JS-модулей (src/shell/*.js) и оттуда попадает в сборку.
 *
 *  Отсюда защита от подмены: shell-код входит в общий SHA-256 полезной
 *  нагрузки. Подменить скрипт «по пути» невозможно — его нет на диске
 *  до запуска, а любая правка ломает `--verify`.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const MODE = (process.argv[2] || 'release').toLowerCase();

if (!['debug', 'release'].includes(MODE)) {
  console.error('Использование: node scripts/build.js <debug|release>');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * Версия и заметки берутся из CHANGELOG.md — единственного места,
 * где их нужно править. package.json и version.json обновляются сами.
 */
function readChangelog() {
  const f = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

  // первый заголовок вида "## 3.1.0" или "## 3.1.0 [важное]"
  const m = text.match(/^##\s+v?(\d+(?:\.\d+){0,2})\s*(\[[^\]]*\])?\s*$/m);
  if (!m) return null;

  const version = m[1];
  const critical = /важн|critical/i.test(m[2] || '');

  // пункты списка до следующего заголовка
  const rest = text.slice(m.index + m[0].length);
  const stop = rest.search(/^##\s+/m);
  const body = stop === -1 ? rest : rest.slice(0, stop);
  const notes = body.split('\n')
    .filter(l => /^\s*[-*]\s+/.test(l))
    .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 8);

  return { version, notes, critical };
}

const CL = readChangelog();
const VERSION = CL ? CL.version : pkg.version;

// package.json подтягивается за CHANGELOG автоматически
if (CL && pkg.version !== VERSION) {
  pkg.version = VERSION;
  fs.writeFileSync(path.join(ROOT, 'package.json'),
                   JSON.stringify(pkg, null, 2) + '\n');
}
// репозиторий для проверки обновлений: из package.json или окружения
const REPO = process.env.RAI_REPO ||
  (pkg.repository && String(pkg.repository.url || pkg.repository)
     .replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '')) || 'USER/rai';

const tty = process.stdout.isTTY;
const c = tty ? { r:'\x1b[0m', g:'\x1b[1;32m', b:'\x1b[1;34m', y:'\x1b[1;33m',
                  d:'\x1b[2m', red:'\x1b[1;31m', cy:'\x1b[1;36m' }
              : new Proxy({}, { get: () => '' });
const ok   = (m) => console.log(`${c.g} OK ${c.r} ${m}`);
const warn = (m) => console.log(`${c.y}WARN${c.r} ${m}`);
const die  = (m) => { console.error(`${c.red}FAIL${c.r} ${m}`); process.exit(1); };
const step = (m) => console.log(`\n${c.cy}── ${m} ${'─'.repeat(Math.max(0, 40 - m.length))}${c.r}`);

// ---------- состав ------------------------------------------------------------
const JS_MODULES = [
  'src/ui.js',
  'src/env.js',
  'src/shell/index.js',
  'src/run.js',
  'src/state.js',
  'src/projects.js',
  'src/update.js',
  'src/commands.js',
  'src/index.js',
];

// ---------- 1. проверка --------------------------------------------------------
step('1/4  Проверка исходников');

// лицензия должна быть заполнена
{
  const lp = path.join(ROOT, 'LICENSE');
  if (!fs.existsSync(lp)) {
    warn('нет файла LICENSE — добавьте перед публикацией');
  } else {
    const t = fs.readFileSync(lp, 'utf8');
    if (/<ВАШЕ ИМЯ|<YOUR NAME|ВАШЕ ИМЯ ИЛИ НИК/.test(t))
      warn('в LICENSE не заполнено имя правообладателя');
  }
}

const missing = JS_MODULES.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) die('Нет файлов:\n  ' + missing.join('\n  '));
ok(`JS-модулей: ${JS_MODULES.length}`);
if (CL) {
  ok(`версия ${VERSION} из CHANGELOG.md${CL.critical ? ' (важное обновление)' : ''}`);
  if (!CL.notes.length) warn('в CHANGELOG.md нет списка изменений для этой версии');
} else {
  warn('CHANGELOG.md не найден — версия берётся из package.json');
}

for (const f of JS_MODULES) {
  const r = spawnSync('node', ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  if (r.status !== 0) die(`синтаксис JS: ${f}\n${(r.stderr || '').slice(0, 300)}`);
}
ok('синтаксис JS');

// пути require между модулями
{
  const bad = [];
  for (const f of JS_MODULES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const dir = path.dirname(path.join(ROOT, f));
    for (const m of code.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)) {
      const t = m[2];
      if (/\.js\.js$/.test(t)) { bad.push(`${f}: require("${t}") — двойное .js`); continue; }
      const target = path.resolve(dir, t.endsWith('.js') ? t : t + '.js');
      if (!fs.existsSync(target)) bad.push(`${f}: require("${t}") — файла нет`);
    }
  }
  if (bad.length) die('Битые require:\n  ' + bad.join('\n  '));
  ok('пути require корректны');
}

// shell-модули: настоящие .sh рядом с JS
const shell = require(path.join(ROOT, 'src/shell/index.js'));
const SHELL_CODE = {};
{
  const missingSh = [];
  for (const rel of shell.MODULES) {
    const f = path.join(ROOT, 'src/shell', rel);
    if (!fs.existsSync(f)) { missingSh.push(rel); continue; }
    SHELL_CODE[rel] = fs.readFileSync(f, 'utf8');
  }
  if (missingSh.length) die('Нет shell-модулей:\n  ' + missingSh.join('\n  '));

  const bad = [];
  for (const rel of Object.keys(SHELL_CODE)) {
    const f = path.join(ROOT, 'src/shell', rel);
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${rel}: ${(r.stderr || '').trim().split('\n')[0]}`);
  }
  if (bad.length) die('Синтаксис shell:\n  ' + bad.join('\n  '));

  const bytes = Object.values(SHELL_CODE).reduce((a, v) => a + Buffer.byteLength(v), 0);
  ok(`shell-модулей: ${Object.keys(SHELL_CODE).length} (${(bytes / 1024).toFixed(1)} КБ)`);
}

// ---------- Kotlin DSL: проверяем РЕАЛЬНО сгенерированный проект ------------
// Полная сборка Gradle тут невозможна (нужен JDK 17 и сеть), поэтому
// генерируем проект во временном HOME и проверяем получившиеся .kts
// на ловушки, на которых сборка уже падала у пользователей.
{
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rai-kts-'));
  const problems = [];
  try {
    for (const profile of ['--stable', '--modern']) {
      const r = spawnSync('bash',
        [path.join(ROOT, 'src/shell/project/new.sh'), 'ChkApp', 'com.chk.app', profile],
        { encoding: 'utf8', timeout: 120000,
          env: { ...process.env, HOME: tmpHome, RAI_HOME: ROOT, RAI_YES: '1',
                 ANDROID_HOME: path.join(tmpHome, 'android-sdk') } });

      const appKts = path.join(tmpHome, 'projects/ChkApp/app/build.gradle.kts');
      if (!fs.existsSync(appKts)) {
        problems.push(`${profile}: app/build.gradle.kts не создан` +
                      (r.stderr ? ` — ${String(r.stderr).trim().split('\n').pop()}` : ''));
        fs.rmSync(path.join(tmpHome, 'projects'), { recursive: true, force: true });
        continue;
      }
      const kts = fs.readFileSync(appKts, 'utf8');
      const props = (() => {
        const f = path.join(tmpHome, 'projects/ChkApp/gradle.properties');
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      })();

      // java.util.X В КОДЕ (строки import не считаются): идентификатор java
      // внутри скрипта занят расширением Gradle (JavaPluginExtension),
      // отсюда "Unresolved reference 'util'"
      const body = kts.split('\n')
        .filter(l => !/^\s*import\s/.test(l))
        .join('\n');
      if (/\bjava\.(util|io)\./.test(body))
        problems.push(`${profile}: java.util/java.io в коде — Unresolved reference`);

      // import обязан быть выше plugins {}
      const iImp = kts.indexOf('import ');
      const iPlug = kts.indexOf('plugins {');
      if (iImp !== -1 && iPlug !== -1 && iImp > iPlug)
        problems.push(`${profile}: import идёт после plugins {}`);

      // Properties используется, но не импортирован
      if (/\bProperties\(\)/.test(kts) && !/^import java\.util\.Properties/m.test(kts))
        problems.push(`${profile}: Properties() без import java.util.Properties`);

      // AGP 9: Kotlin встроен, отдельный плагин ломает сборку
      const agp9 = /com\.android\.application/.test(kts) && profile === '--modern';
      if (agp9 && /org\.jetbrains\.kotlin\.android/.test(kts))
        problems.push('--modern: плагин kotlin.android при AGP 9 — сборка упадёт');

      // AGP 9: опция удалена, даёт WARNING
      if (profile === '--modern' && /android\.defaults\.buildfeatures\.buildconfig/.test(props))
        problems.push('--modern: android.defaults.buildfeatures.buildconfig удалён в AGP 9');

      // abiFilters вместе со splits.abi — конфликт конфигурации
      if (/abiFilters/.test(kts) && /\bsplits\s*\{/.test(kts))
        problems.push(`${profile}: abiFilters вместе со splits.abi — конфликт AGP`);

      fs.rmSync(path.join(tmpHome, 'projects'), { recursive: true, force: true });
    }
  } catch (e) {
    warn('проверка Kotlin DSL не выполнена: ' + e.message);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
  if (problems.length) die('Kotlin DSL:\n  ' + problems.join('\n  '));
  ok('Kotlin DSL: сгенерированные проекты корректны (stable + modern)');
}

// запуск из исходников
{
  const r = spawnSync('node', [path.join(ROOT, 'src/index.js'), '-v'],
    { encoding: 'utf8', cwd: os.tmpdir(), env: { ...process.env, RAI_HOME: ROOT } });
  if (r.status !== 0 || !String(r.stdout).includes(VERSION))
    die('npm start не работает:\n' + String(r.stderr || r.stdout).slice(0, 400));
  ok('запуск из исходников (npm start)');
}

// ---------- 2. JS-бандл --------------------------------------------------------
step('2/4  Сборка JS');

function minify(code) {
  const lines = code.split('\n');
  const out = [];
  for (const l of lines) {
    // строчные комментарии убираем только если строка целиком комментарий
    if (/^\s*\/\//.test(l)) continue;
    out.push(l);
  }
  return out.join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function makeBundle() {
  const p = [];
  p.push(`// RAI v${VERSION} — ${MODE}`);
  p.push(`'use strict';`);
  p.push(`const __RAI = { version: '${VERSION}', mode: '${MODE}', repo: '${REPO}' };`);
  p.push(`const __mods = {}; const __cache = {};`);
  p.push(`function __require(n) {`);
  p.push(`  let k = String(n).replace(/^\\.\\//, '').replace(/\\.js$/, '');`);
  p.push(`  if (k.startsWith('shell/')) k = k.slice(6) === 'index' ? 'shell' : k;`);
  p.push(`  if (__cache[k]) return __cache[k].exports;`);
  p.push(`  if (!__mods[k]) return require(n);`);
  p.push(`  const m = { exports: {} }; __cache[k] = m;`);
  p.push(`  __mods[k](m, m.exports, __require, __RAI);`);
  p.push(`  return m.exports;`);
  p.push(`}`);

  for (const f of JS_MODULES) {
    // ключ модуля: src/shell/common.js -> shell/common, src/ui.js -> ui
    let key = f.replace(/^src\//, '').replace(/\.js$/, '');
    if (key === 'shell/index') key = 'shell';

    let code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    code = code.replace(/^#![^\n]*\n/, '');
    if (MODE === 'release') code = minify(code);

    // локальные require → внутренний загрузчик, с учётом вложенности
    code = code.replace(/require\((['"])(\.[^'"]+?)(\.js)?\1\)/g, (mm, q, target) => {
      const dir = path.dirname(f);                       // напр. src/shell
      const abs = path.normalize(path.join(dir, target)) // src/ui
        .replace(/^src\//, '').replace(/\\/g, '/');
      const k = abs === 'shell/index' ? 'shell' : abs;
      return `__require("${k}")`;
    });

    p.push(`__mods[${JSON.stringify(key)}] = function(module, exports, require, __RAI) {`);
    p.push(code);
    p.push(`};`);
  }
  // встроенная таблица shell-кода: подставляется в модуль shell
  p.push(`__require('shell').setEmbedded(${JSON.stringify(SHELL_CODE)});`);
  p.push(`__require('index');`);
  return p.join('\n');
}

const bundle = makeBundle();
{
  const t = path.join(os.tmpdir(), `rai-bundle-check-${Date.now()}.js`);
  fs.writeFileSync(t, bundle);
  const r = spawnSync('node', ['--check', t], { encoding: 'utf8' });
  fs.rmSync(t, { force: true });
  if (r.status !== 0) die('бандл невалиден:\n' + (r.stderr || '').slice(0, 400));
}
ok(`JS-бандл: ${(bundle.length / 1024).toFixed(1)} КБ (shell внутри)`);

// ---------- 3. генерация .sh ---------------------------------------------------
step('3/4  Генерация .sh');

const b64 = Buffer.from(bundle).toString('base64');
const SHA = crypto.createHash('sha256').update(bundle).digest('hex');
const FP = SHA.slice(0, 16);
const BUILT = new Date().toISOString();

const isDebug = MODE === 'debug';
// Имя файла БЕЗ версии — намеренно.
// Тогда ссылка github.com/<repo>/releases/latest/download/rai.sh вечная,
// и версию не нужно править ни в README, ни где-либо ещё.
// Версия живёт внутри файла: bash rai.sh --info
const outName = isDebug ? 'rai-debug.sh' : 'rai.sh';
const outSub = path.join(OUT_DIR, MODE);
const outPath = path.join(outSub, outName);

const header = isDebug
? `#!/usr/bin/env bash
# =============================================================================
#  RAI v${VERSION} — DEBUG
#  Отладочная сборка: проверить, что всё работает.
#  Собрано   : ${BUILT}
#  Отпечаток : ${FP}
# =============================================================================`
: `#!/usr/bin/env bash
# =============================================================================
#  RAI v${VERSION} — Rapid Android on ARM
#  Сборка Android-приложений прямо на устройстве. Только arm64-v8a.
#
#  Установка  : bash ${outName} --install
#  Подлинность: bash ${outName} --verify
#
#  Версия     : ${VERSION}
#  Собрано    : ${BUILT}
#  Отпечаток  : ${FP}
#  SHA-256    : ${SHA}
#
#  Лицензия  : MIT — см. LICENSE в репозитории
#  Поддержка оказывается только для официальных сборок.
# =============================================================================`;

const sh = `${header}
set -uo pipefail

RAI_V="${VERSION}"
RAI_MODE="${MODE}"
RAI_FP="${FP}"
RAI_SHA="${SHA}"
RAI_BUILT="${BUILT}"

# Куда СТАВИТСЯ код. Всегда внутрь ~/.rai — переменная окружения сюда
# намеренно не влияет: _extract делает rm -rf по этому пути, и внешний
# RAI_HOME (например, указывающий на каталог с исходниками) означал бы
# удаление чужих файлов.
RAI_DEST="\$HOME/.rai/${VERSION}${isDebug ? '-debug' : ''}"

# Откуда ЗАПУСКАЕТСЯ код. Здесь внешний RAI_HOME уважаем: он позволяет
# работать с уже распакованной копией, ничего не перезаписывая.
RAI_HOME="\${RAI_HOME:-\$RAI_DEST}"
export RAI_HOME

_g='\\033[1;32m'; _b='\\033[1;34m'; _y='\\033[1;33m'; _r='\\033[1;31m'; _d='\\033[2m'; _n='\\033[0m'
_ok(){   echo -e "\${_g} OK \${_n} \$*"; }
_log(){  echo -e "\${_b}==>\${_n} \$*"; }
_warn(){ echo -e "\${_y}WARN\${_n} \$*"; }
_die(){  echo -e "\${_r}FAIL\${_n} \$*" >&2; exit 1; }

_payload(){ sed -n '/^#RAI_START\$/,/^#RAI_END\$/p' "\$0" | sed '1d;\$d' | tr -d '\\n'; }

_verify(){
  command -v sha256sum >/dev/null 2>&1 || return 2
  [ "\$(_payload | base64 -d | sha256sum | awk '{print \$1}')" = "\$RAI_SHA" ]
}

_extract(){
  local force="\${1:-0}"
  # Распаковка ВСЕГДА в \$RAI_DEST внутри ~/.rai, никогда по внешнему пути.
  if [ "\$force" = "0" ] && [ -f "\$RAI_DEST/.stamp" ] && \\
     [ "\$(cat "\$RAI_DEST/.stamp" 2>/dev/null)" = "\$RAI_SHA" ]; then
    RAI_HOME="\$RAI_DEST"; export RAI_HOME; return 0
  fi

  # Страховка: удаляем только то, что похоже на каталог установки RAI.
  # Если по пути лежит чужое (исходники, проект) — не трогаем и выходим.
  case "\$RAI_DEST" in
    "\$HOME/.rai/"*) ;;
    *) _die "недопустимый каталог установки: \$RAI_DEST" ;;
  esac
  if [ -e "\$RAI_DEST" ] && [ ! -f "\$RAI_DEST/.stamp" ]; then
    _die "в \$RAI_DEST лежит посторонний каталог — удалите его вручную"
  fi

  rm -rf "\$RAI_DEST"; mkdir -p "\$RAI_DEST/bin" || _die "нет доступа к \$RAI_DEST"
  _payload | base64 -d > "\$RAI_DEST/bin/rai.js" || _die "не распаковался код"
  echo "\$RAI_SHA" > "\$RAI_DEST/.stamp"
  echo "\$RAI_V"   > "\$RAI_DEST/.version"
  echo "\$RAI_FP"  > "\$RAI_DEST/.fingerprint"
  RAI_HOME="\$RAI_DEST"; export RAI_HOME
}

_need_node(){
  command -v node >/dev/null 2>&1 && return 0
  echo "RAI требует Node.js 18+." >&2
  echo "  Ubuntu/Debian:  apt-get install -y nodejs" >&2
  echo "  Termux:         pkg install nodejs" >&2
  exit 1
}


# ---------------------------------------------------------------------------
#  Установка: чистка старых копий, лаунчер, PATH, самопроверка.
#  Аргумент "quiet" — короткий вывод (для автоустановки при первом запуске).
# ---------------------------------------------------------------------------
_do_install(){
  local QUIET="\${1:-}"
  local say
  if [ "\$QUIET" = "quiet" ]; then say(){ :; }; else say(){ _ok "\$@"; }; fi

  if _verify; then say "подлинность подтверждена"
  else _warn "проверка целостности не пройдена — сборка изменена"; fi

  _extract 1
  say "код распакован в \$RAI_DEST"

  # 1) убрать битые ссылки и прежние лаунчеры во всех каталогах PATH
  local _dirs d
  _dirs="\$(printf '%s' "\$PATH" | tr ':' '\n')
\${PREFIX:+\$PREFIX/bin}
/usr/local/bin
/usr/bin
\$HOME/.local/bin
\$HOME/bin"
  for d in \$(printf '%s\n' \$_dirs | awk 'NF && !seen[\$0]++'); do
    [ -n "\$d" ] || continue
    [ -e "\$d/rai" ] || [ -L "\$d/rai" ] || continue
    if [ -L "\$d/rai" ] && [ ! -e "\$d/rai" ]; then
      rm -f "\$d/rai" 2>/dev/null && _ok "убрана битая ссылка \$d/rai"
    elif grep -q 'RAI v.* — лаунчер' "\$d/rai" 2>/dev/null; then
      rm -f "\$d/rai" 2>/dev/null
    elif [ -L "\$d/rai" ]; then
      rm -f "\$d/rai" 2>/dev/null && _ok "убрана прежняя ссылка \$d/rai"
    fi
  done

  # 2) лаунчер — в каталог, который уже есть в PATH
  _in_path(){ case ":\$PATH:" in *":\$1:"*) return 0;; *) return 1;; esac; }

  LAUNCHER=""
  _try_dir(){
    local dd="\$1"
    [ -n "\$dd" ] || return 1
    mkdir -p "\$dd" 2>/dev/null || return 1
    [ -w "\$dd" ] || return 1
    cat > "\$dd/rai" <<LAUNCHER_EOF
#!/usr/bin/env bash
# RAI v\$RAI_V — лаунчер. Создан автоматически при установке.
RAI_HOME="\\\${RAI_HOME:-\$RAI_DEST}"
export RAI_HOME
if [ ! -f "\\\$RAI_HOME/bin/rai.js" ]; then
  echo "RAI повреждён: нет \\\$RAI_HOME/bin/rai.js" >&2
  echo "  Переустановите:  bash rai-*.sh" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || {
  echo "Нужен Node.js:  apt-get install -y nodejs  |  pkg install nodejs" >&2
  exit 1; }
${isDebug ? 'export RAI_DEBUG=1\n' : ''}exec node "\\\$RAI_HOME/bin/rai.js" "\\\$@"
LAUNCHER_EOF
    chmod +x "\$dd/rai" 2>/dev/null || return 1
    LAUNCHER="\$dd/rai"; return 0
  }

  for d in \${PREFIX:+\$PREFIX/bin} /usr/local/bin "\$HOME/.local/bin" "\$HOME/bin"; do
    [ -n "\$d" ] || continue
    _in_path "\$d" || continue
    _try_dir "\$d" && break
  done
  if [ -z "\$LAUNCHER" ]; then
    for d in \${PREFIX:+\$PREFIX/bin} "\$HOME/.local/bin" /usr/local/bin "\$HOME/bin"; do
      _try_dir "\$d" && break
    done
  fi

  if [ -z "\$LAUNCHER" ]; then
    _warn "не удалось создать команду 'rai' — нет доступа на запись"
    echo "  Запускайте так:  bash \$(basename "\$0") <команда>"
    return 1
  fi
  _ok "команда: \$LAUNCHER"

  # 3) PATH
  local LDIR; LDIR="\$(dirname "\$LAUNCHER")"
  if ! _in_path "\$LDIR"; then
    local rc
    for rc in "\$HOME/.bashrc" "\$HOME/.profile"; do
      touch "\$rc" 2>/dev/null || continue
      grep -q 'RAI launcher' "\$rc" 2>/dev/null && continue
      printf '\n# RAI launcher\nexport PATH="%s:\$PATH"\n' "\$LDIR" >> "\$rc"
    done
    export PATH="\$LDIR:\$PATH"
    _ok "\$LDIR добавлен в PATH"
  fi

  # 4) сброс кэша путей оболочки
  hash -r 2>/dev/null || true

  # 5) самопроверка
  if ! "\$LAUNCHER" -v >/dev/null 2>&1; then
    _warn "лаунчер создан, но не отвечает: \$LAUNCHER"
    return 1
  fi
  say "проверка: \$("\$LAUNCHER" -v)"
  return 0
}

case "\${1:-}" in
  --verify)
    echo "RAI v\$RAI_V (\$RAI_MODE)"
    echo "  собрано   : \$RAI_BUILT"
    echo "  отпечаток : \$RAI_FP"
    echo "  SHA-256   : \$RAI_SHA"
    echo
    if _verify; then
      echo -e "\${_g}✔ Подлинная сборка, содержимое не изменено\${_n}"; exit 0
    else
      echo -e "\${_r}✘ Содержимое изменено — это не официальная сборка\${_n}"
      echo "  Скачайте оригинал заново."
      exit 1
    fi ;;

  --install|--reinstall)
    _log "Установка RAI v\$RAI_V"
    if _do_install; then
      echo
      _ok "Готово. Запустите:  rai"
      echo -e "  \${_d}Если оболочка выдаст 'No such file or directory' — hash -r\${_n}"
      exit 0
    else
      exit 1
    fi ;;

  --uninstall|--remove)
    echo -e "\${_y}Удаление RAI v\$RAI_V\${_n}"
    echo
    echo "  Будет удалено:"
    echo "    • код RAI        \$RAI_DEST"
    echo "    • рабочие файлы  \$HOME/.rai/work"
    _FOUND=""
    for d in \$(printf '%s' "\$PATH" | tr ':' '\n' | awk 'NF && !seen[\$0]++'); do
      [ -f "\$d/rai" ] && grep -q 'RAI v.* — лаунчер' "\$d/rai" 2>/dev/null \
        && { echo "    • команда        \$d/rai"; _FOUND="\$_FOUND \$d/rai"; }
    done
    echo
    echo -e "  \${_g}НЕ будет тронуто:\${_n}"
    echo "    • ваши проекты   \$HOME/projects"
    echo "    • Android SDK    \${ANDROID_HOME:-\$HOME/android-sdk}"
    echo "    • ключи подписи  \$HOME/.rai/keystores"
    echo

    if [ "\${RAI_YES:-0}" = "1" ] || [ "\${2:-}" = "-y" ] || [ "\${2:-}" = "--yes" ]; then
      _ANS="y"
    elif [ -t 0 ]; then
      printf "  Удалить RAI? [да/нет] "
      read -r _ANS
    else
      _die "Неинтерактивный запуск. Для подтверждения: --uninstall -y"
    fi

    case "\$_ANS" in
      д|да|Д|ДА|Да|y|Y|yes|YES|Yes)
        rm -rf "\$RAI_DEST" "\$HOME/.rai/work"
        for f in \$_FOUND; do rm -f "\$f" 2>/dev/null; done
        # битые ссылки от прошлых версий
        for d in \$(printf '%s' "\$PATH" | tr ':' '\n' | awk 'NF && !seen[\$0]++'); do
          [ -L "\$d/rai" ] && [ ! -e "\$d/rai" ] && rm -f "\$d/rai" 2>/dev/null
        done
        hash -r 2>/dev/null || true
        echo
        _ok "RAI удалён"
        echo "  Проекты, SDK и ключи остались на месте."
        exit 0 ;;
      *)
        echo
        _log "Отменено — ничего не удалено"
        exit 0 ;;
    esac ;;

  --update|--upgrade)
    _need_node
    _log "Обновление RAI"
    echo "  установлено: \$(command -v rai >/dev/null 2>&1 && rai -v 2>/dev/null || echo 'нет')"
    echo "  этот файл  : RAI v\$RAI_V (\$RAI_MODE)"
    echo

    _CUR=""
    command -v rai >/dev/null 2>&1 && _CUR="\$(rai -v 2>/dev/null | awk '{print \$2}' | tr -d 'v')"
    if [ "\$_CUR" = "\$RAI_V" ]; then
      _ok "уже установлена версия \$RAI_V"
      if [ -f "\$RAI_HOME/.stamp" ] && [ "\$(cat "\$RAI_HOME/.stamp")" = "\$RAI_SHA" ]; then
        echo "  Содержимое совпадает — обновлять нечего."
        echo -e "  \${_d}Принудительно:  bash \$(basename "\$0") --reinstall\${_n}"
        exit 0
      fi
      _log "содержимое отличается — переустанавливаю"
    fi

    if _do_install; then
      echo
      _ok "Обновлено до v\$RAI_V"
      _ok "Запустите:  rai"
      exit 0
    else
      exit 1
    fi ;;

  --info)
    echo "версия    : \$RAI_V"
    echo "режим     : \$RAI_MODE"
    echo "собрано   : \$RAI_BUILT"
    echo "отпечаток : \$RAI_FP"
    echo "каталог   : \$RAI_HOME"
    exit 0 ;;
esac

_need_node

# ---------------------------------------------------------------------------
# Первый запуск: ставим себя сами, без отдельной команды --install.
# Признак «уже установлено» — рабочий лаунчер той же версии.
# ---------------------------------------------------------------------------
_launcher_ok(){
  local f="\$1"
  [ -f "\$f" ] || return 1
  grep -q 'RAI v.* — лаунчер' "\$f" 2>/dev/null || return 1
  grep -q "RAI_HOME:-\$RAI_HOME" "\$f" 2>/dev/null || return 1
  return 0
}

_installed(){
  local d
  for d in \${PREFIX:+\$PREFIX/bin} /usr/local/bin "\$HOME/.local/bin" "\$HOME/bin"; do
    [ -n "\$d" ] || continue
    _launcher_ok "\$d/rai" && return 0
  done
  return 1
}

if [ "\${RAI_NO_AUTOINSTALL:-0}" != "1" ] && ! _installed; then
  echo -e "\${_b}==>\${_n} Первый запуск RAI v\$RAI_V — выполняю установку"
  _do_install quiet
  echo
fi

_extract 0
${isDebug ? `[ "\${RAI_QUIET:-0}" = "1" ] || echo -e "\${_d}[debug] RAI v\$RAI_V · \$RAI_HOME\${_n}" >&2
export RAI_DEBUG=1
` : ''}exec node "\$RAI_HOME/bin/rai.js" "\$@"

#RAI_START
${b64.replace(/(.{120})/g, '$1\n')}
#RAI_END
`;

fs.mkdirSync(outSub, { recursive: true });
// убираем сборки прошлых версий, чтобы не путались
try {
  for (const f of fs.readdirSync(outSub)) {
    if (/^rai-[\d.]+\.sh(\.sha256)?$/.test(f))
      fs.rmSync(path.join(outSub, f), { force: true });
  }
} catch {}
fs.writeFileSync(outPath, sh);
fs.chmodSync(outPath, 0o755);
const size = fs.statSync(outPath).size;
ok(`${outName} (${(size / 1024).toFixed(1)} КБ)`);

// ---------- 4. проверка результата ---------------------------------------------
step('4/4  Проверка результата');

let r = spawnSync('bash', ['-n', outPath], { encoding: 'utf8' });
if (r.status !== 0) die('некорректный .sh:\n' + (r.stderr || ''));
ok('синтаксис .sh');

r = spawnSync('bash', [outPath, '--verify'], { encoding: 'utf8' });
if (r.status === 0 && /Подлинная сборка/.test(r.stdout || '')) ok('самопроверка целостности');
else warn('самопроверка: ' + String(r.stdout || r.stderr).trim().split('\n').pop());

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rai-test-'));
const tenv = { ...process.env, HOME: tmpHome, RAI_QUIET: '1',
               RAI_NO_AUTOINSTALL: '1', PATH: '/usr/bin:/bin' };
delete tenv.RAI_HOME;

r = spawnSync('bash', [outPath, '-v'], { encoding: 'utf8', cwd: os.tmpdir(), env: tenv });
if (String(r.stdout || '').includes(VERSION)) ok(`запуск: ${String(r.stdout).trim()}`);
else warn('запуск: ' + String(r.stdout || r.stderr).slice(0, 120));

r = spawnSync('bash', [outPath, 'help'], { encoding: 'utf8', cwd: os.tmpdir(), env: tenv });
if ((r.stdout || '').includes('rai build')) ok('команды доступны');
else warn('rai help вернул неожиданное');

// shell-модули должны материализоваться из бандла
r = spawnSync('bash', [outPath, 'sources'], { encoding: 'utf8', cwd: os.tmpdir(), env: tenv });
if ((r.stdout || '').includes('SDK (репозиторий)')) ok('shell-модули порождаются из JS');
else warn('shell-модули: ' + String(r.stdout || r.stderr).slice(0, 120));

fs.rmSync(tmpHome, { recursive: true, force: true });

let fileSha = '';
try {
  fileSha = execSync(`sha256sum "${outPath}"`, { encoding: 'utf8' }).split(' ')[0];
  fs.writeFileSync(outPath + '.sha256', `${fileSha}  ${outName}\n`);
} catch {}

// ---------- version.json для проверки обновлений -------------------------------
if (!isDebug) {
  const notes = CL ? CL.notes : [];

  const manifest = {
    version: VERSION,
    published: new Date().toISOString().slice(0, 10),
    file: outName,
    sha256: fileSha,
    minNode: 18,
    notes,
    critical: (CL && CL.critical) || process.env.RAI_CRITICAL === '1',
  };

  const text = JSON.stringify(manifest, null, 2) + '\n';
  // рядом с .sh — чтобы прикрепить к релизу обоими файлами
  fs.writeFileSync(path.join(outSub, 'version.json'), text);
  // и в корне — если публикуете через ветку репозитория
  fs.writeFileSync(path.join(ROOT, 'version.json'), text);
  ok(`version.json (v${VERSION}) — в build/release/ и в корне`);

  // ---------- README не должен содержать версию --------------------------------
  // Имя файла постоянное, ссылка через latest/download, значок динамический.
  // Если конкретный номер всё же просочился в текст — сборка предупредит,
  // иначе README пришлось бы править перед каждым релизом.
  try {
    const rp = path.join(ROOT, 'README.md');
    if (fs.existsSync(rp)) {
      const txt = fs.readFileSync(rp, 'utf8');
      const bad = new Set();
      for (const re of [/rai-\d+\.\d+\.\d+\.sh/g,
                        /releases\/download\/v?\d+\.\d+\.\d+/g,
                        /badge\/[^)\s]*-\d+\.\d+\.\d+-/g,
                        /RAI v\d+\.\d+\.\d+/g]) {
        for (const m of txt.match(re) || []) bad.add(m);
      }
      if (bad.size) {
        warn('README.md содержит версию — её придётся править вручную:');
        for (const b of bad) console.log(`       ${b}`);
        console.log(`       ${c.d}используйте ${outName} и releases/latest/download/${c.r}`);
      } else {
        ok('README.md: версии внутри нет — править перед релизом не нужно');
      }
    }
  } catch (e) { warn('README.md не проверен: ' + e.message); }
}

// ---------- итог ---------------------------------------------------------------
const rel = path.relative(ROOT, outPath);
console.log();
if (isDebug) {
  console.log(`${c.y}════════ DEBUG-СБОРКА ГОТОВА ════════${c.r}`);
  console.log(`
  Файл      : ${rel}
  Размер    : ${(size / 1024).toFixed(1)} КБ
  Отпечаток : ${FP}

  Проверить:
      bash ${rel} --verify
      bash ${rel} status
      bash ${rel} help

  ${c.d}Для распространения:  npm run build:release${c.r}
`);
} else {
  console.log(`${c.g}════════ RELEASE ГОТОВ ════════${c.r}`);
  console.log(`
  Файл      : ${rel}
  Размер    : ${(size / 1024).toFixed(1)} КБ
  Версия    : ${VERSION}
  Отпечаток : ${FP}
  SHA-256   : ${fileSha || '?'}

${c.cy}Для страницы релиза GitHub:${c.r}
──────────────────────────────────────────────────
## RAI v${VERSION}

Один файл. Ни npm, ни распаковки.

### Установка

    curl -LO https://github.com/${REPO}/releases/latest/download/${outName}
    bash ${outName}

### Проверка подлинности

    sha256sum ${outName}
    # ${fileSha}

    bash ${outName} --verify
    # отпечаток: ${FP}

### Поддержка

Только для официальных сборок. Приложите вывод \`rai report\`.
──────────────────────────────────────────────────
`);
}
