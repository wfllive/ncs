/**
 * layoutPreviewCore.js — ядро предпросмотра Android XML-макетов.
 *
 * Чистый модуль без зависимостей (работает и в React Native, и в Node —
 * на нём построены тесты scripts/test-layout-preview.mjs).
 *
 * Что делает:
 *   1. Разбирает Android layout-XML в дерево узлов (с номерами строк для ошибок).
 *   2. Собирает таблицу ресурсов из res/values/*.xml (strings/colors/dimens/styles).
 *   3. Рендерит макет в HTML-документ, визуально повторяющий Android:
 *      LinearLayout/ScrollView/FrameLayout/TextView/Button/EditText/ImageView/
 *      CheckBox/Switch/ProgressBar/Toolbar/CardView и др.
 *
 * Это источник «горячего» предпросмотра в IDE: при каждом сохранении файла
 * макет перечитывается и перерисовывается за миллисекунды — без эмулятора,
 * без сервера и без сборки. Финальная проверка — на устройстве через
 * кастомную сборку (build.sh).
 */

/* ------------------------------------------------------------------ parser */

export class XmlParseError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

/**
 * Разобрать XML в дерево: { tag, attrs, children, text, line }.
 * Поддерживает: декларацию <?xml?>, комментарии, самозакрывающиеся теги,
 * одинарные/двойные кавычки атрибутов, текст между тегами.
 */
export const parseXml = (xml) => {
  const src = String(xml || '');
  const root = { tag: '#root', attrs: {}, children: [], text: '', line: 0 };
  const stack = [root];
  let i = 0;
  let line = 1;
  const nl = (upTo) => {
    while (i < upTo) {
      if (src.charCodeAt(i) === 10) line += 1;
      i += 1;
    }
  };
  const fail = (msg) => { throw new XmlParseError(msg, line); };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const text = src.slice(i);
      if (text.trim()) stack[stack.length - 1].text += text;
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) stack[stack.length - 1].text += text;
      nl(lt);
    }

    // Комментарий
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) fail('Незакрытый комментарий <!--');
      nl(end + 3);
      continue;
    }
    // CDATA
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end < 0) fail('Незакрытый блок <![CDATA[');
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      nl(end + 3);
      continue;
    }
    // Декларация / processing instruction
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end < 0) fail('Незакрытая декларация <?');
      nl(end + 2);
      continue;
    }
    // DOCTYPE
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      if (end < 0) fail('Незакрытая декларация <!');
      nl(end + 1);
      continue;
    }
    // Закрывающий тег
    if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt + 2);
      if (end < 0) fail('Незакрытый тег </');
      const name = src.slice(lt + 2, end).trim();
      nl(end + 1);
      const top = stack[stack.length - 1];
      if (stack.length <= 1) fail(`Лишний закрывающий тег </${name}>`);
      if (top.tag !== name) fail(`Ожидался </${top.tag}>, найден </${name}>`);
      stack.pop();
      continue;
    }

    // Открывающий тег
    const tagLine = line;
    let j = lt + 1;
    const nameMatch = /^[A-Za-z_][\w:.-]*/.exec(src.slice(j));
    if (!nameMatch) fail('Ожидалось имя тега после «<»');
    const tag = nameMatch[0];
    j += tag.length;
    const attrs = {};
    // атрибуты
    for (;;) {
      // пропуск пробелов (с учётом переводов строк)
      while (j < src.length && /\s/.test(src[j])) { if (src[j] === '\n') line += 1; j += 1; }
      if (j >= src.length) fail(`Тег <${tag}> не закрыт`);
      if (src[j] === '/') {
        if (src[j + 1] !== '>') fail(`Ожидалось «>» после «/» в теге <${tag}>`);
        j += 2;
        const node = { tag, attrs, children: [], text: '', line: tagLine, selfClosing: true };
        stack[stack.length - 1].children.push(node);
        break;
      }
      if (src[j] === '>') {
        j += 1;
        const node = { tag, attrs, children: [], text: '', line: tagLine };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        break;
      }
      const am = /^[A-Za-z_][\w:.-]*/.exec(src.slice(j));
      if (!am) fail(`Некорректный атрибут в теге <${tag}>`);
      const aName = am[0];
      j += aName.length;
      while (j < src.length && /\s/.test(src[j])) { if (src[j] === '\n') line += 1; j += 1; }
      if (src[j] !== '=') fail(`Ожидалось «=”» после атрибута ${aName} в <${tag}>`);
      j += 1;
      while (j < src.length && /\s/.test(src[j])) { if (src[j] === '\n') line += 1; j += 1; }
      const q = src[j];
      if (q !== '"' && q !== "'") fail(`Значение атрибута ${aName} должно быть в кавычках`);
      const qEnd = src.indexOf(q, j + 1);
      if (qEnd < 0) fail(`Незакрытая кавычка атрибута ${aName} в <${tag}>`);
      attrs[aName] = decodeXmlEntities(src.slice(j + 1, qEnd));
      // счётчик строк внутри значения
      for (let k = j + 1; k < qEnd; k += 1) if (src[k] === '\n') line += 1;
      j = qEnd + 1;
    }
    nl(j);
  }

  if (stack.length > 1) fail(`Незакрытый тег <${stack[stack.length - 1].tag}>`);
  if (!root.children.length) return null;
  // tools:preview требует один корень; несколько корней оборачиваем
  if (root.children.length === 1) return root.children[0];
  return { tag: 'LinearLayout', attrs: { 'android:orientation': 'vertical', 'android:layout_width': 'match_parent', 'android:layout_height': 'wrap_content' }, children: root.children, text: '', line: 1, syntheticRoot: true };
};

