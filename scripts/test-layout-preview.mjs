#!/usr/bin/env node
/**
 * Тесты ядра горячего предпросмотра (src/utils/layoutPreviewCore.js):
 * парсер Android XML, ресурсы, разрешение ссылок, рендер в HTML.
 *   node scripts/test-layout-preview.mjs
 */
import {
  parseXml, buildResources, resolveValue, parseDimension,
  renderNode, renderPreviewDocument, XmlParseError,
} from '../src/utils/layoutPreviewCore.js';

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('layoutPreviewCore: парсер XML');
{
  const node = parseXml(`<?xml version="1.0" encoding="utf-8"?>
<!-- комментарий -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">
    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Привет &amp; мир" />
    <Button android:layout_width="wrap_content" android:layout_height="wrap_content" android:text='Кнопка'/>
</LinearLayout>`);
  check('корень — LinearLayout', node?.tag === 'LinearLayout');
  check('двое детей', node?.children?.length === 2);
  check('атрибуты прочитаны', node?.attrs?.['android:orientation'] === 'vertical');
  check('сущности декодированы', node?.children?.[0]?.attrs?.['android:text'] === 'Привет & мир');
  check('самозакрывающийся тег', node?.children?.[1]?.tag === 'Button');
}

{
  let err = null;
  try { parseXml('<LinearLayout><TextView></LinearLayout>'); } catch (e) { err = e; }
  check('несовпадающие теги → ошибка', err instanceof XmlParseError);
  check('в ошибке есть номер строки', typeof err?.line === 'number' && err.line >= 1);
}

{
  let err = null;
  try { parseXml('<LinearLayout android:text="не закрыто>'); } catch (e) { err = e; }
  check('незакрытая кавычка → ошибка', err instanceof XmlParseError);
}

{
  const multi = parseXml('<TextView android:text="a" /><TextView android:text="b" />');
  check('несколько корней оборачиваются в LinearLayout', multi?.tag === 'LinearLayout' && multi?.syntheticRoot === true);
}

console.log('layoutPreviewCore: ресурсы');
{
  const res = buildResources({
    'strings.xml': '<resources><string name="app_name">Тест</string><string name="hello">Привет</string></resources>',
    'colors.xml': '<resources><color name="primary">#6750A4</color></resources>',
    'dimens.xml': '<resources><dimen name="pad">12dp</dimen></resources>',
    'broken.xml': 'это не xml <<<',
  });
  check('strings', res.strings.app_name === 'Тест');
  check('colors', res.colors.primary === '#6750A4');
  check('dimens', res.dimens.pad === '12dp');
  check('битый файл не роняет сборку', true);
  check('@string/', resolveValue('@string/hello', res) === 'Привет');
  check('@color/', resolveValue('@color/primary', res) === '#6750A4');
  check('@dimen/', resolveValue('@dimen/pad', res) === '12dp');
  check('@android:color/white', resolveValue('@android:color/white', res) === '#FFFFFF');
  check('литерал проходит как есть', resolveValue('#FF0000', res) === '#FF0000');
  check('неизвестная ссылка остаётся', resolveValue('@string/нет', res) === '@string/нет');
}

console.log('layoutPreviewCore: размеры');
{
  check('16dp → 16', parseDimension('16dp') === 16);
  check('match_parent → 100%', parseDimension('match_parent') === '100%');
  check('wrap_content → auto', parseDimension('wrap_content') === 'auto');
  check('пусто → auto', parseDimension('') === 'auto');
}

console.log('layoutPreviewCore: рендер HTML');
{
  const res = buildResources({
    'strings.xml': '<resources><string name="btn">Нажми</string><string name="title">Экран</string></resources>',
    'colors.xml': '<resources><color name="primary">#123456</color></resources>',
  });
  const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:padding="16dp" android:background="#FFFFFF">
    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="@string/title" android:textSize="22sp" android:textStyle="bold" />
    <Button android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="@string/btn" />
    <EditText android:layout_width="match_parent" android:layout_height="wrap_content" android:hint="Имя" />
    <CheckBox android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Флажок" android:checked="true" />
    <ProgressBar style="?android:attr/progressBarStyleHorizontal" android:layout_width="match_parent" android:layout_height="wrap_content" android:progress="60" />
    <ImageView android:layout_width="60dp" android:layout_height="60dp" />
</LinearLayout>`;
  const html = renderPreviewDocument(xml, res, { title: 'Тест', primary: '#123456' });
  check('заголовок из @string', html.includes('Экран'));
  check('кнопка из @string', html.includes('Нажми'));
  check('статус-бар с темой', html.includes('#123456'));
  check('рамка устройства', html.includes('class="device"'));
  check('EditText hint', html.includes('Имя'));
  check('CheckBox отмечен', html.includes('✓'));
  check('ProgressBar 60%', html.includes('width:60%'));
}

{
  const html = renderPreviewDocument('<LinearLayout><TextView', {}, {});
  check('ошибка парсинга показывается в превью', html.includes('Ошибка в макете'));
}

{
  const html = renderPreviewDocument('', {}, {});
  check('пустой макет — заглушка', html.includes('Макет пуст'));
}

{
  const html = renderPreviewDocument('<ScrollView android:layout_width="match_parent" android:layout_height="match_parent"><LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical"><TextView android:text="Внутри скролла" android:layout_width="wrap_content" android:layout_height="wrap_content"/></LinearLayout></ScrollView>', {}, {});
  check('ScrollView + вложенность', html.includes('Внутри скролла'));
}

console.log('');
console.log(`Итог: ${passed} ок, ${failed} ошибок`);
process.exit(failed ? 1 : 0);
