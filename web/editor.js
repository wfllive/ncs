/**
 * Compose Studio IDE — the code editor that runs inside the WebView.
 *
 * Built on CodeMirror 6 (the same editing engine used by many professional
 * tools). Provides a genuinely VS Code-like experience on Android:
 *   - exact VS Code Dark+ / Light+ colour themes
 *   - JSX / React syntax highlighting
 *   - line numbers, active-line highlight, code folding
 *   - bracket matching + auto-closing brackets
 *   - autocomplete (JSX keywords, React snippets, words from document)
 *   - search / replace panel
 *   - inline lint diagnostics (red squiggles) pushed from the app
 *   - undo / redo, comment toggle, indent control, go-to-line
 *
 * All communication with React Native goes through a tiny JSON bridge:
 *   RN  -> web : window.__rn("<json string>")
 *   web -> RN  : window.ReactNativeWebView.postMessage("<json string>")
 */
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth,
  toggleComment, indentMore, indentLess, selectAll,
  cursorCharLeft, cursorCharRight, cursorLineBoundaryBackward, cursorLineBoundaryForward,
} from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput,
  StreamLanguage, LanguageSupport, indentUnit, foldGutter, codeFolding,
} from '@codemirror/language';
import { kotlin } from '@codemirror/legacy-modes/mode/clike';
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  completeAnyWord, snippetCompletion,
} from '@codemirror/autocomplete';
import {
  searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel,
} from '@codemirror/search';
import { lintGutter, setDiagnostics, diagnosticCount } from '@codemirror/lint';
import { tags } from '@lezer/highlight';

/* ------------------------------------------------------------------ themes */
/* Colours taken straight from VS Code Dark+ and VS Code Light+. */

const DARK = {
  dark: true,
  bg: '#1E1E1E', fg: '#D4D4D4', caret: '#AEAFAD',
  selection: '#264F78', selectionBlur: '#3A3D41',
  activeLine: 'rgba(255,255,255,0.045)', border: '#2D2D30',
  gutterBg: '#1E1E1E', gutterFg: '#858585', gutterActive: '#C6C6C6',
  panelBg: '#252526', panelBorder: '#3C3C3C',
  tooltipBg: '#252526', tooltipBorder: '#454545', tooltipFg: '#CCCCCC',
  tooltipSel: '#04395E', matchBracket: 'rgba(0,122,204,0.30)',
  selMatch: 'rgba(87,135,179,0.28)', searchMatch: 'rgba(234,92,0,0.33)',
  searchMatchSel: 'rgba(245,117,32,0.55)',
  foldPlaceholderBg: 'rgba(90,155,213,0.20)', foldPlaceholderFg: '#A9DCFF',
};

const LIGHT = {
  dark: false,
  bg: '#FFFFFF', fg: '#1F1F1F', caret: '#000000',
  selection: '#ADD6FF', selectionBlur: '#E5EBF1',
  activeLine: 'rgba(0,0,0,0.045)', border: '#E0E0E0',
  gutterBg: '#FFFFFF', gutterFg: '#237893', gutterActive: '#0B216F',
  panelBg: '#F3F3F3', panelBorder: '#CCCCCC',
  tooltipBg: '#F3F3F3', tooltipBorder: '#C8C8C8', tooltipFg: '#333333',
  tooltipSel: '#ADD6FF', matchBracket: 'rgba(0,100,200,0.18)',
  selMatch: 'rgba(186,214,250,0.70)', searchMatch: 'rgba(247,201,72,0.45)',
  searchMatchSel: 'rgba(236,144,40,0.55)',
  foldPlaceholderBg: 'rgba(0,100,200,0.12)', foldPlaceholderFg: '#0451A5',
};

const darkHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: '#C586C0' },
  { tag: [tags.atom, tags.bool, tags.null, tags.self], color: '#569CD6' },
  { tag: tags.number, color: '#B5CEA8' },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.docString], color: '#CE9178' },
  { tag: tags.comment, color: '#6A9955' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#4EC9B0' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#DCDCAA' },
  { tag: tags.definition(tags.variableName), color: '#DCDCAA' },
  { tag: [tags.propertyName, tags.attributeName], color: '#9CDCFE' },
  { tag: tags.variableName, color: '#9CDCFE' },
  { tag: tags.definition(tags.propertyName), color: '#9CDCFE' },
  { tag: tags.meta, color: '#DCDCAA' },
  { tag: tags.operator, color: '#D4D4D4' },
  { tag: tags.punctuation, color: '#D4D4D4' },
  { tag: tags.invalid, color: '#F44747', textDecoration: 'underline wavy' },
]);

const lightHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: '#AF00DB' },
  { tag: [tags.atom, tags.bool, tags.null, tags.self], color: '#0000FF' },
  { tag: tags.number, color: '#098658' },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.docString], color: '#A31515' },
  { tag: tags.comment, color: '#008000' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#267F99' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#795E26' },
  { tag: tags.definition(tags.variableName), color: '#795E26' },
  { tag: [tags.propertyName, tags.attributeName], color: '#001080' },
  { tag: tags.variableName, color: '#001080' },
  { tag: tags.definition(tags.propertyName), color: '#001080' },
  { tag: tags.meta, color: '#795E26' },
  { tag: tags.operator, color: '#1F1F1F' },
  { tag: tags.punctuation, color: '#1F1F1F' },
  { tag: tags.invalid, color: '#F44747', textDecoration: 'underline wavy' },
]);

const baseTheme = (c, fontSize) => EditorView.theme({
  '&': {
    backgroundColor: c.bg, color: c.fg, height: '100%',
    fontSize: `${fontSize}px`,
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',Menlo,Consolas,'DejaVu Sans Mono',monospace",
    lineHeight: '1.55',
    overflowX: 'auto',
  },
  '.cm-content': { caretColor: c.caret, padding: '8px 0 60vh 0' },
  '.cm-line': { padding: '0 10px 0 6px' },
  '.cm-cursor': { borderLeftColor: c.caret, borderLeftWidth: '1.8px' },
  '&.cm-focused .cm-cursor': { borderLeftColor: c.caret },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: c.selection },
  '&:not(.cm-focused) .cm-selectionBackground': { backgroundColor: c.selectionBlur },
  '.cm-selectionMatch': { backgroundColor: c.selMatch },
  '.cm-searchMatch': { backgroundColor: c.searchMatch, outline: `1px solid ${c.searchMatchSel}` },
  '.cm-searchMatch-selected': { backgroundColor: c.searchMatchSel },
  '.cm-activeLine': { backgroundColor: c.activeLine },
  '.cm-matchingBracket': { backgroundColor: c.matchBracket, outline: 'none' },
  '.cm-nonmatchingBracket': { backgroundColor: 'rgba(244,71,71,0.30)' },
  '.cm-gutters': {
    backgroundColor: c.gutterBg, color: c.gutterFg,
    border: 'none', borderRight: `1px solid ${c.border}`,
    fontFamily: "'JetBrains Mono',Menlo,Consolas,monospace",
    paddingLeft: '4px',
  },
  '.cm-gutterElement': { padding: '0 6px 0 8px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: c.gutterActive, fontWeight: '600' },
  '.cm-foldGutter span': { cursor: 'pointer', fontSize: '13px' },
  '.cm-foldPlaceholder': {
    backgroundColor: c.foldPlaceholderBg, color: c.foldPlaceholderFg,
    border: 'none', borderRadius: '3px', padding: '0 6px', margin: '0 2px',
  },
  '.cm-panels': { backgroundColor: c.panelBg, color: c.tooltipFg, borderTop: `1px solid ${c.panelBorder}` },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
  '.cm-panel.cm-search': { padding: '6px 8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' },
  '.cm-panel.cm-search input[type=checkbox]': { margin: '0 2px 0 6px' },
  '.cm-panel.cm-search input': {
    backgroundColor: c.dark ? '#3C3C3C' : '#FFFFFF', color: c.tooltipFg,
    border: `1px solid ${c.panelBorder}`, borderRadius: '3px', padding: '4px 6px', minWidth: '140px',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: c.dark ? '#0E639C' : '#007ACC', color: '#FFFFFF', border: 'none',
    borderRadius: '3px', padding: '4px 10px', margin: '1px 2px', textTransform: 'capitalize',
  },
  '.cm-panel.cm-search button[name=close]': { backgroundColor: 'transparent', color: c.tooltipFg, fontSize: '15px', padding: '2px 8px' },
  '.cm-panel.cm-gotoLine input': { minWidth: '60px' },
  '.cm-tooltip': {
    backgroundColor: c.tooltipBg, color: c.tooltipFg,
    border: `1px solid ${c.tooltipBorder}`, borderRadius: '4px',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'Menlo,Consolas,monospace', fontSize: '0.92em', maxHeight: '220px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: c.tooltipSel, color: c.dark ? '#FFFFFF' : '#1F1F1F' },
  '.cm-completionDetail': { color: c.dark ? '#7F8C98' : '#6E7781', fontStyle: 'normal', paddingLeft: '10px' },
  '.cm-completionIcon': { width: '1.1em', opacity: '0.9' },
  '.cm-completionIcon-function:after': { content: "'ƒ'", color: c.dark ? '#DCDCAA' : '#795E26' },
  '.cm-completionIcon-keyword:after': { content: "'◆'", color: c.dark ? '#C586C0' : '#AF00DB', fontSize: '9px' },
  '.cm-completionIcon-variable:after': { content: "'𝑥'", color: c.dark ? '#9CDCFE' : '#001080' },
  '.cm-completionIcon-type:after': { content: "'𝑇'", color: c.dark ? '#4EC9B0' : '#267F99' },
  '.cm-lintRange-error': { textDecoration: 'underline wavy #F14C4C 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { textDecoration: 'underline wavy #CCA700 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-info': { textDecoration: 'underline wavy #3794FF 1px', textUnderlineOffset: '3px' },
  '.cm-lint-marker': { width: '0.9em', height: '0.9em' },
}, { dark: c.dark });

/* -------------------------------------------------------------- language */

const jsLanguage = StreamLanguage.define({
  name: 'jsx',
  startState: () => ({}),
  token: (stream, state) => {
    // Simple JSX-aware tokenization: strings, comments, tags, braces
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) { while (!stream.eol() && !stream.match('*/', false)) stream.next(); stream.match('*/'); return 'comment'; }
    if (stream.match('"') || stream.match("'") || stream.match('`')) { stream.skipTo(stream.current()); stream.next(); return 'string'; }
    if (stream.match(/<[a-zA-Z][a-zA-Z0-9]*\b/)) return 'type';
    if (stream.match(/<\//)) return 'keyword';
    if (stream.match(/[{}()\[\];,.:]/)) return 'punctuation';
    if (stream.match(/\b(function|const|let|var|class|import|export|from|default|return|if|else|while|for|switch|case|break|continue|try|catch|finally|throw|new|this|super|extends|static|async|await)\b/)) return 'keyword';
    if (stream.match(/\b(true|false|null|undefined)\b/)) return 'atom';
    stream.next();
    return null;
  },
});
const jsxSupport = new LanguageSupport(jsLanguage);

const KEYWORDS = ('function const let var class import export default from return if else when for while do switch case break continue try catch finally throw new this super extends static async await ' +
  'true false null undefined typeof instanceof in of as').split(' ')
  .map((label) => ({ label, type: 'keyword' }));

const REACT_SNIPEETS = [
  snippetCompletion('const [${name}, set${Name}] = useState(${value})', { label: 'useState', type: 'snippet', detail: 'React hook' }),
  snippetCompletion('useEffect(() => {\n\t${}\n}, [${deps}])', { label: 'useEffect', type: 'snippet', detail: 'React hook' }),
  snippetCompletion('function ${Component}() {\n\treturn (\n\t\t<div>\n\t\t\t${}\n\t\t</div>\n\t);\n}', { label: 'Function Component', type: 'snippet', detail: 'React' }),
  snippetCompletion('<div className="${cls}">\n\t${}\n</div>', { label: 'div', type: 'snippet', detail: 'JSX layout' }),
  snippetCompletion('<button onClick={() => ${}}>${label}</button>', { label: 'button', type: 'snippet', detail: 'JSX' }),
  snippetCompletion('<span>{${expr}}</span>', { label: 'span', type: 'snippet', detail: 'JSX' }),
  snippetCompletion('<h1>${}</h1>', { label: 'h1', type: 'snippet', detail: 'JSX' }),
  snippetCompletion('<img src="${}" alt="${}" />', { label: 'img', type: 'snippet', detail: 'JSX' }),
  snippetCompletion('<input type="${}" value={${}} onChange={e => set${}(e.target.value)} />', { label: 'input', type: 'snippet', detail: 'JSX' }),
  snippetCompletion('import React from "react";\nimport { ${name} } from "${path}";', { label: 'import', type: 'snippet', detail: 'JSX' }),
  snippetCompletion('export default function App() {\n\treturn <div>Hello</div>;\n}', { label: 'export default App', type: 'snippet', detail: 'JSX' }),
  ...('div span button h1 h2 p a ul li img input label section header footer nav main article aside form textarea select label br hr').split(' ')
    .map((label) => ({ label, type: 'type', detail: 'JSX tag' })),
];

const jsxCompletions = (context) => {
  const word = context.matchBefore(/[\w$]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: [...KEYWORDS, ...REACT_SNIPEETS], validFor: /^[\w$]*$/ };
};

/* ------------------------------------------------------- dynamic settings */

const themeComp = new Compartment();
const indentComp = new Compartment();
const wrapComp = new Compartment();
const completionComp = new Compartment();
const editableComp = new Compartment();
const readOnlyComp = new Compartment();

let config = {
  theme: 'dark', fontSize: 15, tabSize: 4, spacesForTab: true,
  wordWrap: false, completion: true, readOnly: false,
};

const themeExtensions = (c, fontSize) => [
  baseTheme(c, fontSize),
  syntaxHighlighting(c.dark ? darkHighlight : lightHighlight),
];

const completionExtensions = (on) => (on
  ? [autocompletion({ override: [jsxCompletions, completeAnyWord], icons: true, selectOnOpen: true })]
  : []);

/* ------------------------------------------------------------- RN bridge */

const post = (obj) => {
  try {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj));
  } catch (e) { /* bridge not ready */ }
};

let changeTimer = null;
let cursorTimer = null;
let lastChangeValue = '';
let pendingDiagnostics = [];

const lineCol = (view) => {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return { line: line.number, col: pos - line.from + 1 };
};

const postCursor = () => {
  if (!view) return;
  const { line, col } = lineCol(view);
  post({
    type: 'cursor', line, col,
    lines: view.state.doc.lines,
    canUndo: undoDepth(view.state) > 0,
    canRedo: redoDepth(view.state) > 0,
  });
};

const scheduleCursor = () => {
  if (cursorTimer) return;
  cursorTimer = setTimeout(() => { cursorTimer = null; postCursor(); }, 60);
};

const scheduleChange = () => {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    if (!view) return;
    const value = view.state.doc.toString();
    if (value === lastChangeValue) return;
    lastChangeValue = value;
    post({ type: 'change', value });
  }, 110);
};

