/**
 * with-storm-bundle.js — упаковывает вендоренный сборщик Storm Build
 * (папка storm/) в единый ZIP и кладёт его в assets нативного модуля
 * apt-manager при каждом `expo prebuild`.
 *
 * Схема та же, что у RAI (см. with-rai-bundle.js):
 *   - modules/ prebuild не перегенерирует, файл переживает --clean;
 *   - нативный модуль (seedStormBundle) копирует asset в rootfs:
 *     /root/storm-bundle.zip;
 *   - шаг установки распаковывает его в /root/storm и ставит лаунчер.
 *
 * Итог: установка и сборка работают БЕЗ доступа к GitHub.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['.git', '__pycache__', '.DS_Store']);
const SKIP_EXT = new Set(['.pyc']);

function walk(dir, base, zip) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(full, base, zip);
    } else if (!SKIP_EXT.has(path.extname(entry.name))) {
      zip.file(rel, fs.readFileSync(full));
    }
  }
}

function withStormBundle(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const srcDir = path.join(projectRoot, 'storm');
    const destDir = path.join(
      projectRoot,
      'modules', 'apt-manager', 'android', 'src', 'main', 'assets', 'storm',
    );
    if (!fs.existsSync(path.join(srcDir, 'storm_engine'))) {
      // Не роняем prebuild: если storm/ нет — просто пропускаем.
      return config;
    }
    const JSZip = require('jszip');
    const zip = new JSZip();
    walk(srcDir, srcDir, zip);
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'storm-bundle.zip'), buffer);
    console.log(`[with-storm-bundle] storm-bundle.zip: ${(buffer.length / 1024).toFixed(0)} KB`);
    return config;
  }]);
}

module.exports = withStormBundle;
