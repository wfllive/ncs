/**
 * Regression test for the code-editor feature utilities:
 *   - importManager: findMissingImports / addMissingImports / fileStats
 *   - errorParser: parseBuildErrors / lintSource
 *   - kotlinHighlighter: tokenise without dropping text
 *
 * Run:  node scripts/verify-editor-features.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (rel) =>
  readFileSync(join(root, rel), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default[^\n]*\n/gm, '')
    .replace(/^export (const|let|function|class)/gm, '$1');

let failures = 0;
function report(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) failures++; return cond; }

// ---- importManager ----
{
  const code = `${strip('src/utils/importManager.ts')}\n;return { findMissingImports, addMissingImports, fileStats };`;
  const { findMissingImports, addMissingImports, fileStats } = new Function(code)();
  const src = 'package com.x\n\nclass A {\n    fun m() { Column { Text("hi") } }\n}\n';
  const { missing, count } = findMissingImports(src);
  report('findMissingImports finds Column+Text', count === 2 && missing.includes('androidx.compose.foundation.layout.Column'));
  const out = addMissingImports(src, missing);
  report('addMissingImports inserts after package', out.includes('import androidx.compose.foundation.layout.Column\n') && out.includes('import androidx.compose.material3.Text\n'));
  report('addMissingImports keeps source body', out.includes('class A {') && out.includes('Text("hi")'));
  const st = fileStats('a\n\nb\n');
  report('fileStats counts lines', st.lineCount === 3 && st.nonEmpty === 2 && st.chars === 5);
  report('fileStats counts empty file', fileStats('').lineCount === 0 && fileStats('').chars === 0);
  report('fileStats detects spaces', fileStats('  x').indentation === 'spaces');
  report('fileStats detects tabs', fileStats('\tx').indentation === 'tabs');
}

// ---- errorParser ----
{
  const code = `${strip('src/utils/errorParser.ts')}\n;return { parseBuildErrors, lintSource };`;
  const { parseBuildErrors, lintSource } = new Function(code)();
  const out = 'MainActivity.kt:12:34: error: unresolved reference: foo\nMainActivity.kt: (3, 8): warning: unused variable\ne: file:///x.kt:5:9 Unresolved';
  const { errors, warnings } = parseBuildErrors(out);
  report('parseBuildErrors finds errors', errors.length === 2);
  report('parseBuildErrors finds warnings', warnings.length === 1);
  report('parseBuildErrors parses file/line/col', errors[0].file === 'MainActivity.kt' && errors[0].line === 12 && errors[0].column === 34);
  report('lintSource balanced code ok', lintSource('fun a() { Text("x") }').length === 0);
  report('lintSource detects unclosed brace', lintSource('fun a() {').some((p) => /Unclosed/.test(p.message)));
  report('lintSource detects mismatch', lintSource(']').some((p) => /Unexpected/.test(p.message)));
}

// ---- kotlinHighlighter ----
{
  const code = `${strip('src/utils/kotlinHighlighter.ts')}\n;return { highlightKotlin };`;
  const { highlightKotlin } = new Function(code)();
  const src = '@Composable\nfun M() { var x by remember { mutableIntStateOf(0) }; Text("a $x") }';
  const spans = highlightKotlin(src);
  report('highlighter preserves full text', spans.map((s) => s.text).join('') === src);
  report('highlighter colours keyword', spans.some((s) => s.text === 'fun' && s.color === '#C586C0'));
  report('highlighter colours string', spans.some((s) => s.text.startsWith('"a') && s.color === '#CE9178'));
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nALL PASS - editor feature utilities work.');
