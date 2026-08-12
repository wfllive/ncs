/** Native shell bridge used by the Ubuntu Android/Gradle workspace. */
let apt = null;
let termux = null;
try { apt = require('../../modules/apt-manager/src/index'); } catch (error) {}
try { termux = require('../../modules/termux-terminal/src/index'); } catch (error) {}

export const isAvailable = () => Boolean(apt?.isAvailable?.() || termux?.isAvailable?.());
export const hasShell = () => Boolean(termux?.isAvailable?.());
export const hasApt = () => Boolean(apt?.isAvailable?.());
export type ShellResult = {
  success: boolean;
  exitCode: number;
  output: string;
  jobId?: string;
  status?: string;
  attempt?: number;
};

export type PersistentExecuteOptions = {
  label?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  onJob?: (job: any) => void;
};

export const execute = async (command: string, workDir?: string): Promise<ShellResult> => termux?.execute
  ? termux.execute(command, workDir)
  : { success: false, exitCode: -1, output: 'Native Ubuntu shell is unavailable' };

/**
 * Запустить команду и СТРИМИТЬ её вывод построчно через onLine в реальном времени.
 * Нативный мост (TermuxTerminalModule) читает stdout процесса построчно и шлёт
 * событие "commandOutput" на каждую строку — onLine вызывается сразу.
 * Если события не пришли (мост без стриминга) — на выходе стримим весь output.
 * Возвращает { success, exitCode, output }.
 */
export const streamExecute = async (command: string, workDir: string | undefined, onLine: (line: string) => void): Promise<ShellResult> => {
  if (!termux?.execute) return { success: false, exitCode: -1, output: 'Native shell is unavailable' };
  let sub = null;
  let got = 0;
  try {
    if (termux.commandEvents?.addListener) {
      sub = termux.commandEvents.addListener('commandOutput', (e) => {
        const line = String((e && e.line) || '').replace(/\r/g, '');
        if (line) { got += 1; try { onLine(line); } catch (_) {} }
      });
    }
    const res = await termux.execute(command, workDir);
    if (got === 0 && res?.output) {
      String(res.output).replace(/\r/g, '').split('\n').forEach((l) => { if (l) { got += 1; try { onLine(l); } catch (_) {} } });
    }
    return res;
  } finally {
    try { sub && sub.remove && sub.remove(); } catch (_) {}
  }
};

const ACTIVE_JOB_STATES = new Set(['queued', 'running', 'stopping']);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Stream a command whose lifecycle belongs to Android's foreground service.
 * The native job is persisted before launch and is recovered after process death; this promise is
 * only an observer and may disappear without cancelling the command.
 */
export const observeDetachedJob = async (
  id: string,
  onLine: (line: string) => void,
  initialJob?: any,
): Promise<ShellResult> => {
  if (!apt?.getDetachedJob || !id) {
    return { success: false, exitCode: -1, output: 'Native background job is unavailable' };
  }

  // Starting at zero is intentional: a newly mounted screen replays the persisted log and then
  // follows it live. The command belongs to Android; this observer can be destroyed/recreated.
  let offset = 0;
  let output = '';
  let pendingLine = '';
  const emit = (text: string) => {
    if (!text) return;
    const parts = (pendingLine + text).replace(/\r/g, '').split('\n');
    pendingLine = parts.pop() || '';
    parts.forEach(line => { if (line) { try { onLine(line); } catch (_) {} } });
  };

  let status = initialJob || await apt.getDetachedJob(id);
  do {
    const chunk = await apt.readDetachedJobLog(id, offset, 128 * 1024);
    const text = String(chunk?.text || '');
    offset = Number(chunk?.nextOffset ?? offset);
    if (text) {
      output += text;
      emit(text);
    }
    status = await apt.getDetachedJob(id);
    if (ACTIVE_JOB_STATES.has(status?.status)) await wait(350);
  } while (ACTIVE_JOB_STATES.has(status?.status));

  // Drain bytes written between the final status update and the last poll.
  const tail = await apt.readDetachedJobLog(id, offset, 256 * 1024);
  if (tail?.text) {
    const text = String(tail.text);
    output += text;
    emit(text);
  }
  if (pendingLine) {
    try { onLine(pendingLine); } catch (_) {}
  }
  const exitCode = Number.isFinite(status?.exitCode) ? status.exitCode : -1;
  return {
    success: status?.status === 'succeeded' && exitCode === 0,
    exitCode,
    output,
    jobId: id,
    status: status?.status,
    attempt: status?.attempt,
  };
};

