/**
 * with-security-guard.js — Expo Config Plugin.
 *
 * При КАЖДОМ `expo prebuild --clean` восстанавливает в android/app/build.gradle:
 *   - buildFeatures { buildConfig true }  (требуется для AGP 8+ / Expo SDK 50+)
 *   - хелпер findKeystoreFile + чтение keystore.properties + expectedSha256
 *   - signingConfigs.release с V1/V2/V3 (keystore.properties / ENV / MYAPP_RELEASE_*)
 *   - buildTypes.release: signingConfig signingConfigs.release +
 *     проверка hasReleaseKey → GradleException если ключа нет
 *   - buildConfigField "String", "EXPECTED_SIGNATURE_SHA256", "\"${expectedSha256}\""
 *
 * Плюс: копирует src/native/security/*.kt в android/.../security/,
 * регистрирует SecurityPackage в MainApplication.kt, добавляет proguard -keep.
 *
 * Плагин идемпотентен.
 */
const {
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// =========================================================================
// Низкоуровневые утилиты для разбора Gradle-файла
// =========================================================================

function skipQuoted(line, j) {
  const q = line[j]; j++;
  while (j < line.length) {
    if (line[j] === '\\') { j += 2; continue; }
    if (line[j] === q) return j + 1;
    j++;
  }
  return j;
}

function matchCloseBrace(lines, startLine, startCol, targetDepth) {
  let depth = 0, started = false, i = startLine, j = startCol;
  while (i < lines.length) {
    const line = lines[i];
    while (j < line.length) {
      const ch = line[j], nx = line[j + 1];
      if (ch === '"' || ch === "'") { j = skipQuoted(line, j); continue; }
      if (ch === '/' && nx === '/') break;
      if (ch === '/' && nx === '*') {
        j += 2; let done = false;
        while (i < lines.length) {
          const l = lines[i];
          while (j < l.length) {
            if (l[j] === '*' && l[j+1] === '/') { j += 2; done = true; break; }
            j++;
          }
          if (done) break;
          i++; j = 0;
        }
        continue;
      }
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') {
        if (started) depth--;
        if (started && depth === targetDepth) return { line: i, col: j };
      }
      j++;
    }
    i++; j = 0;
  }
  return null;
}

function findAndroid(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*android\s*\{/.test(lines[i])) {
      const oc = lines[i].indexOf('{');
      const cl = matchCloseBrace(lines, i, oc, 0);
      if (cl) return { line: i, openCol: oc, closeLine: cl.line, closeCol: cl.col };
    }
  }
  return null;
}

// Ищет блок "<kw> { ... }", который является прямым потомком parent
// (т.е. его открывающая '{' находится на глубине 1 относительно parent).
function findChild(lines, parent, kwRegex) {
  let depth = 0, i = parent.line, j = parent.openCol;
  while (i <= parent.closeLine) {
    const line = lines[i];
    while (j < line.length) {
      const ch = line[j], nx = line[j + 1];
      if (ch === '"' || ch === "'") { j = skipQuoted(line, j); continue; }
      if (ch === '/' && nx === '/') break;
      if (ch === '/' && nx === '*') {
        j += 2; let done = false;
        while (i <= parent.closeLine + 1) {
          const l = lines[i];
          while (j < l.length) {
            if (l[j] === '*' && l[j+1] === '/') { j += 2; done = true; break; }
            j++;
          }
          if (done) break;
          i++; j = 0;
        }
        continue;
      }
      if (ch === '{') {
        if (depth === 1) {
          // Извлекаем имя блока как текст от последнего разделителя до '{'
          const prev1 = line.lastIndexOf('{', j - 1);
          const prev2 = line.lastIndexOf(';', j - 1);
          const from = Math.max(prev1, prev2, 0) + 1;
          const name = line.slice(from, j).trim();
          if (kwRegex.test(name)) {
            const cl = matchCloseBrace(lines, i, j, 0);
            if (cl) return { line: i, openCol: j, closeLine: cl.line, closeCol: cl.col };
          }
        }
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth <= 0 && (i > parent.line || j > parent.openCol)) return null;
      }
      j++;
    }
    i++; j = 0;
  }
  return null;
}

