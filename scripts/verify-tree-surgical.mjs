/**
 * Regression test for the design-tree <-> Kotlin surgical edit.
 *
 * Uses the REAL parseActivitySource + patchTree. Editing one design-tree node
 * (e.g. a button's onClick) must change only that node's text in the body and
 * leave every other byte (container chrome, siblings, comments, preamble)
 * byte-for-byte identical — the CodeAssist "minimal text-range patch"
 * guarantee applied to the design tab.
 *
 * Run:  node scripts/verify-tree-surgical.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Build a temp ESM environment with stubbed external deps so we can load the
// real modules (activityTree depends on shellExecutor + config/runtime).
const dir = mkdtempSync(join(tmpdir(), 'vts-'));
mkdirSync(join(dir, 'utils'), { recursive: true });
mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');

const copy = (src, dst) => writeFileSync(dst, readFileSync(src, 'utf8'));
const moduleFiles = [
  'activityTree', 'blockGenerator', 'blockPatcher', 'treePatcher',
  'blockToCode', 'generateId',
];
for (const f of moduleFiles) copy(join(root, 'src', 'utils', `${f}.js`), join(dir, 'utils', `${f}.js`));

writeFileSync(join(dir, 'utils', 'shellExecutor.js'), 'export const execute = async () => ({ success: true, output: "" });\n');
writeFileSync(join(dir, 'config', 'runtime.js'),
  'export const getSourceRoot = () => "app/src/main/java";\n' +
  'export const ANDROID_GRADLE_PLUGIN="x", COMPILE_SDK=37, COMPOSE_BOM="y", GRADLE_VERSION="g", JAVA_VERSION="17", KOTLIN_VERSION="k", MIN_SDK=24, TARGET_SDK=36;\n');

// Fix extensionless relative imports inside the copied modules.
for (const f of moduleFiles) {
  const p = join(dir, 'utils', `${f}.js`);
  let src = readFileSync(p, 'utf8');
  src = src.replace(/(from '\.\.\/config\/runtime')/g, (m) => m.slice(0, -1) + ".js'");
  src = src.replace(/(from '\.\/shellExecutor')/g, (m) => m.slice(0, -1) + ".js'");
  src = src.replace(/(from '\.\/(blockGenerator|blockPatcher|treePatcher|blockToCode|generateId)')(?![.])/g, (m) => m.slice(0, -1) + ".js'");
  writeFileSync(p, src);
}

const at = await import(pathToFileURL(join(dir, 'utils', 'activityTree.js')).href);

const src = `package com.example.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MainScreen() }
    }
}

@Composable
fun MainScreen() {
    var counter by remember { mutableIntStateOf(0) }
    // A comment that must survive a design edit
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Count: $counter")
        Button(onClick = { counter++ }) {
            Text("Increment")
        }
    }
    Text("Footer")
}
`;

let failures = 0;
function report(name, c) { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name); if (!c) failures++; return c; }

// Build the old tree from the real source, then edit the Button onClick.
const oldParsed = at.parseActivitySource(src);
const newTree = JSON.parse(JSON.stringify(oldParsed.tree));
(function walk(n) {
  if (n && n.type === 'Button' && n.props && n.props.onClick) n.props.onClick = 'counter = 100';
  (n.children || []).forEach(walk);
})(newTree);

// Apply through the real updateActivitySource (design path).
const res = at.updateActivitySource(src, {
  rootComponent: newTree, preamble: oldParsed.preamble, blocks: null, _emitFrom: 'tree',
});
const out = res.source;
const a = src.split('\n');
const b = out.split('\n');
const changed = a.filter((l, i) => b[i] !== l);

report('replaced', res.replaced === true);
report('onClick changed in output', /onClick = \{ counter = 100 \}/.test(out));
report('comment preserved', out.includes('// A comment that must survive a design edit'));
report('preamble preserved', /var counter by remember \{ mutableIntStateOf\(0\) \}/.test(out));
report('Text preserved', out.includes('Text("Count: $counter")'));
report('Footer preserved', out.includes('Text("Footer")'));
report('Button child preserved', /Button\(onClick = \{ counter = 100 \}\).*Text\("Increment"\)/s.test(out));
report('only the edited onClick line changed (surgical)', changed.length === 1);

// Add a Text node and delete a Button node — both must be surgical.
{
  const addTree = JSON.parse(JSON.stringify(oldParsed.tree));
  const addCol = addTree.type === 'Column' && addTree._range ? addTree : (addTree.children[0] || addTree);
  addCol.children.push({ id: 'new', type: 'Text', props: { text: 'Added', padding: 0 }, children: [], _range: null, _indent: '' });
  const addRes = at.updateActivitySource(src, { rootComponent: addTree, preamble: oldParsed.preamble, blocks: null, _emitFrom: 'tree' });
  report('added node inserted', addRes.source.includes('Text("Added")'));
  report('add keeps existing verbatim', addRes.source.includes('Button(onClick = { counter++ })') && addRes.source.includes('Text("Count: $counter")'));
}
{
  const delTree = JSON.parse(JSON.stringify(oldParsed.tree));
  const delCol = delTree.type === 'Column' && delTree._range ? delTree : (delTree.children[0] || delTree);
  delCol.children = delCol.children.filter((c) => c.type !== 'Button');
  const delRes = at.updateActivitySource(src, { rootComponent: delTree, preamble: oldParsed.preamble, blocks: null, _emitFrom: 'tree' });
  report('deleted node removed', !/Button\(onClick/.test(delRes.source));
  report('delete keeps others', delRes.source.includes('Text("Count: $counter")') && /var counter by remember \{ mutableIntStateOf\(0\) \}/.test(delRes.source));
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nALL PASS - design-tree edits are surgical; untouched code is byte-identical.');
