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

// Коммит в wfllive/ncs, в котором лежит копия бандла (зеркало для fallback).
// Используем ветку сессии: бандл в ней всегда содержит актуальный install.sh
// (raw.githubusercontent поддерживает refs веток).
const STORM_BUNDLE_RAW =
  'https://raw.githubusercontent.com/wfllive/ncs/arena/01a0263b-ncs/modules/apt-manager/android/src/main/assets/storm/storm-bundle.zip';
// Апстрим-репозиторий сборщика (исходники вместо бандла — третий эшелон).
const STORM_SRC_ZIP =
  'https://codeload.github.com/wfllive/Storm-Build/zip/refs/heads/arena/019ffc57-storm-build';

// Зеркала тулчейнов для «спасательной» докачки (если install.sh не смог сам —
// например, его копия из старого бандла без TLS-фолбэков).
const ANDROID_JAR_MIRRORS = [
  'https://github.com/Sable/android-platforms/raw/master/android-34/android.jar',
  'https://raw.githubusercontent.com/skylot/jadx/master/jadx-core/src/test/resources/samples/android-34.jar',
  'https://github.com/anggrayudi/android-platforms/raw/master/android-34/android.jar',
];
const R8_MIRRORS = [
  'https://storage.googleapis.com/r8-releases/raw/main/r8.jar',
  'https://repo1.maven.org/maven2/com/android/tools/r8/8.2.33/r8-8.2.33.jar',
];
const BUNDLETOOL_MIRRORS = [
  'https://github.com/google/bundletool/releases/download/1.17.0/bundletool-all-1.17.0.jar',
];

/**
 * Команда установки сборщика. Устойчива к «падающим» в proot бинарям:
 * скачивание — curl → wget → python3; распаковка — unzip → python3 → busybox
 * (на устройствах curl/unzip могут abort'иться с «stack smashing detected»).
 *
 * Источники по приоритету:
 *   1) бандл из APK, засеянный в /root/storm-bundle.zip (офлайн);
 *   2) тот же бандл из репозитория конструктора;
 *   3) исходники Storm Build из апстрим-репозитория (codeload).
 * Дальше — штатный `install.sh` (внутри него те же fallback-цепочки).
 */
