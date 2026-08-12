/**
 * React + Vite + Android WebView generator.
 * Полностью без Kotlin / Compose. Только JSX + React + WebView.
 * Visual tree (rootComponent) -> JSX files in src/screens/*.jsx
 * App.jsx handles navigation via simple useState router.
 */
import { writeWorkspaceFile, readWorkspaceFile, shellQuote } from './workspace';
import { execute } from './shellExecutor';
import { getScreensDir, getProjectDir } from '../config/runtime';

// Escape for JS string literals
const esc = (v = '') => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

// Convert prop value to CSS
const toCssValue = (v, fallback: string | number = '') => {
  if (v == null || v === '' ) return fallback;
  if (v === 'match_parent' || v === '100%') return '100%';
  if (v === 'wrap_content' || v === 'auto') return 'auto';
  if (typeof v === 'number') return `${v}px`;
  if (typeof v === 'string' && /^\d+$/.test(v)) return `${v}px`;
  return String(v);
};

// Map component tree -> JSX string (indented)
const componentToJSX = (node, depth = 2) => {
  if (!node) return '';
  const indent = '  '.repeat(depth);
  const p = node.props || {};
  const children = node.children || [];
  const hasChildren = children.length > 0;

  const styleEntries = [];
  // common layout
  if (p.width) styleEntries.push(`width: "${toCssValue(p.width, '100%')}"`);
  if (p.height && p.height !== 'auto') styleEntries.push(`height: "${toCssValue(p.height)}"`);
  if (p.padding != null) styleEntries.push(`padding: ${typeof p.padding === 'number' ? p.padding : `"${p.padding}"`}`);
  if (p.gap != null) styleEntries.push(`gap: ${typeof p.gap === 'number' ? p.gap : `"${p.gap}"`}`);
  if (p.backgroundColor && p.backgroundColor !== 'transparent') styleEntries.push(`backgroundColor: "${esc(p.backgroundColor)}"`);
  if (p.borderRadius != null) styleEntries.push(`borderRadius: ${p.borderRadius}`);
  if (p.shadow != null) styleEntries.push(`boxShadow: "0 ${p.shadow*2}px ${p.shadow*4}px rgba(0,0,0,0.12)"`);

  const styleStr = styleEntries.length ? ` style={{ ${styleEntries.join(', ')} }}` : '';

  switch (node.type) {
    case 'Column':
      return `${indent}<div style={{ display: "flex", flexDirection: "column", ${styleEntries.join(', ')} }}>\n${children.map(c=>componentToJSX(c, depth+1)).join('\n')}\n${indent}</div>`;
    case 'Row':
      return `${indent}<div style={{ display: "flex", flexDirection: "row", alignItems: "${p.alignItems||'center'}", justifyContent: "${p.justifyContent||'flex-start'}", flexWrap: "wrap", ${styleEntries.join(', ')} }}>\n${children.map(c=>componentToJSX(c, depth+1)).join('\n')}\n${indent}</div>`;
    case 'Box':
      return `${indent}<div style={{ display: "flex", ${styleEntries.join(', ')} }}>\n${children.map(c=>componentToJSX(c, depth+1)).join('\n')}\n${indent}</div>`;
    case 'LazyColumn':
      return `${indent}<div style={{ display: "flex", flexDirection: "column", overflowY: "auto", ${styleEntries.join(', ')} }}>\n${children.map(c=>componentToJSX(c, depth+1)).join('\n')}\n${indent}</div>`;
    case 'Scaffold': {
      const title = esc(p.title || p.actionBarTitle || '');
      const appBar = p.topBar ? componentToJSX(p.topBar, depth+1) : (title ? `${indent}  <header style={{ height: 56, backgroundColor: "${esc(p.backgroundColor||'#4F46E5')}", color: "#fff", display: "flex", alignItems: "center", padding: "0 16px", fontWeight: 700 }}>${title}</header>` : '');
      const inner = children.map(c=>componentToJSX(c, depth+1)).join('\n');
      return `${indent}<div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "${esc(p.backgroundColor||'#F8FAFC')}" }}>\n${appBar}\n${indent}  <div style={{ flex: 1, padding: 16 }}>\n${inner}\n${indent}  </div>\n${indent}</div>`;
    }
    case 'TopAppBar': {
      const title = esc(p.title || 'MyApp');
      return `${indent}<header style={{ height: 56, backgroundColor: "${esc(p.backgroundColor||'#4F46E5')}", color: "${esc(p.color||'#FFFFFF')}", display: "flex", alignItems: "center", padding: "0 16px", fontWeight: 700 }}>${title}</header>`;
    }
    case 'Card':
    case 'ElevatedCard':
      return `${indent}<div style={{ backgroundColor: "${esc(p.backgroundColor||'#FFFFFF')}", borderRadius: ${p.borderRadius||12}, padding: ${p.padding||16}, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", ${styleEntries.join(', ')} }}>\n${children.map(c=>componentToJSX(c, depth+1)).join('\n')}\n${indent}</div>`;
    case 'Text': {
      const text = esc(p.text || '');
      const fontSize = p.fontSize || 16;
      const color = esc(p.color || p.textColor || '#111827');
      const weight = p.fontWeight === '700' || p.textStyle === 'bold' ? '700' : p.fontWeight || '400';
      const align = p.textAlign === 'center' ? 'center' : p.textAlign === 'right' || p.textAlign === 'end' ? 'right' : 'left';
      return `${indent}<p style={{ fontSize: ${fontSize}, color: "${color}", fontWeight: "${weight}", textAlign: "${align}", margin: 0 }}>${text}</p>`;
    }
    case 'Button': {
      const text = esc(p.text || 'Кнопка');
      return `${indent}<button style={{ backgroundColor: "${esc(p.backgroundColor||'#4F46E5')}", color: "${esc(p.color||'#FFFFFF')}", border: "none", borderRadius: ${p.borderRadius||10}, padding: "${p.padding||12}px 16px", fontSize: ${p.fontSize||15}, fontWeight: 600, cursor: "pointer" }}>${text}</button>`;
    }
    case 'OutlinedButton': {
      const text = esc(p.text || 'Кнопка');
      return `${indent}<button style={{ backgroundColor: "transparent", color: "${esc(p.color||'#4F46E5')}", border: "1.5px solid ${esc(p.color||'#4F46E5')}", borderRadius: ${p.borderRadius||10}, padding: "${p.padding||12}px 16px", fontSize: ${p.fontSize||15}, fontWeight: 600 }}>${text}</button>`;
    }
    case 'OutlinedTextField': {
      const label = esc(p.label || p.placeholder || 'Поле');
      const value = esc(p.value || '');
      return `${indent}<div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>\n${indent}  <label style={{ fontSize: 12, color: "#64748B" }}>${label}</label>\n${indent}  <input placeholder="${label}" defaultValue="${value}" style={{ width: "100%", height: 44, borderRadius: 10, border: "1px solid #CBD5E1", padding: "0 12px", fontSize: ${p.fontSize||15} }} />\n${indent}</div>`;
    }
    case 'Image': {
      const src = esc(p.src || '');
      if (src) return `${indent}<img src="${src}" alt="${esc(p.alt||'image')}" style={{ width: ${toCssValue(p.width,120)}, height: ${toCssValue(p.height,120)}, borderRadius: ${p.borderRadius||8}, objectFit: "cover" }} />`;
      return `${indent}<div style={{ width: ${toCssValue(p.width,120)}, height: ${toCssValue(p.height,120)}, borderRadius: ${p.borderRadius||12}, backgroundColor: "${esc(p.backgroundColor||'#E5E7EB')}", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", fontSize: 12 }}>Image</div>`;
    }
    case 'Checkbox': {
      const checked = p.checked ? 'checked' : '';
      const text = esc(p.text || 'Флажок');
      return `${indent}<label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ${p.fontSize||15}, color: "${esc(p.color||'#111827')}" }}><input type="checkbox" ${checked} /> ${text}</label>`;
    }
    case 'Switch': {
      const checked = p.checked ? 'checked' : '';
      const text = esc(p.text || 'Переключатель');
      return `${indent}<label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><span>${text}</span><input type="checkbox" role="switch" ${checked} /></label>`;
    }
    case 'LinearProgressIndicator': {
      const prog = Math.max(0, Math.min(1, Number(p.progress)||0.5))*100;
      return `${indent}<div style={{ width: "100%", height: ${p.height||8}, backgroundColor: "${esc(p.trackColor||'#E5E7EB')}", borderRadius: 999, overflow: "hidden" }}><div style={{ width: "${prog}%", height: "100%", backgroundColor: "${esc(p.color||'#4F46E5')}" }} /></div>`;
    }
    case 'CircularProgressIndicator': {
      return `${indent}<div style={{ width: ${p.width||48}, height: ${p.height||48}, borderRadius: "50%", border: "4px solid ${esc(p.trackColor||'#E5E7EB')}", borderTopColor: "${esc(p.color||'#4F46E5')}", display: "inline-block" }} />`;
    }
    case 'HorizontalDivider':
      return `${indent}<hr style={{ width: "100%", height: ${p.height||1}, backgroundColor: "${esc(p.color||'#E5E7EB')}", border: "none", margin: "12px 0" }} />`;
    case 'Spacer':
      return `${indent}<div style={{ height: ${p.height||16}, width: "100%" }} />`;
    case 'Icon':
      return `${indent}<span style={{ fontSize: ${p.size||24}, color: "${esc(p.color||'#4F46E5')}" }}>★ ${esc(p.iconName||'star')}</span>`;
    case 'WebView':
      return `${indent}<iframe src="${esc(p.url||'https://example.com')}" style={{ width: "100%", height: ${p.height||300}, border: "1px solid #E2E8F0", borderRadius: 8 }} title="webview" />`;
    default: {
      if (hasChildren) return `${indent}<div${styleStr}>\n${children.map(c=>componentToJSX(c, depth+1)).join('\n')}\n${indent}</div>`;
      const text = esc(p.text || node.type);
      return `${indent}<div${styleStr}>${text}</div>`;
    }
  }
};

