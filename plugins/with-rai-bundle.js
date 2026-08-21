/**
 * with-rai-bundle.js — копирует вендоренный бандл RAI (rai/rai.sh)
 * и NCS Build shell-скрипты в assets нативного модуля apt-manager
 * при каждом `expo prebuild`.
 *
 * Почему в модуль, а не в android/app/src/main/assets:
 *   - `expo prebuild` перегенерирует папку android/ (особенно --clean),
 *     и файлы, положенные туда, могут пропасть;
 *   - папку modules/ prebuild НЕ трогает — она живёт в репозитории;
 *   - при gradle-сборке assets библиотечного модуля сливаются в APK,
 *     поэтому `seedRaiBundle`/`seedNcsScripts` находят их через
 *     assets.open("rai/rai.sh") / assets.open("rai/ncs/*.sh").
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function withRaiBundle(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const assetsDir = path.join(
      projectRoot,
      'modules', 'apt-manager', 'android', 'src', 'main', 'assets', 'rai',
    );
    fs.mkdirSync(assetsDir, { recursive: true });

    // RAI bundle (legacy Node.js CLI)
    const raiBundle = path.join(projectRoot, 'rai', 'rai.sh');
    if (fs.existsSync(raiBundle)) {
      fs.copyFileSync(raiBundle, path.join(assetsDir, 'rai.sh'));
    }

    // NCS Build scripts (fast install + build + new-project)
    const ncsSrcDir = path.join(projectRoot, 'rai', 'src', 'shell', 'ncs-build');
    const ncsAssetsDir = path.join(assetsDir, 'ncs');
    fs.mkdirSync(ncsAssetsDir, { recursive: true });
    for (const f of ['fast-install.sh', 'ncs-build.sh', 'new-project.sh']) {
      copyFile(path.join(ncsSrcDir, f), path.join(ncsAssetsDir, f));
    }

    return config;
  }]);
}

module.exports = withRaiBundle;
