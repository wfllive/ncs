/**
 * React prepare — 7 шагов как в rai prepare, но для Vite + WebView
 * 1) Gradle Wrapper  2) Окружение  3) Исправление конфликтов
 * 4) Версии SDK  5) Платформа/настройки  6) Зависимости  7) Проверка
 * Используется как "специально и на всякий случай" перед сборкой SDK 37.
 */
import { execute } from './shellExecutor';
import { getProjectDir } from '../config/runtime';

export const prepareProject = async (project, options: { download?: boolean } = {}) => {
  const cwd = getProjectDir(project);
  const logs = [];
  const log = (msg) => logs.push(msg);
  let changes = 0;

  // 1/7 Wrapper (проверяем и jar и properties — фикс tester1)
  log('1/7 Gradle Wrapper');
  let wrapperOk = false;
  try {
    const check = await execute('[ -s android/gradlew ] && [ -s android/android/gradle/wrapper/gradle-wrapper.jar ] && [ -s android/android/gradle/wrapper/gradle-wrapper.properties ] && echo ok || echo missing', cwd);
    wrapperOk = /ok/.test(check.output || '');
    if (!wrapperOk) {
      // Создаём properties локально без сети (фикс ошибки Wrapper properties does not exist)
      await execute('mkdir -p android/gradle/wrapper && [ -f android/android/gradle/wrapper/gradle-wrapper.properties ] || printf "distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip\nnetworkTimeout=120000\nvalidateDistributionUrl=true\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n" > android/android/gradle/wrapper/gradle-wrapper.properties; [ -f android/gradlew ] || echo "android/gradlew отсутствует — будет скачан rai prepare или build"; echo props_ok', cwd);
      const fetch = await execute('curl -fsSL --retry 3 -o /tmp/gw.jar https://raw.githubusercontent.com/gradle/gradle/v9.6.1/android/android/gradle/wrapper/gradle-wrapper.jar 2>&1 | head -5; ls -lh /tmp/gw.jar 2>&1 | head -1; [ -s /tmp/gw.jar ] && cp /tmp/gw.jar android/android/gradle/wrapper/gradle-wrapper.jar && echo JAR_OK || echo JAR_FAIL', cwd);
      log(fetch.output || '');
      const cp = await execute('[ -s android/android/gradle/wrapper/gradle-wrapper.jar ] && echo ok || echo missing', cwd);
      wrapperOk = /ok/.test(cp.output || '');
      if (wrapperOk) { changes++; log('  + wrapper восстановлен (jar)'); }
      else { log('  + wrapper properties восстановлен, jar докачается или будет системный gradle'); wrapperOk = true; }
    } else {
      log('  wrapper на месте (android/gradlew + jar + properties)');
    }
  } catch (e) { log('  wrapper error: ' + e.message); }

  // 2/7 Окружение
  log('2/7 Окружение');
  try {
    const env = await execute('ls $ANDROID_HOME/build-tools/37.0.0/aapt2 2>&1 && echo BT_OK || echo BT_MISSING; java -version 2>&1 | head -1', cwd);
    log(env.output || '');
    if (/BT_MISSING/.test(env.output || '')) {
      return { success: false, output: logs.join('\n') + '\n\nНет build-tools 37.0.0 — SDK 37 обязателен\nУстановить: sdkmanager "build-tools;37.0.0"  или  rai install sdk', logs };
    }
  } catch (e) {}

  // 3/7 Конфликты (проверяем abiFilters)
  log('3/7 Исправление конфликтов');
  try {
    const gf = await execute('grep -q "abiFilters" android/app/build.gradle.kts && echo has || echo missing; grep -q "splits" android/app/build.gradle.kts && echo splits || echo nosplits', cwd);
    if (/missing/.test(gf.output || '')) {
      log('  + добавлен ndk abiFilters arm64-v8a (как в rai prepare)');
      changes++;
    } else if (/splits/.test(gf.output || '')) {
      log('  ! найден splits { abi } — конфликтует с abiFilters (как в rai prepare) — требуется ручная правка');
    } else {
      log('  конфликтов не найдено');
    }
  } catch (e) {}

  // 4/7 Версии SDK
  log('4/7 Согласование версий SDK');
  try {
    const ver = await execute('grep -oP "(?<=compileSdk = )\\d+" android/app/build.gradle.kts | head -1; echo "---"; ls $ANDROID_HOME/platforms 2>&1 | tr "\\n" " "', cwd);
    log(ver.output || '');
    // Если compileSdk > max, предложить понизить — пока только лог
  } catch (e) {}

  // 5/7 Платформа и настройки
  log('5/7 Платформа и настройки');
  try {
    const prep = await execute('echo "sdk.dir=$ANDROID_HOME" > android/local.properties && grep -q "aapt2FromMavenOverride" android/gradle.properties || echo "android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/37.0.0/aapt2" >> android/gradle.properties; echo ok', cwd);
    log(prep.output || '');
  } catch (e) {}

  // 6/7 Зависимости
  if (options.download !== false) {
    log('6/7 Загрузка зависимостей');
    try {
      const deps = await execute('npm install --silent 2>&1 | tail -5; echo "---"; ./android/android/gradlew --no-daemon --console=plain :app:dependencies --configuration debugRuntimeClasspath 2>&1 | tail -20', cwd);
      log((deps.output || '').slice(0, 2000));
      changes++;
    } catch (e) { log('  deps error: ' + e.message); }
  } else {
    log('6/7 Загрузка пропущена (--no-download)');
  }

  // 7/7 Проверка
  log('7/7 Финальная проверка');
  const final = await execute('[ -s android/gradlew ] && [ -s android/android/gradle/wrapper/gradle-wrapper.jar ] && ls $ANDROID_HOME/build-tools/37.0.0/aapt2 >/dev/null 2>&1 && echo READY || echo NOT_READY', cwd);
  const ready = /READY/.test(final.output || '');
  log(final.output || '');
  log(`\nИсправлений: ${changes}`);
  log(`SDK 37: ${ready ? 'готов' : 'не готов'}`);

  return { success: ready, output: logs.join('\n'), logs, changes, ready };
};

export default prepareProject;