export const generateScreenJSX = (screen) => {
  const name = (screen.name || 'Screen').replace(/[^A-Za-z0-9_]/g, '');
  const safeName = /^[A-Za-z]/.test(name) ? name : `Screen${name}`;
  const tree = screen.rootComponent;
  const body = tree ? componentToJSX(tree, 2) : '  <div>Пустой экран</div>';
  return `import React from 'react';

export default function ${safeName}() {
  return (
${body}
  );
}
`;
};

// Update a single screen file from its tree
export const syncComposeProject = async (project, options = {}) => {
  if (!project) return { success: false, output: 'No project' };
  const screens = project.screens || [];
  if (!screens.length) {
    return { success: false, output: 'Проект пуст. Добавьте экран через +.' };
  }
  const results = [];
  for (const screen of screens) {
    const safeName = (screen.name || 'Screen').replace(/[^A-Za-z0-9_]/g, '') || 'Screen';
    const fileName = `src/screens/${safeName}.jsx`;
    // ВАЖНО: используем СОХРАНЁННЫЙ код пользователя (screen.source), а не
    // генерируем заново из дерева — иначе затираем правки пользователя старым
    // шаблоном, и в APK попадает не тот код.
    const source = screen.source || generateScreenJSX(screen);
    const r = await writeWorkspaceFile(project, fileName, source);
    if (!r?.success) return { success: false, output: `Failed to write ${fileName}: ${r?.output}` };
    results.push(fileName);
  }
  // Regenerate App.jsx router
  const appSource = generateAppJSX(project);
  const appRes = await writeWorkspaceFile(project, 'src/App.jsx', appSource);
  if (!appRes?.success) return { success: false, output: `Failed to write App.jsx: ${appRes.output}` };

  await writeWorkspaceFile(project, '.rnstudio/model.json', `${JSON.stringify(project, null, 2)}\n`);
  return { success: true, output: `Синхронизировано ${results.length} экранов → ${results.join(', ')}` };
};

