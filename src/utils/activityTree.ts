/**
 * Per-Activity Kotlin source <-> Compose Studio component tree.
 *
 * The editor is a thin view on top of the rai workspace. The
 * template that rai new writes is the source of truth; the editor
 * never invents AppTheme / Surface / state declarations that are
 * not already in the file. Parsing walks into the @Composable
 * function the Activity's setContent calls into (the standard
 * rai template uses `MainScreen()`) and surfaces that function's
 * body to the editor. Emitting replaces that function's body with
 * the new tree; everything else in the file - imports, the
 * AppTheme wrapper, the `class MainActivity`, the var x by
 * remember declarations that rai put there - is left exactly as
 * the user (or rai) wrote it.
 *
 * If a project has no MainScreen yet (e.g. a brand-new project
 * where the user only added a few components), the editor falls
 * back to emitting a minimal Activity with `setContent { <tree> }`
 * and no extra wrapping.
 */
import { execute } from './shellExecutor';
import { getSourceRoot } from '../config/runtime';
import { generateId } from './generateId';
import { generateBlocksFromSource } from './blockGenerator';
import { patchBody } from './blockPatcher';
import { patchTree } from './treePatcher';
import { generateCodeFromBlocks, generateImportsFromBlocks } from './blockToCode';

const escape = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const COMPONENT_BY_KOTLIN = {
  Column: 'Column',
  Row: 'Row',
  Box: 'Box',
  LazyColumn: 'LazyColumn',
  LazyRow: 'LazyRow',
  Card: 'Card',
  ElevatedCard: 'ElevatedCard',
  OutlinedCard: 'OutlinedCard',
  Surface: 'Surface',
  Text: 'Text',
  Button: 'Button',
  FilledTonalButton: 'FilledTonalButton',
  ElevatedButton: 'ElevatedButton',
  TextButton: 'TextButton',
  OutlinedButton: 'OutlinedButton',
  FloatingActionButton: 'FloatingActionButton',
  ExtendedFloatingActionButton: 'ExtendedFloatingActionButton',
  OutlinedTextField: 'OutlinedTextField',
  TextField: 'TextField',
  BasicTextField: 'BasicTextField',
  SelectableText: 'SelectableText',
  Image: 'Image',
  Checkbox: 'Checkbox',
  Switch: 'Switch',
  Slider: 'Slider',
  RangeSlider: 'RangeSlider',
  RadioButton: 'RadioButton',
  SegmentedButton: 'SegmentedButton',
  SingleChoiceSegmentedButtonRow: 'SingleChoiceSegmentedButtonRow',
  Snackbar: 'Snackbar',
  FlowRow: 'FlowRow',
  FlowColumn: 'FlowColumn',
  ModalNavigationDrawer: 'ModalNavigationDrawer',
  DismissibleNavigationDrawer: 'ModalNavigationDrawer',
  PermanentNavigationDrawer: 'ModalNavigationDrawer',
  ModalDrawerSheet: 'ModalDrawerSheet',
  DrawerSheet: 'ModalDrawerSheet',
  NavigationDrawerItem: 'NavigationDrawerItem',
  DrawerItem: 'NavigationDrawerItem',
  ModalBottomSheet: 'ModalBottomSheet',
  BottomSheet: 'ModalBottomSheet',
  StandardBottomSheet: 'ModalBottomSheet',
  DatePicker: 'DatePicker',
  DateRangePicker: 'DatePicker',
  DatePickerDialog: 'DatePicker',
  SearchBar: 'SearchBar',
  AssistChip: 'AssistChip',
  FilterChip: 'FilterChip',
  SuggestionChip: 'SuggestionChip',
  InputChip: 'InputChip',
  NavigationBar: 'NavigationBar',
  NavigationBarItem: 'NavigationBarItem',
  BottomAppBar: 'BottomAppBar',
  TabRow: 'TabRow',
  PrimaryTabRow: 'PrimaryTabRow',
  SecondaryTabRow: 'SecondaryTabRow',
  Tab: 'Tab',
  AlertDialog: 'AlertDialog',
  DropdownMenu: 'DropdownMenu',
  DropdownMenuItem: 'DropdownMenuItem',
  LinearProgressIndicator: 'LinearProgressIndicator',
  CircularProgressIndicator: 'CircularProgressIndicator',
  HorizontalDivider: 'HorizontalDivider',
  VerticalDivider: 'VerticalDivider',
  Spacer: 'Spacer',
  Icon: 'Icon',
  IconButton: 'IconButton',
  Badge: 'Badge',
  TopAppBar: 'TopAppBar',
  CenterAlignedTopAppBar: 'TopAppBar',
  Scaffold: 'Scaffold',
  InfoRow: 'Text',
};

// Kotlin keywords / declarations that are NOT Composable calls.
// The parser must skip them when walking a function body so that
// `var counter by remember { ... }` or `val context = ...` do not
// end up as phantom Text nodes in the editor tree.
const KOTLIN_NON_COMPOSABLE_KEYWORDS = new Set([
  'var', 'val', 'if', 'else', 'when', 'for', 'while', 'do',
  'return', 'throw', 'break', 'continue', 'import', 'package',
  'class', 'interface', 'object', 'fun', 'typealias', 'try',
  'catch', 'finally', 'yield',
]);

// Standard wrappers rai puts around the user function. We
// consider anything in this set a "transparent" call when
// resolving the user-visible root. We never emit any of these
// ourselves - if the file has them we keep them, if it does not
// we don't add them.
const WRAPPER_NAMES = new Set([
  'AppTheme',
  'MaterialTheme',
  'Surface',
  'Crossfade',
  'AnimatedVisibility',
  'BackHandler',
  'Theme',
  'ProvideWindowInsets',
]);

const splitBody = (source, openIndex, openChar, closeChar) => {
  let depth = 0;
  let inString = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return { body: source.slice(openIndex + 1, i), start: openIndex, end: i };
    }
  }
  return { body: '', start: openIndex, end: openIndex };
};

const splitTopLevelCommas = (input) => {
  const parts = [];
  let depth = 0;
  let brace = 0;
  let bracket = 0;
  let inString = null;
  let buffer = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : '';
    if (inString) {
      buffer += ch;
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; buffer += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === ',' && depth === 0 && brace === 0 && bracket === 0) {
      parts.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
};

const parseNamedArgs = (raw) => {
  const args: Record<string, any> = {};
  for (const part of splitTopLevelCommas(raw)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    args[key] = value;
    // Kotlin named arguments are camelCase (`fontSize = 18.sp`). Expose a
    // lowercase alias too so downstream lookups are case-insensitive — this is
    // what lets the preview capture fontSize/fontWeight/lineHeight/maxLines/…
    if (key.toLowerCase() !== key) args[key.toLowerCase()] = value;
  }
  return args;
};

const mapAlignment = (value) => {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower.includes('centerhorizontally')) return 'center';
  if (lower.includes('centervertically')) return 'center';
  if (lower.includes('end') || lower.includes('right')) return 'end';
  if (lower.includes('bottom')) return 'bottom';
  return 'start';
};

const mapArrangement = (value) => {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower.includes('spacebetween')) return 'spaceBetween';
  if (lower.includes('spacearound')) return 'spaceAround';
  if (lower.includes('spaceevenly')) return 'spaceEvenly';
  if (lower.includes('center')) return 'center';
  if (lower.includes('end') || lower.includes('bottom')) return 'end';
  return 'top';
};

