/**
 * with-cleartext-preview.js — разрешает cleartext HTTP для локального
 * dev-сервера предпросмотра (Vite на localhost:5173).
 *
 * В debug-сборках Android разрешает cleartext по умолчанию, а в release —
 * блокирует (net::ERR_CLEARTEXT_NOT_PERMITTED). WebView предпросмотра
 * грузит http://127.0.0.1:5173, поэтому в release нужно
 * android:usesCleartextTraffic="true" на уровне <application>.
 *
 * Применяется при каждом `expo prebuild` (android/ перегенерируется).
 */
const { withAndroidManifest } = require('@expo/config-plugins');

function withCleartextPreview(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    if (manifest.manifest.application && manifest.manifest.application[0]) {
      manifest.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    }
    return config;
  });
}

module.exports = withCleartextPreview;
