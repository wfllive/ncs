/**
 * with-rai-bundle.js — копирует вендоренный бандл RAI (rai/rai.sh) в
 * assets нативного модуля apt-manager при каждом `expo prebuild`.
 *
 * Почему в модуль, а не в android/app/src/main/assets:
 *   - `expo prebuild` перегенерирует папку android/ (особенно --clean),
 *     и файлы, положенные туда, могут пропасть;
 *   - папку modules/ prebuild НЕ трогает — она живёт в репозитории;
 *   - при gradle-сборке assets библиотечного модуля сливаются в APK,
 *     поэтому `seedRaiBundle` находит rai.sh через assets.open("rai/rai.sh")
 *     в любом сценарии (prebuild, expo run:android, EAS).
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withRaiBundle(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const src = path.join(projectRoot, 'rai', 'rai.sh');
    const destDir = path.join(
      projectRoot,
      'modules', 'apt-manager', 'android', 'src', 'main', 'assets', 'rai',
    );
    if (!fs.existsSync(src)) {
      // Не роняем prebuild: если rai/ нет — просто пропускаем.
      return config;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, 'rai.sh'));
    return config;
  }]);
}

module.exports = withRaiBundle;
