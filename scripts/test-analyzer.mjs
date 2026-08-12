#!/usr/bin/env node
/**
 * Unit tests for the instant Kotlin/Compose analyzer (src/utils/kotlinAnalyzer.ts).
 *
 * The app sources are ESM without "type": "module" in package.json (Metro
 * transpiles them), so plain Node cannot import them directly — we load the
 * sources as text and import them via data: URLs instead.
 *
 * Run with:  node scripts/test-analyzer.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The app sources are ESM without "type": "module" in package.json (Metro
// transpiles them; Node ESM also requires explicit extensions), so copy the
// modules into a temp package with type:module and fix the import specifier.
const tmp = mkdtempSync(join(tmpdir(), 'kt-analyzer-'));
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(tmp, 'importManager.js'), readFileSync(join(root, 'src/utils/importManager.ts'), 'utf8'));
writeFileSync(
  join(tmp, 'kotlinAnalyzer.js'),
  readFileSync(join(root, 'src/utils/kotlinAnalyzer.ts'), 'utf8')
    .replace("from './importManager'", "from './importManager.js'"),
);

const { analyzeKotlin } = await import(pathToFileURL(join(tmp, 'kotlinAnalyzer.js')).href);

let passed = 0;
let failed = 0;
const check = (name, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const problemsOf = (code) => analyzeKotlin(code);
const errorsOf = (code) => problemsOf(code).filter((p) => p.severity === 'error');
const warningsOf = (code) => problemsOf(code).filter((p) => p.severity === 'warning');
const hasCode = (code, rule) => problemsOf(code).some((p) => p.code === rule);

const VALID_ACTIVITY = `package com.example.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Greeting("Android")
        }
    }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    var count by remember { mutableStateOf(0) }
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(text = "Hello \${'$'}name!")
        Button(onClick = { count++ }) {
            Text("Clicked \${'$'}count times")
        }
    }
}
`;

// 1 — a real-world valid activity must be completely clean
{
  const problems = problemsOf(VALID_ACTIVITY);
  check('valid MainActivity: zero problems', problems.length === 0, JSON.stringify(problems, null, 1));
}

// 2 — structural errors
check('unclosed brace → error', errorsOf('fun main() {').some((p) => p.code === 'bracket'));
check('unexpected ) → error', errorsOf('fun main() {})').some((p) => p.code === 'bracket'));
check('mismatched ] → error', errorsOf('val a = (1]').some((p) => p.code === 'bracket'));
check('unclosed string → error', errorsOf('val s = "hello\nval b = 1').some((p) => p.code === 'unclosed-string'));
check('unclosed block comment → error', errorsOf('val a = 1\n/* comment\nval b = 2').some((p) => p.code === 'unclosed-comment'));

// 3 — braces inside strings/comments must NOT count
{
  const code = `val s = "}{)("\nval t = """ { [ ( } ] ) """\n// }))) \n/* ( { */ val b = 1`;
  check('brackets inside strings/comments are ignored', errorsOf(code).length === 0, JSON.stringify(errorsOf(code)));
}

// 4 — template string with ${} contains no bracket noise
{
  const code = 'val msg = "count: ${items.size}"\nfun f() {}';
  check('string template ${} ignored', errorsOf(code).length === 0, JSON.stringify(errorsOf(code)));
}

// 5 — broken declarations
check("lone 'fun' → error", errorsOf('fun').some((p) => p.code === 'decl'));
check("lone 'val' → error", errorsOf('val').some((p) => p.code === 'decl'));
check("lone 'class' → error", errorsOf('suspend class').some((p) => p.code === 'decl'));
check("lone 'import' → error", errorsOf('import').some((p) => p.code === 'decl'));

// 6 — composable context violations
{
  const bad = `fun onCreate() {
    Column {
        Text("hi")
    }
}`;
  check('composable call outside @Composable → warning', hasCode(bad, 'compose-context'), JSON.stringify(problemsOf(bad)));
}
{
  const good = `fun onCreate() {
    setContent {
        Column {
            Text("hi")
        }
    }
}`;
  check('setContent { } creates composable scope — no warning', !hasCode(good, 'compose-context'), JSON.stringify(problemsOf(good)));
}
{
  const good = `@Composable
fun Screen() {
    Column {
        Text("hi")
    }
}`;
  check('@Composable fun — no warning', !hasCode(good, 'compose-context'), JSON.stringify(problemsOf(good)));
}
{
  const parenthesised = `@Composable
