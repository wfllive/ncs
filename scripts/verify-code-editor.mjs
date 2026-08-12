/**
 * Regression test for the "code is the source of truth" editor flow.
 *
 * Verifies that:
 *   1. writeScreenSource writes the raw Kotlin source to the *Activity.kt file
 *      verbatim (nothing regenerated).
 *   2. parseActivitySource turns that source back into a design tree so the
 *      preview can render it.
 *   3. Editing the code and re-saving/re-parsing round-trips without losing
 *      the user's edits (e.g. a changed button label appears in the tree).
 *
 * Run:  node scripts/verify-code-editor.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;

// Build a temp ESM environment with stubbed external deps so we can load the
// real composeProject + activityTree modules.
const dir = mkdtempSync(join(tmpdir(), 'vce-'));
mkdirSync(join(dir, 'utils'), { recursive: true });
mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');

const moduleFiles = ['composeProject', 'activityTree', 'blockGenerator', 'blockPatcher', 'treePatcher', 'blockToCode', 'generateId'];
for (const f of moduleFiles) {
  writeFileSync(join(dir, 'utils', `${f}.js`), readFileSync(join(root, 'src', 'utils', `${f}.js`), 'utf8'));
}
writeFileSync(join(dir, 'utils', 'shellExecutor.js'), 'export const execute = async () => ({ success: true, output: "" });\n');

let disk = {};
let writes = [];
writeFileSync(join(dir, 'utils', 'workspace.js'),
  'let disk={},writes=[];\n' +
  'export const writeWorkspaceFile=async(project,fileName,content)=>{writes.push({fileName,content});disk[fileName]=content;return{success:true};};\n' +
  'export const readWorkspaceFile=async(project,fileName)=>disk[fileName]!=null?{success:true,output:disk[fileName]}:{success:false};\n' +
  'export const getDisk=()=>disk;export const getWrites=()=>writes;export const resetDisk=(d)=>{disk=d||{};writes=[];};\n');

writeFileSync(join(dir, 'config', 'runtime.js'),
  'export const getSourceRoot = () => "app/src/main/java";\n' +
  'export const getProjectDir = () => "/tmp";\n' +
  'export const ANDROID_GRADLE_PLUGIN="x", COMPILE_SDK=37, COMPOSE_BOM="y", GRADLE_VERSION="g", JAVA_VERSION="17", KOTLIN_VERSION="k", MIN_SDK=24, TARGET_SDK=36;\n');

// Fix extensionless relative imports in the copied modules.
for (const f of moduleFiles) {
  const p = join(dir, 'utils', `${f}.js`);
  let src = readFileSync(p, 'utf8');
  src = src.replace(/(from '\.\.\/config\/runtime')/g, (m) => m.slice(0, -1) + ".js'");
  src = src.replace(/(from '\.\/shellExecutor')/g, (m) => m.slice(0, -1) + ".js'");
  src = src.replace(/(from '\.\/(workspace|blockGenerator|blockPatcher|treePatcher|blockToCode|generateId|activityTree)')/g, (m) => m.slice(0, -1) + ".js'");
  writeFileSync(p, src);
}

const compose = await import(pathToFileURL(join(dir, 'utils', 'composeProject.js')).href);
const tree = await import(pathToFileURL(join(dir, 'utils', 'activityTree.js')).href);
const { getWrites, resetDisk } = await import(pathToFileURL(join(dir, 'utils', 'workspace.js')).href);

const FILE = 'app/src/main/java/MainActivity.kt';
const source = `package com.example.app

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
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Count: $counter")
        Button(onClick = { counter++ }) {
            Text("Increment")
        }
    }
}
`;

const project = { packageName: 'com.example.app', name: 'T', screens: [{ id: 'm', name: 'Main' }] };
const screen = { id: 'm', name: 'Main' };

let failures = 0;
function report(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) failures++; return cond; }

resetDisk({});
const res = await compose.writeScreenSource(project, screen, source);
const fileWrite = getWrites().find((w) => w.fileName === FILE);
report('writeScreenSource writes to *Activity.kt', Boolean(fileWrite));
report('writes source verbatim', fileWrite && fileWrite.content === source);

const parsed = tree.parseActivitySource(source);
report('reparses into a design tree', Boolean(parsed && parsed.tree && parsed.tree.type));
const col = parsed.tree.type === 'Column' ? parsed.tree : parsed.tree.children[0];
const children = col ? (col.children || []) : [];
report('tree has Text', children.some((c) => c.type === 'Text'));
report('tree has Button with onClick', children.some((c) => c.type === 'Button' && c.props.onClick === 'counter++'));

// Edit the code (change the button label) and verify it round-trips.
const edited = source.replace('Increment', 'Add');
resetDisk({});
await compose.writeScreenSource(project, screen, edited);
const parsed2 = tree.parseActivitySource(edited);
const col2 = parsed2.tree.type === 'Column' ? parsed2.tree : parsed2.tree.children[0];
const btn2 = (col2.children || []).find((c) => c.type === 'Button');
report('edited code reparses with new label', btn2 && JSON.stringify(btn2).includes('Add'));
report('edited code writes verbatim', getWrites().find((w) => w.fileName === FILE)?.content === edited);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nALL PASS - code is the source of truth; writes are verbatim and preview re-parses correctly.');
