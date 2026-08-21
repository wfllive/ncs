/**
 * Тесты генератора проектов Java + XML и кастомного сборщика (без Gradle).
 * Запускается через scripts/test-app.mjs (esbuild-бандл, стаб шелл-моста).
 */
import {
  createJavaProjectFiles, generateBuildScript, generateLayoutXml,
  generateActivityJava, generateStormConfig, treeNodeToXml,
  activityClassName, layoutFileName, STORM_VERSION,
} from '../../src/utils/javaProject';
import { parseXml } from '../../src/utils/layoutPreviewCore.js';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name} ${extra}`); }
};

const project: any = {
  id: 'test', name: 'Тестовое приложение', slug: 'test-app',
  packageName: 'com.example.testapp', versionName: '1.2.3', versionCode: 7,
  minSdk: 24, targetSdk: 34, compileSdk: 37,
  theme: { primaryColor: '#0066AA', isDark: false },
  screens: [
    {
      id: 's1', name: 'Main',
      rootComponent: {
        id: 'r', type: 'Column', props: { width: 'match_parent', height: 'match_parent', padding: 16 },
        children: [
          { id: 't1', type: 'Text', props: { text: 'Заголовок', fontSize: 22, fontWeight: '700' }, children: [] },
          { id: 'b1', type: 'Button', props: { text: 'Жми', backgroundColor: '#0066AA' }, children: [] },
        ],
      },
    },
    { id: 's2', name: 'About', rootComponent: null },
  ],
};

console.log('javaProject: файлы шаблона');
const files = createJavaProjectFiles(project);

check('project.json', Boolean(files['project.json']) && files['project.json'].includes('"packageName": "com.example.testapp"'));
check('AndroidManifest.xml', Boolean(files['app/AndroidManifest.xml']));
check('build.sh', Boolean(files['build.sh']));
check('MainActivity.java (app/src)', Boolean(files['app/src/com/example/testapp/MainActivity.java']));
check('AboutActivity.java (app/src)', Boolean(files['app/src/com/example/testapp/AboutActivity.java']));
check('activity_main.xml (app/res)', Boolean(files['app/res/layout/activity_main.xml']));
check('activity_about.xml (app/res)', Boolean(files['app/res/layout/activity_about.xml']));
check('strings.xml', files['app/res/values/strings.xml']?.includes('Тестовое приложение'));
check('themes.xml', files['app/res/values/themes.xml']?.includes('Theme.App'));
check('иконки', Boolean(files['app/res/drawable/ic_launcher.xml']) && Boolean(files['app/res/drawable-anydpi-v26/ic_launcher.xml']));

check('storm.m', Boolean(files['storm.m']));
check('proguard-rules', Boolean(files['app/proguard-rules.pro']));

console.log('javaProject: манифест');
{
  const manifest = parseXml(files['app/AndroidManifest.xml']);
  check('манифест парсится', manifest?.tag === 'manifest');
  check('package', manifest?.attrs?.package === 'com.example.testapp');
  check('versionCode из проекта', manifest?.attrs?.['android:versionCode'] === '7');
  const app = manifest?.children?.find((c: any) => c.tag === 'application');
  const acts = app?.children?.filter((c: any) => c.tag === 'activity') || [];
  check('две активности', acts.length === 2);
  check('launcher у первой', JSON.stringify(acts[0]).includes('android.intent.action.MAIN'));
}

console.log('javaProject: исходники');
{
  const main = files['app/src/com/example/testapp/MainActivity.java'];
  check('package совпадает', main.includes('package com.example.testapp;'));
  check('setContentView на макет', main.includes('setContentView(R.layout.activity_main)'));
  check('extends Activity (чистый Android)', main.includes('extends Activity'));
  const about = files['app/src/com/example/testapp/AboutActivity.java'];
  check('второй экран — свой макет', about.includes('R.layout.activity_about'));
  check('путь макета в комментарии', about.includes('app/res/layout/activity_about.xml'));
}

console.log('javaProject: макеты из дерева');
{
  const layout = files['app/res/layout/activity_main.xml'];
  const node = parseXml(layout);
  check('макет парсится', Boolean(node));
  check('корень LinearLayout', node?.tag === 'LinearLayout');
  check('вертикальная ориентация', node?.attrs?.['android:orientation'] === 'vertical');
  const xml = layout;
  check('TextView с текстом', xml.includes('android:text="Заголовок"'));
  check('textSize sp', xml.includes('android:textSize="22sp"'));
  check('bold', xml.includes('android:textStyle="bold"'));
  check('Button', xml.includes('<Button'));
  check('backgroundTint кнопки', xml.includes('android:backgroundTint="#0066AA"'));
  const empty = parseXml(files['app/res/layout/activity_about.xml']);
  check('пустой экран — валидный макет', Boolean(empty));
}

console.log('javaProject: build.sh → Storm Build');
{
  const sh = files['build.sh'];
  check('вызывает storm', sh.includes('storm build apk'));
  check('debug = D8', sh.includes('storm build apk --d8'));
  check('release = R8', sh.includes('storm build apk --release --r8'));
  check('aab поддерживается', sh.includes('storm build aab'));
  check('keystore через storm keygen', sh.includes('storm keygen --yes'));
  check('нет обращений к gradle/gradlew', !/gradlew/i.test(sh) && !/\.gradle\b/i.test(sh));
  check('export в Загрузки', sh.includes('/sdcard/Download/NovaJava'));
  check('DRY_RUN поддерживается', sh.includes('DRY_RUN'));
}

console.log('javaProject: storm.m');
{
  const m = generateStormConfig(project);
  check('plugin auto false (офлайн)', m.includes('auto       false'));
  check('версия Storm закреплена', m.includes(`storm      ${STORM_VERSION}`));
  check('package из проекта', m.includes('package    com.example.testapp'));
  check('пути блока app', m.includes('src        app/src') && m.includes('manifest   app/AndroidManifest.xml'));
  check('debug-подпись', m.includes('keystore   debug.keystore'));
}

console.log('javaProject: treeNodeToXml — прочие виджеты');
{
  const xml = treeNodeToXml({
    type: 'Row', props: { width: 'match_parent' },
    children: [
      { type: 'Checkbox', props: { text: 'Да', checked: true }, children: [] },
      { type: 'Switch', props: { text: 'Вкл' }, children: [] },
      { type: 'Image', props: { width: 48, height: 48 }, children: [] },
    ],
  });
  check('Row → горизонтальный LinearLayout', xml.includes('android:orientation="horizontal"'));
  check('CheckBox', xml.includes('<CheckBox'));
  check('Switch', xml.includes('<Switch'));
  check('ImageView с размерами', xml.includes('android:layout_width="48dp"'));
}

check('activityClassName', activityClassName({ name: 'Settings' }, 1) === 'SettingsActivity');
check('layoutFileName первый экран', layoutFileName({ name: 'Home' }, 0) === 'activity_main.xml');
check('layoutFileName остальные', layoutFileName({ name: 'Settings' }, 1) === 'activity_settings.xml');

console.log('');
console.log(`Итог: ${passed} ок, ${failed} ошибок`);
process.exit(failed ? 1 : 0);
