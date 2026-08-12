#!/usr/bin/env node
/**
 * Headless unit tests for the .kt -> component tree parser
 * (src/utils/activityTree.ts), which is the "code-first" heart of the
 * Jetpack Compose preview.
 *
 * The app sources are ESM without "type": "module" (Metro transpiles them), so
 * we copy them into a temp package with type:module and fix the extensionless
 * relative import specifiers, exactly like scripts/test-analyzer.mjs.
 *
 * Run with:  node scripts/test-activity-tree.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import babel from '@babel/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const tmp = mkdtempSync(join(tmpdir(), 'kt-activity-tree-'));
const transpileTs = (source, destination) => {
  const sourcePath = join(root, 'src', source);
  const targetPath = join(tmp, destination);
  const result = babel.transformSync(readFileSync(sourcePath, 'utf8'), {
    filename: sourcePath,
    babelrc: false,
    configFile: false,
    plugins: [['@babel/plugin-transform-typescript', { allowDeclareFields: true }]],
  });
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, result?.code || '');
};

const addJsExt = (text) =>
  text
    .replace(/from\s+'\.\/([^']+)'(?!\.js)/g, "from './$1.js'")
    .replace(/from\s+'\.\.\/config\/runtime'(?!\.js)/g, "from '../config/runtime.js'");

for (const f of ['utils/activityTree', 'utils/shellExecutor', 'utils/generateId',
  'utils/blockGenerator', 'utils/blockPatcher', 'utils/blockToCode',
  'utils/treePatcher', 'utils/blockDefinitions', 'config/runtime']) {
  transpileTs(`${f}.ts`, `${f}.js`);
}
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));

// Patch extensionless relative imports in the files we loaded.
for (const f of ['utils/activityTree.js', 'utils/shellExecutor.js', 'utils/generateId.js',
  'utils/blockGenerator.js', 'utils/blockPatcher.js', 'utils/blockToCode.js',
  'utils/treePatcher.js', 'utils/blockDefinitions.js']) {
  const target = join(tmp, f);
  writeFileSync(target, addJsExt(readFileSync(target, 'utf8')));
}

const { parseActivitySource, buildActivitySource, expandUserComposables } = await import(pathToFileURL(join(tmp, 'utils/activityTree.js')).href);

let passed = 0;
let failed = 0;
const check = (name, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`); }
};

const activity = (inner) => `package com.example.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                MainScreen()
            }
        }
    }
}

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme { content() }
}

@Composable
fun MainScreen() {
${inner}
}
`;

// ---- plain Column: must NOT synthesize an app bar (code-first) ----
{
  const src = activity(`    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(text = "Hello", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Button(onClick = {}) {
            Text("Tap me")
        }
    }`);
  const parsed = parseActivitySource(src);
  check('parses a plain Column screen', parsed?.tree?.type === 'Column', parsed?.tree);
  check('captures fillMaxSize width', parsed?.tree?.props?.width === 'match_parent');
  check('captures padding(16.dp)', parsed?.tree?.props?.padding === 16);
  const button = parsed?.tree?.children?.find((c) => c.type === 'Button');
  check('finds Button child', !!button, parsed?.tree?.children);
  // Button label text lives in its child Text node; the renderer resolves it.
  check('Button has child Text label', button?.children?.[0]?.type === 'Text');
  const text = parsed?.tree?.children?.find((c) => c.type === 'Text');
  check('Text fontWeight bold', text?.props?.textStyle === 'bold', text?.props);
  check('Text fontSize', text?.props?.textSize === 18);
}

// ---- weight / size / modifier fidelity ----
{
  const src = activity(`    Row(modifier = Modifier.fillMaxWidth()) {
        Box(modifier = Modifier.weight(1f).size(48, 48).background(Color(0xFFE0E0E0)))
        Box(modifier = Modifier.weight(2f).aspectRatio(1f))
        Spacer(modifier = Modifier.width(16.dp))
    }`);
  const parsed = parseActivitySource(src);
  const row = parsed?.tree;
  check('parses Row root', row?.type === 'Row');
  const box1 = row?.children?.find((c) => c.type === 'Box' && c.props?.weight === 1);
  check('Box weight(1f) captured', !!box1, row?.children?.map((c) => c.props));
  check('Box size(48,48) width', box1?.props?.sizeWidth === 48, box1?.props);
  check('Box size(48,48) height', box1?.props?.sizeHeight === 48);
  check('Box background hex (Color(0xFFE0E0E0))', box1?.props?.backgroundColor === '#FFE0E0E0', box1?.props);
  const box2 = row?.children?.find((c) => c.type === 'Box' && c.props?.weight === 2);
  check('Box weight(2f) + aspectRatio', box2?.props?.weight === 2 && box2?.props?.aspectRatio === 1, box2?.props);
}

// ---- padding variants ----
{
  const src = activity(`    Column(modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp).fillMaxWidth()) {
        Text(text = "A", modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 4.dp))
        Text(text = "B", modifier = Modifier.padding(all = 10.dp))
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  check('Column paddingHorizontal', col?.props?.paddingHorizontal === 24, col?.props);
  check('Column paddingVertical', col?.props?.paddingVertical === 16);
  const a = col?.children?.find((c) => c.props?.text === 'A');
  check('Text A paddingStart', a?.props?.paddingStart === 8, a?.props);
  check('Text A paddingEnd', a?.props?.paddingEnd === 8);
  check('Text A paddingTop', a?.props?.paddingTop === 4);
  const b = col?.children?.find((c) => c.props?.text === 'B');
  check('Text B padding(all=10)', b?.props?.padding === 10);
}

// ---- typography style + lineHeight + maxLines ----
{
  const src = activity(`    Column {
        Text(text = "Title", style = MaterialTheme.typography.headlineMedium, lineHeight = 32.sp)
        Text(text = "Body", maxLines = 2, textAlign = TextAlign.End)
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  const t = col?.children?.find((c) => c.props?.text === 'Title');
  check('headlineMedium maps to headline', t?.props?.textStyle === 'headline', t?.props);
  check('lineHeight captured', t?.props?.lineHeight === 32);
  const b = col?.children?.find((c) => c.props?.text === 'Body');
  check('maxLines captured', b?.props?.maxLines === 2);
  check('textAlign End', b?.props?.textAlign === 'end');
}

// ---- new components + Scaffold/TopAppBar ----
{
  const src = activity(`    Scaffold(topBar = { TopAppBar(title = { Text("My App") }) }) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            OutlinedCard { Text("Card") }
            FilledTonalButton(onClick = {}) { Text("Tonal") }
            FloatingActionButton(onClick = {}) { Text("+") }
        }
    }`);
  const parsed = parseActivitySource(src);
  check('parses Scaffold root', parsed?.tree?.type === 'Scaffold', parsed?.tree?.type);
  const col = parsed?.tree?.children?.find((c) => c.type === 'Column');
  check('finds Column inside Scaffold', !!col);
  check('finds OutlinedCard', col?.children?.some((c) => c.type === 'OutlinedCard'));
  check('finds FilledTonalButton', col?.children?.some((c) => c.type === 'FilledTonalButton'));
  check('finds FloatingActionButton', col?.children?.some((c) => c.type === 'FloatingActionButton'));
}

// ---- OutlinedTextField positional label ----
{
  const src = activity(`    Column {
        OutlinedTextField(value = "", label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
        TextField(value = "pre", label = { Text("Email") })
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  const otf = col?.children?.find((c) => c.type === 'OutlinedTextField');
  check('OutlinedTextField found', !!otf);
  const tf = col?.children?.find((c) => c.type === 'TextField');
  check('TextField found', !!tf);
}

// ---- code-first top bar title must be captured from the actual TopAppBar ----
{
  const src = activity(`    Scaffold(topBar = { TopAppBar(title = { Text("My App Title") }) }) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            Text("Content")
        }
    }`);
  const parsed = parseActivitySource(src);
  check('Scaffold root parsed', parsed?.tree?.type === 'Scaffold', parsed?.tree?.type);
  const tb = parsed?.tree?.props?.topBar;
  check('topBar slot captured', tb?.type === 'TopAppBar', tb?.type);
  check('topBar title = code Text', tb?.props?.title === 'My App Title', tb?.props);
}

// ---- more Material 3 components parse into the tree ----
{
  const src = activity(`    Column {
        NavigationBar { NavigationBarItem(selected = true, onClick = {}, icon = { Icon(Icons.Default.Home, contentDescription = null) }, label = { Text("Home") }) }
        Slider(value = 0.6f, onValueChange = {})
        FilterChip(selected = true, onClick = {}, label = { Text("Filter") })
        AssistChip(onClick = {}, label = { Text("Assist") })
        Row { RadioButton(selected = true, onClick = {}); Text("Opt") }
        VerticalDivider(modifier = Modifier.height(20.dp))
        PrimaryTabRow(selectedTabIndex = 1) { Tab(selected = true, onClick = {}, text = { Text("Tab1") }) }
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  check('parses NavigationBar', col?.children?.some((c) => c.type === 'NavigationBar'));
  check('parses NavigationBarItem', col?.children?.some((c) => c.children?.some((n) => n.type === 'NavigationBarItem')));
  check('parses Slider', col?.children?.some((c) => c.type === 'Slider'));
  check('parses FilterChip', col?.children?.some((c) => c.type === 'FilterChip'));
  check('parses AssistChip', col?.children?.some((c) => c.type === 'AssistChip'));
  const radioRow = col?.children?.find((c) => c.type === 'Row');
  check('parses RadioButton (inside Row)', radioRow?.children?.some((c) => c.type === 'RadioButton'));
  check('parses VerticalDivider', col?.children?.some((c) => c.type === 'VerticalDivider'));
  check('parses PrimaryTabRow', col?.children?.some((c) => c.type === 'PrimaryTabRow'));
  const navItem = col?.children?.find((c) => c.type === 'NavigationBar')?.children?.[0];
  check('NavigationBarItem selected', navItem?.props?.selected === true, navItem?.props);
  check('Slider progress', col?.children?.find((c) => c.type === 'Slider')?.props?.progress === 0.6);
  check('FilterChip selected', col?.children?.find((c) => c.type === 'FilterChip')?.props?.selected === true);
}

// ---- button content (child Text) is preserved for faithful rendering ----
{
  const src = activity(`    Column {
        Button(onClick = {}) { Text("Save") }
        Button(onClick = {}, modifier = Modifier.fillMaxWidth()) { Text("Wide") }
        OutlinedButton("Outline") { Text("X") }
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  const b1 = col?.children?.find((c) => c.type === 'Button');
  check('Button has child Text content', b1?.children?.[0]?.type === 'Text' && b1?.children?.[0]?.props?.text === 'Save', b1?.children);
  check('Button fillMaxWidth width', col?.children?.find((c) => c.props?.width === 'match_parent')?.type === 'Button');
  check('OutlinedButton parses', col?.children?.some((c) => c.type === 'OutlinedButton'));
}

// ---- explicit button colour (colors = ButtonDefaults.buttonColors(...)) ----
{
  const src = activity(`    Column {
        Button(onClick = {}, colors = ButtonDefaults.buttonColors(containerColor = composeColor("#FF0000"))) { Text("Red") }
        Button(onClick = {}, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00FF00))) { Text("Green") }
        Button(onClick = {}) { Text("Default") }
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  const buttons = (col?.children || []).filter((c) => c.type === 'Button');
  check('found 3 buttons', buttons.length === 3, buttons.length);
  const childText = (b) => b?.children?.[0]?.props?.text;
  const red = buttons.find((b) => childText(b) === 'Red');
  check('explicit composeColor button backgroundColor', red?.props?.backgroundColor === '#FF0000', red?.props);
  const green = buttons.find((b) => childText(b) === 'Green');
  check('explicit Color(0xFF) button backgroundColor', green?.props?.backgroundColor === '#FF00FF00', green?.props);
  const def = buttons.find((b) => childText(b) === 'Default');
  check('plain button has no backgroundColor override', !def?.props?.backgroundColor, def?.props);
}

// ---- extended batch of Material 3 components ----
{
  const src = activity(`    Column {
        BasicTextField(value = "Edit me", onValueChange = {}, modifier = Modifier.fillMaxWidth())
        SelectableText(value = "Selectable")
        ExtendedFloatingActionButton(onClick = {}, text = { Text("Extend") }, icon = { Icon(Icons.Default.Add, contentDescription = null) })
        RangeSlider(value = 0.2f..0.8f, onValueChange = {})
        Snackbar { Text("Saved") }
        FlowRow { Text("a"); Text("b") }
        SingleChoiceSegmentedButtonRow { SegmentedButton(selected = true, onClick = {}, label = { Text("Day") }) }
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  check('parses BasicTextField', col?.children?.some((c) => c.type === 'BasicTextField'));
  check('parses SelectableText', col?.children?.some((c) => c.type === 'SelectableText'));
  check('parses ExtendedFloatingActionButton', col?.children?.some((c) => c.type === 'ExtendedFloatingActionButton'));
  check('parses RangeSlider', col?.children?.some((c) => c.type === 'RangeSlider'));
  check('parses Snackbar', col?.children?.some((c) => c.type === 'Snackbar'));
  check('parses FlowRow', col?.children?.some((c) => c.type === 'FlowRow'));
  check('parses SingleChoiceSegmentedButtonRow', col?.children?.some((c) => c.type === 'SingleChoiceSegmentedButtonRow'));
  const rs = col?.children?.find((c) => c.type === 'RangeSlider');
  check('RangeSlider start/end', rs?.props?.startValue === 0.2 && rs?.props?.endValue === 0.8, rs?.props);
  const seg = col?.children?.find((c) => c.type === 'SingleChoiceSegmentedButtonRow');
  check('SegmentedButton selected', seg?.children?.[0]?.type === 'SegmentedButton' && seg?.children?.[0]?.props?.selected === true, seg?.children?.[0]?.props);
}

// ---- exotic Material 3 components (drawer / sheet / date / search) ----
{
  const src = activity(`    Column {
        ModalNavigationDrawer(drawerState = rememberDrawerState(DrawerValue.Closed)) {
            ModalDrawerSheet {
                Text("Menu")
                NavigationDrawerItem(label = { Text("Home") }, selected = true, onClick = {})
            }
        }
        ModalBottomSheet(onDismissRequest = {}) {
            Text("Sheet content")
        }
        SearchBar(query = "hello", onQueryChange = {}, onSearch = {}, active = true, onActiveChange = {})
        DatePicker(state = rememberDatePickerState())
        DateRangePicker(state = rememberDateRangePickerState())
    }`);
  const parsed = parseActivitySource(src);
  const col = parsed?.tree;
  const drawer = col?.children?.find((c) => c.type === 'ModalNavigationDrawer');
  check('parses ModalNavigationDrawer', !!drawer);
  const sheet = drawer?.children?.find((c) => c.type === 'ModalDrawerSheet');
  check('parses ModalDrawerSheet (nested)', !!sheet);
  check('parses NavigationDrawerItem (nested)', sheet?.children?.some((n) => n.type === 'NavigationDrawerItem'));
  check('NavigationDrawerItem selected', sheet?.children?.find((n) => n.type === 'NavigationDrawerItem')?.props?.selected === true);
  check('parses ModalBottomSheet', col?.children?.some((c) => c.type === 'ModalBottomSheet'));
  const sb = col?.children?.find((c) => c.type === 'SearchBar');
  check('parses SearchBar with query', sb?.props?.query === 'hello', sb?.props);
  check('parses DatePicker (incl DateRangePicker normalized)', col?.children?.filter((c) => c.type === 'DatePicker').length === 2);
}

// ---- user-defined @Composable helpers inline into the preview tree ----
{
  const src = `package com.example.app
import androidx.compose.material3.*
import androidx.compose.runtime.*
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent { AppTheme { MainScreen() } } }
}
@Composable
fun AppTheme(content: @Composable () -> Unit) { MaterialTheme { content() } }
@Composable
fun MainScreen() {
    Column {
        HeroCard()
        CounterButtons(onIncrement = { counter++ }, onReset = { counter = 0 })
        Tag("Material 3")
    }
}
@Composable
fun HeroCard() { ElevatedCard { Column { Text("Hero"); Text("Body") } } }
@Composable
fun CounterButtons(onIncrement: () -> Unit, onReset: () -> Unit) {
    Row { Button(onClick = onIncrement) { Text("+1") }; Button(onClick = onReset) { Text("Reset") } }
}
@Composable
fun Tag(text: String) { Surface { Text(text = text) } }
`;
  const parsed = parseActivitySource(src);
  check('helpers parse as placeholders first', parsed?.tree?.children?.some((c) => c.type === 'HeroCard'));
  const exp = expandUserComposables(src, parsed.tree);
  check('HeroCard inlined to ElevatedCard', exp?.children?.some((c) => c.type === 'ElevatedCard'));
  check('CounterButtons inlined to Row', exp?.children?.some((c) => c.type === 'Row'));
  check('Row has buttons', exp?.children?.find((c) => c.type === 'Row')?.children?.some((b) => b.type === 'Button'));
  const tag = exp?.children?.find((c) => c.type === 'Surface');
  check('Tag inlined to Surface with substituted text', tag?.children?.[0]?.props?.text === 'Material 3', tag?.children?.[0]?.props);
}

// ---- tree -> code re-emission of the new components must NOT degrade ----
{
  const screen = {
    name: 'Gallery',
    rootComponent: {
      id: 'r', type: 'Column',
      props: { width: 'match_parent' },
      children: [
        { id: 'c1', type: 'OutlinedCard', props: {}, children: [
          { id: 't1', type: 'Text', props: { text: 'Inside' }, children: [] },
        ] },
        { id: 'c2', type: 'FilledTonalButton', props: { text: 'Go' }, children: [] },
        { id: 'c3', type: 'FloatingActionButton', props: { text: '+' }, children: [] },
      ],
    },
  };
  const project = { packageName: 'com.test.app' };
  const out = buildActivitySource(screen, project);
  check('re-emits OutlinedCard as code', out.includes('OutlinedCard('));
  check('re-emits FilledTonalButton as code', out.includes('FilledTonalButton('));
  check('re-emits FloatingActionButton as code', out.includes('FloatingActionButton('));
  check('does not degrade to Text("OutlinedCard")', !out.includes('Text("OutlinedCard")'));
  check('keeps child text inside card', out.includes('Inside'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