// Раскрывает однострочный блок вида `foo { a; b; c }` на отдельные строки.
// В отличие от наивного split(';'), учитывает вложенные { }, чтобы не разрывать
// внутренние блоки (например `release { ...; ... }` остаётся единым).
function ensureMultiline(lines, idx) {
  const line = lines[idx];
  const open = line.indexOf('{');
  if (open < 0) return;
  const cl = matchCloseBrace(lines, idx, open, 0);
  if (!cl) return;
  if (cl.line !== idx) return; // уже многострочный
  const indent = (line.match(/^(\s*)/) || ['', ''])[1];
  const innerRaw = line.slice(open + 1, cl.col);
  const innerIndent = indent + '    ';
  const after = line.slice(cl.col + 1);

  // Разбиваем innerRaw на элементы верхнего уровня (не разделяя ';' внутри вложенных {})
  const parts = [];
  let buf = '', depth = 0, inStr = null;
  for (let k = 0; k < innerRaw.length; k++) {
    const ch = innerRaw[k];
    if (inStr) {
      buf += ch;
      if (ch === '\\' && k + 1 < innerRaw.length) { buf += innerRaw[++k]; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue; }
    if (ch === '{') { depth++; buf += ch; continue; }
    if (ch === '}') { depth--; buf += ch; continue; }
    if (ch === ';' && depth === 0) {
      const s = buf.trim(); if (s) parts.push(s);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);

  const replacement = [line.slice(0, open + 1)];
  for (const p of parts) replacement.push(innerIndent + p);
  replacement.push(indent + '}' + after);
  lines.splice(idx, 1, ...replacement);
}

// Удаляет все NCS-маркированные блоки с прошлых запусков.
const RE_START = /^\/\/\s*NCS-[A-Z0-9_-]+-START\b/;
const RE_END   = /^\/\/\s*NCS-[A-Z0-9_-]+-END\b/;
function stripMarkedBlocks(lines) {
  const out = [];
  let skip = 0;
  for (const line of lines) {
    const t = line.trim();
    if (RE_START.test(t)) { skip++; continue; }
    if (RE_END.test(t))   { skip--; continue; }
    if (skip > 0) continue;
    out.push(line);
  }
  return out;
}

// Удаляет диапазон строк [start, end] ВКЛЮЧИТЕЛЬНО.
function deleteRange(lines, start, end) {
  lines.splice(start, end - start + 1);
}

// =========================================================================
// Основная функция правки build.gradle
// =========================================================================

const KEY_S = '    // NCS-KEYSTORE-START (do not edit by hand)';
const KEY_E = '    // NCS-KEYSTORE-END';
const keystoreBlock = [
  KEY_S,
  '    // Load release signing configuration from keystore.properties if present',
  '    def findKeystoreFile = { String name ->',
  '        if (!name) return new File(projectRoot, "ncs.keystore")',
  '        def f1 = new File(projectRoot, name)',
  '        if (f1.exists()) return f1',
  '        def f2 = rootProject.file(name)',
  '        if (f2.exists()) return f2',
  '        def f3 = file(name)',
  '        if (f3.exists()) return f3',
  '        return f1',
  '    }',
  '',
  '    def keystorePropsFile = findKeystoreFile("keystore.properties")',
  '    def keystoreProps = new Properties()',
  '    if (keystorePropsFile.exists()) {',
  '        keystoreProps.load(new FileInputStream(keystorePropsFile))',
  '    }',
  "    def expectedSha256 = keystoreProps.getProperty('expectedSha256', System.getenv(\"EXPECTED_SIGNATURE_SHA256\") ?: \"\")",
  KEY_E,
];

const REL_S = '        // NCS-RELEASE-SIGNING-START';
const REL_E = '        // NCS-RELEASE-SIGNING-END';
const releaseSignBlock = [
  REL_S,
  '        release {',
  '            if (keystorePropsFile.exists()) {',
  "                def sfPath = keystoreProps['storeFile'] ?: \"ncs\"",
  '                storeFile findKeystoreFile(sfPath)',
  "                storePassword keystoreProps['storePassword']",
  "                keyAlias keystoreProps['keyAlias']",
  "                keyPassword keystoreProps['keyPassword']",
  '                enableV1Signing true',
  '                enableV2Signing true',
  '                enableV3Signing true',
  '            } else if (System.getenv("KEYSTORE_FILE") != null) {',
  '                storeFile file(System.getenv("KEYSTORE_FILE"))',
  '                storePassword System.getenv("KEYSTORE_PASSWORD")',
  '                keyAlias System.getenv("KEY_ALIAS")',
  '                keyPassword System.getenv("KEY_PASSWORD")',
  '                enableV1Signing true',
  '                enableV2Signing true',
  '                enableV3Signing true',
  "            } else if (findProperty('MYAPP_RELEASE_STORE_FILE') != null) {",
  "                storeFile file(findProperty('MYAPP_RELEASE_STORE_FILE'))",
  "                storePassword findProperty('MYAPP_RELEASE_STORE_PASSWORD')",
  "                keyAlias findProperty('MYAPP_RELEASE_KEY_ALIAS')",
  "                keyPassword findProperty('MYAPP_RELEASE_KEY_PASSWORD')",
  '                enableV1Signing true',
  '                enableV2Signing true',
  '                enableV3Signing true',
  '            }',
  '        }',
  REL_E,
];

const CHK_S = '            // NCS-RELEASE-CHECK-START';
const CHK_E = '            // NCS-RELEASE-CHECK-END';
const checkBlock = [
  CHK_S,
  '            def hasReleaseKey = keystorePropsFile.exists() || System.getenv("KEYSTORE_FILE") != null || findProperty("MYAPP_RELEASE_STORE_FILE") != null',
  '            if (!hasReleaseKey) {',
  '                throw new GradleException("ОШИБКА ПОДПИСИ РЕЛИЗА: Не найден файл keystore.properties или ключ подписи! Перед сборкой релиза запустите \'npm run key\' в корне проекта.")',
  '            }',
  '            signingConfig signingConfigs.release',
  CHK_E,
];

function editBuildGradle(contents) {
  let lines = contents.split(/\r?\n/);

  // 0. Сначала раскрываем все однострочные блоки (чтобы дальше не возиться с ними),
  //    затем сносим старые NCS-блоки и legacy-вставки.
  for (let pass = 0; pass < 10; pass++) {
    let any = false;
    const a = findAndroid(lines);
    if (a) {
      for (const parent of [a,
        findChild(lines, a, /^signingConfigs$/),
        findChild(lines, a, /^buildTypes$/),
      ]) {
        if (!parent) continue;
        // Ищем все прямые блоки внутри parent через перебор фигурных скобок
        let depth = 0, i = parent.line, j = parent.openCol;
        while (i <= parent.closeLine) {
          const line = lines[i];
          while (j < line.length) {
            const ch = line[j], nx = line[j+1];
            if (ch === '"' || ch === "'") { j = skipQuoted(line, j); continue; }
            if (ch === '/' && nx === '/') break;
            if (ch === '/' && nx === '*') { j += 2; let done=false; while(i<=parent.closeLine+1){const l=lines[i];while(j<l.length){if(l[j]==='*'&&l[j+1]==='/'){j+=2;done=true;break;}j++;}if(done)break;i++;j=0;} continue; }
            if (ch === '{') {
              if (depth === 1 && i > parent.line) {
                // нашли открывающую скобку прямого потомка
                const cl = matchCloseBrace(lines, i, j, 0);
                if (cl && cl.line === i) { ensureMultiline(lines, i); any = true; i = -1; j = 0; break; }
              }
              depth++;
            } else if (ch === '}') { depth--; if (depth <= 0 && (i > parent.line || j > parent.openCol)) { i = lines.length; break; } }
            j++;
          }
          if (i === -1) break;
          i++; j = 0;
        }
        if (any) break;
      }
    }
    if (!any) break;
  }

  // 1. Сносим старые NCS-блоки.
  lines = stripMarkedBlocks(lines);

  let andr = findAndroid(lines);
  if (!andr) return lines.join('\n');

  // 2. Удаляем legacy-вставки без маркеров (от ручной правки / старых версий).
  const stripLegacy = () => {
    let changed = false;
    const a = findAndroid(lines);
    if (!a) return false;

    // findKeystoreFile … def expectedSha256 (целиком)
    let ksStart = -1, ksEnd = -1;
    for (let i = a.line + 1; i < a.closeLine; i++) {
      const t = lines[i].trim();
      if (ksStart < 0 && /^def\s+findKeystoreFile\b/.test(t)) ksStart = i;
      if (ksStart >= 0 && /^def\s+expectedSha256\b/.test(t)) { ksEnd = i; break; }
    }
    if (ksStart >= 0 && ksEnd >= 0) {
      while (ksStart > a.line + 1 && lines[ksStart - 1].trim() === '') ksStart--;
      while (ksEnd < a.closeLine - 1 && lines[ksEnd + 1].trim() === '') ksEnd++;
      // также захватываем предшествующий комментарий "Load release signing..."
      if (ksStart > a.line + 1 && /^\/\//.test(lines[ksStart - 1].trim())) ksStart--;
      deleteRange(lines, ksStart, ksEnd);
      changed = true;
    }

    const a2 = findAndroid(lines); if (!a2) return changed;
    // signingConfigs.release (не-маркированный)
    const sc = findChild(lines, a2, /^signingConfigs$/);
    if (sc) {
      for (let pass = 0; pass < 3; pass++) {
        const sc2 = findChild(lines, findAndroid(lines), /^signingConfigs$/);
        if (!sc2) break;
        const rel = findChild(lines, sc2, /^release$/);
        if (!rel) break;
        // Удаляем только если в блоке нет нашего маркера (он уже снесён выше)
        const body = lines.slice(rel.line, rel.closeLine + 1).join('\n');
        if (/NCS-RELEASE-SIGNING/.test(body)) break;
        deleteRange(lines, rel.line, rel.closeLine);
        changed = true;
      }
    }

    // buildTypes.release: вычищаем hasReleaseKey/GradleException/signingConfig release/debug,
    // а также многострочный if (!hasReleaseKey) { ... throw ... }
    const a3 = findAndroid(lines); if (a3) {
      const bt = findChild(lines, a3, /^buildTypes$/);
      if (bt) {
        const rel0 = findChild(lines, bt, /^release$/);
        if (rel0) ensureMultiline(lines, rel0.line);
        const bt2 = findChild(lines, findAndroid(lines), /^buildTypes$/);
        if (bt2) {
          const rel = findChild(lines, bt2, /^release$/);
          if (rel) {
            for (let pi = rel.line + 1; pi < rel.closeLine; pi++) {
              const t = lines[pi].trim();
              if (/if\s*\(\s*!hasReleaseKey\s*\)\s*\{/.test(t)) {
                const op = lines[pi].indexOf('{');
                if (op >= 0) {
                  // Ищем закрывающую '}' для этого if (targetDepth=0, ибо стартуем с '{')
                  const cl = matchCloseBrace(lines, pi, op, 0);
                  if (cl) {
                    const body = lines.slice(pi + 1, cl.line).join('\n');
                    if (!/signingConfig|minifyEnabled|shrinkResources|proguardFiles|crunchPngs|enableShrink/i.test(body)) {
                      // Удаляем также предшествующую пустую строку-комментарий
                      let startDel = pi;
                      while (startDel > rel.line + 1 && lines[startDel - 1].trim() === '') startDel--;
                      // и последующую пустую строку
                      let endDel = cl.line;
                      while (endDel < rel.closeLine - 1 && lines[endDel + 1].trim() === '') endDel++;
                      deleteRange(lines, startDel, endDel);
                      changed = true;
                      break;
                    }
                  }
                }
              }
            }
            const rel2 = findChild(lines, findChild(lines, findAndroid(lines), /^buildTypes$/), /^release$/);
            if (rel2) {
              for (let pi = rel2.closeLine - 1; pi > rel2.line; pi--) {
                const t = lines[pi].trim();
                if (/^def\s+hasReleaseKey\b/.test(t) ||
                    /throw\s+new\s+GradleException\s*\(/.test(t) ||
                    /^signingConfig\s+signingConfigs\.(release|debug)\b/.test(t) ||
                    /^\/\/\s*NCS-RELEASE-CHECK-(START|END)\b/.test(t)) {
                  lines.splice(pi, 1);
                  changed = true;
                }
              }
            }
          }
        }
      }
    }

    // defaultConfig: старый buildConfigField EXPECTED_SIGNATURE_SHA256
    const a4 = findAndroid(lines); if (a4) {
      const dc = findChild(lines, a4, /^defaultConfig$/);
      if (dc) {
        for (let pi = dc.closeLine - 1; pi > dc.line; pi--) {
          if (/buildConfigField\s+"String"\s*,\s*"EXPECTED_SIGNATURE_SHA256"/.test(lines[pi])) {
            lines.splice(pi, 1);
            changed = true;
          }
        }
      }
    }
    return changed;
  };
  for (let p = 0; p < 5; p++) if (!stripLegacy()) break;

  // 3. Ещё разок раскрываем (после stripLegacy тоже могли остаться однострочные).
  for (let pass = 0; pass < 5; pass++) {
    let any = false;
    const a = findAndroid(lines); if (!a) break;
    outer: for (const parent of [a,
      findChild(lines, a, /^signingConfigs$/),
      findChild(lines, a, /^buildTypes$/),
    ]) {
      if (!parent) continue;
      let depth = 0, i = parent.line, j = parent.openCol;
      while (i <= parent.closeLine) {
        const line = lines[i];
        while (j < line.length) {
          const ch = line[j], nx = line[j+1];
          if (ch === '"' || ch === "'") { j = skipQuoted(line, j); continue; }
          if (ch === '/' && nx === '/') break;
          if (ch === '/' && nx === '*') { j += 2; continue; }
          if (ch === '{') {
            if (depth === 1 && i > parent.line) {
              const cl = matchCloseBrace(lines, i, j, 0);
              if (cl && cl.line === i) { ensureMultiline(lines, i); any = true; break outer; }
            }
            depth++;
          } else if (ch === '}') { depth--; if (depth <= 0) { i = lines.length; break; } }
          j++;
        }
        i++; j = 0;
      }
    }
    if (!any) break;
  }

  // 4. Свежие позиции.
  andr = findAndroid(lines);
  if (!andr) return lines.join('\n');

  // 4a. Убеждаемся что есть buildFeatures { buildConfig true } (AGP 8+ / Expo SDK 50+)
  {
    let bf = findChild(lines, andr, /^buildFeatures$/);
    if (bf) {
      const body = lines.slice(bf.line + 1, bf.closeLine).join('\n');
      if (!/^\s*buildConfig\s+true\s*$/m.test(body)) {
        lines.splice(bf.line + 1, 0, '        buildConfig true');
      }
    } else {
      // Вставляем после namespace/ndkVersion/buildToolsVersion/compileSdk
      let nsIdx = -1;
      for (let i = andr.line + 1; i < andr.closeLine; i++) {
        if (/^\s*(namespace|compileSdk|buildToolsVersion|ndkVersion)\b/.test(lines[i])) { nsIdx = i; }
      }
      if (nsIdx < 0) nsIdx = andr.line;
      const ind = (lines[nsIdx].match(/^(\s*)/) || ['', '    '])[1];
      let at = nsIdx + 1;
      while (at < andr.closeLine && lines[at].trim() === '') at++;
      lines.splice(at, 0, `${ind}buildFeatures {`, `${ind}    buildConfig true`, `${ind}}`, '');
    }
    // пересчитать andr после вставки
    andr = findAndroid(lines);
    if (!andr) return lines.join('\n');
  }

  let ns = findChild(lines, andr, /^defaultConfig$/);
  let sc = findChild(lines, andr, /^signingConfigs$/);
  let bt = findChild(lines, andr, /^buildTypes$/);
  if (!ns) return lines.join('\n');

  // 5. Вставить keystore-хелперы ПЕРЕД defaultConfig с одной пустой строкой-разделителем.
  lines.splice(ns.line, 0, ...keystoreBlock, '');

  // 6. Пересчитать позиции и вставить release { ... } в signingConfigs.
  andr = findAndroid(lines);
  sc = findChild(lines, andr, /^signingConfigs$/);
  if (sc) lines.splice(sc.line + 1, 0, ...releaseSignBlock);

  // 7. Пересчитать позиции и вставить check-блок в buildTypes.release.
  andr = findAndroid(lines);
  bt = findChild(lines, andr, /^buildTypes$/);
  if (bt) {
    let rel = findChild(lines, bt, /^release$/);
    if (rel) {
      ensureMultiline(lines, rel.line);
      const bt2 = findChild(lines, findAndroid(lines), /^buildTypes$/);
      rel = bt2 && findChild(lines, bt2, /^release$/);
      if (rel) lines.splice(rel.line + 1, 0, ...checkBlock);
    }
  }

  // 8. Пересчитать позиции и вставить buildConfigField перед '}' defaultConfig.
  andr = findAndroid(lines);
  ns = findChild(lines, andr, /^defaultConfig$/);
  if (ns) {
    const fl = '        buildConfigField "String", "EXPECTED_SIGNATURE_SHA256", "\\"${expectedSha256}\\""';
    lines.splice(ns.closeLine, 0, fl);
  }

  // 9. Финальная зачистка двойных пустых строк внутри android {}.
  {
    const a = findAndroid(lines);
    if (a) {
      const out = [];
      let blanks = 0;
      for (let k = 0; k < lines.length; k++) {
        const inside = k > a.line && k <= a.closeLine;
        if (inside && lines[k].trim() === '') {
          blanks++;
          if (blanks <= 1) out.push(lines[k]);
        } else {
          blanks = 0;
          out.push(lines[k]);
        }
      }
      lines = out;
    }
  }

  return lines.join('\n');
}

// =========================================================================
// MainApplication.kt
// =========================================================================

function editMainApplication(contents) {
  if (contents.includes('ru.wfllive.nova.security.SecurityPackage')) {
    // Убедимся что add(SecurityPackage()) тоже есть (а то только import торчит).
    if (/add\(\s*(ru\.wfllive\.nova\.security\.)?SecurityPackage\s*\(\s*\)\s*\)/.test(contents)) {
      return contents;
    }
  }
  const lines = contents.split('\n');

  // Import после последнего import.
  if (!contents.includes('import ru.wfllive.nova.security.SecurityPackage')) {
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) if (/^import\s/.test(lines[i])) lastImport = i;
    if (lastImport >= 0) lines.splice(lastImport + 1, 0, 'import ru.wfllive.nova.security.SecurityPackage');
    else lines.unshift('import ru.wfllive.nova.security.SecurityPackage');
  }

  let out = lines.join('\n');

  // add(SecurityPackage()) внутрь PackageList(this).packages.apply { ... }
  if (!/add\(\s*(ru\.wfllive\.nova\.security\.)?SecurityPackage\s*\(\s*\)\s*\)/.test(out)) {
    if (out.includes('PackageList(this).packages.apply {')) {
      out = out.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n          add(SecurityPackage())'
      );
    }
  }
  return out;
}

// =========================================================================
// Копирование Kotlin-файлов / proguard
// =========================================================================

function copySecurityFiles(projectRoot) {
  const srcDir = path.join(projectRoot, 'src', 'native', 'security');
  const destDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java',
                            'ru', 'wfllive', 'nova', 'security');
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      const s = path.join(srcDir, file);
      if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(destDir, file));
    }
  }
  const proguardPath = path.join(projectRoot, 'android', 'app', 'proguard-rules.pro');
  if (fs.existsSync(proguardPath)) {
    let p = fs.readFileSync(proguardPath, 'utf8');
    if (!p.includes('ru.wfllive.nova.security')) {
      p += '\n# Anti-Mod Security Guard Rules\n-keep class ru.wfllive.nova.security.** { *; }\n-keepclassmembers class ru.wfllive.nova.security.** { *; }\n';
      fs.writeFileSync(proguardPath, p, 'utf8');
    }
  }
}

// =========================================================================
// Сам плагин
// =========================================================================

function withSecurityGuard(config) {
  config = withDangerousMod(config, ['android', async (config) => {
    copySecurityFiles(config.modRequest.projectRoot);
    return config;
  }]);

  config = withMainApplication(config, (config) => {
    config.modResults.contents = editMainApplication(config.modResults.contents || '');
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = editBuildGradle(config.modResults.contents);
    return config;
  });

  return config;
}

module.exports = withSecurityGuard;