/* -------------------------------------------------------------- document */

const makeExtensions = () => [
  lineNumbers(),
  highlightActiveLineGutter(),
  drawSelection(),
  dropCursor(),
  rectangularSelection(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  codeFolding({ placeholderText: ' ··· ' }),
  foldGutter({ openText: '▾', closedText: '▸' }),
  history(),
  jsxSupport,
  highlightActiveLine(),
  highlightSelectionMatches(),
  lintGutter(),
  themeComp.of(themeExtensions(config.theme === 'light' ? LIGHT : DARK, config.fontSize)),
  indentComp.of([
    indentUnit.of(config.spacesForTab ? ' '.repeat(config.tabSize) : '\t'),
    EditorState.tabSize.of(config.tabSize),
  ]),
  wrapComp.of(config.wordWrap ? [EditorView.lineWrapping] : []),
  completionComp.of(completionExtensions(config.completion)),
  editableComp.of(EditorView.editable.of(!config.readOnly)),
  readOnlyComp.of(EditorState.readOnly.of(config.readOnly)),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) scheduleChange();
    if (update.selectionSet || update.docChanged) scheduleCursor();
  }),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...searchKeymap,
    indentWithTab,
  ]),
  EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
];

let view = null;

const createView = () => {
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: makeExtensions() }),
    parent: document.getElementById('editor'),
  });
};

