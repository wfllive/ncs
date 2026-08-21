/**
 * javaProject.ts — генератор проектов **Java + XML** (классический Android).
 *
 * Сборка — **Storm Build** (вендорен в `storm/` этого репозитория):
 * кастомный пайплайн без Gradle (aapt2 → javac/ecj → d8/R8 → zipalign →
 * apksigner), плюс AAB, Maven-зависимости и слияние манифестов.
 *
 *   my-app/
 *   ├── storm.m                 — манифест проекта для Storm
 *   ├── project.json            — метаданные конструктора
 *   ├── build.sh                — обёртка: вызывает `storm build …`
 *   ├── app/
 *   │   ├── AndroidManifest.xml
 *   │   ├── src/<пакет>/…       — исходники Java (код — источник истины)
 *   │   ├── res/layout/…        — XML-макеты экранов
 *   │   ├── res/values/…        — строки, цвета, темы
 *   │   └── proguard-rules.pro
 *   └── build/outputs/          — APK/AAB после сборки
 */
import { writeWorkspaceFile, shellQuote } from './workspace';
import { execute } from './shellExecutor';
import { getProjectDir, PROJECTS_ROOT } from '../config/runtime';
import { generateId } from './generateId';

/** Версия Storm, которую генератор закрепляет в storm.m (auto false — офлайн). */
export const STORM_VERSION = '2026.2.0';

