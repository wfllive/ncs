/**
 * nativeBuild.ts — запуск КАСТОМНОЙ сборки (без Gradle) и работа с артефактами.
 *
 * Всё делает `build.sh` проекта (aapt2 → javac → d8 → zipalign → apksigner);
 * здесь — окружение, стриминг лога, поиск и экспорт APK, установка на устройство.
 */
import { execute, streamExecute } from './shellExecutor';
import { shellQuote } from './workspace';
import { getProjectDir, slugifyProject } from '../config/runtime';
import * as apt from '../../modules/apt-manager/src/index';

/** Проверка окружения сборки: Storm + JDK + aapt2 + платформа. Без сети. */
export const checkBuildEnv = async () => {
  const r = await execute(
    'SDK="${ANDROID_HOME:-$HOME/android-sdk}"; ' +
    'echo "storm: $(command -v storm >/dev/null 2>&1 && echo ЕСТЬ || echo НЕТ)"; ' +
    'echo "python3: $(python3 --version 2>&1 | head -1 || echo НЕТ)"; ' +
    'echo "javac: $(javac -version 2>&1 | head -1 || echo НЕТ)"; ' +
    'AAPT2="$(command -v aapt2 2>/dev/null || command -v aapt 2>/dev/null || true)"; ' +
    '[ -z "$AAPT2" ] && [ -x "$HOME/.storm/tools/aapt2" ] && AAPT2="$HOME/.storm/tools/aapt2"; ' +
    '[ -z "$AAPT2" ] && AAPT2="$(ls "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"; ' +
    'echo "aapt2: ${AAPT2:-НЕТ}"; ' +
    'JAR="$(ls "$HOME"/.storm/tools/android-*.jar 2>/dev/null | tail -1)"; ' +
    '[ -z "$JAR" ] && JAR="$(ls "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)"; ' +
    'echo "android.jar: ${JAR:-НЕТ}"; ' +
    'command -v zip >/dev/null 2>&1 && echo ZIP_OK || echo ZIP_MISSING',
    '/',
  );
  const out = String(r?.output || '');
  const problems: string[] = [];
  if (/storm:.*НЕТ/.test(out)) problems.push('Storm Build не установлен — страница «Установка среды», шаг «Storm Build (install.sh)»');
  if (/python3:.*НЕТ/.test(out)) problems.push('Нет python3 (нужен для Storm Build) — установка среды');
  if (/javac:.*НЕТ/.test(out)) problems.push('Нет JDK — выполните установку среды (страница «Установка»)');
  if (/aapt2:.*НЕТ/.test(out)) problems.push('Нет aapt2 — повторите шаг «Storm Build» (install.sh докачает его)');
  if (/android\.jar:.*НЕТ/.test(out)) problems.push('Нет android.jar — повторите шаг «Storm Build» (install.sh докачает его)');
  if (/ZIP_MISSING/.test(out)) problems.push('Нет утилиты zip (apt install zip)');
  return { ok: problems.length === 0, problems, output: out };
};

/** Путь к артефакту, который создаёт сборка (имя задаёт storm.m: slug-variant). */
export const apkOutputPath = (project: any, variant: 'debug' | 'release' | 'aab' = 'debug') => {
  const slug = String(project?.slug || slugifyProject(project?.name || 'app') || 'app').replace(/[^a-z0-9-]/g, '-');
  const ext = variant === 'aab' ? 'aab' : 'apk';
  return `${getProjectDir(project)}/build/outputs/${slug}-${variant}.${ext}`;
};

/**
 * Запустить кастомную сборку со стримингом вывода.
 * @param onLine — вызывается на каждую строку лога.
 * @returns { success, output, apkPath }
 */