const generateAppJSX = (project) => {
  const screens = project.screens || [];
  const imports = screens.map(s=>{
    const safe = (s.name||'Screen').replace(/[^A-Za-z0-9_]/g,'') || 'Screen';
    const compName = /^[A-Za-z]/.test(safe) ? safe : `Screen${safe}`;
    return `import ${compName} from './screens/${safe}.jsx';`;
  }).join('\n');
  const first = screens[0] ? (screens[0].name||'Screen').replace(/[^A-Za-z0-9_]/g,'') : 'Home';
  const firstComp = /^[A-Za-z]/.test(first) ? first : `Screen${first}`;
  if (!screens.length) {
    return `export default function App(){ return <div style={{padding: 24, fontFamily: 'system-ui'}}><h1>${esc(project.name||'React App')}</h1><p>Нет экранов. Добавьте экран в конструкторе.</p></div> }\n`;
  }
  if (screens.length === 1) {
    return `${imports}
import './App.css';

export default function App(){
  return <${firstComp} />;
}
`;
  }
  // Multi-screen: simple state router (no react-router dep, zero setup)
  return `${imports}
import { useState } from 'react';
import './App.css';

const screens = {
${screens.map(s=>{
  const safe=(s.name||'Screen').replace(/[^A-Za-z0-9_]/g,'')||'Screen';
  const comp=/^[A-Za-z]/.test(safe)?safe:`Screen${safe}`;
  return `  "${s.name}": ${comp},`;
}).join('\n')}
};

export default function App(){
  const [active, setActive] = useState("${screens[0].name}");
  const ActiveScreen = screens[active];
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <nav style={{ display: "flex", gap: 8, padding: 12, background: "#fff", borderBottom: "1px solid #E2E8F0", overflowX: "auto" }}>
        {Object.keys(screens).map(name => (
          <button key={name} onClick={()=>setActive(name)} style={{ padding: "8px 12px", borderRadius: 8, border: active===name?"1px solid #4F46E5":"1px solid #E2E8F0", background: active===name?"#4F46E5":"#fff", color: active===name?"#fff":"#334155", fontWeight: 600 }}>
            {name}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1 }}><ActiveScreen /></main>
    </div>
  );
}
`;
};

/**
 * Обновляет android-скелет УЖЕ СОЗДАННОГО проекта до текущего шаблона:
 * MainActivity (WebViewAssetLoader вместо file://), gradle-файлы (в т.ч. зависимость
 * androidx.webkit), манифест, иконки, prepare/build-скрипты. Это позволяет старым
 * проектам получать исправления шаблона автоматически при сборке, без пересоздания.
 * Пользовательский код (src/*, index.html, package.json) и подпись
 * (keystore.properties, *.keystore) НЕ затираются.
 */
