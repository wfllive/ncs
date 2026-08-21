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

function skipQuoted(line, j) {
  const q = line[j]; j++;
  while (j < line.length) {
    if (line[j] === '\\') { j += 2; continue; }
    if (line[j] === q) return j + 1;
    j++;
  }
  return j;
}

/**
 * Ищет границы блока { ... }, начиная с позиции (lineIdx, colIdx) — позиции
 * открывающей '{'. Корректно обрабатывает строки, строчные и блочные
 * комментарии и вложенные {}. Возвращает {startLine, startCol, endLine, endCol}
 * или null.
 */
function matchCloseBrace(lines, startLine, startCol) {
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
        if (started && depth === 0) return { startLine, startCol, endLine: i, endCol: j };
      }
      j++;
    }
    i++; j = 0;
  }
  return null;
}

/**
 * Если блок, открывающийся на строке idx — однострочный (т.е. закрывающая '}'
 * на той же строке), разворачивает его в многострочный. Учитывает вложенные
 * { }, строки, комментарии, а также Gradle-специфику — отсутствие ';' между
 * sibling-блоками (разделителем считается `} идент {` на глубине 0).
 */
function ensureMultiline(lines, idx) {
  const line = lines[idx];
  const open = line.indexOf('{');
  if (open < 0) return;
  const cl = matchCloseBrace(lines, idx, open);
  if (!cl) return;
  if (cl.endLine !== idx) return; // уже многострочный
  const indent = (line.match(/^(\s*)/) || ['', ''])[1];
  const innerRaw = line.slice(open + 1, cl.endCol);
  const innerIndent = indent + '    ';
  const after = line.slice(cl.endCol + 1);

  const parts = [];
  let buf = '', depth = 0, inStr = null, inLC = false, inBC = false;
  const push = () => { const s = buf.trim(); if (s) parts.push(s); buf = ''; };

  for (let k = 0; k < innerRaw.length; k++) {
    const ch = innerRaw[k];
    const nx = innerRaw[k + 1];
    if (inStr) {
      buf += ch;
      if (ch === '\\' && k + 1 < innerRaw.length) { buf += innerRaw[++k]; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (inBC) {
      buf += ch;
      if (ch === '*' && nx === '/') { buf += nx; k++; inBC = false; }
      continue;
    }
    if (inLC) { buf += ch; if (ch === '\n') inLC = false; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue; }
    if (ch === '/' && nx === '/') { inLC = true; buf += ch; continue; }
    if (ch === '/' && nx === '*') { inBC = true; buf += ch; buf += nx; k++; continue; }

    if (ch === '{') { depth++; buf += ch; continue; }
    if (ch === '}') {
      depth--;
      buf += ch;
      if (depth === 0) {
        let m = k + 1;
        while (m < innerRaw.length && /[ \t]/.test(innerRaw[m])) m++;
        let idE = m;
        while (idE < innerRaw.length && /[A-Za-z0-9_]/.test(innerRaw[idE])) idE++;
        if (idE > m) {
          let n = idE;
          while (n < innerRaw.length && /[ \t]/.test(innerRaw[n])) n++;
          if (n < innerRaw.length && innerRaw[n] === '{') { push(); continue; }
        }
      }
      continue;
    }
    if (ch === ';' && depth === 0) { push(); continue; }
    buf += ch;
  }
  push();

  const replacement = [line.slice(0, open + 1)];
  for (const p of parts) replacement.push(innerIndent + p);
  replacement.push(indent + '}' + after);
  lines.splice(idx, 1, ...replacement);
}

/**
 * Раскрываем однострочные блоки внутри android {} на отдельные строки,
 * чтобы дальше было проще искать/вставлять (многопроходно). Начинаем обход
 * ПЕРЕД открывающей '{' android (depth=-1), чтобы сам android при случае тоже
 * развернулся (обычно он уже развёрнут фазой 0а, но оставляем защиту).
 */
function expandOneLineBlocks(lines) {
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    const ai = lines.findIndex((l) => /^\s*android\s*\{/.test(l));
    if (ai < 0) return;
    const open = lines[ai].indexOf('{');
    const acl = matchCloseBrace(lines, ai, open);
    if (!acl) return;
    let depth = -1, i = ai, j = open;
    outer: while (i <= acl.endLine) {
      const line = lines[i];
      while (j < line.length) {
        const ch = line[j], nx = line[j+1];
        if (ch === '"' || ch === "'") { j = skipQuoted(line, j); continue; }
        if (ch === '/' && nx === '/') break;
        if (ch === '/' && nx === '*') { j += 2; let done=false; while(i<=acl.endLine+1){const l=lines[i];while(j<l.length){if(l[j]==='*'&&l[j+1]==='/'){j+=2;done=true;break;}j++;}if(done)break;i++;j=0;} continue; }
        if (ch === '{') {
          depth++;
          if (depth >= 0) {
            const inner = matchCloseBrace(lines, i, j);
            if (inner && inner.endLine === i) {
              ensureMultiline(lines, i);
              changed = true;
              break outer;
            }
          }
        } else if (ch === '}') {
          depth--;
          if (depth < -1) { i = lines.length; break outer; }
        }
        j++;
      }
      i++; j = 0;
    }
    if (!changed) break;
  }
}

/**
 * Ищет границы блока { ... }, начиная со строки startIdx (от первой '{' на ней).
 * Корректно обрабатывает строки, комментарии и вложенные {}.
 */
function findBlockRange(lines, startIdx) {
  const open = lines[startIdx].indexOf('{');
  if (open < 0) return [startIdx, lines.length - 1];
  const cl = matchCloseBrace(lines, startIdx, open);
  return cl ? [startIdx, cl.endLine] : [startIdx, lines.length - 1];
}

// Вспомогательная для фазы 0: см. with-security-guard.js.
function splitInlineBlockHeader(line) {
  const m0 = line.match(/^(\s*)(\S.*)$/);
  if (!m0) return null;
  const [, ind, body] = m0;
  if (!/[a-zA-Z_]/.test(body)) return null;
  let depth = 0, i = 0, inStr = null, sawContent = false;
  while (i < body.length) {
    const ch = body[i], nx = body[i+1];
    if (inStr) {
      if (ch === '\\' && i + 1 < body.length) { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; sawContent = true; i++; continue; }
    if (ch === '/' && nx === '/') { sawContent = true; break; }
    if (ch === '/' && nx === '*') { sawContent = true; i += 2; continue; }
    if (ch === '{') { depth++; sawContent = true; i++; continue; }
    if (ch === '}') { depth--; sawContent = true; i++; continue; }
    if (ch === ';') { sawContent = false; i++; continue; }
    if (/[A-Za-z_]/.test(ch) && depth === 0 && sawContent && i > 0) {
      const prev = body[i - 1];
      if (!/[A-Za-z0-9_]/.test(prev)) {
        let s = i, e = i;
        while (e < body.length && /[A-Za-z0-9_]/.test(body[e])) e++;
        let n = e;
        while (n < body.length && /[ \t]/.test(body[n])) n++;
        if (n < body.length && body[n] === '{') {
          const before = (ind + body.slice(0, i)).replace(/[ \t]+$/, '');
          const after = ind + body.slice(i);
          if (before.trim().length > 0) return { before, after };
        }
      }
    }
    if (/\S/.test(ch)) sawContent = true;
    i++;
  }
  return null;
}

function editBuildGradle(contents) {
  let lines = contents.split(/\r?\n/);

  // 0a. Если сам android { ... } — однострочный, разворачиваем первым делом.
  for (let pass = 0; pass < 5; pass++) {
    const ai = lines.findIndex((l) => /^\s*android\s*\{/.test(l));
    if (ai < 0) break;
    const open = lines[ai].indexOf('{');
    const acl = matchCloseBrace(lines, ai, open);
    if (!acl || acl.endLine !== ai) break;
    ensureMultiline(lines, ai);
  }

  // 0б. Разбиваем слипшиеся на одной строке sibling-блоки ("} foo {")
  //     и пары "stmt stmt block {" ("namespace x defaultConfig {").
  for (let p = 0; p < 20; p++) {
    let changed = false;
    const ai = lines.findIndex((l) => /^\s*android\s*\{/.test(l));
    if (ai < 0) break;
    const open = lines[ai].indexOf('{');
    const acl = matchCloseBrace(lines, ai, open);
    if (!acl) break;
    for (let i = ai + 1; i < acl.endLine; i++) {
      const line = lines[i];
      const m = line.match(/^(\s*)\}[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\{.*)$/);
      if (m) {
        const [, ind, kw, rest] = m;
        lines[i] = `${ind}}`;
        lines.splice(i + 1, 0, `${ind}${kw} ${rest}`);
        changed = true; break;
      }
      const spl = splitInlineBlockHeader(line);
      if (spl) { lines.splice(i, 1, spl.before, spl.after); changed = true; break; }
    }
    if (!changed) break;
  }

  // Раскрываем однострочные блоки вида `foo { ... }` внутри android {} —
  // без этого мультилайн-поиск ниже промахивается.
  for (let p = 0; p < 20; p++) expandOneLineBlocks(lines);

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