export const buildProject = async (
  project: any,
  variant: 'debug' | 'release' = 'debug',
  onLine: (line: string) => void = () => {},
) => {
  if (!project) return { success: false, output: 'No project', apkPath: '' };
  const cwd = getProjectDir(project);

  // Убедимся, что сборщик на месте (самолечение только отсутствующих файлов).
  await execute('[ -f build.sh ] || echo MISSING', cwd).then(async (r) => {
    if (/MISSING/.test(r?.output || '')) {
      const { ensureJavaProjectIntegrity } = await import('./javaProject');
      await ensureJavaProjectIntegrity(project);
      await execute('chmod +x build.sh 2>/dev/null || true', cwd);
    }
  });

  const started = Date.now();
  onLine(`$ bash build.sh ${variant}  (кастомный пайплайн: без Gradle)`);
  const res = await streamExecute(`bash build.sh ${variant} 2>&1; echo BUILD_EXIT:$?`, cwd, onLine);
  const out = String(res?.output || '');
  const ok = /BUILD_EXIT:0\b/.test(out);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  let apkPath = '';
  if (ok) {
    const expected = apkOutputPath(project, variant);
    const probe = await execute(`[ -s ${shellQuote(expected)} ] && echo FOUND || find build/outputs -name '*.apk' 2>/dev/null | head -1`, cwd);
    const po = String(probe?.output || '').trim();
    if (/FOUND/.test(po)) apkPath = expected;
    else if (po) apkPath = po.startsWith('/') ? po : `${cwd}/${po}`;
  }
  onLine(ok
    ? `✓ Сборка завершена за ${seconds}s → ${apkPath || '(APK не найден)'}`
    : `✗ Сборка упала (${seconds}s) — смотрите лог выше`);
  return { success: ok && Boolean(apkPath), output: out, apkPath, seconds };
};

/** Экспорт APK в Загрузки/NovaCompose/<проект>/apk (общая папка артефактов). */
export const exportApk = async (project: any, apkPath: string, variant = 'debug') => {
  const slug = String(project?.slug || slugifyProject(project?.name || 'app') || 'app');
  const dir = `/sdcard/Download/NovaJava/${slug}/apk`;
  const base = `${slug}-v${project?.versionName || '1.0.0'}-${variant}.apk`;
  const r = await execute(
    `mkdir -p ${shellQuote(dir)} 2>/dev/null && cp -f ${shellQuote(apkPath)} ${shellQuote(`${dir}/${base}`)} && echo EXPORT_OK`,
    '/',
  );
  const ok = /EXPORT_OK/.test(String(r?.output || ''));
  return { success: ok, path: ok ? `${dir}/${base}` : '' };
};

/** Установка собранного APK на устройство (через нативный модуль). */
export const installApk = async (apkPath: string) => {
  if (!apkPath) return { success: false, output: 'Нет APK' };
  const probe = await execute(`[ -s ${shellQuote(apkPath)} ] && echo FOUND || echo MISSING`, '/');
  if (!/FOUND/.test(String(probe?.output || ''))) {
    return { success: false, output: `APK не найден: ${apkPath}` };
  }
  const r = await apt.installApk(apkPath);
  return { success: Boolean(r?.success), output: r?.output || apkPath };
};

/** Запустить установленное приложение по пакету. */
export const launchApp = async (packageName: string) => {
  if (!packageName) return { success: false, output: 'Нет package name' };
  const r = await apt.launchPackage(packageName);
  return { success: Boolean(r?.success), output: r?.output || packageName };
};

/** Проверка артефакта: badging через aapt2 (битый APK видно сразу). */
export const verifyApk = async (apkPath: string, onLine: (line: string) => void = () => {}) => {
  const cmd =
    'SDK="${ANDROID_HOME:-$HOME/android-sdk}"; ' +
    'BT=$(ls "$SDK/build-tools" 2>/dev/null | grep -E \'^[0-9]\' | sort -V | tail -1); ' +
    `if [ -x "$SDK/build-tools/$BT/aapt2" ]; then "$SDK/build-tools/$BT/aapt2" dump badging ${shellQuote(apkPath)} 2>/dev/null | grep -E '^(package|application-label|sdkVersion|targetSdkVersion|launchable-activity):' | head -8 || echo 'APK повреждён?'; ` +
    'else echo "aapt2 не найден — проверка пропущена"; fi';
  const res = await streamExecute(cmd, '/', onLine);
  return String(res?.output || '');
};

export default {
  checkBuildEnv,
  buildProject,
  apkOutputPath,
  exportApk,
  installApk,
  launchApp,
  verifyApk,
};