export const refreshAndroidScaffold = async (project) => {
  const files = createComposeProjectFiles(project);
  const scaffold = Object.keys(files).filter(
    (p) => p.startsWith('android/') || ['prepare.sh', 'build-android.sh', 'build-release.sh'].includes(p)
  );
  const written = [];
  for (const rel of scaffold) {
    const r = await writeWorkspaceFile(project, rel, files[rel]);
    if (!r?.success) return { success: false, output: `Failed to write ${rel}: ${r?.output}` };
    written.push(rel);
  }
  return { success: true, output: `Android-шаблон обновлён (${written.length} файлов)` };
};

/**
 * Самолечение проекта: проверяет, все ли файлы шаблона на месте, и восстанавливает
 * ТОЛЬКО ОТСУТСТВУЮЩИЕ (существующие файлы пользователя никогда не перезаписываются).
 * Вызывается при открытии проекта, после создания и перед сборкой — защита от
 * «битых» проектов (прерванное создание, случайное удаление файла) и жалоб.
 */
export const ensureProjectIntegrity = async (project) => {
  if (!project) return { success: false, restored: [] };
  const files = createComposeProjectFiles(project);
  const paths = Object.keys(files);
  // Одним shell-вызовом получаем список отсутствующих файлов.
  let probe;
  try {
    probe = await execute(
      paths.map((p) => `[ -e ${shellQuote(p)} ] || echo ${shellQuote(p)}`).join('; '),
      getProjectDir(project)
    );
  } catch (e) {
    return { success: false, restored: [], output: e?.message || String(e) };
  }
  const missing = String(probe?.output || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p && files[p]);
  const restored = [];
  for (const rel of missing) {
    const r = await writeWorkspaceFile(project, rel, files[rel]);
    if (r?.success) restored.push(rel);
  }
  return { success: true, restored };
};

