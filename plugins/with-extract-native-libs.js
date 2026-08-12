const { withAndroidManifest } = require('@expo/config-plugins');

function withExtractNativeLibs(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    if (manifest.manifest.application && manifest.manifest.application[0]) {
      manifest.manifest.application[0].$['android:extractNativeLibs'] = 'true';
    }
    return config;
  });
}

module.exports = withExtractNativeLibs;
