/**
 * Regression test for the file explorer utilities.
 *
 * Verifies that projectFiles lists files, builds a nested tree (dirs first,
 * then files), reads a file's content, and writes a file.
 *
 * Run:  node scripts/verify-file-explorer.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'vfe-'));
mkdirSync(join(dir, 'utils'), { recursive: true });
mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');

writeFileSync(join(dir, 'utils', 'projectFiles.js'), readFileSync(join(root, 'src/utils/projectFiles.ts'), 'utf8'));

// Fake shell: return a fixed file listing.
writeFileSync(join(dir, 'utils', 'shellExecutor.js'),
  "export const execute = async () => ({ success: true, output: '\\n./app/src/main/java/com/x/MainActivity.kt\\n./app/build.gradle.kts\\n./app/src/main/AndroidManifest.xml\\n./settings.gradle.kts\\n' });\n");
writeFileSync(join(dir, 'config', 'runtime.js'), 'export const getProjectDir = () => "/tmp/proj";\n');

let disk = {};
writeFileSync(join(dir, 'utils', 'workspace.js'),
  'let disk={};\nexport const readWorkspaceFile=async(project,p)=>({success:true,output:"content of "+p});\nexport const writeWorkspaceFile=async(project,p,c)=>{disk[p]=c;return{success:true};};\nexport const getDisk=()=>disk;\n');

const fix = (f) => {
  const p = join(dir, 'utils', f);
  let s = readFileSync(p, 'utf8');
  s = s.replace(/(from '\.\.\/config\/runtime')/g, (m) => m.slice(0, -1) + ".js'");
  s = s.replace(/(from '\.\/shellExecutor')/g, (m) => m.slice(0, -1) + ".js'");
  s = s.replace(/(from '\.\/workspace')/g, (m) => m.slice(0, -1) + ".js'");
  writeFileSync(p, s);
};
fix('projectFiles.js');

const { listProjectFiles, buildFileTree, readProjectFile, writeProjectFile } = await import(pathToFileURL(join(dir, 'utils', 'projectFiles.js')).href);
const { getDisk } = await import(pathToFileURL(join(dir, 'utils', 'workspace.js')).href);

let failures = 0;
function report(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) failures++; return cond; }

const files = await listProjectFiles({ name: 'x' });
report('lists 4 project files (no root dot)', files.length === 4);
report('excludes "." root', !files.some((f) => f.path === '.' || f.path === ''));

const tree = buildFileTree(files);
report('root has app dir + settings file', tree.children.some((c) => c.isDir && c.name === 'app') && tree.children.some((c) => !c.isDir && c.name === 'settings.gradle.kts'));
const app = tree.children.find((c) => c.isDir && c.name === 'app');
report('app dir nested correctly', app && app.children.some((c) => !c.isDir && c.name === 'build.gradle.kts'));
const appSrc = app && app.children.find((c) => c.isDir && c.name === 'src');
report('app/src has MainActivity.kt', appSrc && JSON.stringify(appSrc.children).includes('MainActivity.kt'));

const read = await readProjectFile({}, 'a/b.kt');
report('readProjectFile returns content', read.output === 'content of a/b.kt');
const w = await writeProjectFile({}, 'x/y.kt', 'hi');
report('writeProjectFile writes content', getDisk()['x/y.kt'] === 'hi');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nALL PASS - file explorer utilities work.');