export const createComposeProjectFiles = (project) => {
  const safeSlug = String(project.slug || 'react-app').replace(/[^a-z0-9-]/g,'-');
  const appName = esc(project.name || 'React App');
  // Package must match namespace in app/build.gradle.kts AND the Kotlin `package`
  // AND the source directory, otherwise the APK crashes on launch with
  // ClassNotFoundException / ActivityNotFoundException for .MainActivity.
  const _rawPkg = (project.packageName || ('com.rnstudio.' + safeSlug.replace(/-/g, '')));
  const pkg = _rawPkg.split('.').map(seg => seg.replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean).join('.') || 'com.rnstudio.app';
  const pkgPath = pkg.split('.').join('/');
  // Цвет иконки по умолчанию — primary цвет темы проекта (валидный #RRGGBB).
  const iconBg = /^#[0-9A-Fa-f]{6}$/.test((project.theme && project.theme.primaryColor) || '')
    ? project.theme.primaryColor
    : '#4F46E5';
  // Нейтральный «блик» — один и тот же для векторной и адаптивной иконки.
  // Глиф внутри adaptive safe zone (центральный круг 66 dp из 108 dp).
  const iconGlyphPath = 'M54,34 C56.5,46 62,51.5 74,54 C62,56.5 56.5,62 54,74 C51.5,62 46,56.5 34,54 C46,51.5 51.5,46 54,34 Z';
  // Supported range: Android 7…17 (API 24–37). API 24–25 use the regular launcher
  // drawable; Android 8+ automatically selects the adaptive v26 icon resource.
  const minSdk = Math.max(24, parseInt(project.minSdk, 10) || 24);
  // Пользовательская PNG-иконка (опционально): абсолютный путь в общем хранилище.
  // Путь чистим от символов, опасных для shell-подстановки в prepare.sh.
  const iconPngPath = String(project.iconPngPath || '').trim().replace(/["'`\\$;|&<>]/g, '');
  const appSource = generateAppJSX(project);
  const files = {
    'package.json': JSON.stringify({
      name: safeSlug,
      private: true,
      version: project.versionName || '1.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', lint: 'oxlint' },
      dependencies: { react: '^19.2.8', 'react-dom': '^19.2.8' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.0', vite: '^5.4.0', oxlint: '^0.11.0' },
    }, null, 2) + '\n',
    'vite.config.js': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ base: './', plugins: [react()], server: { host: '0.0.0.0', port: 5173, strictPort: true }, build: { outDir: 'dist', emptyOutDir: true } });\n`,
    'index.html': `<!DOCTYPE html>\n<html lang="ru"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${appName}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`,
    'src/main.jsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nimport './index.css';\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n`,
    'src/App.jsx': appSource,
    'src/index.css': `*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:#F8FAFC;color:#111827} #root{min-height:100vh}\n`,
    'src/App.css': `/* App styles - override per screen as needed */\n`,
    // Full Android Gradle project for WebView (arm64-only, based on rai stable profile)
    'android/settings.gradle.kts': `pluginManagement {
    repositories {
        google { content { includeGroupByRegex("com\\\\.android.*"); includeGroupByRegex("com\\\\.google.*"); includeGroupByRegex("androidx.*") } }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "${safeSlug}"
include(":app")
`,
    'android/build.gradle.kts': `plugins {
    id("com.android.application") version "9.3.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
}
`,
    'android/gradle.properties': `# Gradle settings (arm64, rai modern profile: AGP 9.3.1 / Kotlin 2.4.10)
android.aapt2FromMavenOverride=
android.sync.suppressAgpWarnings=UNSUPPORTED_PROJECT_OPTION_USE
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
org.gradle.daemon=false
org.gradle.parallel=false
org.gradle.caching=true
org.gradle.configureondemand=false
org.gradle.vfs.watch=false
org.gradle.workers.max=2
kotlin.compiler.execution.strategy=in-process
kotlin.incremental=false
kotlin.daemon.jvmargs=-Xmx1536m
android.useAndroidX=true
android.nonTransitiveRClass=true
android.enableJetifier=false
android.suppressUnsupportedCompileSdk=37,38
android.native.buildOutput=quiet
`,
    'android/gradle/wrapper/gradle-wrapper.properties': `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip
networkTimeout=120000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,
    'android/local.properties': `sdk.dir=\${HOME}/android-sdk
`,
    // Quote SHA256 with Kotlin Char concat ('"' + value + '"').
    // JS template literals eat \", so the previous escape produced invalid
    // Kotlin (""$expectedSha256"") and Gradle failed with "Expecting ')'".
    'android/app/build.gradle.kts': `import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val propsFile = rootProject.file("keystore.properties")
val props = Properties()
if (propsFile.exists()) {
    propsFile.inputStream().use { props.load(it) }
}
val expectedSha256 = props.getProperty("expectedSha256", "")

android {
    namespace = "${pkg}"
    compileSdk = 37
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = "${pkg}"
        minSdk = ${minSdk}
        targetSdk = 37
        versionCode = ${project.versionCode || 1}
        versionName = "${project.versionName || "1.0.0"}"
        buildConfigField("String", "EXPECTED_SIGNATURE_SHA256", '"' + expectedSha256 + '"')
        // arm64-v8a only
        ndk { abiFilters.clear(); abiFilters += "arm64-v8a" }
    }
    signingConfigs {
        create("release") {
            if (propsFile.exists()) {
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
                enableV1Signing = true; enableV2Signing = true; enableV3Signing = true
            }
        }
    }
    buildTypes {
        debug { isMinifyEnabled = false; applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        release {
            signingConfig = if (propsFile.exists()) signingConfigs.getByName("release") else null
            isMinifyEnabled = true; isShrinkResources = true; isDebuggable = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
    buildFeatures { compose = true; buildConfig = true }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
        jniLibs { excludes += listOf("**/x86/**","**/x86_64/**","**/armeabi-v7a/**","**/armeabi/**") }
    }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.activity:activity-compose:1.12.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
}
`,
    'android/app/proguard-rules.pro': `# Keep WebView
-keep class androidx.webkit.** { *; }
-keep class android.webkit.** { *; }
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote **
`,
    'android/app/src/main/res/values/strings.xml': `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appName}</string></resources>
`,
    'android/app/src/main/res/values/themes.xml': `<resources><style name="Theme.App" parent="android:Theme.Material.Light.NoActionBar" /></resources>
`,
    // Иконка проекта: фон — primary цвет темы, глиф — нейтральный «блик» в adaptive safe zone.
    // Витрины магазинов требуют совпадения иконки в карточке и на устройстве — поэтому она есть всегда.
    'android/app/src/main/res/values/colors.xml': `<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">${iconBg}</color></resources>\n`,
    'android/app/src/main/res/drawable/ic_launcher_foreground.xml': `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:pathData="${iconGlyphPath}" />
</vector>
`,
    // Android 8+ (API 26+): адаптивная иконка.
    'android/app/src/main/res/drawable-anydpi-v26/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`,
    // Android 6–7 (API 24–25): полная векторная иконка (фон + глиф) вместо системного «робота».
    'android/app/src/main/res/drawable/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="${iconBg}" android:pathData="M0,0h108v108h-108z" />
    <path android:fillColor="#FFFFFF" android:pathData="${iconGlyphPath}" />
</vector>
`,
    // Android-оболочка: dist из assets раздаётся через WebViewAssetLoader
    // (https://appassets.androidplatform.net/assets/index.html) — без file:// и опасных флагов.
    'android/app/src/main/AndroidManifest.xml': `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET" /><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" /><application android:allowBackup="true" android:icon="@drawable/ic_launcher" android:label="${appName}" android:supportsRtl="true" android:theme="@style/Theme.App"><activity android:name=".MainActivity" android:exported="true" android:label="@string/app_name" android:theme="@style/Theme.App" android:configChanges="orientation|screenSize|keyboardHidden"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity></application></manifest>
`,
    [`android/app/src/main/java/${pkgPath}/MainActivity.kt`]: `package ${pkg}

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader

// Jetpack Compose + WebView: MainActivity на Compose (setContent/MaterialTheme/Surface),
// а WebView встроен в Compose через AndroidView. Vite-сборка (dist, скопирована в
// assets) раздаётся через WebViewAssetLoader с https-хоста appassets.androidplatform.net —
// так ES-модули (<script type="module">) и fetch работают корректно БЕЗ опасных
// file://-флагов, которые помечают статические проверки магазинов приложений.
private const val CONTENT_URL = "https://appassets.androidplatform.net/assets/index.html"

class MainActivity : ComponentActivity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    WebViewScreen()
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen() {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // file:// не используется: контент идёт с https-хоста appassets,
                // поэтому опасные флаги не нужны вовсе.
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mediaPlaybackRequiresUserGesture = false
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): WebResourceResponse? {
                        val uri = request?.url ?: return super.shouldInterceptRequest(view, request)
                        return assetLoader.shouldInterceptRequest(uri)
                            ?: super.shouldInterceptRequest(view, request)
                    }
                }
                webChromeClient = WebChromeClient()
                loadUrl(CONTENT_URL)
            }
        }
    )
}
`,
    'prepare.sh': `#!/usr/bin/env bash
