import { execute } from './shellExecutor';
import { getProjectDir } from '../config/runtime';

export const shellQuote = (value = '') => `'${String(value).replace(/'/g, `'"'"'`)}'`;

export const readWorkspaceJson = async (project, fileName) => {
  const result = await execute(`cat ${shellQuote(fileName)}`, getProjectDir(project));
  if (!result?.success) throw new Error(result?.output || `Cannot read ${fileName}`);
  return JSON.parse(result.output);
};

const toBase64 = (content) => {
  const bytes = unescape(encodeURIComponent(content));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes.charCodeAt(index);
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes.charCodeAt(index + 1) : 0;
    const c = hasC ? bytes.charCodeAt(index + 2) : 0;
    const value = (a << 16) | (b << 8) | c;
    result += alphabet[(value >> 18) & 63];
    result += alphabet[(value >> 12) & 63];
    result += hasB ? alphabet[(value >> 6) & 63] : '=';
    result += hasC ? alphabet[value & 63] : '=';
  }
  return result;
};

export const writeWorkspaceFile = async (project, fileName, content) => {
  const encoded = toBase64(content);
  const command = `mkdir -p "$(dirname ${shellQuote(fileName)})" && printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(fileName)}`;
  return execute(command, getProjectDir(project));
};

export const writeWorkspaceJson = (project, fileName, value) => writeWorkspaceFile(project, fileName, `${JSON.stringify(value, null, 2)}\n`);

export const readWorkspaceFile = async (project, fileName) => {
  const result = await execute(`cat ${shellQuote(fileName)} 2>/dev/null || true`, getProjectDir(project));
  if (!result?.output) return { success: false, output: `Cannot read ${fileName}` };
  return { success: true, output: result.output };
};

export const removeWorkspaceFile = async (project, fileName) => {
  return execute(`rm -f ${shellQuote(fileName)}`, getProjectDir(project));
};

export const ensureWorkspaceDir = async (project, dir) => {
  return execute(`mkdir -p ${shellQuote(dir)}`, getProjectDir(project));
};
