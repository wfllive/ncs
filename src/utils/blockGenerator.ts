/**
 * Parser: Kotlin Compose source -> visual blocks (CodeAssist-style).
 *
 * Mirrors CodeAssist's block projection: the code is the source of truth and
 * blocks are a *projection* of it. Every block anchors to its source text via
 * `_range` (absolute `{start,end}` in the body, starting at the statement's
 * leading indent) and `_indent` (that leading whitespace). This lets the
 * surgical updater (blockPatcher.js) replace only the nodes the user changed
 * and leave every untouched byte of code verbatim.
 *
 * The parser is the exact inverse of `generateCodeFromBlocks` in blockToCode.js
 * for every shape the generator emits, and any unrecognized statement becomes
 * a `custom_code` block, so nothing is ever lost.
 */
import { generateId } from './generateId';

const CATEGORY = {
  remember_int_state: 'STATE', remember_string_state: 'STATE',
  remember_boolean_state: 'STATE', remember_list_state: 'STATE',
  remember_map_state: 'STATE', update_state: 'STATE', derived_state_of: 'STATE',
  column: 'LAYOUT', row: 'LAYOUT', box: 'LAYOUT', surface: 'LAYOUT',
  scaffold: 'LAYOUT', scaffold_with_bottombar: 'LAYOUT',
  elevated_card: 'LAYOUT', outlined_card: 'LAYOUT',
  lazy_column: 'LAYOUT', lazy_row: 'LAYOUT',
  text: 'UI', text_with_variable: 'UI', text_html: 'UI',
  button: 'UI', outlined_button: 'UI', text_button: 'UI',
  icon_button: 'UI', extended_fab: 'UI', outlined_textfield: 'UI',
  checkbox: 'UI', switch: 'UI', slider: 'UI',
  linear_progress: 'UI', circular_progress: 'UI', divider: 'UI',
  spacer: 'UI', info_row: 'UI',
  if_else: 'CONTROL', repeat_times: 'CONTROL', while_loop: 'CONTROL',
  when_expression: 'CONTROL', try_catch: 'CONTROL',
  launched_effect: 'CONTROL', disposable_effect: 'CONTROL',
  side_effect: 'CONTROL', produce_state: 'CONTROL',
  on_click_increment: 'EVENT', on_click_decrement: 'EVENT',
  on_click_set_value: 'EVENT', on_click_toggle: 'EVENT',
  on_click_add_to_list: 'EVENT', on_click_remove_from_list: 'EVENT',
  on_click_clear_list: 'EVENT', on_click_show_snackbar: 'EVENT',
  on_click_launch_url: 'EVENT', on_click_share: 'EVENT',
  list_item: 'LIST', list_size: 'LIST', list_is_empty: 'LIST',
  modifier_padding: 'MODIFIER', modifier_padding_all: 'MODIFIER',
  modifier_fill_max_size: 'MODIFIER', modifier_fill_max_width: 'MODIFIER',
  modifier_fill_max_height: 'MODIFIER', modifier_size: 'MODIFIER',
  modifier_width: 'MODIFIER', modifier_height: 'MODIFIER',
  modifier_background: 'MODIFIER', modifier_clickable: 'MODIFIER',
  modifier_vertical_scroll: 'MODIFIER', modifier_horizontal_scroll: 'MODIFIER',
  modifier_border: 'MODIFIER', modifier_shadow: 'MODIFIER',
  modifier_clip: 'MODIFIER', modifier_alpha: 'MODIFIER',
  modifier_rotate: 'MODIFIER', modifier_scale: 'MODIFIER',
  modifier_offset: 'MODIFIER',
  animate_color_as_state: 'ANIMATION', animate_dp_as_state: 'ANIMATION',
  animate_float_as_state: 'ANIMATION',
  custom_code: '',
};

