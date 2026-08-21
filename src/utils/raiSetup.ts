/**
 * raiSetup.ts — установка среды сборки (без RAI).
 *
 * Исторически модуль ставил окружение через RAI; теперь весь пайплайн живёт
 * в **Storm Build** — кастомном сборщике без Gradle, который вендорен в
 * `storm/` и зашит в APK. Установщик делает только то, что Storm сам не
 * может сделать без прав пакета:
 *
 *   1. apt update                       (быстро, без полного upgrade)
 *   2. apt: JDK 17, python3, curl/zip/unzip
 *   3. Storm Build из бандла в APK      (seedStormBundle → /root/storm)
 *   4. storm setup --api 34             (сам качает aapt2, android.jar,
 *                                        r8.jar, bundletool.jar в ~/.storm)
 *   5. проверка окружения               (Java + aapt2 + платформа)
 *   6. маркер готовности /root/.storm-setup.done
 *
 * Каждый шаг идемпотентен: при повторном входе готовые шаги пропускаются,
 * установка продолжается с места обрыва. Если на устройстве уже стоит старый
 * SDK от RAI ($HOME/android-sdk), Storm найдёт его — повторных скачиваний нет.
 */
import * as apt from '../../modules/apt-manager/src/index';
import { execute, persistentStreamExecute } from './shellExecutor';
import { updateBackground } from './background';

export const STORM_BUNDLE = '/root/storm-bundle.zip';
export const STORM_DIR = '/root/storm';
export const SETUP_MARKER = '/root/.storm-setup.done';
export const SETUP_STEP_FILE = '/root/.storm-step'; // текущий/последний шаг (для «продолжить после закрытия»)
export const SETUP_STEP_DONE = '/root/.storm-step.done'; // маркер окончания шага (PTY-режим)
export const SETUP_LOG = '/root/.storm-setup.log';
export const SETUP_STATUS_FILE = '/root/.storm-status.txt'; // вывод проверки окружения для парсинга

// Совместимость со старыми импортами (эти артефакты больше не используются).
export const RAI_BUNDLE_DIR = '/root/rai';
export const RAI_BUNDLE = `${RAI_BUNDLE_DIR}/rai.sh`;
export const ANDROID_HOME = '/root/android-sdk';
export const RAI_VERSION = '0.0.1';

/**
 * Команда установки сборщика из бандла: распаковка в /root/storm,
 * лаунчер в PATH, быстрая самопроверка (`storm templates`).
 */
export const STORM_INSTALL_CMD =
  `mkdir -p ${STORM_DIR} && cd ${STORM_DIR} && ` +
  `unzip -oq ${STORM_BUNDLE} && ` +
  `chmod +x ${STORM_DIR}/storm && ` +
  `ln -sf ${STORM_DIR}/storm /usr/local/bin/storm && ` +
  `storm templates`;

/**
 * Поиск инструментов для проверок: aapt2/aapt и android.jar.
 * Источники: ~/.storm/tools (storm setup), PATH, старый SDK от RAI
 * ($ANDROID_HOME — он продолжает работать, если уже установлен).
 */
const ENV_PROBE =
  'SDK="${ANDROID_HOME:-$HOME/android-sdk}"; ' +
  'AAPT2="$(command -v aapt2 2>/dev/null || command -v aapt 2>/dev/null || true)"; ' +
  '[ -z "$AAPT2" ] && [ -x "$HOME/.storm/tools/aapt2" ] && AAPT2="$HOME/.storm/tools/aapt2"; ' +
  '[ -z "$AAPT2" ] && AAPT2="$(ls "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"; ' +
  'JAR="$(ls "$HOME"/.storm/tools/android-*.jar 2>/dev/null | tail -1)"; ' +
  '[ -z "$JAR" ] && JAR="$(ls "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)"';