const toDiagnostics = (items) => {
  if (!view) return [];
  const doc = view.state.doc;
  const out = [];
  (items || []).slice(0, 200).forEach((it) => {
    const lineNo = Math.max(1, Math.min(Number(it.line) || 1, doc.lines));
    const line = doc.line(lineNo);
    const from = Math.min(line.from + Math.max(0, (Number(it.col) || 1) - 1), line.to);
    const to = from < line.to ? from + 1 : from;
    out.push({ from, to, severity: it.severity === 'warning' ? 'warning' : 'error', message: String(it.message || '') });
  });
  return out;
};

const applyDiagnostics = () => {
  if (!view) return;
  try { view.dispatch(setDiagnostics(view.state, toDiagnostics(pendingDiagnostics))); } catch (e) { /* keep editing */ }
};

const insertAtCursor = (text) => {
  if (!view || config.readOnly) return;
  view.dispatch(view.state.replaceSelection(String(text)), { scrollIntoView: true, userEvent: 'input' });
  view.focus();
};

const gotoLine = (lineNo) => {
  if (!view) return;
  const doc = view.state.doc;
  const n = Math.max(1, Math.min(Number(lineNo) || 1, doc.lines));
  const pos = doc.line(n).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
  postCursor();
};

const runCommand = (name, arg) => {
  if (!view) return false;
  const commands = {
    undo: () => undo(view),
    redo: () => redo(view),
    search: () => openSearchPanel(view),
    closeSearch: () => closeSearchPanel(view),
    comment: () => toggleComment(view),
    indentMore: () => indentMore(view),
    indentLess: () => indentLess(view),
    selectAll: () => selectAll(view),
    left: () => cursorCharLeft(view),
    right: () => cursorCharRight(view),
    home: () => cursorLineBoundaryBackward(view),
    end: () => cursorLineBoundaryForward(view),
    gotoLine: () => gotoLine(arg),
    focus: () => { view.focus(); return true; },
  };
  const fn = commands[name];
  if (!fn) return false;
  fn();
  scheduleCursor();
  return true;
};

