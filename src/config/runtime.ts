/**
 * Runtime constants для проектов Java + XML с КАСТОМНОЙ сборкой.
 * Никакого Gradle, Kotlin, npm/Vite: только Java, XML-макеты и
 * инструменты Android SDK (aapt2 → javac → d8 → zipalign → apksigner).
 */
export const ROOTFS_URL = 'https://github.com/wfllive/rootfs/releases/download/1.2-min/ub.tar.gz';
export const ROOTFS_NAME = 'Ubuntu arm64';
export const PROJECTS_ROOT = '/root/projects';

// Android-платформа для сгенерированных проектов.
// Конкретные версии берутся из установленной среды (build.sh сам выбирает
// свежайшие build-tools и платформу), поэтому здесь — безопасные минимум/цель.
export const ANDROID_COMPILE_SDK = 37;
export const ANDROID_TARGET_SDK = 34;
export const ANDROID_MIN_SDK = 24; // Android 7+
export const JAVA_VERSION = 17;

// Совместимость со старым кодом
export const COMPILE_SDK = ANDROID_COMPILE_SDK;
export const TARGET_SDK = ANDROID_TARGET_SDK;
export const MIN_SDK = ANDROID_MIN_SDK;
// Больше не используется (оставлено, чтобы старые импорты не падали)
export const ANDROID_GRADLE_PLUGIN = 'none';
export const GRADLE_VERSION = 'none';
export const KOTLIN_VERSION = 'none';
export const COMPOSE_BOM = 'none';
export const REACT_VERSION = 'none';
export const VITE_VERSION = 'none';
export const REACT_ROUTER_VERSION = 'none';

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
  return ascii || `java-app-${Date.now().toString(36)}`;
};

export const packageSegment = (value = '') => {
  const segment = slugifyProject(value).replace(/-/g, '').replace(/^[0-9]+/, '');
  return segment || 'application';
};

export const getProjectDir = (project: any) =>
  project?.projectDir || `${PROJECTS_ROOT}/${project?.name || project?.slug || slugifyProject(project?.name)}`;

/** Корень исходников Java внутри проекта. */
export const getSourceRoot = () => 'src';
/** Каталоги, которые показываются в проводнике. */
export const getLayoutsDir = () => 'res/layout';
export const getValuesDir = () => 'res/values';

// Артефакты кастомной сборки
export const getDebugApk = (project: any) =>
  `build/outputs/${project?.slug || slugifyProject(project?.name || 'app')}-debug.apk`;
export const getReleaseApk = (project: any) =>
  `build/outputs/${project?.slug || slugifyProject(project?.name || 'app')}-release.apk`;
// Совместимость
export const getReleaseBundle = () => '';
export const getDistDir = () => 'build';
export const getAndroidAssetsDir = () => 'assets';
export const getWebDist = () => '';