export const decodeXmlEntities = (s) => String(s)
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

export const encodeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* --------------------------------------------------------------- resources */

/**
 * Собрать таблицу ресурсов из файлов res/values/*.xml.
 * @param {Record<string,string>} files — содержимое файлов (ключ — имя файла или путь).
 * @returns {{strings: Object, colors: Object, dimens: Object, styles: Object}}
 */
export const buildResources = (files = {}) => {
  const res = { strings: {}, colors: {}, dimens: {}, styles: {} };
  for (const content of Object.values(files)) {
    let doc;
    try { doc = parseXml(content); } catch (e) { continue; }
    if (!doc || doc.tag !== 'resources') continue;
    for (const node of doc.children) {
      const name = node.attrs?.name;
      if (!name) continue;
      const value = (node.text || '').trim();
      if (node.tag === 'string') res.strings[name] = decodeXmlEntities(value);
      else if (node.tag === 'color') res.colors[name] = value;
      else if (node.tag === 'dimen') res.dimens[name] = value;
      else if (node.tag === 'style') res.styles[name] = node.attrs || {};
    }
  }
  return res;
};

const ANDROID_COLORS = {
  white: '#FFFFFF', black: '#000000', transparent: 'transparent',
  darker_gray: '#AAAAAA', holo_blue_light: '#33B5E5', holo_green_light: '#99CC00',
  holo_red_light: '#FF4444', holo_orange_light: '#FFBB33', holo_purple: '#AA66CC',
};

/**
 * Разрешить значение вида "@string/…", "@color/…", "@dimen/…", "#RRGGBB",
 * "@android:color/…". Возвращает строку как есть, если ссылка не найдена.
 */
export const resolveValue = (value, resources = {}) => {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (v.startsWith('@string/')) return resources.strings?.[v.slice(8)] ?? v;
  if (v.startsWith('@color/')) return resources.colors?.[v.slice(7)] ?? v;
  if (v.startsWith('@dimen/')) return resources.dimens?.[v.slice(7)] ?? v;
  if (v.startsWith('@android:color/')) return ANDROID_COLORS[v.slice(15)] ?? '#CCCCCC';
  return v;
};

