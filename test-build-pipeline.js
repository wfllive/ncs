#!/usr/bin/env node
/** Validate the React + Vite + Android WebView project pipeline. */
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

function load(file, mocks = {}) {
  const absolute = path.resolve(file);
  const code = babel.transformFileSync(absolute, { plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const instance = new Module(absolute, module);
  instance.filename = absolute;
  instance.paths = Module._nodeModulePaths(path.dirname(absolute));
  const originalRequire = instance.require.bind(instance);
  instance.require = (id) => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : originalRequire(id);
  instance._compile(code, absolute);
  return instance.exports;
}

const runtime = load('src/config/runtime.ts');
const compose = load('src/utils/composeProject.ts', {
  '../config/runtime': runtime,
  './workspace': { writeWorkspaceFile: async () => ({ success: true }) },
  './shellExecutor': { execute: async () => ({ success: true, output: '' }) },
});

const project = {
  id: 'pipeline-test', platform: 'android-react-webview', name: 'Pipeline Test', slug: 'pipeline-test',
  projectDir: '/root/projects/pipeline-test', packageName: 'com.test.pipeline', namespace: 'com.test.pipeline',
  versionName: '1.0.0', versionCode: 1,
  theme: { primaryColor: '#4F46E5', secondaryColor: '#0E7490', backgroundColor: '#F8FAFC', isDark: false },
  variables: [{ name: 'counter', type: 'number', value: 0 }],
  screens: [{
    id: 'main', name: 'Home', backgroundColor: '#F8FAFC',
    rootComponent: { id: 'root', type: 'Column', props: { padding: 16, gap: 8 }, children: [
      { id: 'title', type: 'Text', props: { text: 'React WebView', fontSize: 24, color: '#111827', fontWeight: '700' }, children: [] },
      { id: 'button', type: 'Button', props: { text: 'Run', backgroundColor: '#4F46E5' }, children: [] },
    ] },
  }],
};

const files = compose.createComposeProjectFiles(project);
const pkgPath = 'android/app/src/main/java/com/test/pipeline';
const required = [
  'package.json', 'vite.config.js', 'index.html', 'src/main.jsx', 'src/App.jsx',
  'src/index.css', 'src/screens/Home.jsx',
  'android/settings.gradle.kts', 'android/build.gradle.kts', 'android/gradle.properties',
  'android/app/build.gradle.kts', 'android/app/src/main/AndroidManifest.xml',
  `${pkgPath}/MainActivity.kt`,
  'build-android.sh', 'prepare.sh',
];
for (const name of required) {
  if (!files[name]) throw new Error(`Missing generated file: ${name}`);
}

const gradle = files['android/app/build.gradle.kts'];
const manifest = files['android/app/src/main/AndroidManifest.xml'];
const mainActivity = files[`${pkgPath}/MainActivity.kt`];
const viteConfig = files['vite.config.js'];
const indexHtml = files['index.html'];

const assertions = [
  // --- WebView preview fix: relative asset base ---
  [viteConfig.includes("base: './'"), "vite base: './' (иначе белый экран в WebView из file:///android_asset)"],
  [/<script[^>]+src="\/src\/main\.jsx"/.test(indexHtml), 'index.html entry /src/main.jsx (dev-сервер)'],

  // --- Package consistency (фикс краша на запуске APK) ---
  [gradle.includes('namespace = "com.test.pipeline"'), 'namespace = packageName'],
  [gradle.includes('applicationId = "com.test.pipeline"'), 'applicationId = packageName'],
  [/^package com\.test\.pipeline$/m.test(mainActivity), 'MainActivity package совпадает с namespace'],
  [mainActivity.includes('https://appassets.androidplatform.net/assets/index.html'), 'MainActivity использует безопасный WebViewAssetLoader URL'],
  [mainActivity.includes('WebViewAssetLoader.Builder()'), 'MainActivity настраивает WebViewAssetLoader'],
  // Старый баг: findViewById<WebView>(android.R.id.content) — никогда не находил WebView
  [!mainActivity.includes('findViewById<WebView>(android.R.id.content)'), 'обратный back-press без ошибочного findViewById(android.R.id.content)'],
  [mainActivity.includes('class MainActivity : ComponentActivity'), 'MainActivity хранит ссылку на WebView'],

  // --- arm64-only / Android 7–17 (API 24–37) ---
  [gradle.includes('abiFilters += "arm64-v8a"'), 'abiFilters arm64-v8a (как в rai)'],
  [gradle.includes('compileSdk = 37'), 'compileSdk 37'],
  [gradle.includes('minSdk = 24'), 'minSdk 24 (Android 7.0)'],
  [gradle.includes('targetSdk = 37'), 'targetSdk 37 (Android 17)'],
  [!files['android/app/src/main/res/drawable/ic_launcher.xml'].includes('<adaptive-icon'), 'API 24–25 launcher icon is an ordinary drawable'],
  [files['android/app/src/main/res/drawable-anydpi-v26/ic_launcher.xml'].includes('<adaptive-icon'), 'API 26+ launcher icon uses the qualified adaptive drawable'],
  [/android:name="\.MainActivity"/.test(manifest), 'манифест: .MainActivity (резидится относительно namespace)'],

  // --- React screen generation ---
  [files['src/screens/Home.jsx'].includes('export default function Home'), 'React-экран Home.jsx'],
  [files['src/App.jsx'].includes('export default function App'), 'App.jsx экспортирует App'],
  [viteConfig.includes("outDir: 'dist'"), 'vite outDir dist'],
];

for (const [condition, label] of assertions) if (!condition) throw new Error(`Failed assertion: ${label}`);

// no literal "undefined" leaked into any generated file
for (const [name, value] of Object.entries(files)) if (/\bundefined\b/.test(value)) throw new Error(`undefined emitted in ${name}`);

console.log(`PASS: generated ${Object.keys(files).length} React + Vite + WebView files`);
console.log('PASS: vite base:"./" (relative assets → WebView рендерится, не белый экран)');
console.log('PASS: MainActivity package + WebViewAssetLoader URL корректны');
console.log('PASS: arm64-v8a + Android API 24–37 + launcher resources + манифест корректны');