export const SETUP_STEPS = [
  {
    // БЫСТРО: только `apt update` — полный `apt upgrade` убран (минуты работы
    // и сотни МБ трафика; для сборки он не нужен).
    id: 'apt',
    title: { ru: 'apt update (быстро, без upgrade)', en: 'apt update (fast, no upgrade)' },
    cmd:
      'export DEBIAN_FRONTEND=noninteractive; ' +
      '(dpkg --configure -a 2>/dev/null || true); ' +
      '(apt -f install -y 2>/dev/null || true); ' +
      'apt update',
    check: '[ -n "$(ls /var/lib/apt/lists/ 2>/dev/null | head -1)" ] && echo DONE || echo TODO',
  },
  {
    // Всё, что Storm не ставит сам: JDK 17 (javac/keytool/jarsigner),
    // python3 (движок сборщика), сетевые и архивные утилиты.
    id: 'tools',
    title: { ru: 'JDK 17, python3, утилиты', en: 'JDK 17, python3, utilities' },
    cmd:
      'export DEBIAN_FRONTEND=noninteractive; ' +
      '(dpkg --configure -a 2>/dev/null || true); ' +
      'apt install -y --no-install-recommends openjdk-17-jdk-headless python3 curl wget zip unzip ca-certificates',
    check: 'command -v javac >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 && command -v zip >/dev/null 2>&1 && echo DONE || echo TODO',
  },
  {
    // Storm Build — бандл из APK (assets/storm/storm-bundle.zip) копируется
    // нативным модулем в rootfs и распаковывается локально. GitHub не нужен.
    id: 'storm',
    title: { ru: 'Storm Build (локальный бандл)', en: 'Storm Build (local bundle)' },
    check: `[ -x ${STORM_DIR}/storm ] && command -v storm >/dev/null 2>&1 && echo DONE || echo TODO`,
    run: async (emit) => {
      emit('$ seed Storm bundle (assets/storm/storm-bundle.zip → /root/storm-bundle.zip)');
      let seeded: any = { success: false };
      try { seeded = await apt.seedStormBundle(); } catch (e) { seeded = { success: false, output: String(e) }; }
      if (!seeded?.success) {
        const probe = await execute(`[ -s ${STORM_BUNDLE} ] && echo YES || echo NO`, '/');
        if (!/YES/.test(probe.output || '')) {
          emit(`❌ ${seeded?.output || 'seedStormBundle failed'}`);
          return false;
        }
        emit('⚠ бандл уже есть в rootfs — продолжаем');
      } else {
        emit(`✓ ${seeded.output} (${Math.round((seeded.bytes || 0) / 1024)} KB)`);
      }
      const res = await streamRun(`${STORM_INSTALL_CMD} 2>&1`, emit, '/', 'storm');
      const check = await execute('command -v storm >/dev/null 2>&1 && echo STORM_OK || echo STORM_MISSING', '/');
      if (!/STORM_OK/.test(check.output || '')) {
        emit('❌ команда storm не найдена после установки');
        return false;
      }
      return res;
    },
  },
  {
    // Инструменты сборки: storm setup сам скачивает aapt2, android.jar,
    // r8.jar и bundletool.jar в ~/.storm/tools (зеркала, контроль целостности).
    // Если на устройстве уже есть SDK (например, от старой установки),
    // ничего не скачивается — инструменты находятся по ANDROID_HOME.
    id: 'toolchain',
    title: { ru: 'storm setup — aapt2, android.jar, R8', en: 'storm setup — aapt2, android.jar, R8' },
    cmd: 'storm setup --api 34',
    check: `${ENV_PROBE}; [ -n "$AAPT2" ] && [ -n "$JAR" ] && echo DONE || echo TODO`,
  },
  {
    // Финальная проверка: печатает сводку «Java / build-tools / platforms»
    // (формат совместим с парсером ниже и со статус-экраном).
    id: 'status',
    title: { ru: 'Проверка окружения сборки', en: 'Verify build environment' },
    always: true,
    run: async (emit) => {
      const res = await streamRun(`${ENV_STATUS_CMD} 2>&1 | tee ${SETUP_STATUS_FILE}`, emit, '/', 'status');
      const parsed = parseEnvStatus(res.output);
      emit('');
      emit(parsed.ok
        ? '✓ JDK + aapt2 + платформа на месте — среда готова'
        : '❌ компоненты неполные: JDK/aapt2/платформа не найдены');
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

/** Команда сводки окружения (формат строк — как у прежнего `rai status`). */
export const ENV_STATUS_CMD =
  `echo "Java: $(javac -version 2>&1 | head -1 || echo нет)"; ` +
  `${ENV_PROBE}; ` +
  `echo "build-tools: \${AAPT2:-нет}"; ` +
  `echo "platforms: $(basename "$JAR" 2>/dev/null || echo нет)"`;

// ---------------------------------------------------------------------------
// Парсер сводки окружения
// ---------------------------------------------------------------------------

export const parseEnvStatus = (output = '') => {
  const java = /Java\s*:\s*([^\n]+)/.exec(output);
  const bt = /build-tools\s*:\s*([^\n]+)/.exec(output);
  const pl = /platforms\s*:\s*([^\n]+)/.exec(output);
  const no = /нет|none/i;
  const ok = Boolean(
    java && bt && pl &&
    /\d/.test(java[1]) && !no.test(java[1]) &&
    /\//.test(bt[1]) && !no.test(bt[1]) &&
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
/** Совместимость со старым именем. */
export const parseRaiStatus = parseEnvStatus;

// ---------------------------------------------------------------------------
// Прогон всей установки с пропуском готовых шагов
// ---------------------------------------------------------------------------

const shq = (v = '') => `'${String(v).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isDone = async (cmd) => {
  try {
    const r = await execute(`${cmd}; echo RC_$?`, '/');
    return /DONE/.test(r.output || '') && /RC_0\b/.test(r.output || '');
  } catch (e) {
    return false;
  }
};

/** Запустить команду со стримингом вывода; вернуть { success, output }. */
const streamRun = async (command, onLine, workDir = '/', stepId = 'setup') => {
  const res = await persistentStreamExecute(
    command,
    workDir,
    (line) => { try { onLine && onLine(line); } catch (_) {} },
    {
      label: `Env setup: ${stepId}`,
      kind: 'env-setup',
      metadata: { stepId },
    },
  );
  return { success: res?.success === true && (res?.exitCode ?? 0) === 0, output: res?.output || '' };
};

const runStep = async (step: any, onLine: (line: string) => void, persistStep: (id: string) => any = () => {}) => {
  const startedAt = Date.now();
  const lines = [];
  const emit = (line) => { lines.push(line); try { onLine && onLine(line); } catch (_) {} };
  persistStep(step.id);

  if (step.check) {
    try {
      if (await isDone(step.check)) {
        return { id: step.id, status: 'skipped', output: lines.join('\n'), ms: Date.now() - startedAt };
      }
    } catch (_) {}
  }

  if (typeof step.run === 'function') {
    const out = await step.run(emit);
    if (out === false) {
      return { id: step.id, status: 'failed', output: lines.join('\n'), ms: Date.now() - startedAt };
    }
    return { id: step.id, status: 'done', output: lines.join('\n'), ms: Date.now() - startedAt, extra: out };
  }

  const res = await streamRun(`${step.cmd} 2>&1; echo STEP_EXIT:$?`, emit, '/', step.id);
  const ok = /STEP_EXIT:0\b/.test(res.output || '');
  if (!ok) {
    emit(`\n❌ Шаг не завершился (exit != 0)`);
    return { id: step.id, status: 'failed', output: lines.join('\n'), ms: Date.now() - startedAt };
  }
  return { id: step.id, status: 'done', output: lines.join('\n'), ms: Date.now() - startedAt };
};

const workflowCommandForStep = (step: any) => {
  if (step.id === 'status') {
    return `${ENV_STATUS_CMD} 2>&1 | tee ${shq(SETUP_STATUS_FILE)}; ` +
      `grep -qE 'Java[[:space:]]*:[[:space:]]*[0-9]' ${shq(SETUP_STATUS_FILE)} && ` +
      `grep -qE 'build-tools[[:space:]]*:[[:space:]]*/' ${shq(SETUP_STATUS_FILE)} && ` +
      `grep -qE 'platforms[[:space:]]*:[[:space:]]*android' ${shq(SETUP_STATUS_FILE)}`;
  }
  if (step.id === 'marker') {
    return `mkdir -p /root && echo ok > ${shq(SETUP_MARKER)} && echo done > ${shq(SETUP_LOG)}`;
  }
  return step.cmd || 'true';
};

/** Одна детерминированная команда для всего воркфлоу установки.
 * Android держит и воспроизводит её как одну задачу, поэтому ни один переход
 * не зависит от жизни JS-процесса.
 */
export const buildSetupWorkflowCommand = () => {
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
/** Совместимость со старым именем. */
export const buildRaiSetupWorkflowCommand = buildSetupWorkflowCommand;

/** Seed бандла сборщика до запуска устойчивого шелл-воркфлоу. */
const seedStormBeforeWorkflow = async () => {
  let seeded: any = { success: false };
  try { seeded = await apt.seedStormBundle(); } catch (e) { seeded = { success: false, output: String(e) }; }
  if (!seeded?.success) {
    const probe = await execute(`[ -s ${shq(STORM_BUNDLE)} ] && echo YES || echo NO`, '/');
    if (!/YES/.test(probe.output || '')) {
      return { ok: false, summary: [{ id: 'storm', status: 'failed', output: seeded?.output || 'seedStormBundle failed' }] };
    }
  }
  return { ok: true };
};

export const runRaiSetup = async ({ onStepStart, onStepEnd, onLine }) => {
  const seeded = await seedStormBeforeWorkflow();
  if (!seeded.ok) return seeded;

  const byId = Object.fromEntries(SETUP_STEPS.map(step => [step.id, step]));
  const states = new Map<string, string>();
  const command = buildSetupWorkflowCommand();
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
      label: 'Env setup',
      kind: 'env-setup-workflow',
      metadata: { workflow: 'env-setup', version: 2 },
    },
  );
  const summary = SETUP_STEPS
    .filter(step => states.has(step.id))
    .map(step => ({ id: step.id, status: states.get(step.id) }));
  return { ok: result.success && states.get('marker') === 'done', summary };
};

// ---------------------------------------------------------------------------
// PTY-режим: команды выполняются ВНУТРИ интерактивного терминала (Termux PTY).
// JS узнаёт об окончании шага по файлу-маркеру.
// ---------------------------------------------------------------------------

const ptyStepCommand = (step) => {
  switch (step.id) {
    case 'status': return `${ENV_STATUS_CMD} 2>&1 | tee ${shq(SETUP_STATUS_FILE)}`;
    case 'marker': return `echo ok > ${shq(SETUP_MARKER)}`;
    default: return step.cmd;
  }
};

const ptyStepTimeout = (step) => {
  if (step.id === 'status' || step.id === 'marker') return 5 * 60 * 1000;
  if (step.id === 'toolchain') return 60 * 60 * 1000; // скачивание инструментов может идти долго
  return 120 * 60 * 1000;
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

/** Прогон установки в интерактивном терминале. */
export const runRaiSetupPty = async ({ terminal, onStepStart, onStepEnd, onStatusOutput }) => {
  const summary = [];
  const markerWrite = async (path, value) => {
    try { await execute(`echo ${shq(value)} > ${shq(path)}`, '/'); } catch (_) {}
  };
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

    // 1) JS-прелюдия: шаг 'storm' требует seed бандла из APK в rootfs
    if (step.id === 'storm') {
      const seeded = await seedStormBeforeWorkflow();
      if (!seeded.ok) {
        try { onStepEnd && onStepEnd(step.id, step, { status: 'failed', output: seeded.summary?.[0]?.output }); } catch (_) {}
        summary.push({ id: step.id, status: 'failed' });
        return { ok: false, summary };
      }
    }

    // 2) Команда в PTY с маркерами начала/конца + заголовок шага в терминале.
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
      const parsed = parseEnvStatus(st.output || '');
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

  try { await execute(`rm -f ${shq(SETUP_STEP_FILE)} ${shq(SETUP_STEP_DONE)}`, '/'); } catch (_) {}
  return { ok: true, summary };
};

export const RAI_READY_SENTINEL = '@@NOVA_RAI_READY@@';
export const RAI_NOT_READY_SENTINEL = '@@NOVA_RAI_NOT_READY@@';

export const isRaiProbeReady = (output = '') => String(output)
  .split(/\r?\n/)
  .some(line => line.trim() === RAI_READY_SENTINEL);

/**
 * Готова ли среда сборки (стартовый гейт): живой шелл-зонд —
 * JDK + aapt2/aapt + android.jar (из ~/.storm или старого SDK).
 * Маркер служит только checkpoint'ом и никогда не обходит проверку.
 */
export const probeRaiReady = async () => {
  try {
    const r = await execute(
      `mkdir -p /root; ` +
      `${ENV_PROBE}; ` +
      'if command -v javac >/dev/null 2>&1 && [ -n "$AAPT2" ] && [ -n "$JAR" ]; then ' +
      `  printf 'Java: %s\\n' "$(javac -version 2>&1 | head -1)"; ` +
      `  printf 'build-tools: %s\\n' "$AAPT2"; ` +
      `  printf 'platforms: %s\\n' "$(basename "$JAR")"; ` +
      `  echo ok > ${shq(SETUP_MARKER)}; ` +
      `  rm -f ${shq(SETUP_STEP_FILE)} ${shq(SETUP_STEP_DONE)}; ` +
      `  echo ${shq(RAI_READY_SENTINEL)}; ` +
      'else ' +
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
 *  - 'done'      — checkpoint-маркер есть (готовность подтверждает probeRaiReady);
 *  - 'step:<id>' — установка не завершена, остановились на шаге <id>;
 *  - 'none'      — установка даже не начиналась.
 */
export const getRaiSetupStatus = async () => {
  try {
    const r = await execute(
      `if [ -f ${shq(SETUP_MARKER)} ]; then echo DONE; exit 0; fi; ` +
      `if [ -f ${shq(SETUP_STEP_FILE)} ]; then echo "STEP:$(cat ${shq(SETUP_STEP_FILE)} 2>/dev/null)"; else echo NONE; fi`,
      '/',
    );
    const out = String(r?.output || '').trim();
    if (out === 'DONE') return 'done';
    if (out.startsWith('STEP:')) return `step:${out.slice(5).trim()}`;
    return 'none';
  } catch (e) {
    return 'none';
  }
};

export default {
  SETUP_STEPS, runRaiSetup, runRaiSetupPty, probeRaiReady, getRaiSetupStatus,
  parseEnvStatus, parseRaiStatus, ENV_STATUS_CMD,
  STORM_BUNDLE, STORM_DIR, STORM_INSTALL_CMD,
  SETUP_MARKER, SETUP_STEP_FILE, ANDROID_HOME, RAI_VERSION,
};