# Подготовка: настоящий Gradle Wrapper в android/ + проверка SDK 37.
set -uo pipefail
PROJ="\${1:-$PWD}"; cd "$PROJ" || exit 1
echo "==> Gradle Wrapper (android/)"
mkdir -p android/gradle/wrapper
if [ ! -s android/gradlew ] || [ ! -s android/gradle/wrapper/gradle-wrapper.jar ]; then
  _f(){ local d="$1"; shift; local t u; t=$(mktemp)||return 1; for u in "$@"; do curl -fL --retry 3 --max-time 120 -o "$t" "$u" 2>/dev/null && [ -s "$t" ] && { mkdir -p "$(dirname "$d")"; mv -f "$t" "$d"; chmod 644 "$d" 2>/dev/null||true; return 0; }; done; rm -f "$t"; return 1; }
  _f android/gradle/wrapper/gradle-wrapper.jar "https://raw.githubusercontent.com/gradle/gradle/v9.6.1/gradle/wrapper/gradle-wrapper.jar" "https://github.com/gradle/gradle/raw/v9.6.1/gradle/wrapper/gradle-wrapper.jar" || echo "  gradle-wrapper.jar не скачался"
  _f android/gradlew "https://raw.githubusercontent.com/gradle/gradle/v9.6.1/gradlew" "https://github.com/gradle/gradle/raw/v9.6.1/gradlew" || echo "  gradlew не скачался"
  chmod +x android/gradlew 2>/dev/null || true
fi
[ -s android/gradlew ] && [ -s android/gradle/wrapper/gradle-wrapper.jar ] && echo "  Wrapper OK" || { echo "Wrapper отсутствует — проверьте сеть или: rai prepare android"; exit 1; }
echo "==> SDK 37"
SDK="\${ANDROID_HOME:-$HOME/android-sdk}"
[ -d "$SDK/build-tools/37.0.0" ] && echo "  build-tools 37.0.0 OK" || echo "  Нет build-tools 37.0.0 — SDK 37 обязателен: rai install sdk"
echo "sdk.dir=$SDK" > android/local.properties
echo "Готово: bash build-android.sh"
`,
    'build-release.sh': `#!/usr/bin/env bash