fun Screen() {
    Column(
        modifier = Modifier
    ) {
        Text("hi")
    }
}`;
  check('trailing lambda after multi-line call — no warning', !hasCode(parenthesised, 'compose-context'), JSON.stringify(problemsOf(parenthesised)));
}
{
  const preview = `@Preview
fun ScreenPreview() {
    Column { }
}`;
  check('@Preview counts as composable scope', !hasCode(preview, 'compose-context'), JSON.stringify(problemsOf(preview)));
}

// 7 — remember in control flow
{
  const bad = `@Composable
fun Screen() {
    if (true) {
        val x = remember { mutableStateOf(0) }
    }
}`;
  check('remember inside if → warning', hasCode(bad, 'remember-conditional'), JSON.stringify(problemsOf(bad)));
}
{
  const good = `@Composable
fun Screen() {
    val x = remember { mutableStateOf(0) }
}`;
  check('remember at composable top level — no warning', !hasCode(good, 'remember-conditional'), JSON.stringify(problemsOf(good)));
}

// 8 — typo hints
{
  const typo = `@Composable
fun Screen() {
    Colum {
        Text("hi")
    }
}`;
  check("'Colum' suggests 'Column'", problemsOf(typo).some((p) => p.code === 'typo' && /'Column'/.test(p.message)), JSON.stringify(problemsOf(typo)));
}
{
  const custom = `@Composable