const xmlEsc = (v = '') => String(v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* ------------------------------------------------------------- screen utils */

export const screenBaseName = (screen: any, index = 0) => {
  const raw = String(screen?.name || 'Screen').replace(/[^A-Za-z0-9_]/g, '') || 'Screen';
  return index === 0 ? 'Main' : raw;
};

export const activityClassName = (screen: any, index = 0) => `${screenBaseName(screen, index)}Activity`;

export const layoutFileName = (screen: any, index = 0) => {
  const base = screenBaseName(screen, index).replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'main';
  return `activity_${base}.xml`;
};

export const layoutResName = (screen: any, index = 0) =>
  layoutFileName(screen, index).replace(/\.xml$/, '');

/* ----------------------------------------------------- visual tree → XML */

const dimAttr = (value: any, fallback = 'wrap_content') => {
  if (value == null || value === '' || value === 'auto') return fallback;
  if (value === 'match_parent' || value === 'fill_parent' || value === '100%') return 'match_parent';
  if (value === 'wrap_content') return 'wrap_content';
  if (typeof value === 'number') return `${value}dp`;
  if (/^\d+$/.test(String(value))) return `${value}dp`;
  return String(value);
};

const colorAttr = (v: any) => (/^#[0-9A-Fa-f]{3,8}$/.test(String(v || '')) ? String(v) : '');

/**
 * Конвертировать узел визуального дерева в Android XML-разметку.
 * Используется только для ПЕРВОЙ генерации макета — дальше пользователь
 * правит XML руками (код является источником истины).
 */
export const treeNodeToXml = (node: any, depth = 1): string => {
  if (!node) return '';
  const pad = '    '.repeat(depth);
  const p = node.props || {};
  const children = (node.children || []) as any[];
  const attrs: string[] = [];
  let tag = 'View';
  let body = '';

  const open = (t: string, extra: string[] = []) => {
    tag = t;
    attrs.push(...extra);
  };
  const common = (wDefault = 'match_parent', hDefault = 'wrap_content') => {
    attrs.push(`android:layout_width="${dimAttr(p.width, wDefault)}"`);
    attrs.push(`android:layout_height="${dimAttr(p.height, hDefault)}"`);
    if (p.padding != null) attrs.push(`android:padding="${typeof p.padding === 'number' ? `${p.padding}dp` : p.padding}"`);
    const bg = colorAttr(p.backgroundColor);
    if (bg && bg.toLowerCase() !== '#f8fafc') attrs.push(`android:background="${bg}"`);
    if (p.alignItems === 'center' || p.justifyContent === 'center') attrs.push('android:gravity="center"');
    else if (p.justifyContent === 'flex-end') attrs.push('android:gravity="end"');
  };

  switch (node.type) {
    case 'Column':
    case 'LazyColumn': {
      open('LinearLayout', [`android:orientation="vertical"`]);
      common();
      if (p.gap) attrs.push(`android:dividerPadding="${p.gap}dp"`);
      body = children.map((c) => treeNodeToXml(c, depth + 1)).join('\n');
      if (node.type === 'LazyColumn') {
        return `${pad}<ScrollView\n${pad}    android:layout_width="${dimAttr(p.width, 'match_parent')}"\n${pad}    android:layout_height="${dimAttr(p.height, 'match_parent')}">\n${body}\n${pad}</ScrollView>`;
      }
      break;
    }
    case 'Row':
      open('LinearLayout', [`android:orientation="horizontal"`]);
      common();
      body = children.map((c) => treeNodeToXml(c, depth + 1)).join('\n');
      break;
    case 'Box':
      open('FrameLayout');
      common();
      body = children.map((c) => treeNodeToXml(c, depth + 1)).join('\n');
      break;
    case 'Card':
    case 'ElevatedCard':
      open('FrameLayout');
      common();
      attrs.push(`android:background="${colorAttr(p.backgroundColor) || '#FFFFFF'}"`);
      attrs.push(`android:elevation="${(p.shadow || 2) * 2}dp"`);
      body = children.map((c) => treeNodeToXml(c, depth + 1)).join('\n');
      break;
    case 'Text': {
      open('TextView');
      common('wrap_content');
      attrs.push(`android:text="${xmlEsc(p.text || 'Текст')}"`);
      if (p.fontSize) attrs.push(`android:textSize="${p.fontSize}sp"`);
      const color = colorAttr(p.color || p.textColor);
      if (color) attrs.push(`android:textColor="${color}"`);
      if (String(p.fontWeight) === '700' || p.textStyle === 'bold') attrs.push('android:textStyle="bold"');
      if (p.textAlign === 'center') attrs.push('android:gravity="center"');
      else if (p.textAlign === 'right' || p.textAlign === 'end') attrs.push('android:gravity="end"');
      break;
    }
    case 'Button':
    case 'OutlinedButton': {
      open('Button');
      common('wrap_content');
      attrs.push(`android:text="${xmlEsc(p.text || 'Кнопка')}"`);
      if (node.type === 'Button') {
        const bg = colorAttr(p.backgroundColor);
        if (bg) attrs.push(`android:backgroundTint="${bg}"`);
      } else {
        attrs.push('android:background="@android:color/transparent"');
        const c = colorAttr(p.color);
        if (c) attrs.push(`android:textColor="${c}"`);
      }
      break;
    }
    case 'OutlinedTextField':
      open('EditText');
      common();
      attrs.push(`android:hint="${xmlEsc(p.label || p.placeholder || 'Поле')}"`);
      if (p.value) attrs.push(`android:text="${xmlEsc(p.value)}"`);
      break;
    case 'Image': {
      open('ImageView');
      attrs.push(`android:layout_width="${dimAttr(p.width, '120dp')}"`);
      attrs.push(`android:layout_height="${dimAttr(p.height, '120dp')}"`);
      attrs.push('android:scaleType="centerCrop"');
      const bg = colorAttr(p.backgroundColor);
      if (bg) attrs.push(`android:background="${bg}"`);
      break;
    }
    case 'Checkbox':
      open('CheckBox');
      common('wrap_content');
      attrs.push(`android:text="${xmlEsc(p.text || 'Флажок')}"`);
      if (p.checked) attrs.push('android:checked="true"');
      break;
    case 'Switch':
      open('Switch');
      common();
      attrs.push(`android:text="${xmlEsc(p.text || 'Переключатель')}"`);
      if (p.checked) attrs.push('android:checked="true"');
      break;
    case 'LinearProgressIndicator':
      open('ProgressBar', ['style="?android:attr/progressBarStyleHorizontal"']);
      common();
      attrs.push(`android:progress="${Math.round(Math.max(0, Math.min(1, Number(p.progress) || 0)) * 100)}"`);
      break;
    case 'CircularProgressIndicator':
      open('ProgressBar');
      attrs.push(`android:layout_width="${dimAttr(p.width, '48dp')}"`);
      attrs.push(`android:layout_height="${dimAttr(p.height, '48dp')}"`);
      break;
    case 'HorizontalDivider':
      open('View');
      attrs.push(`android:layout_width="${dimAttr(p.width, 'match_parent')}"`);
      attrs.push(`android:layout_height="${p.height || 1}dp"`);
      attrs.push(`android:background="${colorAttr(p.color) || '#E5E7EB'}"`);
      break;
    case 'Spacer':
      open('Space');
      attrs.push('android:layout_width="match_parent"');
      attrs.push(`android:layout_height="${p.height || 16}dp"`);
      break;
    case 'Icon':
      open('TextView');
      common('wrap_content');
      attrs.push(`android:text="★"`);
      attrs.push(`android:textSize="${p.size || 24}sp"`);
      break;
    case 'TopAppBar':
      open('Toolbar');
      common('match_parent', '56dp');
      attrs.push(`android:title="${xmlEsc(p.title || 'MyApp')}"`);
      attrs.push(`android:background="${colorAttr(p.backgroundColor) || '#6750A4'}"`);
      attrs.push('android:titleTextColor="#FFFFFF"');
      break;
    case 'Scaffold': {
      const title = p.title || p.actionBarTitle || p.topBar?.props?.title || '';
      const bar = title
        ? `${pad}    <Toolbar\n${pad}        android:layout_width="match_parent"\n${pad}        android:layout_height="56dp"\n${pad}        android:title="${xmlEsc(title)}"\n${pad}        android:background="${colorAttr(p.topBar?.props?.backgroundColor || p.backgroundColor) || '#6750A4'}"\n${pad}        android:titleTextColor="#FFFFFF" />`
        : '';
      const inner = children.map((c) => treeNodeToXml(c, depth + 1)).join('\n');
      return `${pad}<LinearLayout\n${pad}    android:layout_width="match_parent"\n${pad}    android:layout_height="match_parent"\n${pad}    android:orientation="vertical"\n${pad}    android:background="${colorAttr(p.backgroundColor) || '#FCFCFC'}">\n${bar ? bar + '\n' : ''}${inner}\n${pad}</LinearLayout>`;
    }
    case 'WebView':
      open('TextView');
      common('match_parent', '120dp');
      attrs.push(`android:text="WebView: ${xmlEsc(p.url || '')}"`);
      attrs.push('android:gravity="center"');
      attrs.push('android:background="#ECEFF1"');
      break;
    default:
      open('FrameLayout');
      common();
      body = children.map((c) => treeNodeToXml(c, depth + 1)).join('\n');
  }

  const attrLines = attrs.map((a) => `${pad}    ${a}`).join('\n');
  if (body) return `${pad}<${tag}\n${attrLines}>\n${body}\n${pad}</${tag}>`;
  return `${pad}<${tag}\n${attrLines} />`;
};

/* ----------------------------------------------------- sources generation */

/** Сгенерировать XML-макет экрана (из сохранённого кода или из дерева). */
export const generateLayoutXml = (project: any, screen: any, index = 0) => {
  if (screen?.layoutXml) return screen.layoutXml;
  if (!screen?.rootComponent) {
    return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:padding="24dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="${xmlEsc(screen?.name || 'Экран')}"
        android:textSize="24sp"
        android:textStyle="bold" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:text="Отредактируйте этот макет — превью обновится автоматически." />

</LinearLayout>
`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
${treeNodeToXml(screen.rootComponent, 0)}
`;
};

/** Сгенерировать Activity на Java для экрана. */
export const generateActivityJava = (project: any, screen: any, index = 0) => {
  if (screen?.source) return screen.source;
  const pkg = project?.packageName || 'com.rnstudio.app';
  const cls = activityClassName(screen, index);
  const layout = layoutResName(screen, index);
  const screens = project?.screens || [];
  const others = screens.filter((_: any, i: number) => i !== index);
  const navComment = others.length
    ? `\n        // Переход на другой экран (пример):\n        // findViewById(R.id.my_button).setOnClickListener(v ->\n        //         startActivity(new android.content.Intent(this, ${activityClassName(others[0], screens.indexOf(others[0]))}.class)));`
    : '';
  return `package ${pkg};

import android.app.Activity;
import android.os.Bundle;

/**
 * Экран «${(screen?.name || 'Main').replace(/\*\//g, '')}».
 * Макет: app/res/layout/${layoutFileName(screen, index)}
 *
 * Это обычный Android без обязательных библиотек: доступны все классы
 * android.*. Код пишется прямо здесь и попадает в APK как есть.
 * Сборка — Storm Build (без Gradle): bash build.sh
 */
public class ${cls} extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.${layout});
${navComment}
    }
}
`;
};

/* ------------------------------------------------------- storm.m & build.sh */

/**
 * Манифест проекта для Storm. Важно: `auto false` — плагин не пытается
 * обновляться с GitHub (офлайн-режим на телефоне).
 */
export const generateStormConfig = (project: any) => {
  const slug = String(project?.slug || 'app').replace(/[^a-z0-9-]/g, '-') || 'app';
  const pkg = project?.packageName || 'com.rnstudio.app';
  const minSdk = project?.minSdk || 24;
  const targetSdk = project?.targetSdk || 34;
  const compileSdk = Math.max(project?.compileSdk || 34, targetSdk);
  return `# ─────────────────────────────────────────────────────────────
#  storm.m  ·  Storm Build project  (сгенерировано конструктором)
#  Документация: wfllive.github.io/Storm-Build
# ─────────────────────────────────────────────────────────────

plugin {
    storm      ${STORM_VERSION}
    source     https://github.com/wfllive/Storm-Engine-Studio
    auto       false
}

project {
    name       ${slug}
    package    ${pkg}
    version    ${project?.versionName || '1.0.0'}
    code       ${project?.versionCode || 1}
}

sdk {
    min        ${minSdk}
    target     ${targetSdk}
    compile    ${compileSdk}
}

app {
    src        app/src
    res        app/res
    assets     app/assets
    jni        app/jniLibs
    manifest   app/AndroidManifest.xml
    proguard   app/proguard-rules.pro
}

build {
    r8         false
}

repositories {
    https://repo1.maven.org/maven2/
    https://maven.google.com/
    https://maven.yandex.ru/repository/public/
}

dependencies {
    # example:
    # implementation  androidx.appcompat:appcompat:1.6.1
}

signing {
    debug {
        keystore   debug.keystore
        alias      androiddebugkey
        storepass  android
        keypass    android
    }
}
`;
};

/**
 * Обёртка сборки: вызывает Storm Build. Задачи:
 *   debug | release | aab | clean | keystore
 * DRY_RUN=1 — команды только печатаются (тесты без SDK).
 */
export const generateBuildScript = (project: any) => {
  const slug = String(project?.slug || 'app').replace(/[^a-z0-9-]/g, '-') || 'app';
  return `#!/usr/bin/env bash
# ============================================================
#  ${slug} — сборка через Storm Build (КАСТОМНЫЙ пайплайн без Gradle)
#  aapt2 → javac → d8/R8 → zipalign → apksigner (+ AAB)
#  Использование:  bash build.sh [debug|release|aab|clean|keystore]
# ============================================================
set -u
cd "$(dirname "$0")"
SLUG="${slug}"
START_TS=$(date +%s)

# Окружение: если есть старый SDK ($HOME/android-sdk) — Storm использует его,
# иначе берёт инструменты из ~/.storm/tools (их ставит «storm setup»).
# ANDROID_HOME задаём явно, чтобы не зависеть от профиля шелла в proot.
export ANDROID_HOME="\${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

c()   { printf '\\033[0;36m%s\\033[0m\\n' "$*"; }
ok()  { printf '\\033[0;32m%s\\033[0m\\n' "$*"; }
err() { printf '\\033[0;31m%s\\033[0m\\n' "$*"; }
run() {
  if [ "\${DRY_RUN:-0}" = "1" ]; then echo "[dry-run] $*"
  else "$@" || { err "✗ команда упала: $*"; exit 1; }; fi
}

VARIANT="\${1:-debug}"

if [ "\${DRY_RUN:-0}" != "1" ] && ! command -v storm >/dev/null 2>&1; then
  err "Storm Build не установлен."
  err "Установите среду в конструкторе (страница «Установка») — шаг «Storm Build»."
  exit 1
fi

c "==> Storm Build: задача '$VARIANT' (без Gradle)"
case "$VARIANT" in
  debug)
    run storm build apk --d8
    ;;
  release)
    if ! grep -q "release {" storm.m 2>/dev/null; then
      err "В storm.m нет блока signing release — создайте ключ: bash build.sh keystore"
      exit 1
    fi
    run storm build apk --release --r8
    ;;
  aab)
    if ! grep -q "release {" storm.m 2>/dev/null; then
      err "В storm.m нет блока signing release — создайте ключ: bash build.sh keystore"
      exit 1
    fi
    run storm build aab --release --r8
    ;;
  clean)
    run storm clean
    ok "Готово."
    exit 0
    ;;
  keystore)
    if [ -f release.keystore ]; then
      ok "release.keystore уже есть."
      exit 0
    fi
    run storm keygen --yes \\
      --keystore release.keystore \\
      --alias release \\
      --storepass androidrelease \\
      --keypass androidrelease \\
      --dname "CN=$SLUG,O=RNStudio,C=RU" \\
      --validity 10950
    ok "Ключ создан и прописан в storm.m (смените пароли перед публикацией!)"
    exit 0
    ;;
  *)
    err "Неизвестная задача: $VARIANT (используйте debug|release|aab|clean|keystore)"
    exit 1
    ;;
esac

# ---------- результат ----------
if [ "\${DRY_RUN:-0}" != "1" ]; then
  ARTIFACT="$(find build/outputs -name "*-$VARIANT.*" 2>/dev/null | head -1)"
  [ -s "$ARTIFACT" ] || { err "Артефакт не найден в build/outputs"; exit 1; }
  SIZE="$(du -h "$ARTIFACT" | cut -f1)"
  DEST="/sdcard/Download/NovaJava/$SLUG/apk"
  if mkdir -p "$DEST" 2>/dev/null; then
    cp -f "$ARTIFACT" "$DEST/$(basename "$ARTIFACT")" 2>/dev/null && c "   копия: $DEST/$(basename "$ARTIFACT")"
  fi
  ELAPSED=$(( $(date +%s) - START_TS ))
  ok "✅ $VARIANT: $ARTIFACT ($SIZE) за \${ELAPSED}s"
else
  ok "[dry-run] пайплайн проверен (storm $VARIANT)"
fi
`;
};

/* --------------------------------------------------------- manifest & res */

const generateManifest = (project: any) => {
  const pkg = project?.packageName || 'com.rnstudio.app';
  const screens = project?.screens || [];
  const activities = screens
    .map((s: any, i: number) => {
      const cls = activityClassName(s, i);
      if (i === 0) {
        return `        <activity
            android:name=".${cls}"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>`;
      }
      return `        <activity android:name=".${cls}" android:exported="false" />`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${pkg}"
    android:versionCode="${project?.versionCode || 1}"
    android:versionName="${project?.versionName || '1.0.0'}">

    <uses-sdk
        android:minSdkVersion="${project?.minSdk || 24}"
        android:targetSdkVersion="${project?.targetSdk || 34}" />

    <application
        android:allowBackup="true"
        android:icon="@drawable/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.App">
${activities}
    </application>
</manifest>
`;
};

/* --------------------------------------------------------------- files map */

export const createJavaProjectFiles = (project: any) => {
  const name = project?.name || 'Моё приложение';
  const pkg = project?.packageName || 'com.rnstudio.app';
  const pkgPath = pkg.split('.').join('/');
  const primary = /^#[0-9A-Fa-f]{6}$/.test(project?.theme?.primaryColor || '')
    ? project.theme.primaryColor
    : '#6750A4';
  const screens = project?.screens?.length ? project.screens : [];
  const glyph = 'M54,34 C56.5,46 62,51.5 74,54 C62,56.5 56.5,62 54,74 C51.5,62 46,56.5 34,54 C46,51.5 51.5,46 54,34 Z';

  const files: Record<string, string> = {};

  files['project.json'] = `${JSON.stringify(
    {
      name,
      slug: project?.slug || 'app',
      packageName: pkg,
      versionName: project?.versionName || '1.0.0',
      versionCode: project?.versionCode || 1,
      minSdk: project?.minSdk || 24,
      targetSdk: project?.targetSdk || 34,
      compileSdk: project?.compileSdk || 37,
      builder: 'storm',
      updatedAt: project?.updatedAt || Date.now(),
    },
    null,
    2,
  )}\n`;

  files['storm.m'] = generateStormConfig(project);
  files['build.sh'] = generateBuildScript(project);
  files['app/AndroidManifest.xml'] = generateManifest(project);
  files['app/proguard-rules.pro'] = `# Правила R8/ProGuard для release-сборки (Storm Build передаёт их в R8).
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote **
`;

  screens.forEach((s: any, i: number) => {
    files[`app/res/layout/${layoutFileName(s, i)}`] = generateLayoutXml(project, s, i);
    files[`app/src/${pkgPath}/${activityClassName(s, i)}.java`] = generateActivityJava(project, s, i);
  });

  files['app/res/values/strings.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${xmlEsc(name)}</string>
</resources>
`;

  files['app/res/values/colors.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="primary">${primary}</color>
    <color name="ic_launcher_background">${primary}</color>
</resources>
`;

  files['app/res/values/themes.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Классическая тема платформы (без библиотек). -->
    <style name="Theme.App" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:colorPrimary">@color/primary</item>
        <item name="android:statusBarColor">@color/primary</item>
        <item name="android:windowBackground">#FCFCFC</item>
    </style>
</resources>
`;

  files['app/res/drawable/ic_launcher_foreground.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:pathData="${glyph}" />
</vector>
`;

  files['app/res/drawable/ic_launcher.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="${primary}" android:pathData="M0,0h108v108h-108z" />
    <path android:fillColor="#FFFFFF" android:pathData="${glyph}" />
</vector>
`;

  files['app/res/drawable-anydpi-v26/ic_launcher.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;

  // Storm ожидает каталоги; пустые директории в git не живут — .gitkeep.
  files['app/assets/.gitkeep'] = '';
  files['app/jniLibs/.gitkeep'] = '';

  files['.gitignore'] = `build/
storm.lock
*.apk
*.aab
*.keystore
build.log
`;

  files['README.md'] = `# ${xmlEsc(name)}

Сгенерировано конструктором **NovaJava Studio** — проект на чистом **Java + XML**.
Сборка — **Storm Build** (кастомный пайплайн без Gradle:
aapt2 → javac → d8/R8 → zipalign → apksigner).

\`\`\`bash
bash build.sh            # debug APK (быстро)
bash build.sh release    # release APK (R8 + подпись; сначала ключ)
bash build.sh keystore   # создать release-ключ
bash build.sh aab        # AAB для Google Play / RuStore
bash build.sh clean      # очистка артефактов
\`\`\`

Структура:

\`\`\`
storm.m                   манифест проекта для Storm
app/AndroidManifest.xml   манифест приложения
app/src/${pkgPath}/…  исходники Java
app/res/layout/           XML-макеты экранов
app/res/values/           строки, цвета, темы
build/outputs/            готовые APK/AAB
\`\`\`

Зависимости (Maven): \`storm deps add <координата>\`, затем сборка.
Документация Storm: https://wfllive.github.io/Storm-Build/
`;

  return files;
};

/* ------------------------------------------------------------ write flows */

/** Записать ВСЕ файлы проекта (создание или полная перезапись шаблона). */
export const writeJavaProject = async (project: any) => {
  const entries = Object.entries(createJavaProjectFiles(project));
  for (const [rel, content] of entries) {
    const r = await writeWorkspaceFile(project, rel, content);
    if (!r?.success) return { success: false, output: `Failed to write ${rel}: ${r?.output}` };
  }
  await execute('chmod +x build.sh 2>/dev/null || true', getProjectDir(project));
  await writeWorkspaceFile(project, '.rnstudio/model.json', `${JSON.stringify(project, null, 2)}\n`);
  return { success: true, output: `Сгенерировано ${entries.length + 1} файлов Java + XML (Storm)` };
};

/**
 * Синхронизировать сохранённые исходники экранов на диск
 * (макеты и Activity — из сохранённого кода, без перегенерации).
 */
export const syncJavaProject = async (project: any) => {
  if (!project) return { success: false, output: 'No project' };
  const screens = project.screens || [];
  if (!screens.length) return { success: false, output: 'Проект пуст. Добавьте экран через +.' };
  const pkg = project.packageName || 'com.rnstudio.app';
  const pkgPath = pkg.split('.').join('/');
  const written: string[] = [];
  for (let i = 0; i < screens.length; i += 1) {
    const s = screens[i];
    const layoutRel = `app/res/layout/${layoutFileName(s, i)}`;
    const layoutSource = s.layoutXml || generateLayoutXml(project, s, i);
    const r1 = await writeWorkspaceFile(project, layoutRel, layoutSource);
    if (!r1?.success) return { success: false, output: `Failed to write ${layoutRel}: ${r1?.output}` };
    written.push(layoutRel);
    const javaRel = `app/src/${pkgPath}/${activityClassName(s, i)}.java`;
    const javaSource = s.source || generateActivityJava(project, s, i);
    const r2 = await writeWorkspaceFile(project, javaRel, javaSource);
    if (!r2?.success) return { success: false, output: `Failed to write ${javaRel}: ${r2?.output}` };
    written.push(javaRel);
  }
  // Служебные файлы — всегда свежие (версии, пакет, список активностей, сборщик).
  const files = createJavaProjectFiles(project);
  for (const rel of ['AndroidManifest.xml', 'app/AndroidManifest.xml', 'project.json', 'storm.m', 'build.sh', 'app/res/values/strings.xml', 'app/res/values/colors.xml', 'app/res/values/themes.xml']) {
    if (!files[rel]) continue;
    const r = await writeWorkspaceFile(project, rel, files[rel]);
    if (!r?.success) return { success: false, output: `Failed to write ${rel}: ${r?.output}` };
  }
  await execute('chmod +x build.sh 2>/dev/null || true', getProjectDir(project));
  await writeWorkspaceFile(project, '.rnstudio/model.json', `${JSON.stringify(project, null, 2)}\n`);
  return { success: true, output: `Синхронизировано ${written.length} файлов исходников` };
};

/**
 * Самолечение проекта: восстановить ОТСУТСТВУЮЩИЕ файлы шаблона,
 * не трогая существующие (код пользователя — источник истины).
 */
export const ensureJavaProjectIntegrity = async (project: any) => {
  if (!project) return { success: false, restored: [] };
  const files = createJavaProjectFiles(project);
  const paths = Object.keys(files);
  let probe;
  try {
    probe = await execute(
      paths.map((p) => `[ -e ${shellQuote(p)} ] || echo ${shellQuote(p)}`).join('; '),
      getProjectDir(project),
    );
  } catch (e: any) {
    return { success: false, restored: [], output: e?.message || String(e) };
  }
  const missing = String(probe?.output || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p && files[p] != null);
  const restored: string[] = [];
  for (const rel of missing) {
    const r = await writeWorkspaceFile(project, rel, files[rel]);
    if (r?.success) restored.push(rel);
  }
  if (restored.some((r) => r === 'build.sh')) {
    await execute('chmod +x build.sh 2>/dev/null || true', getProjectDir(project));
  }
  return { success: true, restored };
};

/** Обновить только сборщик (build.sh) до актуальной версии шаблона. */
export const refreshJavaScaffold = async (project: any) => {
  const script = generateBuildScript(project);
  const r = await writeWorkspaceFile(project, 'build.sh', script);
  if (!r?.success) return { success: false, output: `Failed to write build.sh: ${r?.output}` };
  await execute('chmod +x build.sh 2>/dev/null || true', getProjectDir(project));
  return { success: true, output: 'Сборщик обновлён (build.sh → Storm Build)' };
};

/**
 * Быстрое создание проекта на диске (вызывается из списка проектов).
 * Мгновенно: только запись файлов — без скачиваний и установки зависимостей.
 */
export const javaNew = async (name: string, packageName = '') => {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'java-app';
  const pkg = packageName || `com.rnstudio.${slug.replace(/-/g, '') || 'app'}`;
  const home = {
    id: generateId(),
    name: 'Main',
    fileName: 'activity_main.xml',
    rootComponent: {
      id: generateId(),
      type: 'Column',
      props: { width: 'match_parent', height: 'match_parent', padding: 24, gap: 12, backgroundColor: '#FCFCFC', alignItems: 'center', justifyContent: 'center' },
      children: [
        { id: generateId(), type: 'Text', props: { text: name, fontSize: 26, color: '#1C1B1F', fontWeight: '700', textAlign: 'center' }, children: [] },
        { id: generateId(), type: 'Text', props: { text: 'Java + XML · Storm Build', fontSize: 14, color: '#666E7B', textAlign: 'center' }, children: [] },
        { id: generateId(), type: 'Button', props: { text: 'Нажми меня', backgroundColor: '#6750A4', color: '#FFFFFF' }, children: [] },
      ],
    },
    blocks: [],
  };
  const project: any = {
    id: generateId(),
    platform: 'android-java-xml',
    name,
    slug,
    projectDir: `${PROJECTS_ROOT}/${slug}`,
    packageName: pkg,
    namespace: pkg,
    versionName: '1.0.0',
    versionCode: 1,
    minSdk: 24,
    targetSdk: 34,
    compileSdk: 37,
    theme: { primaryColor: '#6750A4', secondaryColor: '#0E7490', backgroundColor: '#FCFCFC', isDark: false },
    screens: [home],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await execute(`mkdir -p ${shellQuote(project.projectDir)}`, '/');
  const r = await writeJavaProject(project);
  if (!r?.success) return { success: false, output: r.output };
  return { success: true, output: `Java-проект создан: ${project.projectDir}`, project };
};

export default {
  createJavaProjectFiles,
  writeJavaProject,
  syncJavaProject,
  ensureJavaProjectIntegrity,
  refreshJavaScaffold,
  generateLayoutXml,
  generateActivityJava,
  generateBuildScript,
  generateStormConfig,
  treeNodeToXml,
  javaNew,
  activityClassName,
  layoutFileName,
  layoutResName,
  STORM_VERSION,
};