# Release APK (R8 + подпись). React в корне, Gradle в android/.
set -uo pipefail
PROJ="\${1:-$PWD}"; cd "$PROJ" || exit 1
[ -f android/settings.gradle.kts ] || { echo "Нет android/settings.gradle.kts"; exit 1; }
echo "==> npm install"; npm install
echo "==> vite build"; npm run build || { echo "vite build упал"; exit 1; }
echo "==> dist -> android/app/src/main/assets"
mkdir -p android/app/src/main/assets && rm -rf android/app/src/main/assets/* && cp -r dist/* android/app/src/main/assets/
[ -f android/app/src/main/assets/index.html ] || { echo "dist/index.html не найден"; exit 1; }
[ -f keystore.properties ] || echo "WARN: keystore.properties нет — APK будет неподписан (rai keystore create)"
if command -v rai >/dev/null 2>&1; then
  rai build "$PROJ/android" release
else
  echo "==> cd android && ./gradlew assembleRelease"
  ( cd android && ./gradlew assembleRelease --no-daemon --console=plain ) || exit 1
fi
APK=$(find android/app/build/outputs/apk/release -name "*.apk" 2>/dev/null | head -1)
if [ -n "$APK" ]; then
  echo "APK: $APK"
  # Единая папка артефактов: Загрузки → NovaCompose → <проект> → apk
  base="$(basename "$PROJ")-release.apk"
  DEST="/sdcard/Download/NovaCompose/$(basename "$PROJ")/apk"
  mkdir -p "$DEST" 2>/dev/null; cp -f "$APK" "$DEST/$base" 2>/dev/null && echo "   копия: $DEST/$base"
else
  echo "APK не найден"
fi
`,
    'build-android.sh': `#!/usr/bin/env bash
# Debug APK. React в корне, Gradle в android/. Эквивалент кнопки «Android APK → Debug».
set -uo pipefail
PROJ="\${1:-$PWD}"; cd "$PROJ" || exit 1
[ -f android/settings.gradle.kts ] || { echo "Нет android/settings.gradle.kts — структура нарушена"; exit 1; }
echo "==> [1/3] npm install"; npm install
echo "==> [2/3] vite build"; npm run build || { echo "vite build упал"; exit 1; }
echo "==> [3/3] dist -> android/app/src/main/assets"
mkdir -p android/app/src/main/assets && rm -rf android/app/src/main/assets/* && cp -r dist/* android/app/src/main/assets/
[ -f android/app/src/main/assets/index.html ] || { echo "dist/index.html не найден — vite build упал"; exit 1; }
echo "  OK WebView-активы в android/app/src/main/assets/"

# Настоящий Gradle Wrapper в android/ (как rai: только wrapper, без системного gradle)
mkdir -p android/gradle/wrapper
if [ ! -s android/gradlew ] || [ ! -s android/gradle/wrapper/gradle-wrapper.jar ]; then
  echo "==> Скачиваю Gradle Wrapper 9.6.1 в android/ ..."
  _f(){ local d="$1"; shift; local t u; t=$(mktemp)||return 1; for u in "$@"; do curl -fL --retry 3 --max-time 120 -o "$t" "$u" 2>/dev/null && [ -s "$t" ] && { mkdir -p "$(dirname "$d")"; mv -f "$t" "$d"; chmod 644 "$d" 2>/dev/null||true; return 0; }; done; rm -f "$t"; return 1; }
  _f android/gradle/wrapper/gradle-wrapper.jar "https://raw.githubusercontent.com/gradle/gradle/v9.6.1/gradle/wrapper/gradle-wrapper.jar" "https://github.com/gradle/gradle/raw/v9.6.1/gradle/wrapper/gradle-wrapper.jar" || true
  _f android/gradlew "https://raw.githubusercontent.com/gradle/gradle/v9.6.1/gradlew" "https://github.com/gradle/gradle/raw/v9.6.1/gradlew" || true
  chmod +x android/gradlew 2>/dev/null || true
fi

if command -v rai >/dev/null 2>&1; then
  echo "==> rai build $PROJ/android debug"
  rai build "$PROJ/android" debug
else
  if [ ! -s android/gradlew ] || [ ! -s android/gradle/wrapper/gradle-wrapper.jar ]; then
    echo "WARN: Gradle Wrapper не получен (нет сети?). APK не соберётся."
    echo "      Альтернатива: rai prepare android   или   rai build $PROJ/android debug"
    echo "WebView-активы уже готовы в android/app/src/main/assets/ — предпросмотр работает."
    exit 0
  fi
  # JDK + SDK как в rai build-debug
  SDK="\${ANDROID_HOME:-$HOME/android-sdk}"
  JAVA_HOME="\${JAVA_HOME:-}"
  if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
    JAVA_HOME=""
    for p in /usr/lib/jvm/java-17-openjdk-arm64 /usr/lib/jvm/java-17-openjdk* /usr/lib/jvm/java-17-*; do [ -x "$p/bin/javac" ] && { JAVA_HOME="$p"; break; } done
    [ -z "$JAVA_HOME" ] && command -v javac >/dev/null 2>&1 && JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
    [ -z "$JAVA_HOME" ] && for p in /usr/lib/jvm/*/; do [ -x "\${p}bin/javac" ] && { JAVA_HOME="\${p%/}"; break; }; done
  fi
  [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/javac" ] || { echo "FAIL: JDK не найден → rai install base"; exit 1; }
  export JAVA_HOME ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
  export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$PATH"
  export JAVA_TOOL_OPTIONS="-Djava.security.egd=file:/dev/./urandom \${JAVA_TOOL_OPTIONS:-}"
  export TMPDIR="\${TMPDIR:-$HOME/tmp}"; mkdir -p "$TMPDIR"
  BT="$(ls "$SDK/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1)"
  [ -n "$BT" ] || { echo "FAIL: Android SDK не установлен (нет build-tools) → rai install sdk"; exit 1; }
  [ -f "$SDK/build-tools/$BT/aapt2" ] && { grep -q aapt2FromMavenOverride android/gradle.properties 2>/dev/null || echo "android.aapt2FromMavenOverride=$SDK/build-tools/$BT/aapt2" >> android/gradle.properties; }
  [ -f android/local.properties ] || echo "sdk.dir=$SDK" > android/local.properties
  echo "==> cd android && ./gradlew assembleDebug  (build-tools $BT)"
  ( cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon --console=plain --warning-mode=none ) || { echo "FAIL: Gradle упал"; exit 1; }
fi