const applyConfig = (next) => {
  if (!view || !next) return;
  const prev = config;
  config = { ...config, ...next };
  const effects = [];
  if (next.theme !== undefined && next.theme !== prev.theme) {
    effects.push(themeComp.reconfigure(themeExtensions(config.theme === 'light' ? LIGHT : DARK, config.fontSize)));
  }
  if (next.fontSize !== undefined && next.fontSize !== prev.fontSize) {
    effects.push(themeComp.reconfigure(themeExtensions(config.theme === 'light' ? LIGHT : DARK, config.fontSize)));
  }
  if ((next.tabSize !== undefined && next.tabSize !== prev.tabSize) ||
      (next.spacesForTab !== undefined && next.spacesForTab !== prev.spacesForTab)) {
    effects.push(indentComp.reconfigure([
      indentUnit.of(config.spacesForTab ? ' '.repeat(config.tabSize) : '\t'),
      EditorState.tabSize.of(config.tabSize),
    ]));
  }
  if (next.wordWrap !== undefined && next.wordWrap !== prev.wordWrap) {
    effects.push(wrapComp.reconfigure(config.wordWrap ? [EditorView.lineWrapping] : []));
  }
  if (next.completion !== undefined && next.completion !== prev.completion) {
    effects.push(completionComp.reconfigure(completionExtensions(config.completion)));
  }
  if (next.readOnly !== undefined && next.readOnly !== prev.readOnly) {
    effects.push(editableComp.reconfigure(EditorView.editable.of(!config.readOnly)));
    effects.push(readOnlyComp.reconfigure(EditorState.readOnly.of(config.readOnly)));
  }
  if (effects.length) view.dispatch({ effects });
};

/* A full external replace (opening a file or syncing an outside change).
 * Rebuilds the state so undo history and parse caches stay consistent. */
const setDocument = (value) => {
  if (!view) return;
  const text = String(value == null ? '' : value);
  lastChangeValue = text;
  if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
  view.setState(EditorState.create({ doc: text, extensions: makeExtensions() }));
  applyDiagnostics();
  scheduleCursor();
};

/* Entry point used from React Native via injectJavaScript. The message is a
 * JSON-encoded string, so any quoting/unicode issue is impossible. */
window.__rn = (encoded) => {
  let msg = null;
  try { msg = JSON.parse(encoded); } catch (e) { return; }
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'set': setDocument(msg.value); break;
    case 'config': applyConfig(msg.config); break;
    case 'insert': insertAtCursor(msg.text); break;
    case 'command': runCommand(msg.name, msg.arg); break;
    case 'diagnostics': pendingDiagnostics = Array.isArray(msg.items) ? msg.items : []; applyDiagnostics(); break;
    case 'get': post({ type: 'change', value: view ? view.state.doc.toString() : '' }); break;
    case 'debug':
      post({
        type: 'debug',
        chars: view ? view.state.doc.length : 0,
        lines: view ? view.state.doc.lines : 0,
        diagnostics: view ? diagnosticCount(view.state) : 0,
        focused: view ? view.hasFocus : false,
      });
      break;
    default: break;
  }
};

createView();
view.focus();
post({ type: 'ready' });
postCursor();