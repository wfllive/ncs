/**
 * JS / JSX import manager for React projects.
 * Replaces Kotlin import logic.
 */

export const KNOWN_IMPORTS = {
  React: 'react',
  useState: 'react',
  useEffect: 'react',
  useRef: 'react',
  useMemo: 'react',
};

// No-op for React: Vite handles imports via npm. We keep API for EditorScreen.
export const findMissingImports = (source = '') => {
  if (!source) return { missing: [], count: 0 };
  // React JSX needs React import if file contains JSX but no import
  const hasJSX = /<\s*[A-Za-z]/.test(source) || /React\./.test(source);
  const hasReactImport = /import\s+.*from\s+['"]react['"]/.test(source);
  if (hasJSX && !hasReactImport) {
    return { missing: ["import React from 'react'"], count: 1 };
  }
  return { missing: [], count: 0 };
};

export const addMissingImports = (source = '', missing = []) => {
  if (!source || !missing.length) return source;
  const lines = source.split('\n');
  // insert after existing imports or at top
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) idx = i + 1;
    else if (i===0 && /^\s*['"]use strict['"]/.test(lines[i])) idx = i+1;
  }
  while (idx < lines.length && lines[idx].trim() === '') idx++;
  const block = missing.join('\n') + '\n';
  lines.splice(idx, 0, block);
  return lines.join('\n');
};

export const fileStats = (source = '') => {
  const text = source || '';
  const linesArr = text ? text.split('\n') : [];
  const lineCount = linesArr.length ? (text.endsWith('\n') ? linesArr.length - 1 : linesArr.length) : 0;
  const nonEmpty = linesArr.filter(l=>l.trim().length>0).length;
  const chars = text.length;
  let bytes = chars;
  try { bytes = new TextEncoder().encode(text).length; } catch(e){}
  const tabIndented = /(^|\n)\t/.test(text);
  const spaceIndented = /(^|\n) {2,}/.test(text);
  const indentation = tabIndented && !spaceIndented ? 'tabs' : spaceIndented ? 'spaces' : 'mixed';
  return { lineCount, nonEmpty, chars, bytes, indentation };
};

export default findMissingImports;
