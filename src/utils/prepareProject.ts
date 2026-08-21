/**
 * prepareProject — быстрая подготовка проекта к кастомной сборке (без Gradle).
 *
 * 1) Самолечение файлов шаблона (восстановить отсутствующие)
 * 2) Проверка окружения: JDK, build-tools, платформа, aapt2, zip
 * 3) Исполняемый build.sh
 *
 * Никаких скачиваний: среда ставится один раз на странице «Установка».
 */
import { execute } from './shellExecutor';
import { getProjectDir } from '../config/runtime';
import { ensureJavaProjectIntegrity } from './javaProject';
import { checkBuildEnv } from './nativeBuild';

export const prepareProject = async (project: any, options: { download?: boolean } = {}) => {
  const cwd = getProjectDir(project);
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  log('1/3 Файлы проекта');
  try {
    const integ = await ensureJavaProjectIntegrity(project);
    if (integ?.restored?.length) log(`  + восстановлены: ${integ.restored.join(', ')}`);
    else log('  все файлы шаблона на месте');
    await execute('chmod +x build.sh 2>/dev/null || true', cwd);
  } catch (e: any) {
    log('  ошибка: ' + (e?.message || String(e)));
  }

  log('2/3 Окружение сборки (без скачиваний)');
  const env = await checkBuildEnv();
  log(env.output.trim());
  if (!env.ok) {
    return {
      success: false,
      output: logs.join('\n') + '\n\n' + env.problems.join('\n'),
      logs,
      ready: false,
    };
  }

  log('3/3 Проверка сборщика');
  const probe = await execute('[ -x build.sh ] && bash -n build.sh && echo SCRIPT_OK || echo SCRIPT_FAIL', cwd);
  const ok = /SCRIPT_OK/.test(String(probe?.output || ''));
  log(ok ? '  build.sh готов (aapt2 → javac → d8 → zipalign → apksigner)' : '  ✗ build.sh повреждён — пересоздайте проект или восстановите файл');

  return { success: ok, output: logs.join('\n'), logs, changes: 0, ready: ok };
};

export default prepareProject;