export const STORM_INSTALL_CMD =
  `PY="$(command -v python3 2>/dev/null || command -v python3.12 2>/dev/null || true)"; ` +
  `f_iszip() { [ -s "$1" ] && head -c 2 "$1" 2>/dev/null | grep -q "PK"; }; ` +
  `f_fetch() { command -v curl >/dev/null 2>&1 && curl -fsSL --retry 2 --max-time 300 -o "$2" "$1" && return 0; ` +
  `command -v wget >/dev/null 2>&1 && wget -q -T 300 -O "$2" "$1" && return 0; ` +
  `[ -n "$PY" ] && "$PY" -c "import sys,urllib.request as u;u.urlretrieve(sys.argv[1],sys.argv[2])" "$1" "$2" && return 0; ` +
  // Если в rootfs нет CA-сертификатов (битый ca-certificates), TLS-проверка
  // валится — качаем без верификации (крайний случай; URL доверенные).
  `[ -n "$PY" ] && "$PY" -c "import sys,ssl,urllib.request as u;u.install_opener(u.build_opener(u.HTTPSHandler(context=ssl._create_unverified_context())));u.urlretrieve(sys.argv[1],sys.argv[2])" "$1" "$2" && { echo "WARN: TLS без проверки сертификата (CA не настроены)"; return 0; }; ` +
  `command -v curl >/dev/null 2>&1 && curl -fkSL --retry 2 --max-time 300 -o "$2" "$1" && return 0; ` +
  `return 1; }; ` +
  `f_unzip() { [ -s "$1" ] || return 1; ` +
  `command -v unzip >/dev/null 2>&1 && unzip -oq "$1" -d "$2" 2>/dev/null && return 0; ` +
  `[ -n "$PY" ] && "$PY" -c "import sys,zipfile as z;z.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$1" "$2" 2>/dev/null && return 0; ` +
  `command -v busybox >/dev/null 2>&1 && busybox unzip -oq "$1" -d "$2" && return 0; ` +
  `return 1; }; ` +
  `echo "[storm] bundle в rootfs: $(stat -c %s ${STORM_BUNDLE} 2>/dev/null || echo 0) байт"; ` +
  `mkdir -p ${STORM_DIR} && cd ${STORM_DIR} && ` +
  // битый (не-zip) бандл удаляем, чтобы не жевать его по кругу
  `{ [ -e ${STORM_BUNDLE} ] && ! f_iszip ${STORM_BUNDLE} && { echo "[storm] bundle повреждён (не zip) — удаляю"; rm -f ${STORM_BUNDLE}; }; }; ` +
  // 1) офлайн-бандл из APK
  `{ [ -f install.sh ] || { f_iszip ${STORM_BUNDLE} && f_unzip ${STORM_BUNDLE} ${STORM_DIR} && echo "[storm] распаковано из: бандл APK"; }; }; ` +
  // 2) бандл из репозитория конструктора
  `{ [ -f install.sh ] || { f_fetch ${STORM_BUNDLE_RAW} ${STORM_BUNDLE} && f_iszip ${STORM_BUNDLE} && f_unzip ${STORM_BUNDLE} ${STORM_DIR} && echo "[storm] распаковано из: ncs-raw"; }; }; ` +
  `{ [ -f install.sh ] || { [ -e ${STORM_BUNDLE} ] && ! f_iszip ${STORM_BUNDLE} && { echo "[storm] скачанный файл — не zip (портал/MITM?) — удаляю"; rm -f ${STORM_BUNDLE}; }; }; }; ` +
  // 3) исходники апстрима (Storm-Build)
  `{ [ -f install.sh ] || { f_fetch ${STORM_SRC_ZIP} /tmp/storm-src.zip && f_iszip /tmp/storm-src.zip && ` +
  `{ rm -rf /tmp/storm-src && f_unzip /tmp/storm-src.zip /tmp/storm-src && ` +
  `rm -rf ${STORM_DIR} && mkdir -p ${STORM_DIR} && ` +
  `mv /tmp/storm-src/*/* ${STORM_DIR}/ 2>/dev/null; ` +
  `mv /tmp/storm-src/*/.gitignore ${STORM_DIR}/ 2>/dev/null; ` +
  // cwd мог указывать на удалённую директорию — возвращаемся в живую
  `cd ${STORM_DIR} && ` +
  `echo "[storm] распаковано из: upstream"; rm -rf /tmp/storm-src /tmp/storm-src.zip; }; }; }; ` +
  `[ -f install.sh ] || { echo "STORM_FAIL: install.sh не найден — бандла нет в APK и зеркала недоступны"; ` +
  `echo "[storm] диагностика: bundle=$(stat -c %s ${STORM_BUNDLE} 2>/dev/null || echo отсутствует) unzip=$(command -v unzip || echo нет) py=$PY"; exit 1; }; ` +
  `chmod +x install.sh storm 2>/dev/null; ` +
  // «Спасательная» докачка тулчейнов ДО install.sh: если бандл принёс старый
  // install.sh без TLS-фолбэков, он не сможет скачать их сам. Кладём в
  // ~/.storm/tools — install.sh увидит валидные файлы и пропустит скачивание.
  `ST="$HOME/.storm/tools"; mkdir -p "$ST"; ` +
  `{ [ -s "$ST/android-34.jar" ] || { echo "[storm] докачиваю android.jar (API 34)…"; ` +
  `f_fetch ${ANDROID_JAR_MIRRORS[0]} "$ST/android-34.jar" || f_fetch ${ANDROID_JAR_MIRRORS[1]} "$ST/android-34.jar" || f_fetch ${ANDROID_JAR_MIRRORS[2]} "$ST/android-34.jar" || echo "[storm] WARN: android.jar не докачался"; }; }; ` +
  `{ [ -s "$ST/r8.jar" ] || { echo "[storm] докачиваю r8.jar…"; ` +
  `f_fetch ${R8_MIRRORS[0]} "$ST/r8.jar" || f_fetch ${R8_MIRRORS[1]} "$ST/r8.jar" || echo "[storm] WARN: r8.jar не докачался"; }; }; ` +
  `{ [ -s "$ST/bundletool.jar" ] || { f_fetch ${BUNDLETOOL_MIRRORS[0]} "$ST/bundletool.jar" || echo "[storm] WARN: bundletool.jar не докачался (нужен только для AAB)"; }; }; ` +
  `bash install.sh`;

