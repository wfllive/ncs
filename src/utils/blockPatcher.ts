/**
 * Surgical block -> code updater (CodeAssist model).
 *
 * CodeAssist's rule: the source text is the single source of truth; blocks are
 * a projection of it anchored to text ranges; an edit is a *minimal* text-range
 * patch (`DocumentEdit`) that leaves everything outside the touched range
 * byte-for-byte intact. `serialize` reconstructs only created/edited nodes.
 *
 * `patchBody(originalBody, oldBlocks, newBlocks)` applies that here:
 *   - a block that is identical in old and new keeps its exact original text;
 *   - a block whose header/inputs changed is regenerated (only that statement);
 *   - a container whose children changed is patched recursively so its chrome
 *     and its unchanged siblings stay verbatim;
 *   - inserted blocks are added, deleted blocks removed.
 * Everything outside the edited ranges is preserved exactly.
 */
import { generateCodeFromBlocks } from './blockToCode';

const stripNode = (b) => (b
  ? { definitionId: b.definitionId, inputs: b.inputs || {}, children: stripChildren(b.children) }
  : null);
const stripChildren = (ch) => {
  const o = {};
  for (const k of Object.keys(ch || {})) o[k] = (ch[k] || []).map(stripNode);
  return o;
};
const sig = (b) => JSON.stringify(stripNode(b));
const sameDefInputs = (a, b) => a && b && a.definitionId === b.definitionId
  && JSON.stringify(a.inputs || {}) === JSON.stringify(b.inputs || {});
const sameChildren = (a, b) => JSON.stringify(stripChildren(a.children)) === JSON.stringify(stripChildren(b.children));

/** Re-serialize a single block with its leading indent applied to every line. */
const serializeBlock = (block, indent = '') => {
  const code = generateCodeFromBlocks([block], 0);
  if (!code) return '';
  return code.split('\n').map((l) => (l ? indent + l : l)).join('\n');
};

/** Extend a delete range past the trailing newline so no blank line remains. */
const deleteEnd = (text, start, end) => {
  let e = end;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
  if (e < text.length && text[e] === '\r') e++;
  if (e < text.length && text[e] === '\n') e++;
  else e = end;
  return e;
};

/**
 * Collect edits for one statement pair. `containerStart` is the absolute offset
 * of the container (0 at top level); edits are recorded relative to it. `indent`
 * is the fallback indent for inserted blocks.
 */
const editsForStatement = (oldB, newB, body, containerStart, indent, edits) => {
  const rel = (pos) => pos - containerStart;
  if (oldB && newB) {
    if (oldB.definitionId === newB.definitionId
        && JSON.stringify(oldB.inputs || {}) === JSON.stringify(newB.inputs || {})) {
      // Same definition + inputs: only children can differ. Recurse if they do;
      // otherwise reuse the original text (no edit).
      if (!sameChildren(oldB, newB)) {
        const slots = new Set([...Object.keys(oldB.children || {}), ...Object.keys(newB.children || {})]);
        for (const slot of slots) {
          editsForChildren(oldB.children[slot] || [], newB.children[slot] || [], body, containerStart, indent, edits);
        }
      }
      return;
    }
    // Header/type changed: replace the whole statement.
    edits.push({
      start: rel(oldB._range.start),
      end: rel(oldB._range.end),
      text: serializeBlock(newB, oldB._indent || newB._indent || indent),
    });
    return;
  }
  if (newB) {
    edits.push({ start: 0, end: 0, text: '', _insert: true, _block: newB, _indent: indent });
    return;
  }
  if (oldB) {
    edits.push({
      start: rel(oldB._range.start),
      end: deleteEnd(body, oldB._range.start, oldB._range.end) - containerStart,
      text: '',
    });
  }
};

const editsForChildren = (oldList, newList, body, containerStart, indent, edits) => {
  const rel = (pos) => pos - containerStart;
  const oldSigs = oldList.map(sig);
  const newSigs = newList.map(sig);
  const oldUsed = oldList.map(() => false);
  const newMatchOld = newList.map(() => -1);
  const newIsInsert = newList.map(() => true);

  // Pass 1: exact content match -> reuse original text (no edit).
  for (let j = 0; j < newList.length; j++) {
    for (let i = 0; i < oldList.length; i++) {
      if (!oldUsed[i] && oldSigs[i] === newSigs[j]) { oldUsed[i] = true; newMatchOld[j] = i; newIsInsert[j] = false; break; }
    }
  }
  // Pass 2: structural sibling (same definition kind) -> this block CHANGED and
  // must replace its old counterpart (editsForStatement will regenerate it).
  for (let j = 0; j < newList.length; j++) {
    if (!newIsInsert[j]) continue;
    for (let i = 0; i < oldList.length; i++) {
      if (!oldUsed[i] && oldList[i].definitionId === newList[j].definitionId) {
        oldUsed[i] = true; newMatchOld[j] = i; newIsInsert[j] = false; break;
      }
    }
  }

  const pending = [];
  for (let j = 0; j < newList.length; j++) {
    const newB = newList[j];
    if (!newIsInsert[j]) {
      editsForStatement(oldList[newMatchOld[j]], newB, body, containerStart, indent, edits);
    } else {
      // Inserted: anchor before the next un-used old sibling in this slot.
      let anchor = -1;
      for (let i = 0; i < oldList.length; i++) {
        if (!oldUsed[i]) { anchor = oldList[i]._range.start - containerStart; break; }
      }
      if (anchor < 0) {
        // append after the last child in the slot (end of old list region)
        anchor = oldList.length ? rel(oldList[oldList.length - 1]._range.end) : 0;
        pending.push({ anchor, insert: true, text: '\n' + serializeBlock(newB, indent) });
      } else {
        pending.push({ anchor, insert: true, text: serializeBlock(newB, indent) + '\n' });
      }
    }
  }
  // Deleted children: old blocks never matched.
  for (let i = 0; i < oldList.length; i++) {
    if (!oldUsed[i]) {
      edits.push({
        start: oldList[i]._range.start - containerStart,
        end: deleteEnd(body, oldList[i]._range.start, oldList[i]._range.end) - containerStart,
        text: '',
      });
    }
  }
  for (const p of pending) {
    if (p.insert) edits.push({ start: p.anchor, end: p.anchor, text: p.text });
  }
};

/**
 * Patch the function body from old -> new blocks. Returns the new body text.
 * Unchanged blocks are preserved byte-for-byte; only touched ranges change.
 */
export const patchBody = (originalBody, oldBlocks, newBlocks) => {
  if (!originalBody) return originalBody;
  if (!newBlocks || newBlocks.length === 0) return '';
  const edits = [];
  editsForChildren(oldBlocks, newBlocks, originalBody, 0, '    ', edits);

  // Apply edits from the end of the source toward the start so earlier offsets
  // stay valid.
  edits.sort((a, b) => (b.start - a.start) || (b.end - a.end));
  let result = originalBody;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.text + result.slice(e.end);
  }
  return result;
};

export default patchBody;