const mk = (definitionId, inputs, children = {}, meta = null) => ({
  id: generateId(),
  definitionId,
  category: CATEGORY[definitionId] || '',
  inputs: inputs || {},
  children,
  ...(meta ? { _range: meta.range, _indent: meta.indent } : {}),
});

/**
 * Split a body into top-level statements. Each statement is
 *   { text, start, end, ls, indent }
 * where [start,end) is the trimmed content span, [ls] is the line start
 * (including leading whitespace) and [indent] is that leading whitespace.
 * [start] and [end] are absolute offsets within `body`.
 */
const splitStatements = (body) => {
  const spans = [];
  let contentStart = null;
  let lineStart = 0;
  let paren = 0, brace = 0, bracket = 0, inString = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const prev = i > 0 ? body[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '(') { paren++; continue; }
    if (ch === ')') { paren--; continue; }
    if (ch === '{') { brace++; continue; }
    if (ch === '}') { brace--; continue; }
    if (ch === '[') { bracket++; continue; }
    if (ch === ']') { bracket--; continue; }
    if (ch === '\n') {
      if (paren === 0 && brace === 0 && bracket === 0 && contentStart != null) {
        spans.push({ start: contentStart, end: i });
        contentStart = null;
      }
      lineStart = i + 1;
      continue;
    }
    if (contentStart == null && !/\s/.test(ch)) contentStart = i;
  }
  if (contentStart != null) spans.push({ start: contentStart, end: body.length });

  return spans.map((s) => {
    const text = body.slice(s.start, s.end).replace(/\s+$/, '');
    const end = s.start + text.length;
    let ls = s.start;
    while (ls > 0 && body[ls - 1] !== '\n') ls--;
    return { text, start: s.start, end, ls, indent: body.slice(ls, s.start) };
  });
};

/** Find the index of the first top-level `{` (not inside parens/brackets/strings). */
const findTopBrace = (st) => {
  let paren = 0, bracket = 0, inString = null;
  for (let i = 0; i < st.length; i++) {
    const ch = st[i];
    const prev = i > 0 ? st[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '(') { paren++; continue; }
    if (ch === ')') { paren--; continue; }
    if (ch === '[') { bracket++; continue; }
    if (ch === ']') { bracket--; continue; }
    if (ch === '{' && paren === 0 && bracket === 0) return i;
  }
  return -1;
};