export const SETUP_STEPS = [
  {
    // Минимум для распаковки бандла и работы установщика (остальные пакеты —
    // JDK 17, aapt2, zipalign и т.д. — поставит сам install.sh).
    //
    // ВАЖНО про proot: на некоторых устройствах debconf ломается
    // («/usr/share/debconf/frontend: 9: Syntax error "(" unexpected»), из-за
    // чего postinst'ы tzdata/python3/ca-certificates падают и apt возвращает
    // ошибку, ХОТЯ файлы распакованы. Поэтому:
    //   1) глушим debconf заглушкой (среда сборочная, диалоги не нужны);
    //   2) ошибки apt/dpkg не считаем фатальными (|| true);
    //   3) в конце явно проверяем бинари и чиним ссылку /usr/bin/python3
    //      (альтернативы настраиваются в postinst, который мог не дойти).
    id: 'apt',
    title: { ru: 'apt update + unzip', en: 'apt update + unzip' },
    cmd:
      'export DEBIAN_FRONTEND=noninteractive; ' +
      '(dpkg --configure -a 2>/dev/null || true); ' +
      '{ [ -f /usr/share/debconf/frontend ] && ! head -1 /usr/share/debconf/frontend | grep -q "exit 0" && ' +
      '{ cp -a /usr/share/debconf/frontend /usr/share/debconf/frontend.bak 2>/dev/null || true; ' +
      'printf \'#!/bin/sh\\nexit 0\\n\' > /usr/share/debconf/frontend; echo "debconf: заглушка для proot"; }; } || true; ' +
      'apt update || true; ' +
      'apt upgrade -y || true; ' +
      'apt install -y unzip ca-certificates curl wget python3 || true; ' +
      '(dpkg --configure -a 2>/dev/null || true); ' +
      // postinst ca-certificates мог не дойти (битый debconf) — собираем
      // бандл CA вручную, иначе curl/python3 не смогут в TLS.
      '(command -v update-ca-certificates >/dev/null 2>&1 && update-ca-certificates 2>/dev/null) || true; ' +
      '{ [ -x /usr/bin/python3 ] || { P312="$(ls /usr/bin/python3.* 2>/dev/null | head -1)"; [ -n "$P312" ] && ln -sf "$P312" /usr/bin/python3 && echo "python3: ссылка восстановлена"; }; } || true; ' +
      'command -v unzip >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && echo APT_STEP_OK',
    check: 'command -v unzip >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && [ -n "$(ls /var/lib/apt/lists/ 2>/dev/null | head -1)" ] && echo DONE || echo TODO',
  },
  {
    // Storm Build: бандл из APK → распаковка → штатный установщик.
    // install.sh идемпотентен: установленные пакеты и уже скачанные
    // инструменты (проверка целостности) пропускаются.
    id: 'storm',
    title: { ru: 'Storm Build (install.sh)', en: 'Storm Build (install.sh)' },
    check: `[ -x ${STORM_DIR}/storm ] && command -v storm >/dev/null 2>&1 && command -v javac >/dev/null 2>&1 && echo DONE || echo TODO`,
    run: async (emit) => {
      emit('$ seed Storm bundle (assets/storm/storm-bundle.zip → /root/storm-bundle.zip)');
      let seeded: any = { success: false };
      try { seeded = await apt.seedStormBundle(); } catch (e) { seeded = { success: false, output: String(e) }; }
      if (seeded?.success) {
        emit(`✓ ${seeded.output} (${Math.round((seeded.bytes || 0) / 1024)} KB)`);
      } else {
        // Не фатально: STORM_INSTALL_CMD сам попробует зеркала (репозиторий
        // конструктора → апстрим Storm-Build).
        emit(`⚠ бандла из APK нет (${seeded?.output || 'seed недоступен'}) — используем зеркала`);
      }
      const res = await streamRun(`${STORM_INSTALL_CMD} 2>&1`, emit, '/', 'storm');
      const check = await execute(
        'command -v storm >/dev/null 2>&1 && command -v javac >/dev/null 2>&1 && echo STORM_OK || echo STORM_MISSING', '/');
      if (!/STORM_OK/.test(check.output || '')) {
        emit('❌ окружение не готово после install.sh (нет storm или javac)');
        return false;
      }
      return res;
    },
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

/**
 * Поиск инструментов для проверок: aapt2 и android.jar.
 * Источники: ~/.storm/tools (install.sh/storm setup), PATH, старый SDK
 * ($ANDROID_HOME — он продолжает работать, если уже установлен).
 */
const ENV_PROBE =
  'SDK="${ANDROID_HOME:-$HOME/android-sdk}"; ' +
  'AAPT2="$(command -v aapt2 2>/dev/null || true)"; ' +
  '[ -z "$AAPT2" ] && [ -x "$HOME/.storm/tools/aapt2" ] && AAPT2="$HOME/.storm/tools/aapt2"; ' +
  '[ -z "$AAPT2" ] && AAPT2="$(ls "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"; ' +
  '[ -z "$AAPT2" ] && AAPT2="$(command -v aapt 2>/dev/null || true)"; ' +
  'JAR="$(ls "$HOME"/.storm/tools/android-*.jar 2>/dev/null | tail -1)"; ' +
  '[ -z "$JAR" ] && JAR="$(ls "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)"';

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
  if (step.id === 'storm') {
    // Бандл уже засеян в rootfs до запуска воркфлоу (seedStormBeforeWorkflow).
    return STORM_INSTALL_CMD;
  }
  if (step.id === 'status') {
    return `{ ${ENV_STATUS_CMD}; } 2>&1 | tee ${shq(SETUP_STATUS_FILE)}; ` +
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

/** Seed бандла сборщика до запуска устойчивого шелл-воркфлоу.
 * Необязателен: если бандла нет, install.sh подтянется с зеркал. */
const seedStormBeforeWorkflow = async () => {
  try { await apt.seedStormBundle(); } catch (e) { /* зеркала подстрахуют */ }
  return { ok: true as const };
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
    case 'storm': return STORM_INSTALL_CMD;
    // ВАЖНО: фигурные скобки — иначе «| tee» прицепится только к последнему
    // echo и в файл попадёт лишь строка platforms (баг прежних версий).
    case 'status': return `{ ${ENV_STATUS_CMD}; } 2>&1 | tee ${shq(SETUP_STATUS_FILE)}`;
    case 'marker': return `echo ok > ${shq(SETUP_MARKER)}`;
    default: return step.cmd;
  }
};

const ptyStepTimeout = (step) => {
  if (step.id === 'status' || step.id === 'marker') return 5 * 60 * 1000;
  if (step.id === 'storm') return 120 * 60 * 1000; // install.sh: apt + скачивание инструментов может идти долго
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

    // 1) JS-прелюдия: пробуем seed бандла из APK в rootfs (необязательно —
    // при недоступности install.sh подтянется с зеркал).
    if (step.id === 'storm') {
      await seedStormBeforeWorkflow();
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