export const persistentStreamExecute = async (
  command: string,
  workDir: string | undefined,
  onLine: (line: string) => void,
  options: PersistentExecuteOptions = {},
): Promise<ShellResult> => {
  if (!apt?.startDetachedJob) return streamExecute(command, workDir, onLine);
  const job = await apt.startDetachedJob(
    command,
    workDir,
    options.label || 'Background command',
    options.kind || 'shell',
    options.metadata ? JSON.stringify(options.metadata) : undefined,
  );
  if (!job?.id) {
    return { success: false, exitCode: -1, output: job?.error || 'Could not start background command' };
  }
  if (typeof options.onJob === 'function') options.onJob(job);
  return observeDetachedJob(job.id, onLine, job);
};

export const getCurrentDetachedJob = async () => apt?.getCurrentDetachedJob?.() || { exists: false, status: 'idle' };
export const getDetachedJob = async (id) => apt?.getDetachedJob?.(id) || { exists: false, id, status: 'missing' };
export const readDetachedJobLog = async (id, offset = 0) => apt?.readDetachedJobLog?.(id, offset, 128 * 1024) || { text: '', nextOffset: offset, done: true };
export const stopDetachedJob = async (id) => apt?.stopDetachedJob?.(id) || { success: false, id };

export const checkCommand = async (command) => {
  if (termux?.checkCommand) return termux.checkCommand(command);
  if (apt?.whichCommand) return apt.whichCommand(command);
  return { exists: false, path: '' };
};


/**
 * Проверить, что на host:port отвечает HTTP-сервер (статус < 500).
 * Использует node (а не curl) — node всегда есть (на нём крутится Vite), и это
 * работает там, где curl недоступен/ненадёжен. Возвращает true/false.
 */
export const isPortServingHttp = async (port, workDir, host = '127.0.0.1') => {
  const r = await execute(
    `node -e 'const h=require("http");const rq=h.get({host:"${host}",port:${port},path:"/",timeout:2500},x=>process.exit(x.statusCode<500?0:1));rq.on("timeout",()=>{rq.destroy();process.exit(1)});rq.on("error",()=>process.exit(1))' 2>/dev/null; echo RC_$?`,
    workDir,
  );
  return /RC_0\b/.test(r.output || '');
};
export const inspectAndroidToolchain = async () => {
  const result = await execute(`
set +e
printf 'java='; java -version 2>&1 | head -1
printf 'javac='; javac -version 2>&1 | head -1
printf 'android_home='; printf '%s\\n' "\${ANDROID_HOME:-\${ANDROID_SDK_ROOT:-}}"
printf 'sdkmanager='; command -v sdkmanager || true
printf 'adb='; command -v adb || true
printf 'gradle='; command -v gradle || true
`);
  return { success: result.success, output: result.output || '' };
};

export const aptInstall = async (pkg) => apt?.install?.(pkg) || { success: false, output: 'Not available' };
export const aptSearch = async (query) => apt?.search?.(query) || { success: false, output: 'Not available' };
export const aptInfo = async (pkg) => apt?.info?.(pkg) || { success: false, output: 'Not available' };
export const aptRemove = async (pkg) => apt?.remove?.(pkg) || { success: false, output: 'Not available' };
export const aptListInstalled = async () => apt?.listInstalled?.() || [];
export const aptGetPrefix = async () => apt?.getPrefix?.() || { prefix: '' };