const parseNumber = (value) => {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const parseColor = (value) => {
  if (!value) return undefined;
  const match = value.match(/#?[0-9A-Fa-f]{6,8}/);
  return match ? (match[0].startsWith('#') ? match[0] : `#${match[0]}`) : undefined;
};

const stripQuotes = (value) => {
  if (typeof value !== 'string') return value;
  if (value.length < 2) return value;
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }
  return value;
};

const parseModifierChain = (raw) => {
  const out = {
    padding: 0, backgroundColor: undefined, borderRadius: undefined, borderColor: undefined,
    borderWidth: undefined, width: undefined, height: undefined, sizeWidth: undefined,
    sizeHeight: undefined, weight: undefined, widthInMin: undefined, widthInMax: undefined,
    heightInMin: undefined, heightInMax: undefined, offsetX: undefined, offsetY: undefined,
    aspectRatio: undefined, paddingHorizontal: undefined, paddingVertical: undefined,
    paddingStart: undefined, paddingEnd: undefined, paddingTop: undefined, paddingBottom: undefined,
  };
  if (!raw) return out;
  const calls = extractModifierCalls(raw);
  for (const { name, args } of calls) {
    const n = name.toLowerCase();
    const numArg = (a) => parseNumber(a);
    if (n === 'fillmaxsize') {
      out.width = 'match_parent';
      out.height = 'match_parent';
    } else if (n === 'fillmaxwidth') {
      out.width = 'match_parent';
      const f = numArg(args[0]);
      if (f !== undefined) out.width = `fillMaxWidth(${f})`;
    } else if (n === 'fillmaxheight') {
      out.height = 'match_parent';
      const f = numArg(args[0]);
      if (f !== undefined) out.height = `fillMaxHeight(${f})`;
    } else if (n === 'width' && args.length) {
      const f = numArg(args[0]);
      if (f !== undefined) out.width = f;
    } else if (n === 'height' && args.length) {
      const f = numArg(args[0]);
      if (f !== undefined) out.height = f;
    } else if (n === 'size') {
      if (args[0]) { const f = numArg(args[0]); if (f !== undefined) out.sizeWidth = f; }
      if (args[1]) { const f = numArg(args[1]); if (f !== undefined) out.sizeHeight = f; }
      else if (args[0]) { const f = numArg(args[0]); if (f !== undefined) { out.sizeWidth = f; out.sizeHeight = f; } }
    } else if (n === 'widthin') {
      if (args[0]) { const f = numArg(args[0]); if (f !== undefined) out.widthInMin = f; }
      if (args[1]) { const f = numArg(args[1]); if (f !== undefined) out.widthInMax = f; }
    } else if (n === 'heightin') {
      if (args[0]) { const f = numArg(args[0]); if (f !== undefined) out.heightInMin = f; }
      if (args[1]) { const f = numArg(args[1]); if (f !== undefined) out.heightInMax = f; }
    } else if (n === 'aspectratio' && args[0]) {
      const f = numArg(args[0]); if (f !== undefined) out.aspectRatio = f;
    } else if (n === 'weight' && args[0]) {
      const f = numArg(args[0]); if (f !== undefined) out.weight = f;
    } else if (n === 'offset') {
      if (args[0]) { const f = numArg(args[0]); if (f !== undefined) out.offsetX = f; }
      if (args[1]) { const f = numArg(args[1]); if (f !== undefined) out.offsetY = f; }
      else if (args[0]) { const f = numArg(args[0]); if (f !== undefined) { out.offsetX = f; out.offsetY = f; } }
    } else if (n === 'padding') {
      const named = parseNamedArgs(args.join(','));
      const positional = args.filter((a) => a.indexOf('=') < 0);
      if (named.horizontal !== undefined) { const f = numArg(named.horizontal); if (f !== undefined) out.paddingHorizontal = f; }
      if (named.vertical !== undefined) { const f = numArg(named.vertical); if (f !== undefined) out.paddingVertical = f; }
      if (named.start !== undefined) { const f = numArg(named.start); if (f !== undefined) out.paddingStart = f; }
      if (named.end !== undefined) { const f = numArg(named.end); if (f !== undefined) out.paddingEnd = f; }
      if (named.top !== undefined) { const f = numArg(named.top); if (f !== undefined) out.paddingTop = f; }
      if (named.bottom !== undefined) { const f = numArg(named.bottom); if (f !== undefined) out.paddingBottom = f; }
      if (named.all !== undefined) { const f = numArg(named.all); if (f !== undefined) out.padding = f; }
      if (positional.length === 1) { const f = numArg(positional[0]); if (f !== undefined) out.padding = f; }
      else if (positional.length === 2) {
        const fh = numArg(positional[0]); const fv = numArg(positional[1]);
        if (fh !== undefined) out.paddingHorizontal = fh;
        if (fv !== undefined) out.paddingVertical = fv;
      }
    } else if (n === 'background') {
      // background(Color(0xFF...), shape) or background(0xFF....)
      const first = (args[0] || '').trim();
      const colorArg = first.match(/#?[0-9A-Fa-f]{6,8}/);
      if (colorArg) out.backgroundColor = parseColor(first) || undefined;
    } else if (n === 'border') {
      const w = numArg(args[0]);
      if (w !== undefined) out.borderWidth = w;
      const colorMatch = (args[1] || '').match(/#?[0-9A-Fa-f]{6,8}/);
      if (colorMatch) out.borderColor = parseColor(args[1]) || undefined;
    } else if (n === 'clip') {
      const r = args[0] || '';
      const rad = r.match(/roundedcornershape\(([0-9.]+)\.dp\)/);
      if (rad) out.borderRadius = Number(rad[1]);
    }
  }
  return out;
};

/**
 * Split a Modifier chain like `Modifier.fillMaxWidth().padding(16.dp).weight(1f)`
 * into top-level `name(args)` calls. Works across newlines and nested parens.
 */
const extractModifierCalls = (raw) => {
  const calls = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  let lastEnd = 0;
  while ((m = re.exec(raw))) {
    const open = m.index + m[0].length - 1;
    const parsed = splitBody(raw, open, '(', ')');
    if (parsed.end <= open) continue;
    const argsStr = parsed.body;
    // Only accept calls at "top level" of the modifier chain: the segment before
    // this call must not contain an unbalanced `(` (i.e. we are not inside another call).
    const prefix = raw.slice(lastEnd, m.index);
    const unclosed = (prefix.match(/\(/g) || []).length - (prefix.match(/\)/g) || []).length;
    if (unclosed > 0) continue;
    calls.push({ name: m[1], args: splitTopLevelCommas(argsStr) });
    lastEnd = parsed.end + 1;
    re.lastIndex = parsed.end + 1;
  }
  return calls;
};

const parseProps = (raw, simpleName) => {
  const named = parseNamedArgs(raw);
  const positional = splitTopLevelCommas(raw).filter((p) => p.indexOf('=') < 0);
  const props: Record<string, any> = {};
  const modifier = parseModifierChain(named.modifier);
  Object.assign(props, modifier);
  if (named.text) props.text = stripQuotes(named.text);
  if (named.title) {
    const titleValue = named.title.trim();
    // TopAppBar title is often a lambda: title = { Text("MyApp") }
    if (titleValue.startsWith('{')) {
      const inner = titleValue.slice(1, -1).trim();
      const textMatch = inner.match(/Text\s*\(\s*"([^"]*)"/);
      if (textMatch) {
        props.title = textMatch[1];
      } else {
        props.title = inner;
      }
    } else {
      props.title = stripQuotes(named.title);
    }
  }
  if (named.label) props.label = stripQuotes(named.label);
  if (named.color) props.color = parseColor(named.color) || stripQuotes(named.color);
  if (named.backgroundcolor) props.backgroundColor = parseColor(named.backgroundcolor);
  // Scaffold/TopAppBar etc. accept `containerColor = Color(0xFF...)` — surface it
  // as backgroundColor so the preview honours an explicit container colour.
  if (named.containercolor) {
    const cc = parseColor(named.containercolor) || undefined;
    if (cc) props.backgroundColor = cc;
  }
  // Button/OutlinedButton/etc. emit an explicit color as
  //   colors = ButtonDefaults.buttonColors(containerColor = composeColor("#RRGGBB"))
  //   colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFRRGGBB))
  // Extract the containerColor hex back into backgroundColor so the preview
  // honours the real button colour instead of falling back to the theme primary.
  if (named.colors) {
    const cc = String(named.colors).match(/containerColor\s*=\s*composeColor\(\s*"([^"]+)"/) ||
               String(named.colors).match(/containerColor\s*=\s*Color\(\s*(0x[0-9A-Fa-f]+)/);
    if (cc) {
      const col = parseColor(cc[1]) || undefined;
      if (col) props.backgroundColor = col;
    }
  }
  if (named.textcolor) props.textColor = parseColor(named.textcolor);
  if (named.tint) props.tint = parseColor(named.tint);
  if (named.trackcolor) props.trackColor = parseColor(named.trackcolor);
  if (named.borderradius) props.borderRadius = parseNumber(named.borderradius);
  if (named.elevation) props.elevation = parseNumber(named.elevation);
  if (named.spacing) props.spacing = parseNumber(named.spacing);
  if (named.padding) props.padding = parseNumber(named.padding);
  if (named.size) props.size = parseNumber(named.size);
  if (named.progress) props.progress = parseNumber(named.progress);
  // Slider uses `value = 0.6f` — surface it as `progress` for the renderer.
  if (simpleName === 'Slider' && named.value && props.progress === undefined) {
    props.progress = parseNumber(named.value);
  }
  // RangeSlider uses `value = 0.2f..0.8f` — capture both ends.
  if (simpleName === 'RangeSlider' && named.value) {
    const range = String(named.value).match(/(-?\d+(?:\.\d+)?)f?\s*\.\.\s*(-?\d+(?:\.\d+)?)f?/);
    if (range) {
      props.startValue = Number(range[1]);
      props.endValue = Number(range[2]);
    }
  }
  if (named.textsize) props.textSize = parseNumber(named.textsize);
  if (named.fontsize) props.textSize = parseNumber(named.fontsize);
  if (named.url) props.url = stripQuotes(named.url);
  if (named.hint) props.hint = stripQuotes(named.hint);
  if (named.query) props.query = stripQuotes(named.query);
  if (named.checked) props.checked = /true/i.test(named.checked);
  if (named.enabled) props.enabled = !/false/i.test(named.enabled);
  if (named.selected) props.selected = /true/i.test(named.selected);
  if (named.selectedtabindex) props.selectedTabIndex = parseNumber(named.selectedtabindex);
  if (named.selectedindex) props.selectedTabIndex = parseNumber(named.selectedindex);
  // onClick lambda: `onClick = { counter++ }` -> store the action body so a
  // design edit does not silently drop the button's handler.
  const onClickRaw = named.onClick || named.onclick;
  if (onClickRaw) {
    const action = String(onClickRaw).trim();
    props.onClick = (action.startsWith('{') && action.endsWith('}'))
      ? action.slice(1, -1).trim()
      : action;
  }
  if (named.horizontalalignment) props.horizontalAlignment = mapAlignment(named.horizontalalignment);
  if (named.verticalalignment) props.verticalAlignment = mapAlignment(named.verticalalignment);
  if (named.verticalarrangement) props.verticalArrangement = mapArrangement(named.verticalarrangement);
  if (named.horizontalarrangement) props.horizontalArrangement = mapArrangement(named.horizontalarrangement);
  if (named.fontweight && /bold/i.test(named.fontweight)) props.textStyle = 'bold';
  else if (named.fontweight && /medium/i.test(named.fontweight)) props.textStyle = 'medium';
  if (named.fontsize) props.textSize = parseNumber(named.fontsize);
  if (named.lineheight) props.lineHeight = parseNumber(named.lineheight);
  if (named.maxlines) props.maxLines = parseNumber(named.maxlines);
  if (named.letterspacing) props.letterSpacing = parseNumber(named.letterspacing);
  if (named.textalign) {
    const t = named.textalign.toLowerCase();
    if (t.includes('center')) props.textAlign = 'center';
    else if (t.includes('end') || t.includes('right')) props.textAlign = 'end';
    else props.textAlign = 'start';
  }
  if (named.style) {
    // MaterialTheme.typography.headlineMedium -> headline; titleLarge -> title, etc.
    const s = String(named.style).toLowerCase();
    if (/display/.test(s)) props.textStyle = 'display';
    else if (/headline/.test(s)) props.textStyle = 'headline';
    else if (/title/.test(s)) props.textStyle = 'title';
    else if (/label/.test(s)) props.textStyle = 'label';
    else if (/body/.test(s)) props.textStyle = 'body';
    else if (/bold/i.test(named.style)) props.textStyle = 'bold';
  }
  if (named.shape) {
    const shapeArg = String(named.shape).trim();
    const rad = shapeArg.match(/RoundedCornerShape\s*\(\s*([0-9.]+)\s*\.dp/);
    if (rad) props.borderRadius = Number(rad[1]);
  }
  if (named.tonalelevation) props.elevation = parseNumber(named.tonalelevation);
  if (named.contentpadding) {
    const cp = String(named.contentpadding).trim();
    const all = cp.match(/PaddingValues\s*\(\s*([0-9.]+)\s*\.dp/);
    if (all) props.padding = Number(all[1]);
  }
  // Scaffold topBar: extract the TopAppBar from the lambda
  const topBarRaw = named.topBar || named.topbar;
  if (topBarRaw) {
    const topBarValue = topBarRaw.trim();
    if (topBarValue.startsWith('{') && topBarValue.endsWith('}')) {
      const inner = topBarValue.slice(1, -1).trim();
      if (inner) {
        const topBarStmt = parseStatement(inner);
        if (topBarStmt) {
          props.topBar = topBarStmt;
        }
      }
    }
  }
  // Positional argument fallbacks for the most common Composables
  // that users write without `name = ...`:
  //   Text("Hello")
  //   Button("Click me") { ... }
  //   OutlinedButton("OK") { ... }
  //   OutlinedTextField("value", "label")
  if (!props.text) {
    if (simpleName === 'Text' && positional[0]) props.text = stripQuotes(positional[0]);
    else if ((simpleName === 'Button' || simpleName === 'OutlinedButton') && positional[0]) {
      props.text = stripQuotes(positional[0]);
    } else if (simpleName === 'OutlinedTextField' && positional[0]) {
      props.text = stripQuotes(positional[0]);
    }
  }
  if (simpleName === 'OutlinedTextField' && !props.label && positional[1]) {
    props.label = stripQuotes(positional[1]);
  }
  if (simpleName === 'TopAppBar' && !props.title && positional[0]) {
    props.title = stripQuotes(positional[0]);
  }
  return props;
};

const parseStatement = (stmt, absStart = 0, indent = '') => {
  // When a statement carries its own position (from parseChildrenBlock) we
  // already know absStart points at the trimmed statement. When called from
  // parseProps (topBar lambda) absStart defaults to 0 and ranges are unused.
  const offsetOf = (cleaned) => {
    // Offset of `cleaned` (comment-stripped) relative to the statement start.
    return commentIndex >= 0 ? stmt.indexOf(cleaned) : 0;
  };
  let _base = absStart; // updated to children-body base before recursion
  const commentIndex = stmt.indexOf('//');
  const cleaned = commentIndex >= 0 ? stmt.slice(0, commentIndex).trim() : stmt;
  if (!cleaned) return null;
  // Match `Name` (with optional args) - the first non-whitespace
  // character after the name is either `(` (call with arguments) or
  // `{` (trailing lambda with no arguments, e.g. `Box { ... }`).
  const match = cleaned.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*([({])/);
  if (!match) return null;
  const simpleName = match[1].split('.').pop();
  if (['item', 'forEach', 'repeat', 'ColumnScope', 'RowScope', 'BoxScope'].includes(simpleName)) return null;
  const openChar = match[2];
  const open = match.index + match[0].length - 1;
  let args = '';
  let childrenBody = '';
  if (openChar === '(') {
    const { body, end } = splitBody(cleaned, open, '(', ')');
    if (end <= open) return null;
    args = body.trim();
    // Look for a trailing lambda after the closing `)`. The args
    // themselves may contain balanced `name = { ... }` lambdas
    // (e.g. `Scaffold(topBar = { ... })`) - those are not children.
    let idx = end + 1;
    while (idx < cleaned.length && /\s/.test(cleaned[idx])) idx++;
    if (cleaned[idx] === '{') {
      const lambda = splitBody(cleaned, idx, '{', '}');
      if (lambda.end > idx) {
        childrenBody = lambda.body;
        _base = absStart + offsetOf(cleaned) + idx + 1;
      }
    } else {
      // No trailing lambda. Find the first `{ ... }` inside args and
      // treat it as the children block (this is the shape
      // `Button { Text("...") }` where the whole call has no args).
      let d = 0;
      let inStr = null;
      let lambdaStart = -1;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        const prev = i > 0 ? body[i - 1] : '';
        if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
        if (ch === '"' || ch === "'") { inStr = ch; continue; }
        if (ch === '(') d++;
        else if (ch === ')') d--;
        else if (ch === '{' && d === 0) {
          // Skip a `{` that starts a named-argument lambda: `name = { ... }`.
          let k = i - 1;
          while (k >= 0 && /\s/.test(body[k])) k--;
          if (body[k] === '=') {
            const skip = splitBody(body, i, '{', '}');
            if (skip.end > i) i = skip.end;
            continue;
          }
          lambdaStart = i;
          break;
        }
      }
      if (lambdaStart >= 0) {
        const lambda = splitBody(body, lambdaStart, '{', '}');
        if (lambda.end > lambdaStart) {
          childrenBody = lambda.body;
          _base = absStart + offsetOf(cleaned) + lambdaStart + 1;
        }
        args = body.slice(0, lambdaStart).trim();
      }
    }
  } else {
    const lambda = splitBody(cleaned, open, '{', '}');
    if (lambda.end > open) {
      childrenBody = lambda.body;
      _base = absStart + offsetOf(cleaned) + open + 1;
    }
  }
  const type = COMPONENT_BY_KOTLIN[simpleName];
  if (!type) {
    // If the name starts with an uppercase letter it looks like a
    // Composable call we don't model yet (e.g. a custom component
    // or a third-party library call). Surface it as a placeholder
    // node with the call's name so the editor tree is not empty.
    // Lowercase calls (e.g. `LaunchedEffect`, `remember`) are not
    // visual and should be silently dropped.
    if (/^[A-Z]/.test(simpleName)) {
      return { id: generateId(), type: simpleName, props: { text: cleaned }, children: [] };
    }
    return null;
  }
  let props = parseProps(args, simpleName);
  const children = parseChildrenBlock(childrenBody, _base);
  // Helper calls (InfoRow, etc.) keep the type marker but we also
  // surface a human-readable text so the editor doesn't show a
  // blank Text node when rai generated the source.
  if (type === 'Text' && simpleName !== 'Text' && !props.text) {
    const first = splitTopLevelCommas(args)[0];
    if (first) props = { ...props, text: stripQuotes(first) };
  }
  const node: any = { id: generateId(), type, props, children };
  node._range = { start: absStart, end: absStart + stmt.trimEnd().length };
  node._indent = indent;
  return node;
};


const parseChildrenBlock = (block, base = 0) => {
  if (!block) return [];
  // Statement splitter for a Composable body. Statements look like
  //   `Name(args) { body }`
  //   `Name { body }`
  //   `Name(args)`
  // and can be on a single line (`InfoRow("a") InfoRow("b")`),
  // across multiple lines, or nested.
  //
  // We walk the text char by char tracking balanced parens/braces.
  // At depth/brace/bracket == 0 we look for a token that begins a
  // new statement (`Name(` or `Name{`). The statement ends when
  // the outer call closes: trailing-lambda's `}` is the closing
  // brace, and the matching `(` is the open paren of the same
  // statement. A bare call without a trailing lambda ends at its
  // own `)`.
  const statements = [];
  const len = block.length;
  let i = 0;
  // Skip leading whitespace.
  while (i < len && /\s/.test(block[i])) i++;
  while (i < len) {
    // Expect a statement start: identifier followed by `(` or `{`.
    const rest = block.slice(i);
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*([({])/);
    if (!m) {
      // Not a Composable call - skip to the next newline so we
      // don't get stuck on a stray expression.
      const next = block.indexOf('\n', i);
      if (next < 0) break;
      i = next + 1;
      while (i < len && /\s/.test(block[i])) i++;
      continue;
    }
    const name = m[1];
    const openChar = m[2];
    const start = i;
    let depth = 0;
    let brace = 0;
    let bracket = 0;
    let inString = null;
    // Find the open paren/brace of the call body.
    let j = i + m[0].length - 1;
    let parenOpen = -1;
    let parenClose = -1;
    let bodyOpen = -1;
    let bodyClose = -1;
    if (openChar === '(') {
      parenOpen = j;
      const parenSplit = splitBody(block, parenOpen, '(', ')');
      if (parenSplit.end <= parenOpen) { i = len; break; }
      parenClose = parenSplit.end;
      // Optional trailing lambda after `)`.
      let k = parenClose + 1;
      while (k < len && /\s/.test(block[k])) k++;
      if (block[k] === '{') {
        bodyOpen = k;
        const bodySplit = splitBody(block, bodyOpen, '{', '}');
        if (bodySplit.end > bodyOpen) bodyClose = bodySplit.end;
      }
    } else {
      bodyOpen = j;
      const bodySplit = splitBody(block, bodyOpen, '{', '}');
      if (bodySplit.end > bodyOpen) bodyClose = bodySplit.end;
    }
    let end = start;
    if (parenClose > end) end = parenClose;
    if (bodyClose > end) end = bodyClose;
    if (end <= start) {
      // Could not find a balanced close - bail.
      i = len;
      break;
    }
    const raw = block.slice(start, end + 1);
    let ls = start;
    while (ls > 0 && block[ls - 1] !== '\n') ls--;
    statements.push({ text: raw.trim(), start, ls, indent: block.slice(ls, start) });
    i = end + 1;
    while (i < len && /\s/.test(block[i])) i++;
  }
  const children: any[] = [];
  for (const stmt of statements) {
    // absStart = content start; absLineStart = start including leading indent.
    const absStart = base + stmt.start;
    const absLineStart = base + stmt.ls;
    // Skip Kotlin non-Composable statements: `var x by remember`,
    // `val context = ...`, `if (...)`, `when (...)`, etc.
    const firstToken = stmt.text.match(/^([A-Za-z_]\w*)/);
    if (firstToken && KOTLIN_NON_COMPOSABLE_KEYWORDS.has(firstToken[1])) continue;
    // Skip lambda parameter prefixes like `padding ->`
    const lambdaParam = stmt.text.match(/^\w+\s*->/);
    if (lambdaParam) {
      // Re-parse the remainder after `->`
      const remainder = stmt.text.slice(lambdaParam[0].length).trim();
      if (remainder) {
        const child = parseStatement(remainder, absStart + lambdaParam[0].length, stmt.indent);
        if (child) {
          child._range = { start: absLineStart, end: absStart + remainder.length };
          child._indent = stmt.indent;
          children.push(child);
        }
      }
      continue;
    }
    const child = parseStatement(stmt.text, absStart, stmt.indent);
    if (child) {
      // Normalize the source anchor regardless of the parse path taken inside
      // parseStatement (some early returns skip setting _range). The range
      // starts at the LINE START (including leading indent) to match the block
      // parser, so a surgical replacement of the whole statement aligns.
      child._range = { start: absLineStart, end: absStart + stmt.text.trimEnd().length };
      child._indent = stmt.indent;
      children.push(child);
    }
  }
  return children;
};

const emptyTree = () => ({
  id: generateId(),
  type: 'Column',
  props: { width: 'match_parent', height: 'match_parent', padding: 0, spacing: 0, backgroundColor: 'transparent' },
  children: [],
});

/**
 * Extract non-Composable preamble declarations from a function body.
 * These are `var x by remember { ... }`, `val context = ...`, and
 * similar Kotlin declarations that must be preserved when the editor
 * rewrites the Composable body. Returns an array of raw strings.
 */
const extractPreamble = (body) => {
  if (!body) return [];
  const preamble = [];
  const len = body.length;
  let i = 0;
  while (i < len && /\s/.test(body[i])) i++;
  while (i < len) {
    const rest = body.slice(i);
    const firstToken = rest.match(/^([A-Za-z_]\w*)/);
    if (!firstToken) {
      const next = body.indexOf('\n', i);
      if (next < 0) break;
      i = next + 1;
      continue;
    }
    const token = firstToken[1];
    if (KOTLIN_NON_COMPOSABLE_KEYWORDS.has(token)) {
      // Walk past this statement (balanced parens/braces/brackets)
      let depth = 0;
      let brace = 0;
      let bracket = 0;
      let inStr = null;
      let j = i;
      while (j < len) {
        const ch = body[j];
        const prev = j > 0 ? body[j - 1] : '';
        if (inStr) {
          if (ch === inStr && prev !== '\\') inStr = null;
          j++;
          continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; j++; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === '{') brace++;
        else if (ch === '}') {
          brace--;
          if (brace < 0) break;
        }
        else if (ch === '[') bracket++;
        else if (ch === ']') bracket--;
        // End of statement: newline at depth 0
        if (ch === '\n' && depth === 0 && brace === 0 && bracket === 0) {
          preamble.push(body.slice(i, j).trim());
          i = j + 1;
          while (i < len && /\s/.test(body[i])) i++;
          break;
        }
        j++;
      }
      if (j >= len) {
        preamble.push(body.slice(i).trim());
        break;
      }
    } else {
      // This is a Composable call or uppercase call - skip past it
      const m = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*([({])/);
      if (!m) {
        const next = body.indexOf('\n', i);
        if (next < 0) break;
        i = next + 1;
        while (i < len && /\s/.test(body[i])) i++;
        continue;
      }
      const openChar = m[2];
      const open = i + m[0].length - 1;
      let end = open;
      if (openChar === '(') {
        const parsed = splitBody(body, open, '(', ')');
        end = parsed.end;
        // Check for trailing lambda
        let k = end + 1;
        while (k < len && /\s/.test(body[k])) k++;
        if (body[k] === '{') {
          const lambda = splitBody(body, k, '{', '}');
          end = lambda.end;
        }
      } else {
        const lambda = splitBody(body, open, '{', '}');
        end = lambda.end;
      }
      i = end + 1;
      while (i < len && /\s/.test(body[i])) i++;
    }
  }
  return preamble;
};

// The editor now parses rai --modern template bodies (Scaffold,
// TopAppBar, ElevatedCard, var by remember, Build.*, ...) into a
// real component tree. The old READ_ONLY_BODY_SENTINELS approach
// has been removed: instead of refusing to parse these bodies and
// returning an empty tree, the editor extracts the visual
// structure and preserves the preamble (var/val declarations) for
// re-emission.

/**
 * Find the body of a top-level @Composable fun <Name>(...) { ... }.
 * Returns { name, params, body, bodyStart, bodyEnd, sigStart } or null.
 * `bodyStart` and `bodyEnd` are indices in `source` of the opening
 * and closing braces of the body, so the caller can splice a new
 * body in place without re-emitting the rest of the file.
 */
const findComposableFunction = (source, name) => {
  // Walk top-level `fun <name>(` declarations. We don't require
  // the @Composable annotation to be the first thing on the line
  // because rai --modern wraps MainScreen in @OptIn(...) @Composable.
  // We just match `fun <Name>(` and verify that the same statement
  // group has a @Composable annotation in it.
  const funRe = new RegExp(`(?:^|\\n)\\s*(?:public\\s+|private\\s+|internal\\s+)?fun\\s+${name}\\s*\\(`, 'g');
  let m;
  while ((m = funRe.exec(source))) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const preceding = source.slice(Math.max(0, lineStart - 800), m.index);
    if (!/@Composable\b/.test(preceding)) continue;
    const open = m.index + m[0].length - 1;
    const parsed = splitBody(source, open, '(', ')');
    if (parsed.end <= open) continue;
    let idx = parsed.end + 1;
    while (idx < source.length && /\s/.test(source[idx])) idx++;
    if (source[idx] === ':') {
      const colonIdx = idx;
      let depth = 0;
      let found = -1;
      for (let i = colonIdx + 1; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '}' || ch === ')' || ch === ']') depth--;
        else if (ch === '{' && depth === 0) { found = i; break; }
        if (ch === '\n' && i - colonIdx > 200) { found = -1; break; }
      }
      if (found < 0) continue;
      idx = found;
    }
    if (source[idx] !== '{') continue;
    const bodyParsed = splitBody(source, idx, '{', '}');
    if (bodyParsed.end > idx) {
      return {
        name,
        params: parsed.body,
        body: bodyParsed.body,
        bodyStart: idx,
        bodyEnd: bodyParsed.end,
        sigStart: m.index,
      };
    }
  }
  return null;
};

const findSetContent = (source) => {
  // setContent can be called as `setContent { ... }` (no parens,
  // trailing lambda) or `setContent { ... }` with parens.
  const re = /\bsetContent\s*([({])/g;
  let m;
  while ((m = re.exec(source))) {
    const openChar = m[1];
    const open = m.index + m[0].length - 1;
    if (openChar === '(') {
      const parsed = splitBody(source, open, '(', ')');
      if (parsed.end > open) return { body: parsed.body, start: open, end: parsed.end };
    } else {
      const parsed = splitBody(source, open, '{', '}');
      if (parsed.end > open) return { body: parsed.body, start: open, end: parsed.end };
    }
  }
  return null;
};

const findFirstCallInBody = (body) => {
  const trimmed = body.trim();
  if (!trimmed) return null;
  // Match `Name` (with optional args) - the first non-whitespace
  // character after the name is either `(` (call with arguments) or
  // `{` (trailing lambda with no arguments, e.g. `AppTheme { ... }`).
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*([({])/);
  if (!match) return null;
  const name = match[1].split('.').pop();
  const openChar = match[2];
  const open = match.index + match[0].length - 1;
  let args = '';
  let bodyStart;
  if (openChar === '(') {
    const parsed = splitBody(trimmed, open, '(', ')');
    if (parsed.end <= open) return null;
    args = parsed.body;
    let idx = parsed.end + 1;
    while (idx < trimmed.length && /\s/.test(trimmed[idx])) idx++;
    if (trimmed[idx] !== '{') {
      // Plain call, no trailing lambda (e.g. `MainScreen()`).
      return { kind: 'call', name, lambdaBody: '' };
    }
    bodyStart = idx;
  } else {
    bodyStart = open;
  }
  const lambda = splitBody(trimmed, bodyStart, '{', '}');
  if (lambda.end <= bodyStart) return { kind: 'call', name, lambdaBody: '' };
  return { kind: 'call', name, lambdaBody: lambda.body };
};

/**
 * Walk the setContent body, peeling off wrapper calls (AppTheme,
 * Surface, ...) until we either hit a call to a top-level
 * @Composable function defined in the same file (return
 * { kind: 'user-function', name }) or a built-in Composable call
 * (return { kind: 'root-call', name, lambdaBody, callText }).
 * `user-function` is the standard rai template shape; `root-call`
 * is the fallback when the file has nothing but a Column { ... }
 * inside setContent.
 */
const resolveRoot = (source, setContentBody) => {
  let currentBody = setContentBody;
  for (let depth = 0; depth < 8; depth++) {
    const first = findFirstCallInBody(currentBody);
    if (!first) return null;
    if (WRAPPER_NAMES.has(first.name)) {
      if (!first.lambdaBody) return null;
      currentBody = first.lambdaBody;
      continue;
    }
    if (/^[A-Z]/.test(first.name)) {
      const def = findComposableFunction(source, first.name);
      if (def) return { kind: 'user-function', name: first.name, def };
      return { kind: 'root-call', name: first.name, callText: currentBody };
    }
    return { kind: 'root-call', name: first.name, callText: currentBody };
  }
  return null;
};

/**
 * Parse a *Activity.kt file. Returns the editor tree that
 * corresponds to the user-visible content of the Activity. If
 * the file has a MainScreen / AuthScreen / ... function that
 * setContent calls into, that function's body is the tree. If
 * not, the children of setContent are the tree.
 */
export const parseActivitySource = (source) => {
  if (!source) return { tree: emptyTree(), rootName: null, hasUserFunction: false, readOnly: false, preamble: [], body: '' };
  const setContent = findSetContent(source);
  if (!setContent) return { tree: emptyTree(), rootName: null, hasUserFunction: false, readOnly: false, preamble: [], body: '' };
  const resolved = resolveRoot(source, setContent.body);
  if (!resolved) return { tree: emptyTree(), rootName: null, hasUserFunction: false, readOnly: false, preamble: [], body: '' };
  const body = resolved.kind === 'user-function' ? resolved.def.body : setContent.body;
  // Extract preamble (var/val declarations) before parsing the visual
  // tree. The preamble is preserved by updateActivitySource so
  // `var counter by remember { ... }` survives re-sync.
  const preamble = extractPreamble(body);
  const children = parseChildrenBlock(body);
  let tree;
  if (children.length === 1) tree = children[0];
  else if (children.length > 1) {
    tree = {
      id: generateId(),
      type: 'Column',
      props: { width: 'match_parent', height: 'wrap_content', padding: 0, spacing: 0, backgroundColor: 'transparent' },
      children,
    };
  } else tree = emptyTree();
  return {
    tree,
    rootName: resolved.kind === 'user-function' ? resolved.def.name : (resolved.name || null),
    hasUserFunction: resolved.kind === 'user-function',
    readOnly: false,
    preamble,
    // The raw user-visible function body. Blocks are generated from this
    // body (not from the whole file) so the block editor sees the actual
    // @Composable content instead of wrapping the entire file in one blob.
    body,
  };
};

const propToModifier = (key, value) => {
  switch (key) {
    case 'width':
      if (value === 'match_parent') return 'fillMaxWidth()';
      if (value === 'wrap_content') return null;
      return `width(${value}.dp)`;
    case 'height':
      if (value === 'match_parent') return 'fillMaxHeight()';
      if (value === 'wrap_content') return null;
      return `height(${value}.dp)`;
    case 'padding': return value ? `padding(${value}.dp)` : null;
    case 'backgroundColor': return `background(composeColor("${escape(value)}"))`;
    case 'borderRadius': return `clip(RoundedCornerShape(${value}.dp))`;
    default: return null;
  }
};

const buildModifier = (props = {}) => {
  const calls = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || value === undefined || value === null) continue;
    const expr = propToModifier(key, value);
    if (expr) calls.push(expr);
  }
  if (!calls.length) return 'Modifier';
  return `Modifier.${calls.join('.')}`;
};

const componentToKotlin = (node, depth) => {
  if (!node) return '';
  const indent = '    '.repeat(depth);
  const props = node.props || {};
  const children = node.children || [];
  switch (node.type) {
    case 'Column': {
      const hAlign = props.horizontalAlignment === 'center' ? 'Alignment.CenterHorizontally'
        : props.horizontalAlignment === 'end' ? 'Alignment.End' : 'Alignment.Start';
      const vArrange = props.spacing ? `Arrangement.spacedBy(${props.spacing}.dp)` : 'Arrangement.Top';
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}Column(modifier = ${buildModifier(props)}, horizontalAlignment = ${hAlign}, verticalArrangement = ${vArrange}) {\n${inner}\n${indent}}`;
    }
    case 'Row': {
      const hArrange = props.spacing ? `Arrangement.spacedBy(${props.spacing}.dp)` : 'Arrangement.Start';
      const vAlign = props.verticalAlignment === 'center' ? 'Alignment.CenterVertically'
        : props.verticalAlignment === 'bottom' ? 'Alignment.Bottom' : 'Alignment.Top';
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}Row(modifier = ${buildModifier(props)}, horizontalArrangement = ${hArrange}, verticalAlignment = ${vAlign}) {\n${inner}\n${indent}}`;
    }
    case 'Box': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}Box(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'LazyColumn': {
      const items = children.map((c) => `${indent}    item {\n${componentToKotlin(c, depth + 2)}\n${indent}    }`).join('\n');
      return `${indent}LazyColumn(modifier = ${buildModifier(props)}) {\n${items}\n${indent}}`;
    }
    case 'Card': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}Card(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'ElevatedCard': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}ElevatedCard(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'Scaffold': {
      const topBarNode = props.topBar;
      const topBarCode = topBarNode ? `topBar = { ${componentToKotlin(topBarNode, 0).trim()} }` : '';
      const modifierCode = buildModifier(props);
      const scaffoldArgs = topBarCode
        ? `\n${indent}    ${topBarCode},\n${indent}    modifier = ${modifierCode},\n${indent}`
        : `modifier = ${modifierCode}`;
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}Scaffold(${scaffoldArgs}) { padding ->\n${inner}\n${indent}}`;
    }
    case 'TopAppBar': {
      const title = escape(props.title || 'MyApp');
      return `${indent}TopAppBar(title = { Text("${title}") })`;
    }
    case 'Text': {
      const text = escape(props.text || '');
      const size = props.textSize ? `, fontSize = ${props.textSize}.sp` : '';
      const weight = props.textStyle === 'bold' ? ', fontWeight = FontWeight.Bold' : '';
      const color = props.textColor ? `, color = composeColor("${escape(props.textColor)}")` : '';
      const align = props.textAlign === 'center' ? ', textAlign = TextAlign.Center'
        : props.textAlign === 'end' ? ', textAlign = TextAlign.End' : '';
      const style = props.textStyle === 'headline' ? ', style = MaterialTheme.typography.headlineSmall' : '';
      return `${indent}Text(text = "${text}"${size}${weight}${color}${align}${style})`;
    }
    case 'Button': {
      const bg = props.backgroundColor ? `, colors = ButtonDefaults.buttonColors(containerColor = composeColor("${escape(props.backgroundColor)}"))` : '';
      const onClick = props.onClick ? `onClick = { ${props.onClick} }` : 'onClick = {}';
      // If the button has children (parsed from trailing lambda),
      // emit them directly. Otherwise fall back to props.text.
      if (children.length) {
        const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
        return `${indent}Button(${onClick}, modifier = ${buildModifier(props)}${bg}) {\n${inner}\n${indent}}`;
      }
      const text = escape(props.text || '');
      return `${indent}Button(${onClick}, modifier = ${buildModifier(props)}${bg}) { Text("${text}") }`;
    }
    case 'OutlinedButton': {
      const onClick = props.onClick ? `onClick = { ${props.onClick} }` : 'onClick = {}';
      if (children.length) {
        const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
        return `${indent}OutlinedButton(${onClick}, modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
      }
      const text = escape(props.text || '');
      return `${indent}OutlinedButton(${onClick}, modifier = ${buildModifier(props)}) { Text("${text}") }`;
    }
    case 'OutlinedTextField': {
      const label = props.label ? `, label = { Text("${escape(props.label)}") }` : '';
      const hint = props.hint ? `, placeholder = { Text("${escape(props.hint)}") }` : '';
      const value = escape(props.text || '');
      return `${indent}OutlinedTextField(value = "${value}", onValueChange = {}, modifier = ${buildModifier(props)}${label}${hint})`;
    }
    case 'Image': {
      const w = props.width || 120;
      const h = props.height || 120;
      return `${indent}Box(modifier = Modifier.size(${w}.dp, ${h}.dp).background(composeColor("${escape(props.backgroundColor || '#E5E7EB')}")), contentAlignment = Alignment.Center) { Icon(Icons.Default.Image, contentDescription = null) }`;
    }
    case 'Checkbox': {
      const text = escape(props.text || '');
      return `${indent}Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked = ${Boolean(props.checked)}, onCheckedChange = {}); Text("${text}") }`;
    }
    case 'Switch': {
      const text = escape(props.text || '');
      return `${indent}Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) { Text("${text}"); Switch(checked = ${Boolean(props.checked)}, onCheckedChange = {}) }`;
    }
    case 'LinearProgressIndicator': {
      const value = Number(props.progress) || 0.5;
      return `${indent}LinearProgressIndicator(progress = ${value.toFixed(2)}f, modifier = ${buildModifier(props)})`;
    }
    case 'CircularProgressIndicator': {
      return `${indent}CircularProgressIndicator(modifier = ${buildModifier(props)})`;
    }
    case 'HorizontalDivider': {
      return `${indent}HorizontalDivider(thickness = ${(props.height || 1)}.dp${props.color ? `, color = composeColor("${escape(props.color)}")` : ''})`;
    }
    case 'Spacer': {
      return `${indent}Spacer(modifier = Modifier.height(${props.height || 16}.dp))`;
    }
    case 'Icon': {
      return `${indent}Icon(Icons.Default.${props.iconName || 'Favorite'}, contentDescription = null, modifier = Modifier.size(${props.size || 28}.dp), tint = composeColor("${escape(props.tint || '#4F46E5')}"))`;
    }
    case 'OutlinedCard': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}OutlinedCard(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'FilledTonalButton':
    case 'ElevatedButton':
    case 'TextButton':
    case 'FloatingActionButton': {
      const onClick = props.onClick ? `onClick = { ${props.onClick} }` : 'onClick = {}';
      if (children.length) {
        const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
        return `${indent}${node.type}(${onClick}, modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
      }
      const text = escape(props.text || '');
      return `${indent}${node.type}(${onClick}, modifier = ${buildModifier(props)}) { Text("${text}") }`;
    }
    case 'TextField': {
      const label = props.label ? `, label = { Text("${escape(props.label)}") }` : '';
      const hint = props.hint ? `, placeholder = { Text("${escape(props.hint)}") }` : '';
      const value = escape(props.text || '');
      return `${indent}TextField(value = "${value}", onValueChange = {}, modifier = ${buildModifier(props)}${label}${hint})`;
    }
    case 'IconButton': {
      const onClick = props.onClick ? `onClick = { ${props.onClick} }` : 'onClick = {}';
      if (children.length) {
        const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
        return `${indent}IconButton(${onClick}, modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
      }
      return `${indent}IconButton(${onClick}, modifier = ${buildModifier(props)}) { Icon(Icons.Default.${props.iconName || 'Favorite'}, contentDescription = null) }`;
    }
    case 'Badge': {
      const text = escape(props.text || '');
      if (children.length) {
        const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
        return `${indent}Badge(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
      }
      return `${indent}Badge(modifier = ${buildModifier(props)}) { Text("${text}") }`;
    }
    case 'LazyRow': {
      const items = children.map((c) => `${indent}    item {\n${componentToKotlin(c, depth + 2)}\n${indent}    }`).join('\n');
      return `${indent}LazyRow(modifier = ${buildModifier(props)}) {\n${items}\n${indent}}`;
    }
    case 'Surface': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}Surface(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'VerticalDivider': {
      return `${indent}VerticalDivider(modifier = ${buildModifier(props)})`;
    }
    case 'Slider': {
      return `${indent}Slider(value = ${Number(props.progress) || 0.5}f, onValueChange = {}, modifier = ${buildModifier(props)})`;
    }
    case 'RadioButton': {
      const text = escape(props.text || '');
      return `${indent}Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(selected = ${Boolean(props.checked || props.selected)}, onClick = {}); Text("${text}") }`;
    }
    case 'AssistChip':
    case 'SuggestionChip': {
      const label = escape(props.text || '');
      return `${indent}${node.type}(onClick = {}, modifier = ${buildModifier(props)}, label = { Text("${label}") })`;
    }
    case 'FilterChip':
    case 'InputChip': {
      const label = escape(props.text || '');
      return `${indent}${node.type}(selected = ${Boolean(props.selected)}, onClick = {}, modifier = ${buildModifier(props)}, label = { Text("${label}") })`;
    }
    case 'NavigationBar': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}NavigationBar(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'NavigationBarItem': {
      const label = escape(props.label || props.text || '');
      return `${indent}NavigationBarItem(selected = ${Boolean(props.selected)}, onClick = {}, modifier = ${buildModifier(props)}, icon = { Icon(Icons.Default.Home, contentDescription = null) }, label = { Text("${label}") })`;
    }
    case 'BottomAppBar': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}BottomAppBar(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'TabRow':
    case 'PrimaryTabRow':
    case 'SecondaryTabRow': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}${node.type}(selectedTabIndex = ${Number(props.selectedTabIndex) || 0}) {\n${inner}\n${indent}}`;
    }
    case 'Tab': {
      const label = escape(props.text || '');
      return `${indent}Tab(selected = ${Boolean(props.selected)}, onClick = {}, modifier = ${buildModifier(props)}, text = { Text("${label}") })`;
    }
    case 'AlertDialog': {
      const title = escape(props.title || '');
      const text = escape(props.text || '');
      return `${indent}AlertDialog(onDismissRequest = {}, confirmButton = { TextButton(onClick = {}) { Text("OK") } }, title = { Text("${title}") }, text = { Text("${text}") })`;
    }
    case 'DropdownMenu': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}DropdownMenu(expanded = true, onDismissRequest = {}, modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'DropdownMenuItem': {
      const label = escape(props.text || '');
      return `${indent}DropdownMenuItem(text = { Text("${label}") }, onClick = {}, modifier = ${buildModifier(props)})`;
    }
    case 'BasicTextField': {
      const value = escape(props.text || '');
      return `${indent}BasicTextField(value = "${value}", onValueChange = {}, modifier = ${buildModifier(props)})`;
    }
    case 'SelectableText': {
      const value = escape(props.text || '');
      return `${indent}SelectableText(value = "${value}", modifier = ${buildModifier(props)})`;
    }
    case 'ExtendedFloatingActionButton': {
      const text = escape(props.text || '');
      return `${indent}ExtendedFloatingActionButton(onClick = {}, icon = { Icon(Icons.Default.Add, contentDescription = null) }, text = { Text("${text}") }, modifier = ${buildModifier(props)})`;
    }
    case 'RangeSlider': {
      const s = Number(props.startValue) || 0.2; const e = Number(props.endValue) || 0.8;
      return `${indent}RangeSlider(value = ${s.toFixed(2)}f..${e.toFixed(2)}f, onValueChange = {}, modifier = ${buildModifier(props)})`;
    }
    case 'Snackbar': {
      const msg = escape(props.text || '');
      return `${indent}Snackbar(modifier = ${buildModifier(props)}) { Text("${msg}") }`;
    }
    case 'FlowRow': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}FlowRow(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'FlowColumn': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}FlowColumn(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'SegmentedButton': {
      const label = escape(props.text || '');
      return `${indent}SegmentedButton(selected = ${Boolean(props.selected)}, onClick = {}, modifier = ${buildModifier(props)}, label = { Text("${label}") })`;
    }
    case 'SingleChoiceSegmentedButtonRow': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}SingleChoiceSegmentedButtonRow(modifier = ${buildModifier(props)}) {\n${inner}\n${indent}}`;
    }
    case 'ModalNavigationDrawer': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}ModalNavigationDrawer(drawerContent = {\n${inner}\n${indent}} ) {\n${indent}    Text("content")\n${indent}}`;
    }
    case 'ModalDrawerSheet': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}ModalDrawerSheet {\n${inner}\n${indent}}`;
    }
    case 'NavigationDrawerItem': {
      const label = escape(props.text || props.label || '');
      return `${indent}NavigationDrawerItem(label = { Text("${label}") }, selected = ${Boolean(props.selected)}, onClick = {})`;
    }
    case 'ModalBottomSheet': {
      const inner = children.map((c) => componentToKotlin(c, depth + 1)).filter(Boolean).join('\n');
      return `${indent}ModalBottomSheet(onDismissRequest = {}) {\n${inner}\n${indent}}`;
    }
    case 'DatePicker': {
      return `${indent}DatePicker(state = rememberDatePickerState())`;
    }
    case 'SearchBar': {
      const query = escape(props.query || props.text || '');
      return `${indent}SearchBar(query = "${query}", onQueryChange = {}, onSearch = {}, active = false, onActiveChange = {})`;
    }
    default:
      return `${indent}Text("${escape(node.type || 'Unknown')}")`;
  }
};

/**
 * The editor never invents boilerplate. The rai template (or the
 * user) decides what the *Activity.kt file looks like. The editor
 * reads the file, finds the user-visible Composable, and replaces
 * only that body. If the file has no Composable yet (a fresh,
 * empty Activity created by the + button), the editor emits a
 * minimal Activity with setContent { <tree> } and nothing else -
 * no AppTheme wrapper, no remember state, no var counter.
 *
 * Returns { source, replaced, rootName }. If `replaced` is true
 * the source has been updated in place; the caller can just write
 * it back to disk. If `replaced` is false the file was not in a
 * shape the editor can edit (e.g. no setContent at all) and the
 * caller should leave the file alone.
 */
export const updateActivitySource = (originalSource, screen) => {
  if (!originalSource) return { source: originalSource, replaced: false, rootName: null };
  
  const tree = screen.rootComponent || emptyTree();
  const setContent = findSetContent(originalSource);
  if (!setContent) return { source: originalSource, replaced: false, rootName: null };
  const resolved = resolveRoot(originalSource, setContent.body);
  
  if (resolved && resolved.kind === 'user-function') {
    const def = resolved.def;
    // Извлекаем preamble из оригинального источника
    const preamble = (screen.preamble && screen.preamble.length)
      ? screen.preamble
      : extractPreamble(def.body);
    
    let newBody;
    if (screen._emitFrom === 'blocks' && screen.blocks && screen.blocks.length) {
      // Surgical edit (CodeAssist model): patch only the changed blocks in the
      // original body. The body already contains the remember-state declarations,
      // so they are preserved verbatim (or regenerated only if edited) and never
      // duplicated. Unchanged code outside the edited ranges stays byte-identical.
      const oldBlocks = generateBlocksFromSource(def.body);
      newBody = patchBody(def.body, oldBlocks, screen.blocks);
    } else if (screen._emitFrom === 'tree' && screen.rootComponent) {
      // Surgical design edit: patch only the changed design-tree nodes in the
      // original body. The old tree is the one currently parsed from the file
      // (its nodes carry `_range`/`_indent` anchors). Unchanged siblings,
      // container chrome, comments and preamble stay byte-for-byte intact.
      const oldParsed = parseActivitySource(originalSource);
      const oldTree = oldParsed.tree || emptyTree();
      newBody = patchTree(def.body, oldTree, screen.rootComponent);
    } else {
      const parts = [];
      for (const decl of preamble) parts.push('    ' + decl);
      parts.push(componentToKotlin(tree, 1));
      newBody = parts.join('\n');
    }
    
    // The function body already begins/ends right around the braces; avoid
    // adding a blank line from a leading/trailing newline carried over from the
    // original body (which the surgical patchers preserve verbatim).
    const spliced = newBody.replace(/^\n+/, '').replace(/\n+$/, '');
    const newSource = originalSource.slice(0, def.bodyStart + 1)
      + '\n' + spliced + '\n'
      + originalSource.slice(def.bodyEnd);
    return { source: newSource, replaced: true, rootName: def.name };
  }
  
  // No user function
  const inner = screen._emitFrom === 'blocks' && screen.blocks && screen.blocks.length
    ? patchBody(setContent.body, generateBlocksFromSource(setContent.body), screen.blocks)
    : componentToKotlin(tree, 4);
  const newBody = ` {\n${inner}\n        }`;
  const newSource = originalSource.slice(0, setContent.start)
    + 'setContent' + newBody
    + originalSource.slice(setContent.end + 1);
  return { source: newSource, replaced: true, rootName: null };
};

/**
 * Compatibility shim: callers that want a brand-new *Activity.kt
 * file (e.g. the + button in the editor) can still get one.
 * The result is intentionally minimal: just the class, the
 * onCreate, and a setContent { <tree> } - no AppTheme, no Surface,
 * no MainScreen, no var counter. The rai template that the user
 * actually wants lives in their first project; subsequent edits
 * patch it, not this stub.
 */
export const buildActivitySource = (screen, project) => {
  const pkg = project?.packageName || 'com.example.app';
  const activityName = screen.name;
  
  // Generate code from blocks if available, otherwise from component tree
  let inner;
  let smartImports = '';
  
  if (screen.blocks && screen.blocks.length > 0) {
    // Generate from visual blocks with smart imports
    const blockCode = generateCodeFromBlocks(screen.blocks, 3);
    inner = blockCode;
    smartImports = generateImportsFromBlocks(screen.blocks);
  } else {
    // Generate from component tree
    const tree = screen.rootComponent || emptyTree();
    inner = componentToKotlin(tree, 3);
    smartImports = `import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier`;
  }
  
  return `package ${pkg}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
${smartImports}
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.foundation.isSystemInDarkTheme

class ${activityName}Activity : ComponentActivity() {
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
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) darkColorScheme() else lightColorScheme(),
        content = content
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(showBackground = true, showSystemUi = true, name = "${activityName} Preview")
@Composable
fun MainScreen() {
${inner}
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
    }
}
`;
};

/**
 * Add or update an `<activity>` entry in AndroidManifest.xml.
 */
export const upsertActivityInManifest = (manifestText, packageName, activityNames) => {
  if (!manifestText) return manifestText;
  const applicationStart = manifestText.indexOf('<application');
  if (applicationStart < 0) return manifestText;
  const applicationEnd = manifestText.lastIndexOf('</application>');
  if (applicationEnd < 0) return manifestText;
  const openTagMatch = manifestText.slice(applicationStart).match(/<application[^>]*>/);
  if (!openTagMatch) return manifestText;
  const openTag = openTagMatch[0];
  const inner = manifestText.slice(applicationStart + openTag.length, applicationEnd);
  const stripped = inner.replace(/<activity[\s\S]*?<\/activity>|<activity[^>]*\/>/g, '');
  const newActivities = activityNames.map((name, index) => {
    const isMain = index === 0;
    const filter = isMain
      ? `\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>`
      : '';
    return `        <activity\n            android:name=".${name}Activity"${filter}\n            android:exported="true" />`;
  }).join('\n');
  const newApplication = `${openTag}\n${stripped.trim() ? stripped + '\n' : ''}${newActivities}\n    </application>`;
  return manifestText.slice(0, applicationStart) + newApplication + manifestText.slice(applicationEnd + '</application>'.length);
};

/**
 * Pull the current list of `*Activity.kt` files from the rai
 * project and parse each into an editor screen record.
 */
export const loadRaiActivities = async (project) => {
  if (!project) return [];
  const sourceRoot = getSourceRoot(project);
  const result = await execute(
    `find ${sourceRoot} -maxdepth 1 -name '*Activity.kt' -type f 2>/dev/null | sort`,
    project.projectDir,
  );
  const files = (result.output || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const activities = [];
  const { readWorkspaceFile } = await import('./workspace');
  for (const filePath of files) {
    const nameMatch = filePath.match(/\/([A-Za-z0-9_]+)Activity\.kt$/);
    if (!nameMatch) continue;
    const activityName = nameMatch[1];
    const relative = filePath.startsWith(sourceRoot) ? filePath : filePath;
    const read = await readWorkspaceFile(project, relative);
    if (!read.success) continue;
    const parsed = parseActivitySource(read.output);
    activities.push({
      id: `act-${activityName.toLowerCase()}`,
      name: activityName,
      fileName: `${activityName}Activity.kt`,
      packagePath: '',
      rootComponent: parsed.tree,
      source: read.output,
      blocks: generateBlocksFromSource(parsed.body),
      readOnly: parsed.readOnly === true,
      hasUserFunction: parsed.hasUserFunction === true,
      rootName: parsed.rootName || null,
      preamble: parsed.preamble || [],
    });
  }
  return activities;
};

/**
 * Collect the file's own top-level @Composable functions (besides known
 * components and wrappers), keyed by name -> findComposableFunction result.
 * Used by [expandUserComposables] to inline helper composables like HeroCard(),
 * CounterButtons(...), Tag(...) so the preview shows their real content.
 */
const collectUserComposables = (source) => {
  const fns = {};
  const re = /(?:^|\n)\s*(?:public\s+|private\s+|internal\s+)?fun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    if (COMPONENT_BY_KOTLIN[name] || WRAPPER_NAMES.has(name)) continue;
    const def = findComposableFunction(source, name);
    if (def) fns[name] = def;
  }
  return fns;
};

const callArgsOf = (stmt) => {
  const m = String(stmt || '').match(/^[A-Za-z][A-Za-z0-9_.]*\s*\(\s*([\s\S]*)\)\s*$/);
  return m ? splitTopLevelCommas(m[1]) : [];
};

const paramNamesOf = (params) =>
  splitTopLevelCommas(params).map((p) => p.split(':')[0].trim()).filter(Boolean);

/**
 * Replace simple literal parameters (string/number/boolean) in a helper's body
 * so `Tag("Material 3")` renders the real text. Skips non-literal args and
 * avoids clobbering parameter labels (`text =` is left untouched).
 */
const substituteLiterals = (body, params, argMap) => {
  let out = body;
  for (const name of paramNamesOf(params)) {
    const v = (argMap[name] || '').trim();
    if (!/^"|^'|^-?\d|^true$|^false$|^0x/.test(v)) continue;
    const re = new RegExp('(?<![.\\w])' + name.replace(/[$]/g, '\\$&') + '(?!\\s*=)', 'g');
    out = out.replace(re, v);
  }
  return out;
};

/**
 * Inline user-defined @Composable helper functions into the preview tree so the
 * rendered preview matches the compiled app (which inlines them by calling them).
 * A helper call node (e.g. type 'HeroCard') is replaced by its parsed body.
 * Depth-guarded to avoid infinite recursion on self/mutually recursive helpers.
 */
export const expandUserComposables = (source, tree) => {
  if (!source || !tree) return tree;
  const fns = collectUserComposables(source);
  if (Object.keys(fns).length === 0) return tree;

  const parseBodyToNode = (fn, argMap) => {
    const body = substituteLiterals(fn.body, fn.params, argMap);
    const children = parseChildrenBlock(body, 0);
    if (children.length === 1) return children[0];
    if (children.length > 1) {
      return { id: generateId(), type: 'Column', props: {}, children };
    }
    return null;
  };

  const walk = (node, depth) => {
    if (!node) return null;
    if (depth > 8) return node;
    const fn = fns[node.type];
    if (fn) {
      const args = callArgsOf(node.props?.text);
      const argMap = {};
      let pos = 0;
      const names = paramNamesOf(fn.params);
      for (const a of args) {
        const eq = a.indexOf('=');
        if (eq > 0 && !a.startsWith('"') && !a.startsWith("'")) {
          argMap[a.slice(0, eq).trim()] = a.slice(eq + 1).trim();
        } else if (pos < names.length) {
          argMap[names[pos]] = a.trim();
          pos++;
        }
      }
      const sub = parseBodyToNode(fn, argMap);
      if (sub) return walk(sub, depth + 1);
    }
    if (Array.isArray(node.children)) {
      return { ...node, children: node.children.map((c) => walk(c, depth + 1)).filter(Boolean) };
    }
    return node;
  };

  return walk(tree, 0);
};
