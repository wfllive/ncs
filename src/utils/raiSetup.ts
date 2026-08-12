/**
 * raiSetup.js — первый запуск RAI-окружения (страница после установки Ubuntu).
 *
 * RAI — вендоренный в этот репозиторий (папка rai/): исходники + собранный
 * бандл rai.sh лежат в проекте и в APK (assets модуля apt-manager, путь
 * assets/rai/rai.sh — переживает expo prebuild --clean). GitHub-репозиторий
 * RAI не используется: нативный модуль копирует бандл в rootfs
 * (/root/rai/rai.sh), и установка запускается локально.
 *
 *   1. apt update && apt upgrade -y
 *   2. apt install curl wget zip unzip -y
 *   3. Node.js 24 (nodesource; запасной вариант — apt nodejs)
 *   4. bash /root/rai/rai.sh        (локальный бандл из APK)
 *   5. rai install base             (apt, JDK 17, утилиты)
 *   6. rai install sdk              (нативный ARM Android SDK)
 *   7. rai status                   (проверка) → marker /root/.rai-setup.done
 *
 * Каждый шаг идемпотентен: при повторном входе (после обрыва/фонового
 * сворачивания) уже выполненные шаги быстро пропускаются, установка
 * продолжается с места обрыва.
 */
import * as apt from '../../modules/apt-manager/src/index';
import { execute, persistentStreamExecute } from './shellExecutor';
import { updateBackground } from './background';

export const RAI_BUNDLE_DIR = '/root/rai';
export const RAI_BUNDLE = `${RAI_BUNDLE_DIR}/rai.sh`;
export const SETUP_MARKER = '/root/.rai-setup.done';
export const SETUP_STEP_FILE = '/root/.rai-step'; // текущий/последний шаг (для «продолжить после закрытия»)
export const SETUP_STEP_DONE = '/root/.rai-step.done'; // маркер окончания шага (PTY-режим)
export const SETUP_LOG = '/root/.rai-setup.log';
export const SETUP_STATUS_FILE = '/root/.rai-status.txt'; // вывод `rai status` для парсинга
export const ANDROID_HOME = '/root/android-sdk';
export const RAI_VERSION = '0.0.1'; // версия вендоренного RAI (rai/version.json)

