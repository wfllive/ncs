/**
 * rai.ts — сборка Java + XML проектов КАСТОМНЫМ пайплайном (без Gradle).
 *
 * Раньше здесь был мост к Gradle/Vite; теперь проекты — чистый Java + XML,
 * а собирает их `build.sh` (aapt2 → javac → d8 → zipalign → apksigner).
 * Модуль оставлен как точка входа: создание проекта, сборка, окружение.
 */
import { javaNew } from './javaProject';
import { buildProject, checkBuildEnv, exportApk, apkOutputPath } from './nativeBuild';
import { getProjectDir } from '../config/runtime';

/** Создать Java + XML проект на диске (мгновенно, без скачиваний). */
export const raiNew = async (
  name: string,
  packageName = `com.rnstudio.${String(name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'app'}`,
) => javaNew(name, packageName);

/** Краткая сводка окружения сборки (для журнала). */
export const envSummary = async () => {
  const env = await checkBuildEnv();
  return env.output + (env.ok ? '✓ окружение готово' : `✗ проблемы: ${env.problems.join('; ')}`);
};

/**
 * Полная кастомная сборка (debug | release) со стримингом.
 * Совместима со старым API: { success, output, apkPath, copiedApk, release }.
 */
export const raiBuild = async (
  project: any,
  variant: 'debug' | 'release' = 'debug',
  cwd: string | undefined = undefined,
  onLine: (text: string, level?: string) => void = () => {},
) => {
  if (!project) return { success: false, output: 'No project', apkPath: '', copiedApk: '', release: variant === 'release' };
  const dir = cwd || getProjectDir(project);
  const emit = (text: string, level?: string) => { try { onLine(text, level); } catch (_) {} };

  const env = await checkBuildEnv();
  emit(env.output, env.ok ? 'info' : 'warning');
  if (!env.ok) env.problems.forEach((p) => emit(`⚠ ${p}`, 'warning'));

  const r = await buildProject(project, variant, (line) => emit(line));
  let copiedApk = '';
  if (r.apkPath) {
    const ex = await exportApk(project, r.apkPath, variant);
    if (ex.success) {
      copiedApk = ex.path;
      emit(`⎘ Экспорт: ${ex.path}`, 'success');
    }
  }
  return {
    success: r.success,
    output: r.output,
    apkPath: r.apkPath,
    copiedApk,
    rawApkPath: r.apkPath,
    release: variant === 'release',
    logPath: '',
    distReady: true,
  };
};

export const raiKeystore = async (project: any) => {
  const { execute } = await import('./shellExecutor');
  const r = await execute('bash build.sh keystore 2>&1', getProjectDir(project));
  return { success: Boolean(r?.success), output: String(r?.output || '') };
};

export const getDebugApkPath = (project: any) => apkOutputPath(project, 'debug');
export const getReleaseApkPath = (project: any) => apkOutputPath(project, 'release');

export default { raiNew, raiBuild, raiKeystore, envSummary, checkBuildEnv };
