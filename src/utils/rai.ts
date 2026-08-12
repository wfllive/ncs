/**
 * rai.js — сборка React + Vite + Android WebView проектов.
 *
 * Структура: React в корне, Gradle-проект в android/.
 * Метод rai повторяется напрямую (без вызова бинарника rai):
 *   npm install → vite build → cp dist→android/app/src/main/assets →
 *   скачать wrapper в android/ → cd android && ./gradlew assembleDebug/Release
 *   с окружением как rai build-debug.sh (JDK 17, ANDROID_HOME, aapt2, /dev/./urandom).
 *
 * Оболочка — Jetpack Compose (Kotlin) + WebView через AndroidView. Compose Runtime
 * в зависимостях — compose-компилятор удовлетворён.
 *
 * Вывод СТРИМИТСЯ в реальном времени через onLine (фон + poll лога): gradle/npm
 * запускаются под PTY (script) или stdbuf -oL, поэтому строки идут построчно,
 * а не кусками. Полный лог — в build.log.
 */
import { execute, streamExecute } from './shellExecutor';
import { createComposeProjectFiles, syncComposeProject } from './composeProject';
import { writeWorkspaceFile, shellQuote } from './workspace';
import { generateId } from './generateId';
import { getProjectDir, PROJECTS_ROOT } from '../config/runtime';