/* ------------------------------------------------------------- dimensions */

/** dp/sp/px → CSS px (1dp = 1px в превью). Возвращает число, '100%', 'auto' или 0. */
export const parseDimension = (value) => {
  const v = String(value == null ? '' : value).trim();
  if (!v || v === 'wrap_content') return 'auto';
  if (v === 'match_parent' || v === 'fill_parent') return '100%';
  const m = /^(-?\d+(?:\.\d+)?)(dp|sp|px|dip)?$/i.exec(v);
  if (m) return Number(m[1]);
  if (/^-?\d+(?:\.\d+)%$/.test(v)) return v;
  return 0;
};

const cssLen = (value) => {
  const d = parseDimension(value);
  if (typeof d === 'number') return `${d}px`;
  return d;
};

/* ------------------------------------------------------------------ render */

const FONT = "-apple-system, 'Roboto', 'Segoe UI', system-ui, sans-serif";

const shortTag = (tag) => String(tag || '').split('.').pop();

/** Стили по android:gravity / layout_gravity. */
const gravityStyles = (gravity, axis = 'both') => {
  const s = {};
  const g = String(gravity || '').toLowerCase();
  if (!g) return s;
  const parts = g.split('|').map(x => x.trim());
  let justify = null, align = null, textAlign = null;
  if (parts.includes('center')) { justify = 'center'; align = 'center'; textAlign = 'center'; }
  if (parts.includes('center_horizontal')) { justify = 'center'; textAlign = 'center'; }
  if (parts.includes('center_vertical')) align = 'center';
  if (parts.includes('end') || parts.includes('right')) { justify = 'flex-end'; textAlign = 'right'; }
  if (parts.includes('start') || parts.includes('left')) { justify = 'flex-start'; textAlign = 'left'; }
  if (parts.includes('top')) align = 'flex-start';
  if (parts.includes('bottom')) align = 'flex-end';
  if (axis === 'h' || axis === 'both') { if (justify) s.justifyContent = justify; }
  if (axis === 'v' || axis === 'both') { if (align) s.alignItems = align; }
  if (textAlign) s.textAlign = textAlign;
  return s;
};

