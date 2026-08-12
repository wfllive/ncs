/**
 * Regression test for the block <-> Kotlin round trip.
 *
 * Verifies two invariants that fix "saving corrupts my code":
 *   1. blocks -> code -> blocks is identity (ignoring volatile ids and
 *      cosmetic categories): editing blocks never invents or drops a block.
 *   2. code -> blocks -> code is byte-stable for every shape the block
 *      generator emits: opening a file and saving again never rewrites it.
 *
 * Run:  node scripts/verify-block-roundtrip.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The source files are ESM but this repo is not `"type": "module"`, so we
// load them by stripping the import/export glue and evaluating in a scope
// that provides `generateId`. This keeps the test self-contained.
const stripModule = (rel) =>
  readFileSync(join(root, rel), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default[^\n]*\n/gm, '')
    .replace(/^export (const|let|function|class)/gm, '$1');

const scope = { generateId: () => Math.random().toString(36).slice(2) + Date.now().toString(36) };
const combined = `${stripModule('src/utils/blockGenerator.ts')}\n${stripModule('src/utils/blockToCode.ts')}\n${stripModule('src/utils/blockPatcher.ts')}\n;return { generateCodeFromBlocks, generateImportsFromBlocks, generateBlocksFromSource, patchBody };`;
const { generateCodeFromBlocks, generateBlocksFromSource, patchBody } =
  new Function(...Object.keys(scope), combined)(...Object.values(scope));

const norm = (v) => JSON.stringify(v, (k, x) => ['id', 'category', '_range', '_indent'].includes(k) ? undefined : x);
const id = () => Math.random().toString(36).slice(2);
const B = (definitionId, inputs = {}, children = {}) => ({ id: id(), definitionId, category: 'X', inputs, children });

const cases = [
  ['state+column+text', [
    B('remember_int_state', { 'Variable Name': 'counter', 'Initial Value': '0' }),
    B('column', { 'Horizontal Alignment': 'CenterHorizontally', 'Vertical Spacing (dp)': '16' },
      { content: [B('text', { 'Text Content': 'Hello', 'Style': '', 'Font Weight': '' })] }),
  ]],
  ['button', [B('button', { 'Button Label': 'Click', 'OnClick Action': 'counter++' })]],
  ['if_else', [B('if_else', { 'Condition': 'counter > 5' },
    { then: [B('text', { 'Text Content': 'Big', 'Style': '', 'Font Weight': '' })],
      else: [B('text', { 'Text Content': 'Small', 'Style': '', 'Font Weight': '' })] })]],
  ['repeat', [B('repeat_times', { 'Times': '3' },
    { do: [B('text', { 'Text Content': 'x', 'Style': '', 'Font Weight': '' })] })]],
  ['lazy_column', [B('lazy_column', { 'List Variable': 'items' },
    { content: [B('text_with_variable', { 'Text with $variable': '$item', 'Style': '', 'Font Weight': '' })] })]],
  ['scaffold', [B('scaffold', { 'TopBar Title': 'MyApp' },
    { content: [B('text', { 'Text Content': 'Body', 'Style': '', 'Font Weight': '' })] })]],
  ['nested deep', [B('column', { 'Horizontal Alignment': 'Start', 'Vertical Spacing (dp)': '8' },
    { content: [
      B('row', { 'Horizontal Arrangement': 'spacedBy', 'Spacing (dp)': '8' },
        { content: [B('button', { 'Button Label': 'A', 'OnClick Action': 'x++' })] }),
      B('remember_string_state', { 'Variable Name': 'msg', 'Initial Value': 'hi' }),
    ] })]],
  ['custom_code preserved', [B('custom_code', { Code: 'someCall()' })]],
];

let failures = 0;
for (const [name, blocks] of cases) {
  const code = generateCodeFromBlocks(blocks);
  const parsed = generateBlocksFromSource(code);
  const code2 = generateCodeFromBlocks(parsed);
  const blocksOK = norm(blocks) === norm(parsed);
  const codeOK = code === code2;
  const ok = blocksOK && codeOK;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name} (blocksRoundTrip=${blocksOK}, codeStable=${codeOK})`);
}

// ---------------------------------------------------------------------------
// Surgical edit guarantee (CodeAssist model): editing one block must leave
// every other byte of the body byte-for-byte identical.
// ---------------------------------------------------------------------------
const body = [
  '    var counter by remember { mutableIntStateOf(0) }',
  '    Column(',
  '        modifier = Modifier',
  '            .fillMaxSize()',
  '            .padding(24.dp),',
  '        horizontalAlignment = Alignment.CenterHorizontally,',
  '        verticalArrangement = Arrangement.spacedBy(16.dp)',
  '    ) {',
  '        Text("Count: $counter")',
  '        // A comment that must survive',
  '        Button(onClick = { counter++ }) {',
  '            Text("Increment")',
  '        }',
  '    }',
  '    Text("Footer")',
].join('\n') + '\n';

const oldBlocks = generateBlocksFromSource(body);
const newBlocks = JSON.parse(JSON.stringify(oldBlocks));
newBlocks.find((b) => b.definitionId === 'column')
  .children.content.find((c) => c.definitionId === 'button').inputs['Button Label'] = 'Add';
const out = patchBody(body, oldBlocks, newBlocks);
const origLines = body.split('\n');
const outLines = out.split('\n');
const changedLines = origLines.filter((l, i) => outLines[i] !== l);
const surgicalOK = out.includes('var counter by remember { mutableIntStateOf(0) }')
  && out.includes('horizontalAlignment = Alignment.CenterHorizontally')
  && out.includes('Text("Count: $counter")')
  && out.includes('// A comment that must survive')
  && out.includes('Text("Footer")')
  && out.includes('Text("Add")')
  && changedLines.length === 1;
if (surgicalOK) console.log('PASS - surgical edit changes only the edited block, rest byte-identical');
else { console.error('FAIL - surgical edit corrupted untouched code'); failures++; }

if (failures) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log('\nALL PASS - block<->code round trip is lossless and edits are surgical.');
