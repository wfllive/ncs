/**
 * Project file explorer helpers.
 *
 * Lists and reads/writes arbitrary files inside the rai project directory
 * (the same Ubuntu workspace the editor already reads screens from). This is
 * what lets the editor browse and edit any project file (screens, theme,
 * gradle, manifest, ...), not just *Activity.kt screens.
 */
import { execute } from './shellExecutor';
import { getProjectDir } from '../config/runtime';
import { readWorkspaceFile, writeWorkspaceFile } from './workspace';

/**
 * List all editable project files as { path, name, dir, ext }.
 * `path` is relative to the project root; `dir` is the directory part.
 */
export const listProjectFiles = async (project) => {
  if (!project) return [];
  const cwd = getProjectDir(project);
  const result = await execute(
    `find . -type f \\( -name '*.jsx' -o -name '*.js' -o -name '*.tsx' -o -name '*.ts' -o -name '*.css' -o -name '*.html' -o -name '*.sh' -o -name '*.json' -o -name '*.md' -o -name '*.txt' -o -name '*.properties' -o -name '*.xml' \\) 2>/dev/null | grep -vE '/(build|\\.gradle|\\.idea|node_modules|dist)/' | sort`,
    cwd,
  );
  const files = (result.output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '.' && line !== './')
    .map((line) => {
      const clean = line.replace(/^\.\//, '');
      const parts = clean.split('/');
      const name = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join('/');
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot + 1) : '';
      return { path: clean, name, dir, ext };
    });
  return files;
};

/**
 * Build a nested tree from a flat file list. Returns a tree where each node is
 * { name, path, isDir, children }. Used by the explorer to render folders.
 */
export const buildFileTree = (files) => {
  const root = { name: '', path: '', isDir: true, children: [] };
  const dirMap = { '': root };
  const getDir = (dirPath) => {
    if (dirMap[dirPath]) return dirMap[dirPath];
    const parts = dirPath.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!dirMap[acc]) {
        const node = { name: part, path: acc, isDir: true, children: [] };
        dirMap[acc] = node;
        cur.children.push(node);
      }
      cur = dirMap[acc];
    }
    return cur;
  };
  for (const file of files) {
    const dir = getDir(file.dir);
    dir.children.push({ name: file.name, path: file.path, isDir: false, ext: file.ext });
  }
  // Sort: dirs first, then files, alphabetical.
  const sort = (node) => {
    if (!node.children || !node.children.length) return;
    node.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
};

/** Read a file's text content (relative to project root). */
export const readProjectFile = async (project, path) => readWorkspaceFile(project, path);

/** Write a file's text content (relative to project root). */
export const writeProjectFile = async (project, path, content) => writeWorkspaceFile(project, path, content);

export default listProjectFiles;