/** Return index of the `}` matching the `{` at openIndex. */
const matchBrace = (st, openIndex) => {
  let depth = 0, inString = null;
  for (let i = openIndex; i < st.length; i++) {
    const ch = st[i];
    const prev = i > 0 ? st[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Given a container statement, return { head, body, bodyBase } of its trailing
 * lambda. `head` is the text before the first top-level `{`, `body` is the text
 * inside the braces, and `bodyBase` is the absolute offset of `body` within the
 * full source so child ranges stay correct.
 */
const extractTrailingLambda = (st, base) => {
  const open = findTopBrace(st);
  if (open < 0) return null;
  const close = matchBrace(st, open);
  if (close < 0) return null;
  return { head: st.slice(0, open).trim(), body: st.slice(open + 1, close), bodyBase: base + open + 1 };
};

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

const parseIfElse = (st, base) => {
  const m = st.match(/^if\s*\(\s*([\s\S]*?)\s*\)\s*\{\s*([\s\S]*?)\s*\}\s*(?:else\s*\{\s*([\s\S]*?)\s*\}\s*)?$/);
  if (!m) return null;
  const children = { then: parseLevel(m[2], base) };
  if (m[3] != null) children.else = parseLevel(m[3], base);
  return mk('if_else', { Condition: m[1].trim() }, children);
};

const parseTryCatch = (st, base) => {
  const m = st.match(/^try\s*\{\s*([\s\S]*?)\s*\}\s*catch\s*\(\s*([^)]*)\s*\)\s*\{\s*([\s\S]*?)\s*\}\s*$/);
  if (!m) return null;
  return mk('try_catch', {}, {
    try: parseLevel(m[1], base),
    catch: parseLevel(m[3], base),
  });
};

const parseLazy = (st, isRow, base) => {
  const re = isRow
    ? /^LazyRow\(\s*modifier\s*=\s*[^)]*\)\s*\{\s*items\(\s*([\s\S]*?)\s*\)\s*\{\s*item\s*->\s*([\s\S]*?)\s*\}\s*\}$/
    : /^LazyColumn\(\s*modifier\s*=\s*[\s\S]*?\)\s*\{\s*items\(\s*([\s\S]*?)\s*\)\s*\{\s*item\s*->\s*([\s\S]*?)\s*\}\s*\}$/;
  const m = st.match(re);
  if (!m) return null;
  return mk(isRow ? 'lazy_row' : 'lazy_column', { 'List Variable': m[1].trim() }, {
    content: parseLevel(m[2], base),
  });
};

const parseDisposable = (st, base) => {
  const m = st.match(/^DisposableEffect\(\s*([\s\S]*?)\s*\)\s*\{\s*([\s\S]*?)\s*onDispose\s*\{\s*([\s\S]*?)\s*\}\s*\}$/);
  if (!m) return null;
  return mk('disposable_effect', { Key: m[1].trim() }, {
    do: parseLevel(m[2], base),
    onDispose: parseLevel(m[3], base),
  });
};

const parseProduceState = (st, base) => {
  const m = st.match(/^val\s+(\w+)\s+by\s+produceState<([^>]*)>\(\s*initialValue\s*=\s*([\s\S]*?)\s*\)\s*\{\s*([\s\S]*?)\s*\}$/);
  if (!m) return null;
  return mk('produce_state', {
    'Variable Name': m[1],
    'Type': m[2],
    'Initial Value': m[3].trim(),
  }, { do: parseLevel(m[4], base) });
};

const parseWhen = (st, base) => {
  const m = st.match(/^when\s*\(\s*([\s\S]*?)\s*\)\s*\{\s*([\s\S]*?)\s*\}$/);
  if (!m) return null;
  return mk('when_expression', { 'Value to Check': m[1].trim() }, {
    branches: parseLevel(m[2], base),
  });
};

const parseSimpleContainer = (head, body, bodyBase) => {
  let def, inputs = {};
  if (/^Column\(/i.test(head)) {
    def = 'column';
    const a = head.match(/horizontalAlignment\s*=\s*Alignment\.(\w+)/);
    const s = head.match(/verticalArrangement\s*=\s*Arrangement\.spacedBy\((\d+)\.dp\)/);
    inputs = {
      'Horizontal Alignment': a ? a[1] : 'Start',
      'Vertical Spacing (dp)': s ? s[1] : '0',
    };
  } else if (/^Row\(/i.test(head)) {
    def = 'row';
    const h = head.match(/horizontalArrangement\s*=\s*Arrangement\.(\w+)\((\d+)\.dp\)/);
    inputs = h
      ? { 'Horizontal Arrangement': h[1], 'Spacing (dp)': h[2] }
      : { 'Horizontal Arrangement': 'spacedBy', 'Spacing (dp)': '12' };
  } else if (/^Box\(/i.test(head)) {
    def = 'box';
    const c = head.match(/contentAlignment\s*=\s*Alignment\.(\w+)/);
    inputs = { 'Content Alignment': c ? c[1] : 'Center' };
  } else if (/^ElevatedCard\(/i.test(head)) {
    def = 'elevated_card';
    const e = head.match(/defaultElevation\s*=\s*(\d+)\.dp/);
    inputs = { 'Elevation (dp)': e ? e[1] : '4' };
  } else if (/^OutlinedCard\(/i.test(head)) {
    def = 'outlined_card';
    inputs = {};
  } else if (/^Surface\(/i.test(head)) {
    def = 'surface';
    const c = head.match(/color\s*=\s*([^,\n]+)/);
    const e = head.match(/shadowElevation\s*=\s*(\d+)\.dp/);
    inputs = {
      'Color': c ? c[1].trim() : 'MaterialTheme.colorScheme.surface',
      'Shadow Elevation (dp)': e ? e[1] : '4',
    };
  } else if (/^Scaffold\(/.test(head)) {
    const withBB = /bottomBar\s*=/.test(head);
    def = withBB ? 'scaffold_with_bottombar' : 'scaffold';
    const t = head.match(/TopAppBar\(\s*title\s*=\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\}\s*\)/);
    inputs = { 'TopBar Title': t ? t[1] : 'MyApp' };
    // The content lambda is written as `{ padding ->` by the generator.
    // Strip the implicit lambda parameter so it does not become a block.
    body = body.replace(/^\s*padding\s*->\s*/g, '');
  } else if (/^repeat\(\s*(\d+)\s*\)$/.test(head)) {
    def = 'repeat_times';
    inputs = { Times: head.match(/^repeat\(\s*(\d+)\s*\)$/)[1] };
    return mk(def, inputs, { do: parseLevel(body, bodyBase) });
  } else if (/^while\(\s*([\s\S]*?)\s*\)$/.test(head)) {
    def = 'while_loop';
    inputs = { Condition: head.match(/^while\(\s*([\s\S]*?)\s*\)$/)[1].trim() };
    return mk(def, inputs, { do: parseLevel(body, bodyBase) });
  } else if (/^LaunchedEffect\(/.test(head)) {
    def = 'launched_effect';
    const k = head.match(/^LaunchedEffect\(\s*([\s\S]*?)\s*\)$/);
    inputs = { Key: k ? k[1].trim() : 'Unit' };
    return mk(def, inputs, { do: parseLevel(body, bodyBase) });
  } else if (/^SideEffect\s*\{/.test(head)) {
    def = 'side_effect';
    inputs = {};
    return mk(def, inputs, { do: parseLevel(body, bodyBase) });
  } else {
    return null;
  }
  return mk(def, inputs, { content: parseLevel(body, bodyBase) });
};

// ---------------------------------------------------------------------------
// Leaf statements
// ---------------------------------------------------------------------------

const parseLeaf = (st) => {
  let m;

  if ((m = st.match(/^var\s+(\w+)\s+by\s+remember\s*\{\s*mutableIntStateOf\(([^)]*)\)\s*\}$/))) {
    return mk('remember_int_state', { 'Variable Name': m[1], 'Initial Value': m[2].trim() });
  }
  if ((m = st.match(/^var\s+(\w+)\s+by\s+remember\s*\{\s*mutableStateOf\(\s*"([^"]*)"\s*\)\s*\}$/))) {
    return mk('remember_string_state', { 'Variable Name': m[1], 'Initial Value': m[2] });
  }
  if ((m = st.match(/^var\s+(\w+)\s+by\s+remember\s*\{\s*mutableStateOf\((true|false)\)\s*\}$/))) {
    return mk('remember_boolean_state', { 'Variable Name': m[1], 'Initial Value': m[2] });
  }
  if ((m = st.match(/^var\s+(\w+)\s+by\s+remember\s*\{\s*mutableStateOf\(mutableListOf<String>\(\)\)\s*\}$/))) {
    return mk('remember_list_state', { 'Variable Name': m[1], 'Initial Value': 'mutableListOf<String>()' });
  }
  if ((m = st.match(/^var\s+(\w+)\s+by\s+remember\s*\{\s*mutableStateOf\(mutableMapOf<String,\s*String>\(\)\)\s*\}$/))) {
    return mk('remember_map_state', { 'Variable Name': m[1], 'Initial Value': 'mutableMapOf<String, String>()' });
  }
  if ((m = st.match(/^val\s+(\w+)\s+by\s+remember\s*\{\s*derivedStateOf\s*\{\s*([\s\S]+?)\s*\}\s*\}$/))) {
    return mk('derived_state_of', { 'Variable Name': m[1], 'Expression': m[2].trim() });
  }
  if ((m = st.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/))) {
    return mk('update_state', { 'Variable Name': m[1], 'New Value or Expression': m[2].trim() });
  }

  if ((m = st.match(/^Text\(buildAnnotatedString\s*\{\s*append\(\s*"([^"]*)"\s*\)\s*\}\)$/))) {
    return mk('text_html', { Content: m[1] });
  }
  if ((m = st.match(/^Text\(\s*"([^"]*)"(?:\s*,\s*style\s*=\s*MaterialTheme\.typography\.(\w+))?(?:\s*,\s*fontWeight\s*=\s*FontWeight\.(\w+))?\s*\)$/))) {
    const content = m[1];
    const def = content.includes('$') ? 'text_with_variable' : 'text';
    return mk(def, {
      [def === 'text_with_variable' ? 'Text with $variable' : 'Text Content']: content,
      'Style': m[2] || '',
      'Font Weight': m[3] || '',
    });
  }

  if ((m = st.match(/^Button\(\s*onClick\s*=\s*\{\s*([\s\S]*?)\s*\}\s*\)\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\}$/))) {
    return mk('button', { 'Button Label': m[2], 'OnClick Action': m[1].trim() });
  }
  if ((m = st.match(/^OutlinedButton\(\s*onClick\s*=\s*\{\s*([\s\S]*?)\s*\}\s*\)\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\}$/))) {
    return mk('outlined_button', { 'Button Label': m[2], 'OnClick Action': m[1].trim() });
  }
  if ((m = st.match(/^TextButton\(\s*onClick\s*=\s*\{\s*([\s\S]*?)\s*\}\s*\)\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\}$/))) {
    return mk('text_button', { 'Button Label': m[2], 'OnClick Action': m[1].trim() });
  }
  if ((m = st.match(/^IconButton\(\s*onClick\s*=\s*\{\s*([\s\S]*?)\s*\}\s*\)\s*\{\s*Icon\(Icons\.Default\.(\w+),\s*contentDescription\s*=\s*null\)\s*\}$/))) {
    return mk('icon_button', { 'Icon Name': m[2], 'OnClick Action': m[1].trim() });
  }
  if ((m = st.match(/^ExtendedFloatingActionButton\(\s*onClick\s*=\s*\{\s*([\s\S]*?)\s*\}\s*,\s*icon\s*=\s*\{\s*Icon\(Icons\.Default\.(\w+),\s*contentDescription\s*=\s*null\)\s*\}\s*,\s*text\s*=\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\}\s*\)$/))) {
    return mk('extended_fab', { 'OnClick Action': m[1].trim(), 'Icon': m[2], 'Text': m[3] });
  }

  if ((m = st.match(/^OutlinedTextField\(\s*value\s*=\s*(\w+),\s*onValueChange\s*=\s*\{\s*\w+\s*=\s*it\s*\},\s*label\s*=\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\},\s*placeholder\s*=\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*\},\s*modifier\s*=\s*Modifier\.fillMaxWidth\(\),\s*singleLine\s*=\s*(true|false)\s*\)$/))) {
    return mk('outlined_textfield', {
      'Value Variable': m[1],
      'Label': m[2],
      'Placeholder': m[3],
      'Single Line': m[4],
    });
  }
  if ((m = st.match(/^Row\(verticalAlignment\s*=\s*Alignment\.CenterVertically\)\s*\{\s*Checkbox\(\s*checked\s*=\s*(\w+),\s*onCheckedChange\s*=\s*\{\s*\w+\s*=\s*it\s*\}\s*\)\s*Text\(\s*"([^"]*)"\s*\)\s*\}$/))) {
    return mk('checkbox', { 'Checked Variable': m[1], 'Label Text': m[2] });
  }
  if ((m = st.match(/^Row\(\s*modifier\s*=\s*Modifier\.fillMaxWidth\(\),\s*horizontalArrangement\s*=\s*Arrangement\.SpaceBetween,\s*verticalAlignment\s*=\s*Alignment\.CenterVertically\s*\)\s*\{\s*Text\(\s*"([^"]*)"\s*\)\s*Switch\(\s*checked\s*=\s*(\w+),\s*onCheckedChange\s*=\s*\{\s*\w+\s*=\s*it\s*\}\s*\)\s*\}$/))) {
    return mk('switch', { 'Label Text': m[1], 'Checked Variable': m[2] });
  }
  if ((m = st.match(/^Slider\(\s*value\s*=\s*(\w+)\.toFloat\(\),\s*onValueChange\s*=\s*\{\s*\w+\s*=\s*it\.toInt\(\)\s*\},\s*valueRange\s*=\s*(\d+)\.toFloat\(\)\.\.(\d+)\.toFloat\(\),\s*modifier\s*=\s*Modifier\.fillMaxWidth\(\)\s*\)$/))) {
    return mk('slider', { 'Value Variable': m[1], 'Min Value': m[2], 'Max Value': m[3] });
  }
  if ((m = st.match(/^LinearProgressIndicator\(\s*progress\s*=\s*\{\s*([\s\S]*?)\s*\},\s*modifier\s*=\s*Modifier\.fillMaxWidth\(\)\s*\)$/))) {
    return mk('linear_progress', { 'Progress Variable': m[1].trim() });
  }
  if ((m = st.match(/^CircularProgressIndicator\(\s*progress\s*=\s*\{\s*([\s\S]*?)\s*\}\s*\)$/))) {
    return mk('circular_progress', { 'Progress Variable': m[1].trim() });
  }
  if ((m = st.match(/^HorizontalDivider\(thickness\s*=\s*(\d+)\.dp\)$/))) {
    return mk('divider', { 'Thickness (dp)': m[1] });
  }
  if ((m = st.match(/^Spacer\(modifier\s*=\s*Modifier\.height\((\d+)\.dp\)\)$/))) {
    return mk('spacer', { 'Height (dp)': m[1] });
  }
  if ((m = st.match(/^InfoRow\(\s*"([^"]*)"\s*,\s*([\s\S]+?)\)$/))) {
    return mk('info_row', { 'Label': m[1], 'Value Expression': m[2].trim() });
  }

  if ((m = st.match(/^\.padding\((\d+)\.dp\)$/))) return mk('modifier_padding', { 'Padding (dp)': m[1] });
  if ((m = st.match(/^\.padding\(horizontal\s*=\s*(\d+)\.dp,\s*vertical\s*=\s*(\d+)\.dp\)$/))) {
    return mk('modifier_padding_all', { 'Horizontal (dp)': m[1], 'Vertical (dp)': m[2] });
  }
  if (/^\.fillMaxSize\(\)$/.test(st)) return mk('modifier_fill_max_size', {});
  if (/^\.fillMaxWidth\(\)$/.test(st)) return mk('modifier_fill_max_width', {});
  if (/^\.fillMaxHeight\(\)$/.test(st)) return mk('modifier_fill_max_height', {});
  if ((m = st.match(/^\.size\((\d+)\.dp,\s*(\d+)\.dp\)$/))) return mk('modifier_size', { 'Width (dp)': m[1], 'Height (dp)': m[2] });
  if ((m = st.match(/^\.width\((\d+)\.dp\)$/))) return mk('modifier_width', { 'Width (dp)': m[1] });
  if ((m = st.match(/^\.height\((\d+)\.dp\)$/))) return mk('modifier_height', { 'Height (dp)': m[1] });
  if ((m = st.match(/^\.background\(([\s\S]+?)\)$/))) return mk('modifier_background', { 'Color': m[1].trim() });
  if ((m = st.match(/^\.clickable\s*\{\s*([\s\S]*?)\s*\}$/))) return mk('modifier_clickable', { 'OnClick Action': m[1].trim() });
  if (/^\.verticalScroll\(rememberScrollState\(\)\)$/.test(st)) return mk('modifier_vertical_scroll', {});
  if (/^\.horizontalScroll\(rememberScrollState\(\)\)$/.test(st)) return mk('modifier_horizontal_scroll', {});
  if ((m = st.match(/^\.border\((\d+)\.dp,\s*([\s\S]*?),\s*([\s\S]+?)\)$/))) {
    return mk('modifier_border', { 'Width (dp)': m[1], 'Color': m[2].trim(), 'Shape': m[3].trim() });
  }
  if ((m = st.match(/^\.shadow\((\d+)\.dp\)$/))) return mk('modifier_shadow', { 'Elevation (dp)': m[1] });
  if ((m = st.match(/^\.clip\(RoundedCornerShape\((\d+)\.dp\)\)$/))) return mk('modifier_clip', { 'Corner Radius (dp)': m[1] });
  if ((m = st.match(/^\.alpha\((\d+(?:\.\d+)?)f\)$/))) return mk('modifier_alpha', { 'Alpha (0.0 - 1.0)': m[1] });
  if ((m = st.match(/^\.rotate\((\d+(?:\.\d+)?)f\)$/))) return mk('modifier_rotate', { 'Degrees': m[1] });
  if ((m = st.match(/^\.scale\((\d+(?:\.\d+)?)f\)$/))) return mk('modifier_scale', { 'Scale Factor': m[1] });
  if ((m = st.match(/^\.offset\(x\s*=\s*(\d+)\.dp,\s*y\s*=\s*(\d+)\.dp\)$/))) {
    return mk('modifier_offset', { 'X Offset (dp)': m[1], 'Y Offset (dp)': m[2] });
  }

  if ((m = st.match(/^([A-Za-z_]\w*)\+\+$/))) return mk('on_click_increment', { 'Variable Name': m[1] });
  if ((m = st.match(/^([A-Za-z_]\w*)--$/))) return mk('on_click_decrement', { 'Variable Name': m[1] });
  if ((m = st.match(/^([A-Za-z_]\w*)\s*=\s*!([A-Za-z_]\w*)$/))) return mk('on_click_toggle', { 'Variable Name': m[1] });
  if ((m = st.match(/^([A-Za-z_]\w*)\.add\(([\s\S]+?)\)$/))) return mk('on_click_add_to_list', { 'List Variable': m[1], 'Item to Add': m[2].trim() });
  if ((m = st.match(/^([A-Za-z_]\w*)\.removeAt\((\d+)\)$/))) return mk('on_click_remove_from_list', { 'List Variable': m[1], 'Index': m[2] });
  if ((m = st.match(/^([A-Za-z_]\w*)\.clear\(\)$/))) return mk('on_click_clear_list', { 'List Variable': m[1] });
  if ((m = st.match(/^\/\/ Show snackbar:\s*"([^"]*)"\s*with\s*action\s*"([^"]*)"$/))) {
    return mk('on_click_show_snackbar', { 'Message': m[1], 'Action Label': m[2] });
  }
  if ((m = st.match(/^\/\/ Launch URL:\s*([\s\S]*)\nval\s+intent\s*=\s*Intent\(Intent\.ACTION_VIEW,\s*Uri\.parse\(\s*"([^"]*)"\s*\)\)\ncontext\.startActivity\(intent\)$/))) {
    return mk('on_click_launch_url', { 'URL': m[2] });
  }
  if ((m = st.match(/^\/\/ Share:\s*"([^"]*)"\nval\s+intent\s*=\s*Intent\(Intent\.ACTION_SEND\)\.apply\s*\{\n\s*type\s*=\s*"text\/plain"\n\s*putExtra\(Intent\.EXTRA_TEXT,\s*"([^"]*)"\)\n\s*putExtra\(Intent\.EXTRA_SUBJECT,\s*"([^"]*)"\)\n\}\ncontext\.startActivity\(Intent\.createChooser\(intent,\s*null\)\)$/))) {
    return mk('on_click_share', { 'Text to Share': m[2], 'Subject': m[3] });
  }
  if ((m = st.match(/^([A-Za-z_]\w*)\[(\d+)\]$/))) return mk('list_item', { 'List Variable': m[1], 'Index': m[2] });
  if ((m = st.match(/^([A-Za-z_]\w*)\.size$/))) return mk('list_size', { 'List Variable': m[1] });
  if ((m = st.match(/^([A-Za-z_]\w*)\.isEmpty\(\)$/))) return mk('list_is_empty', { 'List Variable': m[1] });

  if ((m = st.match(/^val\s+(\w+)\s+by\s+animateColorAsState\(\s*targetValue\s*=\s*if\s*\(\s*([\s\S]*?)\s*\)\s*([\s\S]*?)\s*else\s*([\s\S]*?)\s*\)$/))) {
    return mk('animate_color_as_state', {
      'Variable Name': m[1], 'True Color': m[3].trim(), 'False Color': m[4].trim(),
    });
  }
  if ((m = st.match(/^val\s+(\w+)\s+by\s+animateDpAsState\(\s*targetValue\s*=\s*if\s*\(\s*([\s\S]*?)\s*\)\s*(\d+)\.dp\s*else\s*(\d+)\.dp\s*\)$/))) {
    return mk('animate_dp_as_state', {
      'Variable Name': m[1], 'Expanded Size (dp)': m[3], 'Collapsed Size (dp)': m[4],
    });
  }
  if ((m = st.match(/^val\s+(\w+)\s+by\s+animateFloatAsState\(\s*targetValue\s*=\s*(\d+(?:\.\d+)?)f\s*\)$/))) {
    return mk('animate_float_as_state', { 'Variable Name': m[1], 'Target Value': m[2] });
  }

  return null;
};

const parseStatement = (st, base) => {
  const text = st.trim();
  if (!text) return null;

  const ifElse = parseIfElse(text, base);
  if (ifElse) return ifElse;
  const tryCatch = parseTryCatch(text, base);
  if (tryCatch) return tryCatch;

  const leaf = parseLeaf(text);
  if (leaf) return leaf;

  const lazy = parseLazy(text, false, base) || parseLazy(text, true, base);
  if (lazy) return lazy;

  const disposable = parseDisposable(text, base);
  if (disposable) return disposable;

  const produce = parseProduceState(text, base);
  if (produce) return produce;

  const whenB = parseWhen(text, base);
  if (whenB) return whenB;

  const lamb = extractTrailingLambda(text, base);
  if (lamb) {
    const container = parseSimpleContainer(lamb.head, lamb.body, lamb.bodyBase);
    if (container) return container;
  }

  return mk('custom_code', { Code: text });
};

const parseLevel = (body, base = 0) => {
  if (!body) return [];
  return splitStatements(body)
    .map((stmt) => {
      const block = parseStatement(stmt.text, base + stmt.start);
      if (!block) return null;
      // Attach the source anchor (absolute offsets within the top-level body):
      // range from line start (incl. indent) to content end, plus the leading
      // indent string.
      block._range = { start: base + stmt.ls, end: base + stmt.end };
      block._indent = stmt.indent;
      return block;
    })
    .filter(Boolean);
};

/**
 * Convert a Kotlin Compose body into visual blocks. Containers become a single
 * block with nested children; unrecognized statements become `custom_code`
 * blocks. Every block carries its source anchor (`_range`, `_indent`).
 */
export const generateBlocksFromSource = (source) => {
  if (!source) return [];
  return parseLevel(source);
};

export default generateBlocksFromSource;
