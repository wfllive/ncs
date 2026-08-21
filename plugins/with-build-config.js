/**
 * with-build-config.js — минимальный плагин.
 *
 * После КАЖДОГО `expo prebuild --clean` добавляет в android/app/build.gradle:
 *
 *     buildFeatures {
 *         buildConfig true
 *     }
 *
 * Это ТРЕБУЕТСЯ для AGP 8+ (который идёт с Expo SDK 50+), где по умолчанию
 * класс BuildConfig НЕ генерируется. Без этой строки Kotlin-код, обращающийся
 * к BuildConfig.EXPECTED_SIGNATURE_SHA256 (SecurityUtils.kt), падает с
 * "Unresolved reference: BuildConfig".
 *
 * Всё остальное — keystore helpers, release signing, buildConfigField
 * EXPECTED_SIGNATURE_SHA256, hasReleaseKey-проверку — добавляет
 * with-security-guard.js. Этот плагин только активирует генерацию BuildConfig.
 *
 * Плагин идемпотентен: повторный запуск не дублирует блок.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Ищет границы блока { ... }, начиная со строки startIdx.
 * Корректно обрабатывает строки, комментарии и вложенные {}.
 */
function findBlockRange(lines, startIdx) {
  let depth = 0;
  let inString = null;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const nx = line[j + 1];
      if (inString === '/*') {
        if (ch === '*' && nx === '/') { inString = null; j++; }
        continue;
      }
      if (inString === '"' || inString === "'") {
        if (ch === '\\') { j++; continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '/' && nx === '/') break;
      if (ch === '/' && nx === '*') { inString = '/*'; j++; continue; }
      if (ch === '"' || ch === "'") { inString = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return [startIdx, i];
      }
    }
  }
  return [startIdx, lines.length - 1];
}

function editBuildGradle(contents) {
  let lines = contents.split(/\r?\n/);

  const androidIdx = lines.findIndex((l) => /^\s*android\s*\{/.test(l));
  if (androidIdx < 0) return contents;
  const [, aEnd] = findBlockRange(lines, androidIdx);

  // Есть ли уже buildFeatures { buildConfig true }?
  let hasBuildFeaturesBlock = false;
  let hasBuildConfigTrue = false;
  for (let i = androidIdx + 1; i < aEnd; i++) {
    if (/^\s*buildFeatures\s*\{/.test(lines[i])) {
      hasBuildFeaturesBlock = true;
      const [s, e] = findBlockRange(lines, i);
      for (let k = s; k <= e; k++) {
        if (/^\s*buildConfig\s+true\s*$/.test(lines[k])) { hasBuildConfigTrue = true; break; }
      }
      break;
    }
  }
  if (hasBuildConfigTrue) return lines.join('\n');

  if (hasBuildFeaturesBlock) {
    // вставить buildConfig true внутрь существующего buildFeatures { ... }
    for (let i = androidIdx + 1; i < aEnd; i++) {
      if (/^\s*buildFeatures\s*\{/.test(lines[i])) {
        lines.splice(i + 1, 0, '        buildConfig true');
        return lines.join('\n');
      }
    }
  }

  // Вставить buildFeatures блок после namespace
  let nsIdx = -1;
  for (let i = androidIdx + 1; i < aEnd; i++) {
    if (/^\s*namespace\s+['"]/.test(lines[i])) { nsIdx = i; break; }
  }
  if (nsIdx < 0) return lines.join('\n');

  const ind = lines[nsIdx].match(/^(\s*)/)?.[1] || '    ';
  let insertAt = nsIdx + 1;
  if (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  lines.splice(insertAt, 0,
    `${ind}buildFeatures {`,
    `${ind}    buildConfig true`,
    `${ind}}`,
    '',
  );
  return lines.join('\n');
}

function withBuildConfig(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = editBuildGradle(config.modResults.contents);
    return config;
  });
}

module.exports = withBuildConfig;
