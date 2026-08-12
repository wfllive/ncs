/**
 * Parse Gradle / Kotlin compiler output into structured errors.
 *
 * Kotlin and Gradle emit errors in a few shapes:
 *   MainActivity.kt:12:34: error: unresolved reference: foo
 *   MainActivity.kt: (12, 34): error: ...
 *   e: file:///app/src/main/java/.../MainActivity.kt:12:34 unresolved reference
 *   > Task :app:compileDebugKotlin FAILED
 *
 * We extract { file, line, column, message, severity } so the UI can show a
 * clickable problem list / error dock.
 */

const LINE_COL = /([\w./\\-]+\.kt):(\d+):(\d+):\s*(error|warning):?\s*(.*)/i;
const PAREN_LC = /\((\d+),\s*(\d+)\):\s*(error|warning):?\s*(.*)/i;
const V2_PREFIX = /\be:\s*(?:file:\/\/\/)?([\w./\\-]+\.kt):(\d+):(\d+)\s+(.*)/i;
const V2_WARN = /\bw:\s*(?:file:\/\/\/)?([\w./\\-]+\.kt):(\d+):(\d+)\s+(.*)/i;

export const parseBuildErrors = (output = '') => {
  if (!output) return { errors: [], warnings: [] };
  const errors = [];
  const warnings = [];
  const lines = output.split('\n');
  let currentFile = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // Track the file that a following "(line, col)" refers to.
    const fileRef = line.match(/^>?\s*(?:Task\s+:|\s*)?(.+\.kt):\s*$/i);
    if (fileRef) { currentFile = fileRef[1]; continue; }

    let m = line.match(LINE_COL);
    if (m) {
      const entry = { file: m[1], line: Number(m[2]), column: Number(m[3]), severity: m[4].toLowerCase(), message: m[5].trim() };
      (entry.severity === 'warning' ? warnings : errors).push(entry);
      currentFile = m[1];
      continue;
    }
    m = line.match(V2_PREFIX);
    if (m) {
      const entry = { file: m[1], line: Number(m[2]), column: Number(m[3]), severity: 'error', message: m[4].trim() };
      errors.push(entry);
      currentFile = m[1];
      continue;
    }
    m = line.match(V2_WARN);
    if (m) {
      const entry = { file: m[1], line: Number(m[2]), column: Number(m[3]), severity: 'warning', message: m[4].trim() };
      warnings.push(entry);
      currentFile = m[1];
      continue;
    }
    m = line.match(PAREN_LC);
    if (m) {
      const entry = { file: currentFile || null, line: Number(m[1]), column: Number(m[2]), severity: m[3].toLowerCase(), message: m[4].trim() };
      (entry.severity === 'warning' ? warnings : errors).push(entry);
    }
  }
  return { errors, warnings };
};

/**
 * A tiny "lint" over the Kotlin source itself: report clearly-unbalanced
 * braces/parens and missing closing braces for the open Composable body. This
 * gives immediate feedback while typing, before a Gradle build.
 */
export const lintSource = (source = '') => {
  if (!source) return [];
  const problems = [];
  const stack = []; // { char, line, col }
  let line = 1;
  let col = 1;
  let inString = null;
  let inBlockComment = false;
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      if (ch === '\n') { line++; col = 1; } else col++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && source[i + 1] === '/') { inBlockComment = false; i++; col += 2; }
      else if (ch === '\n') { line++; col = 1; } else col++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { i++; col++; }
      i--; // for loop increments
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') { inBlockComment = true; i++; col += 2; continue; }
    if (ch === '"' || ch === "'") { inString = ch; col++; continue; }
    if ('([{'.includes(ch)) { stack.push({ char: ch, line, col }); }
    else if (')]}'.includes(ch)) {
      const open = stack.pop();
      if (!open) problems.push({ line, col, message: `Unexpected '${ch}' (no matching opening bracket)` });
      else if (open.char !== pairs[ch]) problems.push({ line, col, message: `Mismatched '${ch}': expected '${pairs[open.char] === ch ? ch : Object.keys(pairs).find(k => pairs[k] === open.char)}' to close '${open.char}' opened at ${open.line}:${open.col}` });
    }
    if (ch === '\n') { line++; col = 1; } else col++;
  }
  for (const open of stack) {
    problems.push({ line: open.line, col: open.col, message: `Unclosed '${open.char}' — add the matching closing bracket` });
  }
  return problems;
};

export default parseBuildErrors;