fun Screen() {
    MyCustomWidget {
        Text("hi")
    }
}`;
  check('unknown custom composable — NO typo warning', !hasCode(custom, 'typo'), JSON.stringify(problemsOf(custom)));
}

// 9 — deprecations and quality hints
check('Divider deprecated → warning', hasCode('@Composable\nfun S() {\n    Divider()\n}', 'deprecated'));
check("material2 import → warning", hasCode('import androidx.compose.material.Text\nval a = 1', 'material2'));
check('!! → warning', hasCode('val x = name!!', 'force-unwrap'));

// 10 — Kotlin stdlib/class construction never flagged as composable-context
{
  const code = `fun util() {
    val uri = Uri.parse("content://x")
    val intent = Intent()
    val brush = Brush.linearGradient()
    Color(0xFF112233)
}`;
  check('symbols/types — no compose-context warnings', !hasCode(code, 'compose-context'), JSON.stringify(problemsOf(code)));
}

// 11 — heuristics are suppressed while structural errors exist
{
  const code = `@Composable\nfun Screen() {\n    Colum {`;
  const problems = problemsOf(code);
  check('structural errors win: typo hints skipped on broken code', hasCode(code, 'bracket') && !problems.some((p) => p.code === 'compose-context'), JSON.stringify(problems));
}

// 12 — problem positions are 1-based and sensible
{
  const problems = problemsOf('Column(\n    modifier = Modifier\n');
  check('unclosed ( reported at its own position', problems.some((p) => p.line === 1 && p.col === 7 && p.code === 'bracket'), JSON.stringify(problems));
}

// 13 — val reassignment
{
  check('val reassigned → error', hasCode('fun f() {\n    val x = 1\n    x = 2\n}', 'val-reassign'), 'expected val-reassign');
  const okVar = 'fun f() {\n    var x = 1\n    x = 2\n    x += 3\n    x++\n}';
  check('var reassigned — no error', !hasCode(okVar, 'val-reassign'), JSON.stringify(problemsOf(okVar)));
  const member = 'fun f() {\n    val prop = 1\n    obj.prop = 2\n}';
  check('member assignment obj.prop — no error', !hasCode(member, 'val-reassign'), JSON.stringify(problemsOf(member)));
  const typedInit = 'fun f() {\n    val x: Int = 5\n}';
  check('typed initializer val x: Int = 5 — no error', !hasCode(typedInit, 'val-reassign'), JSON.stringify(problemsOf(typedInit)));
  const inLambda = 'val count = 0\nfun f() {\n    Button(onClick = { count = 5 }) { }\n}';
  check('reassignment inside onClick lambda → error', hasCode(inLambda, 'val-reassign'), JSON.stringify(problemsOf(inLambda)));
  const param = 'fun f(x: Int) {\n    x = 3\n}';
  check('function parameter reassigned → error', hasCode(param, 'val-reassign'), JSON.stringify(problemsOf(param)));
  const lambdaParam = 'fun f() {\n    listOf(1).forEach { item ->\n        item = 2\n    }\n}';
  check('lambda parameter reassigned → error', hasCode(lambdaParam, 'val-reassign'), JSON.stringify(problemsOf(lambdaParam)));
  const loopVar = 'fun f() {\n    for (i in 1..10) {\n        i = 3\n    }\n}';
  check('for-loop variable reassigned → error', hasCode(loopVar, 'val-reassign'), JSON.stringify(problemsOf(loopVar)));
  const shadow = 'fun f() {\n    val x = 1\n    if (true) {\n        var x = 2\n        x = 3\n    }\n}';
  check('inner var shadows outer val — no error', !hasCode(shadow, 'val-reassign'), JSON.stringify(problemsOf(shadow)));
}

// 14 — duplicate declarations
{
  check('duplicate val in same scope → error', hasCode('fun f() {\n    val x = 1\n    val x = 2\n}', 'duplicate-decl'));
  const nested = 'fun f() {\n    val x = 1\n    if (true) {\n        val x = 2\n    }\n}';
  check('same name in nested scope — no error', !hasCode(nested, 'duplicate-decl'), JSON.stringify(problemsOf(nested)));
  check('duplicate parameter names → error', hasCode('fun f(a: Int, a: String) { }', 'duplicate-decl'));
}

// 15 — literal type mismatches
{
  check("val x: Int = 'hello' → error", hasCode('val x: Int = "hello"', 'type-mismatch'));
  check('val s: String = 42 → error', hasCode('val s: String = 42', 'type-mismatch'));
  check('val s: String = true → error', hasCode('val s: String = true', 'type-mismatch'));
  check('val f: Float = 1.5 → error', hasCode('val f: Float = 1.5', 'type-mismatch'));
  check('val f: Float = 1.5f — no error', !hasCode('val f: Float = 1.5f', 'type-mismatch'));
  check('val d: Double = 1 → error', hasCode('val d: Double = 1', 'type-mismatch'));
  check('val d: Double = 1.0 — no error', !hasCode('val d: Double = 1.0', 'type-mismatch'));
  check('val i: Int = 42 — no error', !hasCode('val i: Int = 42', 'type-mismatch'));
  check('val i: Int = 42L → error', hasCode('val i: Int = 42L', 'type-mismatch'));
  check('val l: Long = 42 — no error', !hasCode('val l: Long = 42', 'type-mismatch'));
  check('val b: Boolean = 1 → error', hasCode('val b: Boolean = 1', 'type-mismatch'));
  check('val b: Boolean = true — no error', !hasCode('val b: Boolean = true', 'type-mismatch'));
  check("val c: Char = 'a' — no error", !hasCode("val c: Char = 'a'", 'type-mismatch'));
  check("val c: Char = 'ab' → error", hasCode("val c: Char = 'ab'", 'type-mismatch'));
  check("val s: String = 'a' → error", hasCode("val s: String = 'a'", 'type-mismatch'));
  const compound = 'fun f() {\n    val n: Int = "x".length\n}';
  check('"x".length is compound — NO false type error', !hasCode(compound, 'type-mismatch'), JSON.stringify(problemsOf(compound)));
}

// 16 — named arguments of known Compose components
{
  check("Button(text = …) → warning", hasCode('@Composable\nfun S() {\n    Button(text = "OK") { }\n}', 'named-arg'));
  const valid = '@Composable\nfun S() {\n    Button(onClick = { }, enabled = true) { }\n}';
  check('valid Button args — no warning', !hasCode(valid, 'named-arg'), JSON.stringify(problemsOf(valid)));
  const colValid = '@Composable\nfun S() {\n    Column(modifier = Modifier, verticalArrangement = null) { }\n}';
  check('valid Column args — no warning', !hasCode(colValid, 'named-arg'), JSON.stringify(problemsOf(colValid)));
  const shadowed = '@Composable\nfun Button(text: String) { }\n@Composable\nfun S() {\n    Button(text = "x")\n}';
  check('local Button shadow — no named-arg warning', !hasCode(shadowed, 'named-arg'), JSON.stringify(problemsOf(shadowed)));
  check('unknown callee args — no warning', !hasCode('val u = User(name = "x", age = 5)', 'named-arg'));
  check('fun default param — no warning', !hasCode('fun f(count: Int = 5) { }', 'named-arg'));
}

// 17 — missing imports
{
  check('Card without import → missing-import warning', hasCode('@Composable\nfun S() {\n    Card { }\n}', 'missing-import'));
  const imported = 'import androidx.compose.material3.Card\n@Composable\nfun S() {\n    Card { }\n}';
  check('Card with import — no warning', !hasCode(imported, 'missing-import'), JSON.stringify(problemsOf(imported)));
  const sizeProp = 'fun f(list: List<Int>) {\n    val n = list.size\n}';
  check('list.size property — no import warning', !hasCode(sizeProp, 'missing-import'), JSON.stringify(problemsOf(sizeProp)));
  const modPad = 'fun f() {\n    val m = Modifier.padding(8.dp)\n}';
  check('Modifier.padding(8.dp) → import warnings', hasCode(modPad, 'missing-import'), JSON.stringify(problemsOf(modPad)));
  const ownPadding = 'val padding = 4\ndval = 1'.replace('dval', 'val x');
  check('local val named padding — no padding import', problemsOf(ownPadding).every((p) => p.code !== 'missing-import' || !/layout\.padding/.test(p.message)), JSON.stringify(problemsOf(ownPadding)));
}

// 18 — regression: the real-world activity stays clean under the new passes
{
  const problems = problemsOf(VALID_ACTIVITY);
  check('valid MainActivity: still zero problems after upgrade', problems.length === 0, JSON.stringify(problems, null, 1));
}

// 19 — dp/sp unit confusion
{
  check('fontSize = 16.dp → unit-mismatch error', hasCode('@Composable\nfun S() {\n    Text("hi", fontSize = 16.dp)\n}', 'unit-mismatch'));
  check('fontSize = 16.sp — no error', !hasCode('@Composable\nfun S() {\n    Text("hi", fontSize = 16.sp)\n}', 'unit-mismatch'));
  check('TextStyle(fontSize = 16.dp) → error', hasCode('val st = TextStyle(fontSize = 16.dp)', 'unit-mismatch'));
  check('Modifier.size(16.sp) → error', hasCode('fun f() {\n    val m = Modifier.size(16.sp)\n}', 'unit-mismatch'));
  check('Modifier.size(16.dp) — no error', !hasCode('fun f() {\n    val m = Modifier.size(16.dp)\n}', 'unit-mismatch'));
  check('padding(16.sp) → error', hasCode('fun f() {\n    val m = Modifier.padding(16.sp)\n}', 'unit-mismatch'));
  check('RoundedCornerShape(8.sp) → error', hasCode('val s = RoundedCornerShape(8.sp)', 'unit-mismatch'));
  check('spacedBy(8.sp) in Arrangement → error', hasCode('@Composable\nfun S() {\n    Column(verticalArrangement = Arrangement.spacedBy(8.sp)) { }\n}', 'unit-mismatch'));
}

// 20 — assignment inside a condition
{
  check('if (x = true) → error', hasCode('fun f() {\n    var x = false\n    if (x = true) { }\n}', 'assign-in-condition'));
  check('if (x == true) — no error', !hasCode('fun f() {\n    val x = false\n    if (x == true) { }\n}', 'assign-in-condition'));
  check('when (val y = foo()) is legal — no error', !hasCode('fun f() {\n    when (val y = listOf(1)) { }\n}', 'assign-in-condition'));
  check('while (x = next()) → error', hasCode('fun f() {\n    var x = 1\n    while (x = 2) { }\n}', 'assign-in-condition'));
  check('named arg inside condition call — no error', !hasCode('fun f() {\n    if (foo(flag = true)) { }\n}', 'assign-in-condition'));
}

// 21 — effect lambdas are NOT composable scopes
{
  const eff = '@Composable\nfun S() {\n    LaunchedEffect(Unit) {\n        Text("hi")\n    }\n}';
  check('Text inside LaunchedEffect → compose-context warning', hasCode(eff, 'compose-context'), JSON.stringify(problemsOf(eff)));
  const eff2 = '@Composable\nfun S() {\n    DisposableEffect(Unit) {\n        onDispose { }\n    }\n}';
  check('DisposableEffect body — no compose warning', !hasCode(eff2, 'compose-context'), JSON.stringify(problemsOf(eff2)));
  const col = '@Composable\nfun S() {\n    Column {\n        Text("hi")\n    }\n}';
  check('Text inside Column — still no warning', !hasCode(col, 'compose-context'), JSON.stringify(problemsOf(col)));
  const onclick = '@Composable\nfun S() {\n    Button(onClick = { Text("hi") }) { }\n}';
  check('Text inside onClick lambda → compose-context warning', hasCode(onclick, 'compose-context'), JSON.stringify(problemsOf(onclick)));
  const content = '@Composable\nfun S() {\n    Scaffold(content = { Column { } }) { }\n}';
  check('content slot stays composable — no warning', !hasCode(content, 'compose-context'), JSON.stringify(problemsOf(content)));
}

// 22 — @Composable annotation target + naming
{
  check('@Composable val → error', hasCode('@Composable\nval content = { }', 'composable-target'));
  check('@Composable class → error', hasCode('@Composable\nclass Foo', 'composable-target'));
  check('@Composable fun — no error', !hasCode('@Composable\nfun Foo() { }', 'composable-target'));
  check('lowercase composable name → naming warning', hasCode('@Composable\nfun myScreen() { }', 'compose-naming'));
  check('PascalCase composable name — no warning', !hasCode('@Composable\nfun MyScreen() { }', 'compose-naming'));
  check('inner val of composable — no target error', !hasCode('@Composable\nfun F() {\n    val x = 5\n}', 'composable-target'), JSON.stringify(problemsOf('@Composable\nfun F() {\n    val x = 5\n}')));
}

// 23 — modifier parameter lints
{
  check('UI composable with params, no modifier → warning', hasCode('@Composable\nfun MyCard(text: String) {\n    Text(text)\n}', 'modifier-param'));
  check('modifier with default — no warning', !hasCode('@Composable\nfun MyCard(text: String, modifier: Modifier = Modifier) {\n    Text(text)\n}', 'modifier-param'));
  check('modifier without default → warning', hasCode('@Composable\nfun MyCard(text: String, modifier: Modifier) {\n    Text(text)\n}', 'modifier-param'));
  check('zero-param screen without modifier — no warning', !hasCode('@Composable\nfun MainScreen() {\n    Text("hi")\n}', 'modifier-param'));
  check('@Preview with UI calls — no modifier warning', !hasCode('@Preview\n@Composable\nfun MyCardPreview() {\n    Text("hi")\n}', 'modifier-param'));
  check('non-composable helper with UI-ish calls — no warning', !hasCode('fun builder(f: () -> Unit) { }', 'modifier-param'));
}

// 24 — state without remember
{
  check('mutableStateOf in composable without remember → warning', hasCode('@Composable\nfun S() {\n    val count = mutableStateOf(0)\n}', 'state-no-remember'));
  check('wrapped in remember — no warning', !hasCode('@Composable\nfun S() {\n    val count = remember { mutableStateOf(0) }\n}', 'state-no-remember'));
  check('by remember — no warning', !hasCode('@Composable\nfun S() {\n    var count by remember { mutableStateOf(0) }\n}', 'state-no-remember'));
  check('state in ViewModel class — no warning', !hasCode('class Vm : ViewModel() {\n    val count = mutableStateOf(0)\n}', 'state-no-remember'));
  check('state in plain function — no warning', !hasCode('fun f() {\n    val count = mutableStateOf(0)\n}', 'state-no-remember'));
}

// 25 — CompositionLocal & Toast
{
  check('LocalContext bare → warning', hasCode('fun f() {\n    toast(LocalContext)\n}', 'composition-local-use'));
  check('LocalContext.current — no warning', !hasCode('fun f() {\n    toast(LocalContext.current)\n}', 'composition-local-use'));
  check('LocalContext provides — no warning', !hasCode('@Composable\nfun S() {\n    CompositionLocalProvider(LocalContext provides ctx) { }\n}', 'composition-local-use'));
  check('own Local declaration — no warning', !hasCode('val LocalPrefs = compositionLocalOf { 0 }\nfun f() {\n    use(LocalPrefs)\n}', 'composition-local-use'));
  check('Toast.makeText without show → warning', hasCode('fun f(ctx: C) {\n    Toast.makeText(ctx, "hi", Toast.LENGTH_SHORT)\n}', 'toast-show'));
  check('Toast.makeText().show() — no warning', !hasCode('fun f(ctx: C) {\n    Toast.makeText(ctx, "hi", Toast.LENGTH_SHORT).show()\n}', 'toast-show'));
  check('Toast multiline .show() — no warning', !hasCode('fun f(ctx: C) {\n    Toast.makeText(ctx, "hi", Toast.LENGTH_SHORT)\n        .show()\n}', 'toast-show'));
}

console.log(`\n[test-analyzer] ${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
if (failed > 0) process.exit(1);
