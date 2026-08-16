const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * RuStore: гарантирует отсутствие android.permission.REQUEST_INSTALL_PACKAGES
 * в итоговом AndroidManifest, даже если сторонняя библиотека его добавляет.
 * Добавляет tools:node="remove" и вычищает дубликаты.
 */
function withRemoveInstallPermission(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    if (!manifest.manifest) return config;
    // 1. Убрать из массива uses-permission
    if (Array.isArray(manifest.manifest['uses-permission'])) {
      manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'].filter((p) => {
        const name = p.$?.['android:name'];
        return name !== 'android.permission.REQUEST_INSTALL_PACKAGES';
      });
    }
    // 2. Добавить явный remove, чтобы перекрыть транзитивные манифесты библиотек
    const removeEntry = {
      $: {
        'android:name': 'android.permission.REQUEST_INSTALL_PACKAGES',
        'tools:node': 'remove',
      },
    };
    // ensure xmlns:tools
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    // не дублировать remove если уже есть
    const hasRemove = manifest.manifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === 'android.permission.REQUEST_INSTALL_PACKAGES' && p.$?.['tools:node'] === 'remove'
    );
    if (!hasRemove) manifest.manifest['uses-permission'].push(removeEntry);

    return config;
  });
}

module.exports = withRemoveInstallPermission;
