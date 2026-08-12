/**
 * Surgical design-tree -> code updater (CodeAssist model).
 *
 * Symmetric to blockPatcher, but works on the design tree
 * (`{ type, props, children }` with `_range`/`_indent` anchors) instead of the
 * block list. `patchTree` replaces only the tree nodes the user changed in the
 * body, leaving every untouched byte (container chrome, other siblings,
 * comments, custom code) byte-for-byte intact.
 */

const stripNode = (n) => (n
  ? { type: n.type, props: n.props || {}, children: (n.children || []).map(stripNode) }
  : null);
const sig = (n) => JSON.stringify(stripNode(n));
const sameChildren = (a, b) => JSON.stringify((a.children || []).map(stripNode)) === JSON.stringify((b.children || []).map(stripNode));

/** Serialize a tree node to Kotlin with its leading indent applied to every line. */
const serializeNode = (node, indent = '') => {
  const code = nodeToKotlin(node);
  if (!code) return '';
  return code.split('\n').map((l) => (l ? indent + l : l)).join('\n');
};

/**
 * Convert a single design-tree node back to Kotlin. This is a lightweight
 * re-emitter that stays structurally close to the node model. For nodes the
 * editor can render this reproduces the original shape.
 */
const nodeToKotlin = (node) => {
  if (!node) return '';
  const { type, props = {}, children = [] } = node;
  const mod = buildModifierString(props);
  switch (type) {
    case 'Column': {
      const hAlign = props.horizontalAlignment === 'center' ? 'Alignment.CenterHorizontally'
        : props.horizontalAlignment === 'end' ? 'Alignment.End' : 'Alignment.Start';
      const vArrange = props.spacing ? `Arrangement.spacedBy(${props.spacing}.dp)` : 'Arrangement.Top';
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const modArg = mod ? `modifier = ${mod}, ` : '';
      return `Column(${modArg}horizontalAlignment = ${hAlign}, verticalArrangement = ${vArrange}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'Row': {
      const hArrange = props.spacing ? `Arrangement.spacedBy(${props.spacing}.dp)` : 'Arrangement.Start';
      const vAlign = props.verticalAlignment === 'center' ? 'Alignment.CenterVertically'
        : props.verticalAlignment === 'bottom' ? 'Alignment.Bottom' : 'Alignment.Top';
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const modArg = mod ? `modifier = ${mod}, ` : '';
      return `Row(${modArg}horizontalArrangement = ${hArrange}, verticalAlignment = ${vAlign}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'Box': {
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const contentAlignment = props.contentAlignment ? `, contentAlignment = Alignment.${props.contentAlignment}` : '';
      const modArg = mod ? `modifier = ${mod}` : '';
      return `Box(${modArg}${contentAlignment}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'Text': {
      const text = props.text || '';
      const size = props.textSize ? `, fontSize = ${props.textSize}.sp` : '';
      const weight = props.textStyle === 'bold' ? ', fontWeight = FontWeight.Bold' : '';
      const color = props.textColor ? `, color = composeColor("${props.textColor}")` : '';
      const style = props.textStyle === 'headline' ? ', style = MaterialTheme.typography.headlineSmall' : '';
      return `Text("${text}"${size}${weight}${color}${style})`;
    }
    case 'Button': {
      const onClick = props.onClick ? `onClick = { ${props.onClick} }` : 'onClick = {}';
      const bg = props.backgroundColor ? `, colors = ButtonDefaults.buttonColors(containerColor = composeColor("${props.backgroundColor}"))` : '';
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const extras = (mod ? `, modifier = ${mod}` : '') + bg;
      return `Button(${onClick}${extras}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'OutlinedButton': {
      const onClick = props.onClick ? `onClick = { ${props.onClick} }` : 'onClick = {}';
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const extras = mod ? `, modifier = ${mod}` : '';
      return `OutlinedButton(${onClick}${extras}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'ElevatedCard': {
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const modArg = mod ? `modifier = ${mod}` : '';
      return `ElevatedCard(${modArg}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'Card': {
      const inner = children.map((c) => nodeToKotlin(c)).filter(Boolean).join('\n');
      const modArg = mod ? `modifier = ${mod}` : '';
      return `Card(${modArg}) {\n${indentLines(inner, '    ')}\n}`;
    }
    case 'TopAppBar': {
      return `TopAppBar(title = { Text("${props.title || ''}") })`;
    }
    case 'Spacer': {
      return `Spacer(modifier = Modifier.height(${props.height || 16}.dp))`;
    }
    case 'HorizontalDivider': {
      return `HorizontalDivider(thickness = ${props.height || 1}.dp)`;
    }
    default:
      return null;
  }
};

const indentLines = (str, pad) => str.split('\n').map((l) => (l ? pad + l : l)).join('\n');

const buildModifierString = (props: Record<string, any> = {}) => {
  const calls = [];
  if (props.width === 'match_parent') calls.push('fillMaxWidth()');
  else if (typeof props.width === 'number') calls.push(`width(${props.width}.dp)`);
  if (props.height === 'match_parent') calls.push('fillMaxHeight()');
  else if (typeof props.height === 'number') calls.push(`height(${props.height}.dp)`);
  if (props.padding) calls.push(`padding(${props.padding}.dp)`);
  if (props.backgroundColor) calls.push(`background(composeColor("${props.backgroundColor}"))`);
  if (props.borderRadius) calls.push(`clip(RoundedCornerShape(${props.borderRadius}.dp))`);
  return calls.length ? `Modifier.${calls.join('.')}` : '';
};

const deleteEnd = (text, start, end) => {
  let e = end;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
  if (e < text.length && text[e] === '\r') e++;
  if (e < text.length && text[e] === '\n') e++;
  else e = end;
  return e;
};

const editsForNode = (oldN, newN, body, base, indent, edits) => {
  const rel = (pos) => pos - base;
  if (oldN && newN) {
    if (oldN.type === newN.type && JSON.stringify(oldN.props || {}) === JSON.stringify(newN.props || {})) {
      if (!sameChildren(oldN, newN)) {
        editsForChildren(oldN.children || [], newN.children || [], body, base, indent, edits);
      }
      return;
    }
    const ser = serializeNode(newN, oldN._indent || newN._indent || indent);
    if (ser) {
      edits.push({ start: rel(oldN._range.start), end: rel(oldN._range.end), text: ser });
    }
    return;
  }
  if (newN) {
    const ser = serializeNode(newN, indent);
    if (ser) edits.push({ start: rel(newN._range ? newN._range.start : 0), end: rel(newN._range ? newN._range.start : 0), text: ser + '\n' });
    return;
  }
  if (oldN) {
    edits.push({
      start: rel(oldN._range.start),
      end: deleteEnd(body, oldN._range.start, oldN._range.end) - base,
      text: '',
    });
  }
};

const editsForChildren = (oldList, newList, body, base, indent, edits) => {
  const rel = (pos) => pos - base;
  const oldSigs = oldList.map(sig);
  const newSigs = newList.map(sig);
  const oldUsed = oldList.map(() => false);
  const newMatch = newList.map(() => -1);
  const newIsInsert = newList.map(() => true);

  for (let j = 0; j < newList.length; j++) {
    for (let i = 0; i < oldList.length; i++) {
      if (!oldUsed[i] && oldSigs[i] === newSigs[j]) { oldUsed[i] = true; newMatch[j] = i; newIsInsert[j] = false; break; }
    }
  }
  for (let j = 0; j < newList.length; j++) {
    if (!newIsInsert[j]) continue;
    for (let i = 0; i < oldList.length; i++) {
      if (!oldUsed[i] && oldList[i].type === newList[j].type) { oldUsed[i] = true; newMatch[j] = i; newIsInsert[j] = false; break; }
    }
  }

  for (let j = 0; j < newList.length; j++) {
    if (!newIsInsert[j]) editsForNode(oldList[newMatch[j]], newList[j], body, base, indent, edits);
  }
  // Deleted
  for (let i = 0; i < oldList.length; i++) {
    if (!oldUsed[i]) edits.push({ start: rel(oldList[i]._range.start), end: deleteEnd(body, oldList[i]._range.start, oldList[i]._range.end) - base, text: '' });
  }
  // Inserted
  for (let j = 0; j < newList.length; j++) {
    if (newIsInsert[j]) {
      let anchor = -1;
      for (let i = 0; i < oldList.length; i++) {
        if (!oldUsed[i]) { anchor = rel(oldList[i]._range.start); break; }
      }
      if (anchor < 0) {
        anchor = oldList.length ? rel(oldList[oldList.length - 1]._range.end) : rel(base);
        const ser = serializeNode(newList[j], indent);
        edits.push({ start: anchor, end: anchor, text: (ser ? '\n' + ser : '') });
      } else {
        const ser = serializeNode(newList[j], indent);
        edits.push({ start: anchor, end: anchor, text: (ser ? ser + '\n' : '') });
      }
    }
  }
};

/**
 * Patch the function body from old -> new design tree.
 *
 * The tree may be a single real node (it carries a `_range`) or a synthetic
 * root Column that wraps several top-level statements (it has no `_range`).
 * - real node: `editsForNode` recurses into children; a changed node is
 *   regenerated, unchanged children and container chrome stay verbatim;
 * - synthetic root: its children are patched as a top-level list.
 * Unchanged nodes are preserved byte-for-byte; only changed subtrees are
 * regenerated.
 */
export const patchTree = (body, oldTree, newTree) => {
  if (!body) return body;
  if (!newTree) return '';
  const edits = [];
  const synthetic = (t) => t && t._range == null;
  if (!synthetic(oldTree) && !synthetic(newTree) && oldTree && newTree) {
    editsForNode(oldTree, newTree, body, 0, oldTree._indent || '    ', edits);
  } else {
    editsForChildren(
      (oldTree && !synthetic(oldTree) ? [oldTree] : (oldTree ? oldTree.children || [] : [])),
      (newTree && !synthetic(newTree) ? [newTree] : (newTree ? newTree.children || [] : [])),
      body, 0, '    ', edits,
    );
  }

  edits.sort((a, b) => (b.start - a.start) || (b.end - a.end));
  let result = body;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.text + result.slice(e.end);
  }
  return result;
};

export default patchTree;