const shq = (v = '') => `'${String(v).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Быстрая проверка «шаг уже сделан»: вывод DONE → пропустить.
const isDone = async (cmd) => {
  try {
    const r = await execute(`${cmd}; echo RC_$?`, '/');
    return /DONE/.test(r.output || '') && /RC_0\b/.test(r.output || '');
  } catch (e) {
    return false;
  }
};

/** Запустить команду со стримингом вывода; вернуть { success, output } (output полный). */
const streamRun = async (command, onLine, workDir = '/', stepId = 'setup') => {
  const res = await persistentStreamExecute(
    command,
    workDir,
    (line) => { try { onLine && onLine(line); } catch (_) {} },
    {
      label: `RAI setup: ${stepId}`,
      kind: 'rai-setup',
      metadata: { stepId },
    },
  );
  return { success: res?.success === true && (res?.exitCode ?? 0) === 0, output: res?.output || '' };
};

/** Выполнить шаг: check (skip?) → cmd/run. */
const runStep = async (step: any, onLine: (line: string) => void, persistStep: (id: string) => any = () => {}) => {
  const startedAt = Date.now();
  const lines = [];
  const emit = (line) => { lines.push(line); try { onLine && onLine(line); } catch (_) {} };
  persistStep(step.id);

  // 0) Проверка «уже сделано»
  if (step.check) {
    try {
      if (await isDone(step.check)) {
        return { id: step.id, status: 'skipped', output: lines.join('\n'), ms: Date.now() - startedAt };
      }
    } catch (_) {}
  }

  // 1) Кастомный раннер (seed бандла, rai status, финиш)
  if (typeof step.run === 'function') {
    const out = await step.run(emit);
    if (out === false) {
      return { id: step.id, status: 'failed', output: lines.join('\n'), ms: Date.now() - startedAt };
    }
    return { id: step.id, status: 'done', output: lines.join('\n'), ms: Date.now() - startedAt, extra: out };
  }

  // 2) Обычная shell-команда со стримингом
  const res = await streamRun(`${step.cmd} 2>&1; echo STEP_EXIT:$?`, emit, '/', step.id);
  const ok = /STEP_EXIT:0\b/.test(res.output || '');
  if (!ok) {
    emit(`\n❌ Шаг не завершился (exit != 0)`);
    return { id: step.id, status: 'failed', output: lines.join('\n'), ms: Date.now() - startedAt };
  }
  return { id: step.id, status: 'done', output: lines.join('\n'), ms: Date.now() - startedAt };
};

// ---------------------------------------------------------------------------
// Шаги
// ---------------------------------------------------------------------------

export const SETUP_STEPS = [
  {
    id: 'apt',
    title: { ru: 'apt update && apt upgrade', en: 'apt update && apt upgrade' },
    // Сначала лечим незавершённую dpkg-базу (если прошлый apt upgrade прервали),
    // иначе apt падает на half-configured пакетах (напр. ca-certificates).
    cmd:
      'export DEBIAN_FRONTEND=noninteractive; ' +
      '(dpkg --configure -a 2>/dev/null || true); ' +
      'apt update && apt upgrade -y',
    check: 'command -v curl >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 && [ -n "$(ls /var/lib/apt/lists/ 2>/dev/null | head -1)" ] && echo DONE || echo TODO',
  },
  {
    id: 'tools',
    title: { ru: 'Утилиты: curl, wget, zip, unzip', en: 'Utilities: curl, wget, zip, unzip' },
    cmd:
      'export DEBIAN_FRONTEND=noninteractive; ' +
      '(dpkg --configure -a 2>/dev/null || true); ' +
      '(apt -f install -y 2>/dev/null || true); ' +
      'apt install -y curl wget zip unzip ca-certificates',
    check: 'command -v curl >/dev/null 2>&1 && command -v wget >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 && command -v zip >/dev/null 2>&1 && echo DONE || echo TODO',
  },
  {
    id: 'node',
    title: { ru: 'Node.js 24 (nodesource)', en: 'Node.js 24 (nodesource)' },
    // Уже есть node 24+? → пропускаем. Иначе nodesource setup_24.x, при сбое — apt nodejs.
    cmd:
      'if node -v 2>/dev/null | grep -qE "^v(2[0-9]|[0-9]{3,})"; then echo "node $(node -v) уже установлен"; ' +
      'elif curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs; then echo "node $(node -v) (nodesource 24.x)"; ' +
      'else apt install -y nodejs && echo "node $(node -v) (apt fallback)"; fi',
    check: 'node -v 2>/dev/null | grep -qE "^v(1[89]|[2-9][0-9])" && echo DONE || echo TODO',
  },
  {
    id: 'rai',
    title: { ru: 'Установка RAI (локальный бандл)', en: 'Install RAI (local bundle)' },
    // Спец-шаг: бандл из APK (assets/rai/rai.sh) копируется нативным модулем
    // в rootfs (/root/rai/rai.sh) и запускается локально — GitHub не нужен.
    // Первый запуск bash rai.sh сам ставит CLI в ~/.rai и лаунчер `rai`.
    check: `command -v rai >/dev/null 2>&1 && echo DONE || echo TODO`,
    run: async (emit) => {
      emit('$ seed RAI bundle (assets/rai/rai.sh → /root/rai/rai.sh)');
      let seeded: any = { success: false };
      try { seeded = await apt.seedRaiBundle(); } catch (e) { seeded = { success: false, output: String(e) }; }
      if (!seeded?.success) {
        // Файл мог быть засеян ранее напрямую — проверяем перед тем как падать.
        const probe = await execute(`[ -s ${shq(RAI_BUNDLE)} ] && echo YES || echo NO`, '/');
        if (!/YES/.test(probe.output || '')) {
          emit(`❌ ${seeded?.output || 'seedRaiBundle failed'}`);
          return false;
        }
        emit('⚠ бандл уже есть в rootfs — продолжаем');
      } else {
        emit(`✓ ${seeded.output} (${Math.round((seeded.bytes || 0) / 1024)} KB)`);
      }
      emit('');
      emit(`$ bash ${RAI_BUNDLE}  (локально, без GitHub)`);
      const res = await streamRun(`bash ${shq(RAI_BUNDLE)} 2>&1`, emit, '/', 'rai');
      const check = await execute('command -v rai >/dev/null 2>&1 && echo RAI_OK || echo RAI_MISSING', '/');
      if (!/RAI_OK/.test(check.output || '')) {
        emit('❌ команда rai не найдена после установки');
        return false;
      }
      return res;
    },
  },
  {
    id: 'base',
    title: { ru: 'rai install base (apt, JDK 17)', en: 'rai install base (apt, JDK 17)' },
    cmd: 'rai install base',
    check: 'command -v javac >/dev/null 2>&1 && command -v java >/dev/null 2>&1 && echo DONE || echo TODO',
  },
  {
    id: 'sdk',
    title: { ru: 'rai install sdk (нативный ARM SDK)', en: 'rai install sdk (native ARM SDK)' },
    cmd: 'rai install sdk',
    check: `[ -d ${ANDROID_HOME}/build-tools ] && [ -d ${ANDROID_HOME}/platforms ] && [ -d ${ANDROID_HOME}/platform-tools ] && echo DONE || echo TODO`,
  },
  {
    id: 'status',
    title: { ru: 'rai status — проверка компонентов', en: 'rai status — verify components' },
    always: true,
    run: async (emit) => {
      const res = await streamRun('rai status 2>&1', emit, '/', 'status');
      const parsed = parseRaiStatus(res.output);
      emit('');
      emit(parsed.ok
        ? '✓ Java + build-tools + platforms на месте'
        : '❌ компоненты неполные: Java/сборка/платформы не найдены');
      return parsed.ok;
    },
  },
  {
    id: 'marker',
    title: { ru: 'Завершение установки', en: 'Finish setup' },
    always: true,
    run: async (emit) => {
      await execute(`mkdir -p /root && echo ok > ${shq(SETUP_MARKER)} && echo done > ${shq(SETUP_LOG)}`, '/');
      emit('✓ среда готова — переходим к проектам');
      return true;
    },
  },
];

// ---------------------------------------------------------------------------
// Парсер вывода `rai status`
// ---------------------------------------------------------------------------

export const parseRaiStatus = (output = '') => {
  const java = /Java\s*:\s*([^\n]+)/.exec(output);
  const bt = /build-tools\s*:\s*([^\n]+)/.exec(output);
  const pl = /platforms\s*:\s*([^\n]+)/.exec(output);
  const no = /нет|none/i;
  const ok = Boolean(
    java && bt && pl &&
    /\d/.test(java[1]) && !no.test(java[1]) &&
    /\d/.test(bt[1]) && !no.test(bt[1]) &&
    /android/i.test(pl[1]) && !no.test(pl[1]),
  );
  return {
    ok,
    java: java ? java[1].trim() : '',
    buildTools: bt ? bt[1].trim() : '',
    platforms: pl ? pl[1].trim() : '',
    output,
  };
};

// ---------------------------------------------------------------------------
// Прогон всей установки с пропуском готовых шагов
// ---------------------------------------------------------------------------

const workflowCommandForStep = (step: any) => {
  if (step.id === 'rai') {
    return `bash ${shq(RAI_BUNDLE)} && command -v rai >/dev/null 2>&1`;
  }
  if (step.id === 'status') {
    return `rai status 2>&1 | tee ${shq(SETUP_STATUS_FILE)}; ` +
      `grep -qE 'Java[[:space:]]*:[[:space:]]*[0-9]' ${shq(SETUP_STATUS_FILE)} && ` +
      `grep -qE 'build-tools[[:space:]]*:[[:space:]]*[0-9]' ${shq(SETUP_STATUS_FILE)} && ` +
      `grep -qE 'platforms[[:space:]]*:[[:space:]]*android' ${shq(SETUP_STATUS_FILE)}`;
  }
  if (step.id === 'marker') {
    return `mkdir -p /root && echo ok > ${shq(SETUP_MARKER)} && echo done > ${shq(SETUP_LOG)}`;
  }
  return step.cmd || 'true';
};

/** Build one deterministic shell command for the complete setup workflow.
 * Android persists and replays this command as one job, so no transition depends on JS being alive.
 */
export const buildRaiSetupWorkflowCommand = () => {
  const lines = [
    'run_nova_step() {',
    '  nova_id="$1"; nova_title="$2"; nova_check="$3"; nova_body="$4"',
    `  printf '%s\\n' "$nova_id" > ${shq(SETUP_STEP_FILE)}`,
    '  printf "@@NOVA_STEP_START@@:%s\\n" "$nova_id"',
    '  printf "── %s ──\\n" "$nova_title"',
    '  if [ -n "$nova_check" ] && eval "$nova_check" | grep -q DONE; then',
    '    printf "@@NOVA_STEP_SKIPPED@@:%s\\n" "$nova_id"',
    '    return 0',
    '  fi',
    '  eval "$nova_body"',
    '  nova_rc=$?',
    '  if [ "$nova_rc" -eq 0 ]; then',
    '    printf "@@NOVA_STEP_DONE@@:%s\\n" "$nova_id"',
    '    return 0',
    '  fi',
    '  printf "@@NOVA_STEP_FAILED@@:%s:%s\\n" "$nova_id" "$nova_rc"',
    '  return "$nova_rc"',
    '}',
  ];
  SETUP_STEPS.forEach((step) => {
    lines.push(
      `run_nova_step ${shq(step.id)} ${shq(step.title?.ru || step.id)} ` +
      `${shq(step.check || '')} ${shq(workflowCommandForStep(step))} || exit $?`,
    );
  });
  lines.push(`rm -f ${shq(SETUP_STEP_FILE)} ${shq(SETUP_STEP_DONE)}`);
  return lines.join('\n');
};

export const runRaiSetup = async ({ onStepStart, onStepEnd, onLine }) => {
  // Seeding is a fast native asset copy and must happen before the durable shell workflow. Once
  // copied, every expensive/networked setup stage is owned by the foreground-service supervisor.
  let seeded: any = { success: false };
  try { seeded = await apt.seedRaiBundle(); } catch (e) { seeded = { success: false, output: String(e) }; }
  if (!seeded?.success) {
    const probe = await execute(`[ -s ${shq(RAI_BUNDLE)} ] && echo YES || echo NO`, '/');
    if (!/YES/.test(probe.output || '')) {
      return { ok: false, summary: [{ id: 'rai', status: 'failed', output: seeded?.output || 'seedRaiBundle failed' }] };
    }
  }

  const byId = Object.fromEntries(SETUP_STEPS.map(step => [step.id, step]));
  const states = new Map<string, string>();
  const command = buildRaiSetupWorkflowCommand();
  const result = await persistentStreamExecute(
    command,
    '/',
    (line) => {
      const marker = /^@@NOVA_STEP_(START|DONE|SKIPPED|FAILED)@@:([^:]+)(?::(.*))?$/.exec(line);
      if (!marker) {
        try { onLine && onLine(line); } catch (_) {}
        return;
      }
      const [, event, id, detail] = marker;
      const step = byId[id];
      if (!step) return;
      if (event === 'START') {
        states.set(id, 'running');
        try { onStepStart && onStepStart(id, step); } catch (_) {}
        return;
      }
      const status = event === 'DONE' ? 'done' : event === 'SKIPPED' ? 'skipped' : 'failed';
      states.set(id, status);
      try { onStepEnd && onStepEnd(id, step, { status, output: detail || '' }); } catch (_) {}
    },
    {
      label: 'RAI setup',
      kind: 'rai-setup-workflow',
      metadata: { workflow: 'rai-setup', version: 1 },
    },
  );
  const summary = SETUP_STEPS
    .filter(step => states.has(step.id))
    .map(step => ({ id: step.id, status: states.get(step.id) }));
  return { ok: result.success && states.get('marker') === 'done', summary };
};

// ---------------------------------------------------------------------------
// PTY-режим: команды выполняются ВНУТРИ интерактивного терминала (Termux PTY),
// а не в отдельных процессах. Терминал сам рисует вывод (цвета, курсор, можно
// вводить команды руками). JS узнаёт об окончании шага по файлу-маркеру.
// ---------------------------------------------------------------------------

const ptyStepCommand = (step) => {
  switch (step.id) {
    case 'rai': return `bash ${shq(RAI_BUNDLE)}`;
    // tee: вывод и в терминал, и в файл (для парсинга статуса)
    case 'status': return `rai status 2>&1 | tee ${shq(SETUP_STATUS_FILE)}`;
    case 'marker': return `echo ok > ${shq(SETUP_MARKER)}`;
    default: return step.cmd;
  }
};

const ptyStepTimeout = (step) => {
  if (step.id === 'status' || step.id === 'marker') return 5 * 60 * 1000;
  return 120 * 60 * 1000; // apt/upgrade/sdk могут идти долго
};

const waitForMarker = async (marker, intervalMs, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await execute(`cat ${shq(marker)} 2>/dev/null`, '/');
      const v = String(r.output || '').trim();
      if (v) return v;
    } catch (_) {}
    await sleep(intervalMs);
  }
  return '';
};

/**
 * Прогон установки в интерактивном терминале.
 * @param {object} opts
 * @param {{write:(string)=>void}} opts.terminal — обёртка над TerminalView.writeText
 * @param {(id:string, step:object)=>void} opts.onStepStart
 * @param {(id:string, step:object, res:{status:string, output?:string})=>void} opts.onStepEnd
 * @param {(parsed:object)=>void} [opts.onStatusOutput] — результат parseRaiStatus (шаг status)
 */
export const runRaiSetupPty = async ({ terminal, onStepStart, onStepEnd, onStatusOutput }) => {
  const summary = [];
  const markerWrite = async (path, value) => {
    try { await execute(`echo ${shq(value)} > ${shq(path)}`, '/'); } catch (_) {}
  };
  // Сброс маркеров перед стартом
  try { await execute(`rm -f ${shq(SETUP_STEP_FILE)} ${shq(SETUP_STEP_DONE)} ${shq(SETUP_STATUS_FILE)}`, '/'); } catch (_) {}

  for (const [index, step] of SETUP_STEPS.entries()) {
    try { onStepStart && onStepStart(step.id, step); } catch (_) {}
    try { await updateBackground(step.title?.ru || step.id); } catch (_) {}

    // 0) Шаг уже сделан? → skip
    if (step.check) {
      try {
        if (await isDone(step.check)) {
          try { onStepEnd && onStepEnd(step.id, step, { status: 'skipped' }); } catch (_) {}
          summary.push({ id: step.id, status: 'skipped' });
          continue;
        }
      } catch (_) {}
    }

    // 1) JS-прелюдия: шаг 'rai' требует seed бандла из APK в rootfs (нативный код)
    if (step.id === 'rai') {
      let seeded: any = { success: false };
      try { seeded = await apt.seedRaiBundle(); } catch (e) { seeded = { success: false, output: String(e) }; }
      if (!seeded?.success) {
        const probe = await execute(`[ -s ${shq(RAI_BUNDLE)} ] && echo YES || echo NO`, '/');
        if (!/YES/.test(probe.output || '')) {
          try { onStepEnd && onStepEnd(step.id, step, { status: 'failed', output: seeded.output }); } catch (_) {}
          summary.push({ id: step.id, status: 'failed' });
          return { ok: false, summary };
        }
      }
    }

    // 2) Команда в PTY с маркерами начала/конца + заголовок шага в терминале.
    //    Заголовок и маркеры оборачиваем в shq(): в title есть `&&`, кавычки и
    //    русский текст — в двойных кавычках echo это сломало бы команду.
    const cmd = ptyStepCommand(step);
    const title = step.title?.ru || step.id;
    const header = shq(`── [${index + 1}/${SETUP_STEPS.length}] ${title} ──`);
    const full =
      `echo ${header}; ` +
      `echo "start:${step.id}" > ${shq(SETUP_STEP_FILE)}; ` +
      `echo "" > ${shq(SETUP_STEP_DONE)}; ` +
      `${cmd}; rc=$?; echo "end:${step.id}:$rc" > ${shq(SETUP_STEP_DONE)}`;
    terminal.write(full + '\n');

    const end = await waitForMarker(SETUP_STEP_DONE, 2500, ptyStepTimeout(step));
    if (!end) {
      try { onStepEnd && onStepEnd(step.id, step, { status: 'failed', output: 'timeout: шаг не завершился' }); } catch (_) {}
      summary.push({ id: step.id, status: 'failed' });
      return { ok: false, summary };
    }

    const m = end.match(/^end:([^:]+):(\d+)$/);
    const ok = m && m[2] === '0';
    if (!ok) {
      try { onStepEnd && onStepEnd(step.id, step, { status: 'failed', output: end }); } catch (_) {}
      summary.push({ id: step.id, status: 'failed' });
      return { ok: false, summary };
    }

    // 3) Пост-обработка: шаг 'status' — распарсить сохранённый вывод
    if (step.id === 'status') {
      const st = await execute(`cat ${shq(SETUP_STATUS_FILE)} 2>/dev/null`, '/');
      const parsed = parseRaiStatus(st.output || '');
      try { onStatusOutput && onStatusOutput(parsed); } catch (_) {}
      if (!parsed.ok) {
        try { onStepEnd && onStepEnd(step.id, step, { status: 'failed', output: st.output }); } catch (_) {}
        summary.push({ id: step.id, status: 'failed' });
        return { ok: false, summary };
      }
    }

    try { onStepEnd && onStepEnd(step.id, step, { status: 'done' }); } catch (_) {}
    summary.push({ id: step.id, status: 'done' });
    await markerWrite(SETUP_STEP_DONE, '');
    await sleep(150);
  }

  // Финал: маркер готовности уже записан шагом 'marker'; чистим временные
  try { await execute(`rm -f ${shq(SETUP_STEP_FILE)} ${shq(SETUP_STEP_DONE)}`, '/'); } catch (_) {}
  return { ok: true, summary };
};

export const RAI_READY_SENTINEL = '@@NOVA_RAI_READY@@';
export const RAI_NOT_READY_SENTINEL = '@@NOVA_RAI_NOT_READY@@';

/** Exact sentinel matching prevents `NOT_READY` from being mistaken for `READY`. */
export const isRaiProbeReady = (output = '') => String(output)
  .split(/\r?\n/)
  .some(line => line.trim() === RAI_READY_SENTINEL);

/**
 * Готова ли RAI-среда (для стартового гейта): всегда запускаем настоящий
 * `rai status`. Маркер служит только checkpoint и никогда не обходит проверку.
 */
export const probeRaiReady = async () => {
  try {
    const r = await execute(
      `mkdir -p /root; ` +
      'if command -v rai >/dev/null 2>&1; then ' +
      '  out=$(rai status 2>&1); rai_rc=$?; ' +
      `  printf '%s\\n' "$out" > ${shq(SETUP_STATUS_FILE)}; ` +
      '  if [ "$rai_rc" -eq 0 ] && ' +
      '    echo "$out" | grep -qE "Java[[:space:]]*:[[:space:]]*[0-9]" && ' +
      '    echo "$out" | grep -qE "build-tools[[:space:]]*:[[:space:]]*[0-9]" && ' +
      '    echo "$out" | grep -qE "platforms[[:space:]]*:[[:space:]]*android"; then ' +
      `      echo ok > ${shq(SETUP_MARKER)}; ` +
      `      rm -f ${shq(SETUP_STEP_FILE)} ${shq(SETUP_STEP_DONE)}; ` +
      `      echo ${shq(RAI_READY_SENTINEL)}; ` +
      '    else ' +
      `      rm -f ${shq(SETUP_MARKER)}; ` +
      `      echo ${shq(RAI_NOT_READY_SENTINEL)}; ` +
      '    fi; ' +
      'else ' +
      `  : > ${shq(SETUP_STATUS_FILE)}; ` +
      `  rm -f ${shq(SETUP_MARKER)}; ` +
      `  echo ${shq(RAI_NOT_READY_SENTINEL)}; ` +
      'fi',
      '/',
    );
    return isRaiProbeReady(r.output || '');
  } catch (e) {
    return false;
  }
};

/**
 * Статус установки для «продолжить после закрытия»:
 *  - 'done'     — checkpoint-маркер есть; готовность всё равно подтверждает probeRaiReady();
 *  - 'running'  — идёт сейчас (в памяти) — не используется, зовём на старте;
 *  - 'step:<id>'— установка не завершена, остановились на шаге <id>
 *                 (или он был последним записанным) → можно продолжить;
 *  - 'none'     — установка даже не начиналась.
 */
export const getRaiSetupStatus = async () => {
  try {
    const r = await execute(
      `if [ -f ${shq(SETUP_MARKER)} ]; then echo DONE; exit 0; fi; ` +
      `if [ -f ${shq(SETUP_STEP_FILE)} ]; then echo "STEP:$(cat ${shq(SETUP_STEP_FILE)} 2>/dev/null)"; else echo NONE; fi`,
      '/',
    );
    const out = String(r.output || '').trim();
    if (out === 'DONE') return 'done';
    if (out.startsWith('STEP:')) return `step:${out.slice(5).trim()}`;
    return 'none';
  } catch (e) {
    return 'none';
  }
};

export default {
  SETUP_STEPS, runRaiSetup, probeRaiReady, getRaiSetupStatus, parseRaiStatus,
  RAI_BUNDLE_DIR, RAI_BUNDLE, SETUP_MARKER, SETUP_STEP_FILE, ANDROID_HOME, RAI_VERSION,
};
