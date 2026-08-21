/**
 * Стаб нативного shell-моста для тестов на Node: исполнители команд — no-op,
 * shellQuote — настоящий (та же реализация, что в src/utils/workspace).
 */
export const shellQuote = (value = '') => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;

export const execute = async (_command: string, _workDir?: string) => ({
  success: true,
  exitCode: 0,
  output: '',
});

export const streamExecute = async (_command: string, _workDir: string | undefined, _onLine: (line: string) => void) => ({
  success: true,
  exitCode: 0,
  output: '',
});

export const persistentStreamExecute = streamExecute;
export const isAvailable = () => false;
export const hasShell = () => false;
export const hasApt = () => false;
