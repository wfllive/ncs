/**
 * Runtime constants for React + Vite + Android WebView projects.
 * NO Kotlin. NO Gradle. NO Compose.
 * Generated projects are plain Vite + React with thin Android WebView wrapper.
 */
export const ROOTFS_URL = 'https://github.com/wfllive/rootfs/releases/download/1.2-min/ub.tar.gz';
export const ROOTFS_NAME = 'Ubuntu arm64';
export const PROJECTS_ROOT = '/root/projects';

// React / Vite / WebView stack (2026)
export const REACT_VERSION = '19.2.8';
export const VITE_VERSION = '5.4.0';
export const REACT_ROUTER_VERSION = '6.26.0';

// Android wrapper (only for WebView container, not UI)
export const ANDROID_COMPILE_SDK = 37;
export const ANDROID_TARGET_SDK = 37;
export const ANDROID_MIN_SDK = 24; // Android 7; newer APIs stay version-gated
export const JAVA_VERSION = 17;

// RAI is vendored in this repository (rai/) and shipped inside the APK
// via the apt-manager module assets (assets/rai/rai.sh) — no GitHub
// download at setup time. This location survives `expo prebuild --clean`.
// (Version: see RAI_VERSION in src/utils/raiSetup.js, from rai/version.json.)

// compat aliases - old code expects these names
export const COMPILE_SDK = ANDROID_COMPILE_SDK;
export const TARGET_SDK = ANDROID_TARGET_SDK;
export const MIN_SDK = ANDROID_MIN_SDK;
export const ANDROID_GRADLE_PLUGIN = '9.3.1';
export const GRADLE_VERSION = '9.6.1';
export const KOTLIN_VERSION = REACT_VERSION; // compat stub
export const COMPOSE_BOM = 'react-webview'; // compat stub

export const slugifyProject = (name = '') => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  const ascii = normalized
    .normalize('NFKD')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
  return ascii || `react-app-${Date.now().toString(36)}`;
};

export const packageSegment = (value = '') => {
  const segment = slugifyProject(value).replace(/-/g, '').replace(/^[0-9]+/, '');
  return segment || 'application';
};

export const getProjectDir = (project) => project?.projectDir || `${PROJECTS_ROOT}/${project?.name || project?.slug || slugifyProject(project?.name)}`;
export const getSourceRoot = (project) => 'src';
export const getScreensDir = (project) => 'src/screens';
export const getDistDir = () => 'dist';
export const getAndroidAssetsDir = () => 'android/app/src/main/assets';

// Compat helpers - old Gradle APK paths now map to dist + WebView APK
export const getDebugApk = () => 'android/app/build/outputs/apk/debug/app-debug.apk';
export const getReleaseApk = () => 'android/app/build/outputs/apk/release/app-release-unsigned.apk';
export const getReleaseBundle = () => 'android/app/build/outputs/bundle/release/app-release.aab';
export const getWebDist = () => 'dist/index.html';