APK="$(find android/app/build/outputs/apk/debug -name '*.apk' 2>/dev/null | head -1)"
if [ -n "$APK" ]; then
  echo " APK: $APK  $(du -h "$APK" | cut -f1)"
  base="$(basename "$PROJ")-debug.apk"
  cp -f "$APK" "$PROJ/$base" 2>/dev/null && echo "   копия: $PROJ/$base"
  # Единая папка артефактов: Загрузки → NovaCompose → <проект> → apk
  DEST="/sdcard/Download/NovaCompose/$(basename "$PROJ")/apk"
  mkdir -p "$DEST" 2>/dev/null; cp -f "$APK" "$DEST/$base" 2>/dev/null && echo "   копия: $DEST/$base"
else
  echo "WARN: APK не найден"
fi
`,
    '.gitignore': `node_modules/\ndist/\nandroid/app/build/\nandroid/.gradle/\nandroid/app/src/main/assets/\nandroid/local.properties\n*.keystore\n*.jks\nkeystore.properties\n`,
    'README.md': `# ${appName}\n\nСгенерировано конструктором NovaCompose Studio (**React + Vite**).\n\nНативная Android-оболочка, локальный интерфейс на React.\n\n## Команды\n\n\`\`\`bash\nnpm install\nnpm run dev      # Vite dev server на http://localhost:5173\nnpm run build    # → dist/\nbash build-android.sh  # сборка + копирование в android assets\n\`\`\`\n## Android WebView\n\nWebView получает dist (скопированный в assets) через WebViewAssetLoader по адресу \`https://appassets.androidplatform.net/assets/index.html\` — ES-модули и fetch работают без опасных file://-флагов.\n`,
  };
  // also generate screen files on initial create
  (project.screens || []).forEach(s=>{
    const safe=(s.name||'Screen').replace(/[^A-Za-z0-9_]/g,'')||'Screen';
    files[`src/screens/${safe}.jsx`] = generateScreenJSX(s);
  });
  // ensure at least Home screen exists if project empty
  if (!project.screens || !project.screens.length) {
    files['src/screens/Home.jsx'] = `export default function Home(){ return <div style={{padding:24}}><h1>${appName}</h1><p>Добро пожаловать! Отредактируйте экран в конструкторе.</p></div> }\n`;
  }
  if (iconPngPath) {
    // Кастомная иконка: PNG копируется в ресурсы скриптом prepare.sh —
    // векторные заглушки не генерируем (иначе Duplicate resources при сборке).
    delete files['android/app/src/main/res/drawable/ic_launcher.xml'];
    delete files['android/app/src/main/res/drawable/ic_launcher_foreground.xml'];
    files['prepare.sh'] = files['prepare.sh'].replace(
      'echo "Готово: bash build-android.sh"',
      `echo "==> Иконка проекта (PNG)"
if [ -f "${iconPngPath}" ]; then
  mkdir -p android/app/src/main/res/drawable
  cp -f "${iconPngPath}" android/app/src/main/res/drawable/ic_launcher.png
  cp -f "${iconPngPath}" android/app/src/main/res/drawable/ic_launcher_foreground.png
  echo "  иконка: ${iconPngPath}"
else
  echo "  WARN: иконка ${iconPngPath} не найдена — скопируйте PNG и повторите prepare"
fi
echo "Готово: bash build-android.sh"`,
    );
  }
  return files;
};

export const writeScreenSource = async (project, screen, source) => {
  if (!project || !screen) return { success: false, output: 'No screen' };
  const safe = (screen.name || 'Screen').replace(/[^A-Za-z0-9_]/g,'') || 'Screen';
  const fileName = `src/screens/${safe}.jsx`;
  const r = await writeWorkspaceFile(project, fileName, source);
  if (!r?.success) return { success: false, output: `Failed to write ${fileName}: ${r?.output}` };
  await writeWorkspaceFile(project, '.rnstudio/model.json', `${JSON.stringify(project, null, 2)}\n`);
  return { success: true, output: fileName };
};

export const writeComposeProject = async (project) => {
  const entries = Object.entries(createComposeProjectFiles(project));
  const results = [];
  for (const [fileName, content] of entries) results.push(await writeWorkspaceFile(project, fileName, content));
  const failed = results.find((r) => !r?.success);
  if (failed) return failed;
  await writeWorkspaceFile(project, '.rnstudio/model.json', `${JSON.stringify(project, null, 2)}\n`);
  return { success: true, output: `Сгенерировано ${entries.length + 1} файлов React + Vite` };
};

// Compat stubs - old Kotlin API
export const buildScreenSource = () => null;
export const generateComposeScreen = (project, screen) => screen ? generateScreenJSX(screen) : '';
export const generateComposePreviewSource = (project, screen) => screen ? generateScreenJSX(screen) : '';
export const getComposeScreenClass = () => 'Screen';
export const getComposeRoute = () => 'home';
export const getBaseDependencies = () => [];
export const runBuildCommand = () => 'npm run build && bash build-android.sh';