/** Общие правила из android:*, применимые к любому виджету. */
const commonStyles = (attrs, resources) => {
  const s = { boxSizing: 'border-box' };
  const w = attrs['android:layout_width'];
  const h = attrs['android:layout_height'];
  s.width = w ? cssLen(w) : 'auto';
  s.minHeight = h ? cssLen(h) : 'auto';
  if (h && h !== 'wrap_content') s.height = cssLen(h);

  const bg = attrs['android:background'];
  if (bg) {
    const resolved = resolveValue(bg, resources);
    if (/^#[0-9a-fA-F]{3,8}$/.test(resolved) || resolved === 'transparent') s.background = resolved;
    else if (resolved.startsWith('@drawable/')) {
      s.background = '#E8EAED';
      s.border = '1px dashed #B0B7C0';
    }
  }
  for (const [attr, prop] of [
    ['android:padding', 'padding'],
    ['android:paddingHorizontal', null],
    ['android:paddingVertical', null],
    ['android:paddingLeft', 'paddingLeft'],
    ['android:paddingRight', 'paddingRight'],
    ['android:paddingTop', 'paddingTop'],
    ['android:paddingBottom', 'paddingBottom'],
    ['android:paddingStart', 'paddingLeft'],
    ['android:paddingEnd', 'paddingRight'],
  ]) {
    const v = attrs[attr];
    if (!v) continue;
    if (attr === 'android:paddingHorizontal') { s.paddingLeft = cssLen(v); s.paddingRight = cssLen(v); }
    else if (attr === 'android:paddingVertical') { s.paddingTop = cssLen(v); s.paddingBottom = cssLen(v); }
    else if (prop) s[prop] = cssLen(v);
  }
  if (attrs['android:layout_margin']) { s.margin = cssLen(attrs['android:layout_margin']); }
  if (attrs['android:layout_marginHorizontal']) { s.marginLeft = cssLen(attrs['android:layout_marginHorizontal']); s.marginRight = cssLen(attrs['android:layout_marginHorizontal']); }
  if (attrs['android:layout_marginVertical']) { s.marginTop = cssLen(attrs['android:layout_marginVertical']); s.marginBottom = cssLen(attrs['android:layout_marginVertical']); }
  if (attrs['android:layout_marginTop']) s.marginTop = cssLen(attrs['android:layout_marginTop']);
  if (attrs['android:layout_marginBottom']) s.marginBottom = cssLen(attrs['android:layout_marginBottom']);
  if (attrs['android:layout_marginLeft'] || attrs['android:layout_marginStart']) s.marginLeft = cssLen(attrs['android:layout_marginLeft'] || attrs['android:layout_marginStart']);
  if (attrs['android:layout_marginRight'] || attrs['android:layout_marginEnd']) s.marginRight = cssLen(attrs['android:layout_marginRight'] || attrs['android:layout_marginEnd']);

  if (attrs['android:elevation']) {
    const e = parseDimension(attrs['android:elevation']);
    if (typeof e === 'number' && e > 0) s.boxShadow = `0 ${Math.max(1, e / 2)}px ${e * 2}px rgba(0,0,0,${Math.min(0.35, 0.08 + e * 0.02)})`;
  }
  if (attrs['android:alpha']) s.opacity = String(attrs['android:alpha']);
  const vis = attrs['android:visibility'];
  if (vis === 'gone') s.display = 'none';
  else if (vis === 'invisible') s.visibility = 'hidden';
  return s;
};

/** android:layout_weight → flex-grow внутри LinearLayout. */
const weightStyle = (attrs) => {
  const w = attrs['android:layout_weight'];
  if (!w) return {};
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return {};
  return { flexGrow: n, flexBasis: '0', minWidth: 0, minHeight: 0 };
};

const textStyleOf = (attrs, resources) => {
  const s = {};
  const size = attrs['android:textSize'] || attrs['android:textSizeSp'];
  if (size) {
    const d = parseDimension(resolveValue(size, resources));
    if (typeof d === 'number') s.fontSize = `${d}px`;
  }
  const color = attrs['android:textColor'];
  if (color) {
    const resolved = resolveValue(color, resources);
    if (/^#[0-9a-fA-F]{3,8}$/.test(resolved)) s.color = resolved;
  }
  const style = String(attrs['android:textStyle'] || '');
  if (style.includes('bold')) s.fontWeight = '700';
  if (style.includes('italic')) s.fontStyle = 'italic';
  if (String(attrs['android:textAllCaps']) === 'true') s.textTransform = 'uppercase';
  if (attrs['android:letterSpacing']) s.letterSpacing = `${Number(attrs['android:letterSpacing']) * 10}px`;
  if (attrs['android:lineSpacingExtra']) s.lineHeight = `calc(1.35em + ${cssLen(attrs['android:lineSpacingExtra'])})`;
  if (attrs['android:maxLines'] === '1') { s.whiteSpace = 'nowrap'; s.overflow = 'hidden'; s.textOverflow = 'ellipsis'; }
  return s;
};

const displayText = (attrs, resources) => {
  const raw = attrs['tools:text'] || attrs['android:text'] || attrs['android:hint'] || '';
  return resolveValue(raw, resources);
};

/* ------------------------------------------------------- widget renderers */

/**
 * Отрендерить один узел макета в HTML.
 * @param node — узел из parseXml
 * @param resources — таблица из buildResources
 * @param theme — { primary, isDark }
 */
export const renderNode = (node, resources, theme = {}) => {
  if (!node) return '';
  const tag = shortTag(node.tag);
  const attrs = node.attrs || {};
  const children = () => (node.children || []).map(c => renderNode(c, resources, theme)).join('');
  const primary = theme.primary || '#6750A4';
  const wrap = (styleObj, inner, extraClass = '') => {
    const css = Object.entries(styleObj)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:${v}`)
      .join(';');
    return `<div class="w ${extraClass}" style="${css}">${inner}</div>`;
  };

  switch (tag) {
    case 'LinearLayout': {
      const vertical = String(attrs['android:orientation']).toLowerCase() !== 'horizontal';
      const s = {
        ...commonStyles(attrs, resources),
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        gap: attrs['android:dividerPadding'] ? undefined : '0px',
        ...gravityStyles(attrs['android:gravity'], 'both'),
      };
      // вес детей: распределяем по оси
      const childHtml = (node.children || []).map((c) => {
        const w = weightStyle(c.attrs || {});
        const inner = renderNode(c, resources, theme);
        if (!Object.keys(w).length) return inner;
        const css = Object.entries(w).map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:${v}`).join(';');
        return `<div style="display:flex;flex-direction:${vertical ? 'column' : 'row'};${css}">${inner}</div>`;
      }).join('');
      return wrap(s, childHtml, 'lin');
    }
    case 'FrameLayout':
    case 'merge': {
      const s = { ...commonStyles(attrs, resources), position: 'relative' };
      const kids = (node.children || []).map((c, idx) => {
        const inner = renderNode(c, resources, theme);
        return idx === 0 && (node.children || []).length === 1
          ? inner
          : `<div style="position:absolute;inset:0;display:flex">${inner}</div>`;
      }).join('');
      return wrap(s, kids, 'frame');
    }
    case 'ScrollView': {
      const s = { ...commonStyles(attrs, resources), overflowY: 'auto' };
      return wrap(s, children(), 'scroll');
    }
    case 'HorizontalScrollView': {
      const s = { ...commonStyles(attrs, resources), overflowX: 'auto', display: 'flex' };
      return wrap(s, children(), 'hscroll');
    }
    case 'TextView': {
      const s = { ...commonStyles(attrs, resources), ...textStyleOf(attrs, resources), ...gravityStyles(attrs['android:gravity'], 'h') };
      if (s.minHeight === 'auto') delete s.minHeight;
      const text = displayText(attrs, resources);
      const css = Object.entries(s).map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:${v}`).join(';');
      return `<div class="w text" style="${css}">${encodeHtml(text) || '&nbsp;'}</div>`;
    }
    case 'Button':
    case 'com.google.android.material.button.MaterialButton': {
      const customBg = attrs['android:background'];
      const text = displayText(attrs, resources) || 'Button';
      const base = {
        ...commonStyles(attrs, resources),
        ...textStyleOf(attrs, resources),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '20px',
        padding: attrs['android:padding'] ? undefined : '10px 24px',
        fontWeight: '600',
        letterSpacing: '0.4px',
      };
      if (!customBg) { base.background = primary; base.color = attrs['android:textColor'] ? base.color : '#FFFFFF'; }
      if (base.minHeight === 'auto') base.minHeight = '40px';
      return wrap(base, `<span>${encodeHtml(text)}</span>`, 'button');
    }
    case 'EditText':
    case 'TextInputEditText':
    case 'AutoCompleteTextView': {
      const hint = displayText(attrs, resources) || 'Текст';
      const s = {
        ...commonStyles(attrs, resources),
        display: 'flex',
        alignItems: 'center',
        border: `1px solid ${theme.isDark ? '#5A5E66' : '#79747E'}`,
        borderRadius: '4px',
        padding: '12px 12px',
        color: theme.isDark ? '#E6E1E5' : '#49454F',
        fontSize: '16px',
        background: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
      };
      return wrap(s, `<span style="opacity:0.55">${encodeHtml(hint)}</span>`, 'edit');
    }
    case 'ImageView':
    case 'ImageButton': {
      const s = {
        ...commonStyles(attrs, resources),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      };
      if (s.width === 'auto') s.width = '48px';
      if (s.minHeight === 'auto') s.minHeight = '48px';
      if (!s.background) { s.background = theme.isDark ? '#3A3F47' : '#DDE1E6'; }
      const src = attrs['android:src'] || attrs['app:srcCompat'] || '';
      const resolved = resolveValue(src, resources);
      let inner = '<svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" opacity="0.55"><path d="M3 5h18v14H3z" stroke="#80868B" stroke-width="1.6"/><circle cx="8.5" cy="9.5" r="1.8" fill="#80868B"/><path d="M4 17l5-5 3 3 4-4 4 4" stroke="#80868B" stroke-width="1.6"/></svg>';
      if (/^#[0-9a-fA-F]{3,8}$/.test(resolved)) inner = '';
      if (s.background === undefined && /^#[0-9a-fA-F]{3,8}$/.test(resolved)) s.background = resolved;
      return wrap(s, inner, 'image');
    }
    case 'CheckBox':
    case 'RadioButton': {
      const text = displayText(attrs, resources) || (tag === 'CheckBox' ? 'Флажок' : 'Радио');
      const checked = attrs['android:checked'] === 'true';
      const s = { ...commonStyles(attrs, resources), display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: theme.isDark ? '#E6E1E5' : '#1C1B1F' };
      const box = tag === 'RadioButton'
        ? `<span style="width:18px;height:18px;border-radius:50%;border:2px solid ${primary};display:inline-flex;align-items:center;justify-content:center">${checked ? `<span style="width:9px;height:9px;border-radius:50%;background:${primary}"></span>` : ''}</span>`
        : `<span style="width:18px;height:18px;border-radius:3px;border:2px solid ${checked ? primary : (theme.isDark ? '#8F9398' : '#79747E')};background:${checked ? primary : 'transparent'};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:12px;line-height:1">${checked ? '✓' : ''}</span>`;
      return wrap(s, `${box}<span>${encodeHtml(text)}</span>`, 'compound');
    }
    case 'Switch':
    case 'SwitchCompat':
    case 'SwitchMaterial': {
      const text = displayText(attrs, resources) || 'Переключатель';
      const checked = attrs['android:checked'] === 'true';
      const s = { ...commonStyles(attrs, resources), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '15px', color: theme.isDark ? '#E6E1E5' : '#1C1B1F' };
      const knob = checked
        ? `<span style="width:34px;height:20px;border-radius:20px;background:${primary};display:inline-flex;align-items:center;justify-content:flex-end;padding:0 2px"><span style="width:16px;height:16px;border-radius:50%;background:#fff"></span></span>`
        : `<span style="width:34px;height:20px;border-radius:20px;background:${theme.isDark ? '#55595F' : '#CAC4D0'};display:inline-flex;align-items:center;padding:0 2px"><span style="width:16px;height:16px;border-radius:50%;background:${theme.isDark ? '#93999F' : '#fff'};box-shadow:0 1px 2px rgba(0,0,0,.3)"></span></span>`;
      return wrap(s, `<span>${encodeHtml(text)}</span>${knob}`, 'compound');
    }
    case 'ProgressBar': {
      const indeterminate = !String(attrs['style'] || '').toLowerCase().includes('horizontal');
      const s = { ...commonStyles(attrs, resources) };
      if (indeterminate) {
        if (s.width === 'auto') s.width = '40px';
        if (s.minHeight === 'auto') s.minHeight = '40px';
        return wrap(s, `<span style="display:block;width:70%;height:70%;border-radius:50%;border:3px solid ${theme.isDark ? '#4A4E55' : '#E6E0E9'};border-top-color:${primary}"></span>`, 'progress');
      }
      const progress = Math.max(0, Math.min(100, Number(attrs['android:progress'] || attrs['tools:progress'] || 40)));
      if (s.minHeight === 'auto') s.minHeight = '6px';
      return wrap({ ...s, borderRadius: '999px', overflow: 'hidden', background: theme.isDark ? '#4A4E55' : '#E6E0E9' }, `<div style="width:${progress}%;height:100%;background:${primary}"></div>`, 'progress');
    }
    case 'View': {
      const s = { ...commonStyles(attrs, resources) };
      if (!s.background) s.background = theme.isDark ? '#4A4E55' : '#CAC4D0';
      if (s.minHeight === 'auto' && s.height === undefined) s.minHeight = '1px';
      return wrap(s, '', 'divider');
    }
    case 'Space': {
      const s = { ...commonStyles(attrs, resources) };
      return wrap(s, '', 'space');
    }
    case 'Toolbar': {
      const title = displayText(attrs, resources) || attrs['app:title'] || '';
      const s = {
        ...commonStyles(attrs, resources),
        display: 'flex',
        alignItems: 'center',
        minHeight: '56px',
        padding: '0 16px',
        fontSize: '18px',
        fontWeight: '600',
      };
      if (!s.background) s.background = theme.isDark ? '#1F1F1F' : '#F7F2FA';
      return wrap(s, `<span style="flex:1">${encodeHtml(title)}</span>`, 'toolbar');
    }
    case 'CardView':
    case 'MaterialCardView': {
      const radius = parseDimension(attrs['app:cardCornerRadius'] || '12dp');
      const s = {
        ...commonStyles(attrs, resources),
        borderRadius: typeof radius === 'number' ? `${radius}px` : '12px',
        overflow: 'hidden',
        background: attrs['app:cardBackgroundColor'] ? resolveValue(attrs['app:cardBackgroundColor'], resources) : (theme.isDark ? '#2B2B2E' : '#FFF8FA'),
      };
      if (!s.boxShadow) s.boxShadow = '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)';
      return wrap(s, children(), 'card');
    }
    case 'RecyclerView':
    case 'ListView':
    case 'GridView': {
      const s = { ...commonStyles(attrs, resources), border: '1px dashed #9AA0A6', borderRadius: '8px', color: '#80868B', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px' };
      if (s.minHeight === 'auto') s.minHeight = '80px';
      return wrap(s, `<span>⟳ ${tag} — список отрисовывается в рантайме</span>`, 'list');
    }
    case 'include': {
      const layout = attrs['layout'] || '';
      const s = { ...commonStyles(attrs, resources), border: '1px dashed #9AA0A6', borderRadius: '8px', color: '#80868B', fontSize: '12px', padding: '12px' };
      return wrap(s, `<span>&lt;include ${encodeHtml(layout)}&gt;</span>`, 'include');
    }
    case 'WebView':
    case 'VideoView':
    case 'MapView': {
      const s = { ...commonStyles(attrs, resources), background: theme.isDark ? '#33373D' : '#ECEFF1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#80868B', fontSize: '12px' };
      if (s.minHeight === 'auto') s.minHeight = '120px';
      return wrap(s, `<span>▣ ${tag}</span>`, 'media');
    }
    case 'fragment':
    case 'FragmentContainerView': {
      const name = attrs['android:name'] || attrs['class'] || 'фрагмент';
      const s = { ...commonStyles(attrs, resources), border: '1px dashed #9AA0A6', borderRadius: '8px', color: '#80868B', fontSize: '12px', padding: '12px' };
      if (s.minHeight === 'auto') s.minHeight = '60px';
      return wrap(s, `<span>⬒ ${encodeHtml(String(name).split('.').pop())}</span>`, 'fragment');
    }
    default: {
      // Неизвестный виджет: рендерим как контейнер с подписью, детей — внутрь.
      const s = { ...commonStyles(attrs, resources), border: '1px dashed #B0B7C0', borderRadius: '8px', padding: '8px' };
      const label = `<div style="font-size:10px;color:#9AA0A6;margin-bottom:4px">${encodeHtml(tag)}</div>`;
      if (s.minHeight === 'auto') s.minHeight = '32px';
      return wrap(s, label + (node.children?.length ? children() : ''), 'custom');
    }
  }
};

/* ----------------------------------------------------------- html document */

/**
 * Полный HTML-документ предпросмотра: рамка устройства + статус-бар + макет.
 * @param {string} layoutXml — содержимое файла макета (или уже разобранный узел).
 * @param {object} resources — buildResources(...)
 * @param {object} options — { title, widthDp, heightDp, primary, isDark, fileName, error }
 */
export const renderPreviewDocument = (layoutXml, resources = {}, options = {}) => {
  const {
    title = 'Предпросмотр',
    widthDp = 390,
    heightDp = 844,
    primary = '#6750A4',
    isDark = false,
    fileName = '',
  } = options;

  let body;
  let parseError = options.error || '';
  try {
    const node = typeof layoutXml === 'string' ? parseXml(layoutXml) : layoutXml;
    if (!node) {
      body = `<div class="empty">Макет пуст — добавьте виджеты в XML.</div>`;
    } else {
      body = renderNode(node, resources, { primary, isDark });
    }
  } catch (e) {
    parseError = e?.message || String(e);
    body = '';
  }

  const bg = isDark ? '#121212' : '#FCFCFC';
  const fg = isDark ? '#E6E1E5' : '#1C1B1F';
  const errBlock = parseError
    ? `<div class="errbox"><div class="errhead">✕ Ошибка в макете</div><pre>${encodeHtml(parseError)}</pre><div class="errhint">Исправьте файл и сохраните — превью обновится автоматически.</div></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; font-family: ${FONT}; }
  .device { width: ${widthDp}px; min-height: ${heightDp}px; background: ${bg}; color: ${fg}; display: flex; flex-direction: column; overflow: hidden; border-radius: 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
  .statusbar { height: 26px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; font-size: 10px; color: ${isDark ? '#B8BCC2' : '#5F6368'}; background: ${primary}; color: rgba(255,255,255,0.92); }
  .screen { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .screen > .w { flex-shrink: 0; }
  .w { flex-shrink: 0; }
  .empty { padding: 40px 20px; text-align: center; color: #9AA0A6; font-size: 13px; }
  .errbox { margin: 12px; border: 1px solid #F2B8B5; background: ${isDark ? '#3A2325' : '#FDECEA'}; border-radius: 10px; padding: 10px 12px; }
  .errhead { color: #C5221F; font-weight: 700; font-size: 12px; margin-bottom: 6px; }
  .errbox pre { margin: 0; white-space: pre-wrap; font-family: Menlo, Consolas, monospace; font-size: 11px; color: ${isDark ? '#F5B8B4' : '#8C1D18'}; }
  .errhint { margin-top: 6px; font-size: 11px; color: ${isDark ? '#C4C7C5' : '#5F6368'}; }
  .filename { padding: 4px 14px 6px; font-size: 10px; color: ${isDark ? '#8F9398' : '#9AA0A6'}; font-family: Menlo, Consolas, monospace; background: ${isDark ? '#1B1B1D' : '#F3F4F6'}; border-top: 1px solid ${isDark ? '#2E3033' : '#E5E7EB'}; }
</style>
</head>
<body>
<div class="device">
  <div class="statusbar"><span>12:30</span><span>${encodeHtml(title)}</span><span>▮▮▮ 100%</span></div>
  <div class="screen">${errBlock}${body}</div>
  ${fileName ? `<div class="filename">${encodeHtml(fileName)} · hot reload</div>` : ''}
</div>
</body>
</html>`;
};

export default {
  parseXml, buildResources, resolveValue, parseDimension,
  renderNode, renderPreviewDocument, XmlParseError,
};
