#!/usr/bin/env node
/**
 * Headless smoke test for the IDE code editor (src/ide/editorHtml.ts).
 *
 * Loads the generated HTML into jsdom and drives the exact bridge protocol
 * the React Native WebView uses, verifying:
 *   - the editor boots and announces `ready`
 *   - documents can be set and edited
 *   - edits produce debounced `change` messages
 *   - config (theme / fontSize / tabSize / wrap / readOnly) applies
 *   - commands: insert, undo/redo, gotoLine, comment toggle, cursor moves
 *   - diagnostics are accepted
 *
 * Run with:  node scripts/test-editor.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/ide/editorHtml.ts'), 'utf8');
const match = source.match(/export const EDITOR_HTML = (\".*\");/s);
if (!match) {
  console.error('[test-editor] could not extract EDITOR_HTML from src/ide/editorHtml.ts');
  process.exit(1);
}
const html = JSON.parse(match[1]);

let passed = 0;
let failed = 0;
const check = (name, condition) => {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}`); }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const messages = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.ReactNativeWebView = {
      postMessage: (data) => { try { messages.push(JSON.parse(data)); } catch (e) { /* ignore */ } },
    };
    window.scrollTo = () => {};
    window.scrollBy = () => {};
    // jsdom reports zero layout sizes; give elements a believable geometry so
    // CodeMirror's virtualised viewport renders more than the first line.
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 500; }, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 300; }, configurable: true });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLElement.prototype.getClientRects = function getClientRects() {
      return [{ top: 0, left: 0, right: 20, bottom: 10, width: 20, height: 10 }];
    };
    window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { top: 0, left: 0, right: 300, bottom: 500, width: 300, height: 500, x: 0, y: 0 };
    };
    window.Element.prototype.getBoundingClientRect = window.HTMLElement.prototype.getBoundingClientRect;
    window.Range.prototype.getClientRects = function getClientRects() {
      return [{ top: 0, left: 0, right: 20, bottom: 10, width: 20, height: 10 }];
    };
    window.Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { top: 0, left: 0, right: 20, bottom: 10, width: 20, height: 10 };
    };
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  },
});

const { window } = dom;
const send = (msg) => window.__rn(JSON.stringify(msg));
const lastOfType = (type) => [...messages].reverse().find((m) => m.type === type);

// Allow the bundle (loaded synchronously) plus timers to settle.
await sleep(300);

check('window.__rn bridge entry exists', typeof window.__rn === 'function');
check('editor announced `ready`', messages.some((m) => m.type === 'ready'));
check('editor DOM mounted (.cm-content)', Boolean(window.document.querySelector('.cm-content')));
check('gutter with line numbers mounted', Boolean(window.document.querySelector('.cm-gutters')));

const SAMPLE = [
  'package com.example.app',
  '',
  'import android.os.Bundle',
  'import androidx.activity.ComponentActivity',
  '',
  'class MainActivity : ComponentActivity() {',
  '    override fun onCreate(savedInstanceState: Bundle?) {',
  '        super.onCreate(savedInstanceState)',
  '    }',
  '}',
].join('\n');

send({ type: 'set', value: SAMPLE });
await sleep(250);
send({ type: 'get' });
await sleep(200);
check('set(): document text is loaded', lastOfType('change')?.value === SAMPLE);
check('set(): cursor message carries line count', (lastOfType('cursor')?.lines || 0) === 10);

send({ type: 'command', name: 'gotoLine', arg: 7 });
await sleep(200);
check('gotoLine: cursor lands on line 7', lastOfType('cursor')?.line === 7);

send({ type: 'insert', text: '// hello\n' });
await sleep(350);
const changeMsg = lastOfType('change');
check('insert(): change message emitted', Boolean(changeMsg));
check('insert(): inserted text present', changeMsg?.value?.includes('// hello') === true);
check('insert(): inserted at start of line 7', changeMsg?.value?.split('\n')[6]?.startsWith('// hello') === true);

send({ type: 'command', name: 'undo' });
await sleep(350);
check('undo(): insertion reverted', lastOfType('change')?.value === SAMPLE);
send({ type: 'command', name: 'redo' });
await sleep(350);
check('redo(): insertion re-applied', lastOfType('change')?.value?.includes('// hello') === true);

send({ type: 'command', name: 'left' });
send({ type: 'command', name: 'right' });
await sleep(250);
check('cursor move commands do not crash', Boolean(lastOfType('cursor')));

send({ type: 'command', name: 'comment' });
await sleep(350);
check('toggleComment: line gets // prefix', lastOfType('change')?.value?.split('\n')[6]?.includes('//') === true);
send({ type: 'command', name: 'comment' });
await sleep(350);

send({ type: 'diagnostics', items: [{ line: 6, col: 5, message: 'Unresolved reference: foo', severity: 'error' }] });
await sleep(250);
send({ type: 'debug' });
await sleep(200);
check('diagnostics: one active diagnostic in state', lastOfType('debug')?.diagnostics === 1);
check('diagnostics: debug reports 11 lines (SAMPLE + inserted line)', lastOfType('debug')?.lines === 11);

send({ type: 'config', config: { theme: 'light', fontSize: 18, tabSize: 2, spacesForTab: false, wordWrap: true } });
await sleep(250);
check('config: light theme applied (dark class removed)', window.document.querySelector('.cm-editor')?.classList.contains('cm-dark') === false);

send({ type: 'config', config: { readOnly: true } });
send({ type: 'insert', text: 'SHOULD_NOT_APPEAR' });
await sleep(350);
check('readOnly: insert ignored', (lastOfType('change')?.value || '').includes('SHOULD_NOT_APPEAR') === false);
send({ type: 'config', config: { readOnly: false } });

send({ type: 'get' });
await sleep(200);
check('get(): current document returned', lastOfType('change')?.value?.includes('MainActivity') === true);

console.log(`\n[test-editor] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