const quote = (v = '') => shellQuote(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRADLE_VER = '9.6.1';

const envSummary = async (projectDir) => {
  const r = await execute(
    `echo "node: $(node -v 2>/dev/null || echo НЕТ)"; ` +
    `echo "npm:  $(npm -v 2>/dev/null || echo НЕТ)"; ` +
    `echo "java: $(java -version 2>&1 | grep -i version | head -1 || echo НЕТ)"; ` +
    `echo "javac: $(javac -version 2>&1 | tail -1 || echo НЕТ)"; ` +
    `echo "ANDROID_HOME: \${ANDROID_HOME:-НЕ ЗАДАН}"; ` +
    `echo "build-tools: $(ls "\$ANDROID_HOME/build-tools" 2>/dev/null | tr '\\n' ' ' || echo НЕТ)"; ` +
    `echo "platforms: $(ls "\$ANDROID_HOME/platforms" 2>/dev/null | tr '\\n' ' ' || echo НЕТ)"; ` +
    `echo "android/settings.gradle.kts: $([ -f android/settings.gradle.kts ] && echo ЕСТЬ || echo НЕТ)"; ` +
    `echo "android/gradlew: $([ -s android/gradlew ] && echo ЕСТЬ || echo НЕТ)"; ` +
    `echo "android/.../gradle-wrapper.jar: $([ -s android/gradle/wrapper/gradle-wrapper.jar ] && echo ЕСТЬ || echo НЕТ)"`,
    projectDir,
  );
  return r?.output || '(нет вывода)';
};

const ensureWrapper = async (projectDir) => {
  const chk = await execute(
    '[ -s android/gradle/wrapper/gradle-wrapper.jar ] && [ -s android/gradlew ] && ! grep -q "exec gradle" android/gradlew 2>/dev/null && echo WRAP_OK || echo WRAP_NEED',
    projectDir,
  );
  if (/WRAP_OK/.test(chk.output || '')) return { ok: true, output: 'Gradle Wrapper на месте (android/)' };
  const dl = await execute(
    'mkdir -p android/gradle/wrapper; ' +
    '_f(){ local d="$1"; shift; local t u; t=$(mktemp) || return 1; ' +
    'for u in "$@"; do curl -fL --retry 3 --max-time 120 -o "$t" "$u" 2>/dev/null && [ -s "$t" ] && { mkdir -p "$(dirname "$d")"; mv -f "$t" "$d"; chmod 644 "$d" 2>/dev/null || true; return 0; }; done; rm -f "$t"; return 1; }; ' +
    `_f android/gradle/wrapper/gradle-wrapper.jar "https://raw.githubusercontent.com/gradle/gradle/v${GRADLE_VER}/gradle/wrapper/gradle-wrapper.jar" "https://github.com/gradle/gradle/raw/v${GRADLE_VER}/gradle/wrapper/gradle-wrapper.jar" || true; ` +
    `_f android/gradlew "https://raw.githubusercontent.com/gradle/gradle/v${GRADLE_VER}/gradlew" "https://github.com/gradle/gradle/raw/v${GRADLE_VER}/gradlew" || true; ` +
    'chmod +x android/gradlew 2>/dev/null || true; [ -s android/gradle/wrapper/gradle-wrapper.jar ] && [ -s android/gradlew ] && echo OK || echo NO',
    projectDir,
  );
  return { ok: /\bOK\b/.test(dl.output || ''), output: `$ скачать Gradle Wrapper ${GRADLE_VER} в android/\n${dl?.output || ''}` };
};

// Скрипт сборки (метод rai build-debug.sh): JDK + SDK + aapt2 + ./gradlew. Чистый, без rai.
const gradleScript = (assembleTask) =>
  'set +e; ' +
  'SDK="${ANDROID_HOME:-$HOME/android-sdk}"; ' +
  'JAVA_HOME="${JAVA_HOME:-}"; ' +
  'if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then ' +
    'JAVA_HOME=""; ' +
    'for p in /usr/lib/jvm/java-17-openjdk-arm64 /usr/lib/jvm/java-17-openjdk* /usr/lib/jvm/java-17-*; do [ -x "$p/bin/javac" ] && { JAVA_HOME="$p"; break; } done; ' +
    '[ -z "$JAVA_HOME" ] && command -v javac >/dev/null 2>&1 && JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"; ' +
    '[ -z "$JAVA_HOME" ] && for p in /usr/lib/jvm/*/; do [ -x "${p}bin/javac" ] && { JAVA_HOME="${p%/}"; break; }; done; ' +
  'fi; ' +
  'if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then ' +
    'echo "JDK_FAIL: JDK 17 не найден — openjdk-17-jdk (apt) или rai install base"; ' +
  'else ' +
    'export JAVA_HOME ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"; ' +
    'export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$PATH"; ' +
    'case "${JAVA_TOOL_OPTIONS:-}" in *egd=file:/dev/./urandom*) ;; *) export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom ${JAVA_TOOL_OPTIONS:-}";; esac; ' +
    'export TMPDIR="${TMPDIR:-$HOME/tmp}"; mkdir -p "$TMPDIR"; ' +
    'echo "sdk.dir=$SDK" > android/local.properties; ' +
    'BT="$(ls "$SDK/build-tools" 2>/dev/null | grep -E "^[0-9]" | sort -V | tail -1)"; ' +
    'if [ -z "$BT" ]; then echo "SDK_FAIL: Android SDK не установлен (нет build-tools) — rai install sdk / sdkmanager"; ' +
    'else ' +
      '[ -f "$SDK/build-tools/$BT/aapt2" ] && { grep -q aapt2FromMavenOverride android/gradle.properties 2>/dev/null || echo "android.aapt2FromMavenOverride=$SDK/build-tools/$BT/aapt2" >> android/gradle.properties; }; ' +
      'echo "== build-tools $BT · $(basename "$JAVA_HOME") =="; ' +
      'cd android && chmod +x gradlew 2>/dev/null && ./gradlew ' + assembleTask + ' --no-daemon --console=plain --warning-mode=none 2>&1; ' +
    'fi; ' +
  'fi';

// Обернуть команду в PTY через `script` — JVM (gradle) видит TTY и flush'ит
// построчно, значит нативный мост (forEachLine → событие commandOutput) получит
// строки В РЕАЛЬНОМ ВРЕМЕНИ, а не кусками в конце.
const wrapPty = async (command, workDir) => {
  const has = await execute('command -v script >/dev/null 2>&1 && echo Y || echo N', workDir);
  return /Y/.test(has.output || '') ? `script -qfc ${quote(command)} /dev/null` : command;
};

// Запустить команду и СТРИМИТЬ вывод построчно через onLine в реальном времени
// (через событие commandOutput нативного моста, не опрос файла). usePty=true —
// для gradle (обернуть в script). Возвращает полный текст.
const streamRun = async (command, workDir, onLine, usePty = false) => {
  const cmd = usePty ? await wrapPty(command, workDir) : command;
  const res = await streamExecute(cmd, workDir, onLine);
  return res?.output || '';
};

const locateApk = async (cwd, variant = 'debug') => {
  const sub = variant === 'release' ? 'release' : 'debug';
  const probe = await execute(
    `find android/app/build/outputs/apk/${sub} -name '*.apk' 2>/dev/null; ` +
    `find android -path "*/build/outputs/apk/${sub}/*.apk" 2>/dev/null | head -3`,
    cwd,
  );
  const line = String(probe.output || '').split('\n').map(x => x.trim()).find(x => x.endsWith('.apk'));
  return line ? (line.startsWith('/') ? line : `${cwd}/${line.replace(/^\.\//, '')}`) : '';
};

export const raiNew = async (name, packageName = `com.rnstudio.${String(name).toLowerCase().replace(/[^a-z0-9]/g, '')}`) => {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '') || 'react-app';
  const project = {
    id: generateId(), platform: 'android-react-webview', name, slug,
    projectDir: `${PROJECTS_ROOT}/${slug}`, packageName, namespace: packageName,
    versionName: '1.0.0', versionCode: 1, screens: [],
    theme: { primaryColor: '#4F46E5', secondaryColor: '#0E7490', backgroundColor: '#F8FAFC', isDark: false },
    variables: [{ id: generateId(), name: 'counter', type: 'number', value: 0 }],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const files = createComposeProjectFiles({ ...project, screens: [{ name: 'Home', rootComponent: { id: generateId(), type: 'Column', props: { width: '100%', padding: 16, gap: 12, backgroundColor: '#F8FAFC' }, children: [{ id: generateId(), type: 'Text', props: { text: `Добро пожаловать в ${name}`, fontSize: 22, color: '#111827', fontWeight: '700' }, children: [] }] } }] });
  await execute(`mkdir -p ${quote(project.projectDir)}`, '/');
  for (const [rel, content] of Object.entries(files)) {
    const res = await writeWorkspaceFile({ projectDir: project.projectDir }, rel, content);
    if (!res?.success) return { success: false, output: `Failed to write ${rel}: ${res?.output}` };
  }
  await writeWorkspaceFile({ projectDir: project.projectDir }, '.rnstudio/model.json', `${JSON.stringify(project, null, 2)}\n`);
  execute('npm install --silent 2>&1 | tail -10; echo YARN_READY', project.projectDir).catch(() => {});
  return { success: true, output: `React project created: ${name} at ${project.projectDir}`, project };
};

export const raiKeystore = (name, cwd) =>
  Promise.resolve({ success: true, output: 'Debug APK использует debug-keystore автоматически. Release: bash build-release.sh (нужен keystore.properties).' });

/**
 * Полная сборка APK (debug | release) со СТРИМИНГОМ вывода в реальном времени.
 * onLine(text, level?) вызывается по мере появления строк.
 * Возвращает { success, output, apkPath, distReady, release, logPath, copiedApk }.
 */
export const raiBuild = async (project, variant = 'debug', cwd: string | undefined = undefined, onLine: (text: string, level?: string) => void = () => {}) => {
  if (!project) return { success: false, output: 'No project' };
  const projectDir = cwd || getProjectDir(project);
  if (!projectDir) return { success: false, output: 'Project directory is unknown' };
  const release = variant === 'release';
  const assembleTask = release ? 'assembleRelease' : 'assembleDebug';
  const apkSub = release ? 'release' : 'debug';
  const out = [];
  const emit = (text, level = undefined) => { out.push(text); try { onLine && onLine(text, level); } catch (e) {} };
  const step = (num, title, text, level = undefined) => {
    emit('', undefined);
    emit(`──── [${num}] ${title} ────────────────────────────────`, 'command');
    String(text == null ? '' : text).split('\n').forEach((l) => emit(l, level));
  };

  // 0) Окружение
  step(0, 'Окружение', await envSummary(projectDir));

  const exists = await execute(`[ -d ${quote(projectDir)} ] && printf ok || printf missing`, '/');
  if (!/ok/i.test(exists.output || '')) {
    const created = await raiNew(project.name, project.packageName);
    if (!created?.success) return { success: false, output: created.output };
  }

  // 1) Синхронизация экранов
  try { const sync = await syncComposeProject(project); step(1, 'Синхронизация экранов → src/screens/*.jsx', sync?.output || 'ok'); }
  catch (e) { step(1, 'Синхронизация', String(e), 'error'); }

  // 2) npm install — СТРИМ
  // Сначала убиваем любой идущий npm install / vite (фоновой install при создании
  // проекта или превью) — иначе два npm install в одном каталоге гоняются и
  // калечат node_modules → vite падает на "Failed to resolve react".
  await execute('pkill -f "npm install" 2>/dev/null; pkill -f "npm run dev" 2>/dev/null; pkill -f "vite" 2>/dev/null; sleep 1', projectDir);
  emit('', undefined); emit(`──── [2] npm install ────────────────────────────────`, 'command');
  await streamRun('npm install --no-audit --no-fund 2>&1', projectDir, (l) => emit(l));
  // Проверяем, что react РЕАЛЬНО разрешается. В proot npm иногда оставляет
  // недоустановленный/битый node_modules (особенно если фоновый install при
  // создании проекта не дошёл) → vite падает "Failed to resolve react".
  // Если так — чистая переустановка.
  const reactResolves = async () => /OK/.test((await execute(`node -e "require.resolve('react')" 2>/dev/null && echo OK || echo NO`, projectDir)).output || '');
  if (!(await reactResolves())) {
    emit('', undefined); emit('⚠ react не разрешается — чистая переустановка (rm -rf node_modules package-lock.json && npm install)…', 'warning');
    await streamRun('rm -rf node_modules package-lock.json && npm install --no-audit --no-fund 2>&1', projectDir, (l) => emit(l));
    if (!(await reactResolves())) {
      emit('', undefined); emit('❌ react так и не установился — проверьте сеть и package.json', 'error');
      return { success: false, output: out.join('\n'), apkPath: '', distReady: false, release, logPath: '', copiedApk: '' };
    }
  }

  // 3) vite build — СТРИМ
  emit('', undefined); emit(`──── [3] vite build ────────────────────────────────`, 'command');
  const viteOut = await streamRun('npm run build', projectDir, (l) => emit(l));
  if (/error|failed/i.test(viteOut || '') && !/built in/i.test(viteOut || '')) {
    return { success: false, output: out.join('\n'), apkPath: '', distReady: false, release, logPath: '', copiedApk: '' };
  }

  // 4) cp dist → android/app/src/main/assets
  const cp = await execute(
    'mkdir -p android/app/src/main/assets && rm -rf android/app/src/main/assets/* && cp -r dist/* android/app/src/main/assets/ 2>/dev/null; ' +
    '[ -f android/app/src/main/assets/index.html ] && echo ASSETS_OK || echo ASSETS_MISSING',
    projectDir,
  );
  step(4, 'cp dist → android/app/src/main/assets', cp?.output || '');
  const distReady = /ASSETS_OK/.test(cp.output || '');

  // 5) Gradle Wrapper
  const wrap = await ensureWrapper(projectDir);
  step(5, 'Gradle Wrapper (android/)', wrap.output);

  // 6) assemble — СТРИМ (метод rai build-debug.sh, чистый Java-шелл, без rai)
  let gradleFailed = false;
  if (wrap.ok) {
    emit('', undefined); emit(`──── [6] cd android && ./gradlew ${assembleTask} ────────────────────────────────`, 'command');
    const gOut = await streamRun(gradleScript(assembleTask), projectDir, (l) => emit(l), true);
    if (/BUILD FAILED|FAILURE:|What went wrong|JDK_FAIL|SDK_FAIL|command not found/i.test(gOut || '')) gradleFailed = true;
  } else {
    step(6, 'assemble пропущен', 'Нет wrapper (скачивание не удалось — проверьте сеть). dist уже в android/app/src/main/assets.', 'warning');
  }

  // 7) Результат
  const apkPath = await locateApk(projectDir, apkSub);
  step('✓', 'Результат',
    `${release ? 'Release' : 'Debug'} APK: ${apkPath || 'НЕ СОБРАН'}\n` +
    `WebView-пейлоад (dist → android/app/src/main/assets): ${distReady ? 'ГОТОВ' : 'ОТСУТСТВУЕТ'}\n` +
    `${apkPath ? '✅ APK собран' : (gradleFailed ? '❌ Gradle упал — см. лог выше' : '⚠ APK не найден')}`,
    apkPath ? 'success' : (gradleFailed ? 'error' : 'warning'));

  // 8) Сохранить полный лог + скопировать APK
  const fullLog = out.join('\n');
  const slug = project.slug || String(project.name || 'app').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '') || 'app';
  let logPath = '';
  let copiedApk = '';
  try { const lw = await writeWorkspaceFile(project, 'build.log', fullLog); if (lw?.success) logPath = `${projectDir}/build.log`; } catch (e) {}
  if (apkPath) {
    const base = `${slug}-${apkSub}.apk`;
    const cp2 = await execute(
      `cp -f ${quote(apkPath)} ${quote(projectDir + '/' + base)} 2>/dev/null && echo PROJ_OK; ` +
      // Единая папка артефактов: Загрузки → NovaCompose → <проект> → apk
      `mkdir -p ${quote('/sdcard/Download/NovaCompose/' + slug + '/apk')} 2>/dev/null; cp -f ${quote(apkPath)} ${quote('/sdcard/Download/NovaCompose/' + slug + '/apk/' + base)} 2>/dev/null && echo SDCARD_OK; ` +
      `mkdir -p "$HOME/shared" 2>/dev/null; cp -f ${quote(apkPath)} "$HOME/shared/${base}" 2>/dev/null && echo SHARED_OK`,
      '/');
    const c = cp2.output || '';
    copiedApk = /SDCARD_OK/.test(c) ? `/sdcard/Download/NovaCompose/${slug}/apk/${base}` : /SHARED_OK/.test(c) ? `$HOME/shared/${base}` : /PROJ_OK/.test(c) ? `${projectDir}/${base}` : '';
    step('⎘', 'APK и лог — куда скинуть',
      `APK: ${copiedApk || apkPath}\n` +
      `Лог сборки: ${logPath || 'не сохранён'}\n` +
      (copiedApk ? '✅ APK и build.log доступны — откройте/расшарьте через файловый менеджер.' : 'APK в android/app/build/outputs — откройте через Файлы проекта.'),
      'success');
  } else if (logPath) {
    step('⎘', 'Лог сборки', `Полный лог: ${logPath} — откройте через Файлы проекта и скиньте мне.`, 'info');
  }

  return { success: !!apkPath, output: fullLog, apkPath: copiedApk || apkPath, distReady, release, logPath, copiedApk, rawApkPath: apkPath };
};

export const raiPreview = (name, options: { cwd?: string } = {}) =>
  execute(`echo "Preview через Vite dev server: npm run dev → http://localhost:5173 (открывается в WebView редактора)"`, options.cwd || '/tmp');