// @ts-nocheck — экран сохранён без визуальных изменений относительно main.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, IconButton, PrimaryButton, SectionCard, SegmentedControl, StatusPill, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { execute } from '../utils/shellExecutor';
import { shellQuote } from '../utils/workspace';
import { getProjectDir, slugifyProject } from '../config/runtime';
import { prepareProject } from '../utils/prepareProject';
import { refreshAndroidScaffold, ensureProjectIntegrity } from '../utils/composeProject';
import * as apt from '../../modules/apt-manager/src/index';
import { startBackground, stopBackground } from '../utils/background';
import { TerminalView, isAvailable as terminalAvailable } from '../../modules/termux-terminal/src/index';
import AdsBanner from '../components/AdsBanner';
import { maybeShowInterstitial } from '../ads/yandexAds';

// Терминал сборки — только вывод: панель спец-клавиш (ESC/CTRL/…) скрыта,
// экранная клавиатура не появляется, ручной ввод запрещён — всё запускается кнопками.
const EXTRA_KEYS = '[]';

const tasks = {
  dev: { icon: 'flash-outline', label: 'Vite dev', cmd: 'npm run dev', desc: 'Локальный Vite dev-server', tone: 'info' },
  build: { icon: 'hammer-outline', label: 'Vite build', cmd: 'npm run build', desc: 'Сборка dist/', tone: 'success' },
  android: { icon: 'logo-android', label: 'Android APK', cmd: 'bash build-android.sh', desc: 'подготовка → dist → assets → APK', tone: 'warning' },
  prepare: { icon: 'shield-checkmark-outline', label: 'Prepare SDK37', cmd: 'bash prepare.sh', desc: '7 шагов: wrapper/SDK37/конфликты', tone: 'info' },
};

// Адаптивный селектор: на узком экране — сетка карточек (2 в ряд, подписи не режутся),
// на широком — обычный SegmentedControl.
const OptionPicker = ({ value, onChange, options, grid, colors }) => {
  if (!grid) return <SegmentedControl value={value} onChange={onChange} options={options} />;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flexBasis: options.length > 3 ? '46%' : '30%',
              flexGrow: 1,
              minWidth: 120,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              paddingVertical: 11,
              paddingHorizontal: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primarySurface : colors.bg,
            }}
          >
            {opt.icon ? <Icon name={opt.icon} size={15} color={selected ? colors.primary : colors.textSecondary} /> : null}
            <Text numberOfLines={1} style={{ flexShrink: 1, color: selected ? colors.text : colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const BuildScreen = ({ navigation }) => {
  const { width } = useWindowDimensions();
  const { currentProject, addWorkspaceLog } = useProject();
  const { colors, language, t } = useAppSettings();
  const [task, setTask] = useState('build');
  const [variant, setVariant] = useState('debug'); // debug | release (для задачи android)
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [resultState, setResultState] = useState('idle');

  // Полноэкранная реклама РСЯ — только после успешной сборки и не чаще,
  // чем задано в adsConfig (no-op, если нативный SDK недоступен).
  useEffect(() => {
    if (resultState === 'success') void maybeShowInterstitial();
  }, [resultState]);

  const [artifact, setArtifact] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const scrollRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalReadyRef = useRef(false);
  const terminalPendingRef = useRef([]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  const desktop = width >= 800;
  const narrow = width < 560; // телефон в портрете: прячем второстепенные кнопки шапки консоли
  const useGridPicker = width < 620; // на телефоне SegmentedControl режет подписи — сетка карточек
  const stackButtons = width < 400; // «Запустить»/«Prepare» в колонку во всю ширину
  const ru = language === 'ru';

  const copy = ru ? {
    title: 'Сборка React', subtitle: 'React + Vite', choose: 'Задача сборки', run: 'Запустить', running: 'Выполняется…', success: 'Успешно', failed: 'Ошибка',
    terminal: 'Журнал сборки', clear: 'Очистить', install: 'Установить APK', launch: 'Открыть', note: 'Подготовка проекта выполняется автоматически — отдельный Prepare не нужен. Одна кнопка «Запустить» — полный цикл: файлы проекта → Vite build → assets → Gradle → проверка APK (aapt2) → экспорт в Загрузки/NovaCompose/<проект>/apk.',
    noProject: 'Сначала откройте проект.', artifact: 'Артефакт', clean: 'Очистить',
  } : {
    title: 'React Build', subtitle: 'React + Vite', choose: 'Build task', run: 'Run', running: 'Running…', success: 'Success', failed: 'Failed',
    terminal: 'Build log', clear: 'Clear', install: 'Install APK', launch: 'Open', note: 'Project preparation runs automatically — no separate Prepare needed. One Run button — the full cycle: project files → Vite build → assets → Gradle → APK check (aapt2) → export to Downloads/NovaCompose/<project>/apk.',
    noProject: 'Open a project first.', artifact: 'Artifact', clean: 'Clean',
  };

  const writeTerminal = (text) => {
    if (!text && text !== '') return;
    if (terminalReadyRef.current) {
      try { terminalRef.current?.writeText?.(String(text).replace(/\n/g, '\r\n') + '\r\n'); } catch (_) {}
    } else {
      terminalPendingRef.current.push(String(text));
    }
  };

  // Строки журнала/статусов выводим в терминал как КОММЕНТАРИИ bash ("# ...") —
  // иначе shell пытается их выполнить и транскрипт журнала засоряется мусором
  // вида "bash: ✓: command not found" / "syntax error near unexpected token `('".
  const sayInTerminal = (text) => {
    const s = String(text ?? '').replace(/\r/g, '');
    writeTerminal(s.split('\n').map((l) => (l ? `# ${l}` : '')).join('\n'));
  };

  // Выполнить команду ВНУТРИ терминала (PTY), вернуть true/false по маркеру.
  // Как в установщике: терминал показывает живой bash, а не журнал.
  const runInTerminal = async (label, command, { timeoutMs = 30 * 60 * 1000, cwd } = {}) => {
    if (!terminalReadyRef.current) {
      // Терминал не готов — фолбэк: команда через execute (журнал).
      append(`$ ${label}`, 'command');
      const r = await execute(`cd ${cwd ? `'${cwd}'` : ''} && ${command} 2>&1; echo RC:$?`, cwd);
      String(r.output || '').split('\n').filter(Boolean).forEach((l) => append(l));
      return /RC:0\b/.test(r.output || '');
    }
    const marker = '/root/.rai-build.done';
    const full = `echo "" > ${marker}; cd ${cwd ? `'${cwd}'` : ''} && ${command}; rc=$?; echo "rc:$rc" > ${marker}`;
    sayInTerminal(`── ${label} ──`);
    try { terminalRef.current?.writeText?.(full + '\n'); } catch (_) {}
    // Ждём маркер
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const r = await execute(`cat ${marker} 2>/dev/null`, '/');
        const v = String(r.output || '').trim();
        if (/^rc:\d+$/.test(v)) {
          const ok = v === 'rc:0';
          append(ok ? `✓ ${label} — готово` : `✗ ${label} — ошибка (rc=${v.slice(3)})`, ok ? 'success' : 'error');
          return ok;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    append(`✗ ${label} — таймаут`, 'error');
    return false;
  };

  const onTerminalEvent = (event) => {
    const value = event?.nativeEvent || event;
    if (value?.type === 'started') {
      terminalReadyRef.current = true;
      const buf = terminalPendingRef.current;
      terminalPendingRef.current = [];
      buf.forEach((t) => writeTerminal(t));
    }
    if (value?.type === 'exit') terminalReadyRef.current = false;
  };

  const clearConsole = () => {
    setLogs([]);
    try { terminalRef.current?.writeText?.('[2J[H'); } catch (_) {}
  };

  const append = (text, level = 'normal') => {
    setLogs(v => [...v, { id: `${Date.now()}-${v.length}`, text, level }]);
    sayInTerminal(text);
  };

  const runPrepare = async () => {
    if (!currentProject || running) return;
    setRunning(true); setResultState('running'); setLogs([]); setArtifact('');
    const cwd = getProjectDir(currentProject);
    await startBackground(`${copy.title}: Prepare`);
    try {
      // prepare в терминале (или JS-фолбэк, если нет терминала)
      if (terminalReadyRef.current) {
        const ok = await runInTerminal('prepare.sh — 7 шагов SDK37', '([ -f prepare.sh ] && bash prepare.sh) || echo "prepare.sh нет — используйте Android APK"', { timeoutMs: 30 * 60 * 1000, cwd });
        if (!ok) throw new Error('prepare не завершился — смотрите терминал');
      } else {
        const r = await prepareProject(currentProject, { download: true });
        if (!r.success) throw new Error(r.output || 'prepare failed');
      }
      setResultState('success');
    } catch (e) { append(e?.message || String(e), 'error'); setResultState('error'); }
    finally { setRunning(false); await stopBackground(); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80); }
  };

  const run = async (selected = task) => {
    if (!currentProject || running) return;
    // Prepare имеет собственный цикл и свою проверку running — вызываем ДО setRunning(true),
    // иначе runPrepare мгновенно выходит по флагу и подготовка никогда не стартует.
    if (selected === 'prepare') {
      return runPrepare();
    }
    setRunning(true); setResultState('running'); setLogs([]); setArtifact('');
    const cwd = getProjectDir(currentProject);
    // Фоновая служба: долгая сборка (npm install / vite / gradle) продолжается,
    // даже если приложение свернуть или заблокировать экран.
    await startBackground(`${copy.title}: ${selected === 'android' ? `APK ${variant.toUpperCase()}` : (tasks[selected]?.label || selected)}`);
    try {
      sayInTerminal(`🔧 ${selected === 'android' ? `APK ${variant.toUpperCase()}` : (tasks[selected]?.label || selected)} — ${currentProject.name}`);
      if (selected === 'dev') {
        // dev-server не ждёт завершения — запускаем в фоне и показываем PID
        await runInTerminal('Vite dev (фоновый)', 'nohup npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/vite.log 2>&1 & echo $!', { timeoutMs: 30000, cwd });
        sayInTerminal('Откройте http://localhost:5173 или предпросмотр в приложении');
        setResultState('success');
        return;
      }
      if (selected === 'build') {
        // Только Vite (быстро) — как просили, без APK
        await runInTerminal('install vite (если нужно)', '[ -f node_modules/.bin/vite ] || npm install --silent 2>&1 | tail -10', { timeoutMs: 10 * 60 * 1000, cwd });
        const okBuild = await runInTerminal('vite build', 'npm run build 2>&1', { timeoutMs: 20 * 60 * 1000, cwd });
        if (!okBuild) throw new Error('vite build не завершился — смотрите терминал');
        // Копируем в android/assets
        await runInTerminal('cp dist → android/assets', 'mkdir -p android/app/src/main/assets && rm -rf android/app/src/main/assets/* && cp -r dist/* android/app/src/main/assets/ 2>/dev/null; ls -lh dist/index.html 2>&1 | head -1', { timeoutMs: 60000, cwd });
        const probe = await execute('ls -lh dist/index.html 2>/dev/null && echo FOUND || echo MISSING', cwd);
        if (/FOUND/.test(probe.output || '')) setArtifact(`${cwd}/dist`);
        setResultState('success'); addWorkspaceLog(`vite build: ${copy.success}`, 'success');
      } else if (selected === 'android') {
        // Полный APK/AAB пайплайн в ТЕРМИНАЛЕ: подготовка → npm install → vite build → gradle.
        const gradleTask = variant === 'aab' ? 'bundleRelease' : variant === 'release' ? 'assembleRelease' : 'assembleDebug';
        const label = variant === 'aab' ? 'AAB (bundleRelease)' : `APK ${variant.toUpperCase()}`;

        // Шаг 1. Обновляем android-скелет проекта из текущего шаблона конструктора
        // (MainActivity на WebViewAssetLoader, зависимости, иконки, скрипты) — так
        // старые проекты получают исправления автоматически, без пересоздания.
        // Пользовательский код (src/*) и подпись при этом не трогаются.
        try {
          // Самолечение: восстанавливаем отсутствующие файлы шаблона (прерванное
          // создание, случайное удаление) — существующие файлы не трогаются.
          const integ = await ensureProjectIntegrity(currentProject);
          if (integ?.restored?.length) append(`✓ Восстановлены файлы проекта: ${integ.restored.join(', ')}`, 'warning');
          // Убираем MainActivity по старому package-пути (если пакет меняли в настройках).
          await execute('rm -rf android/app/src/main/java', cwd);
          const rr = await refreshAndroidScaffold(currentProject);
          append(rr?.success ? `✓ ${rr.output || 'Android-шаблон обновлён'}` : `⚠ ${rr?.output || 'не удалось обновить android-шаблон'}`, rr?.success ? 'success' : 'warning');
        } catch (e) {
          append(`⚠ не удалось обновить android-шаблон: ${e?.message || String(e)}`, 'warning');
        }

        // Шаг 2. Автоподготовка (Gradle Wrapper, SDK, local.properties) — отдельная кнопка
        // Prepare больше не нужна: prepare.sh идемпотентен и быстро пропускает уже готовые
        // шаги. Предупреждения подготовки не останавливают сборку — судьбу решает Gradle.
        const okPrep = await runInTerminal('prepare.sh — подготовка проекта (авто)', '([ -f prepare.sh ] && bash prepare.sh) || echo "prepare.sh не найден — пропускаю подготовку"', { timeoutMs: 30 * 60 * 1000, cwd });
        if (!okPrep) append('⚠ Подготовка завершилась с предупреждением — продолжаю сборку', 'warning');

        // Шаг 3. Сборка: npm install → vite build → dist в assets → gradle.
        const ok = await runInTerminal(
          label,
          `( [ -f node_modules/.bin/vite ] || npm install --silent 2>&1 | tail -10 ) && npm run build 2>&1 &&` +
          `mkdir -p android/app/src/main/assets && rm -rf android/app/src/main/assets/* && cp -r dist/* android/app/src/main/assets/ 2>/dev/null &&` +
          `cd android && ./gradlew ${gradleTask} --no-daemon --console=plain --warning-mode=none 2>&1`,
          { timeoutMs: 120 * 60 * 1000, cwd }
        );
        if (!ok) throw new Error('Сборка не завершилась — смотрите терминал');

        // Ищем APK или AAB
        const sub = variant === 'aab' ? 'bundle/release' : `apk/${variant === 'release' ? 'release' : 'debug'}`;
        const ext = variant === 'aab' ? 'aab' : 'apk';
        const probe = await execute(`find android/app/build/outputs/${sub} -name '*.${ext}' 2>/dev/null | head -1`, cwd);
        const outPath = String(probe.output || '').trim();
        if (outPath) {
          const absArtifact = outPath.startsWith('/') ? outPath : `${cwd}/${outPath}`;
          setArtifact(absArtifact);
          sayInTerminal(`✅ ${variant === 'aab' ? 'AAB' : 'APK'}: ${outPath}`);
          // Проверка артефакта: aapt2 разбирает APK лучше любого инсталлятора —
          // если файл повреждён (Xiaomi/Samsung «не открывается»), узнаем сразу.
          await runInTerminal('проверка артефакта (aapt2)',
            `SDK="$ANDROID_HOME"; [ -n "$SDK" ] || SDK="$HOME/android-sdk"; BT=$(ls "$SDK/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1);` +
            `if [ -x "$SDK/build-tools/$BT/aapt2" ]; then "$SDK/build-tools/$BT/aapt2" dump badging ${shellQuote(absArtifact)} 2>/dev/null | grep -E '^(package|application-label|sdkVersion|targetSdkVersion|native-code):' | head -7 || echo 'aapt2 не смог разобрать файл — APK повреждён?';` +
            `else echo 'aapt2 не найден — пропускаю проверку'; fi`,
            { timeoutMs: 60000, cwd });
          // Экспорт в общую папку: Загрузки → NovaCompose → <Проект> → apk.
          const slugName = slugifyProject(currentProject.name || 'app') || 'app';
          const artifactFile = `${slugName}-v${currentProject.versionName || '1.0.0'}-${variant}.${ext}`;
          const exportDir = `/sdcard/Download/NovaCompose/${currentProject.name || slugName}/apk`;
          const okExport = await runInTerminal('экспорт в Загрузки',
            `DEST=${shellQuote(exportDir)}; mkdir -p "$DEST" 2>/dev/null && cp -f ${shellQuote(absArtifact)} "$DEST/${artifactFile}" && ls -lh "$DEST/${artifactFile}"`,
            { timeoutMs: 60000, cwd });
          if (okExport) { append(`✓ Экспортировано: ${exportDir}/${artifactFile}`, 'success'); addWorkspaceLog(`APK экспортирован: ${exportDir}/${artifactFile}`, 'success'); }
          else append(`⚠ Не удалось записать в ${exportDir} — проверьте доступ к хранилищу (APK остался в папке проекта)`, 'warning');
          setResultState('success'); addWorkspaceLog(`${variant} ${variant === 'aab' ? 'aab' : 'apk'}: ${copy.success}`, 'success');
        } else {
          // Артефакта нет — не притворяемся успехом и не показываем кнопку установки.
          setArtifact('');
          sayInTerminal('❌ Сборка завершилась, но файл артефакта не найден — проверьте терминал');
          setResultState('error');
          const msg = ru ? 'Сборка завершилась, но файл артефакта не найден — проверьте терминал' : 'Build finished but the artifact file was not found — check the terminal';
          addWorkspaceLog(msg, 'error'); append(`✗ ${msg}`, 'error');
        }
      }
    } catch (e) { append(e?.message || String(e), 'error'); setResultState('error'); addWorkspaceLog(String(e), 'error'); }
    finally {
      setRunning(false);
      await stopBackground();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const installDebug = async () => {
    // RuStore: REQUEST_INSTALL_PACKAGES удалён, поэтому прямая установка
    // из приложения невозможна. Пробуем apt.installApk (откроет chooser),
    // при ошибке — предлагаем «Поделиться» и показываем путь в Загрузки.
    const path = artifact && artifact.endsWith('.apk') ? artifact : `${getProjectDir(currentProject)}/android/app/build/outputs/apk/debug/app-debug.apk`;
    let probe;
    try { probe = await execute(`test -s '${path}' && echo FOUND || echo MISSING`); } catch (e) { probe = null; }
    if (!/FOUND/.test(probe?.output || '')) {
      const msg = ru ? `APK не найден: ${path} — сначала выполните сборку (кнопка «Запустить»)` : `APK not found: ${path} — run a build first`;
      append(`✗ ${msg}`, 'error'); addWorkspaceLog(msg, 'error');
      return;
    }
    append(`$ install ${path}`, 'command');
    const r = await apt.installApk?.(path);
    if (r?.success) {
      append(ru ? `Запрос на открытие APK отправлен: ${r.output || path}` : `Open APK requested: ${r.output || path}`, 'success');
      return;
    }
    // Ошибка — для RuStore показываем дружелюбную инструкцию + Share
    const errText = r?.output || (ru ? 'Прямая установка отключена для RuStore' : 'Direct install disabled for RuStore');
    append(`✗ ${errText}`, 'error');
    // APK уже экспортирован в /sdcard/Download/NovaCompose/... — предлагаем поделиться
    const exportHint = ru
      ? `APK сохранён в Загрузки/NovaCompose/${currentProject.name}/apk — откройте его через системный файловый менеджер для установки.`
      : `APK exported to Downloads/NovaCompose/${currentProject.name}/apk — open it via system file manager to install.`;
    append(exportHint, 'warning');
    addWorkspaceLog(`${errText}\n${exportHint}`, 'warning');
    // Пробуем системный Share (пользователь выберет файловый менеджер / Telegram / Drive)
    try {
      await Share.share({ message: ru ? `APK: ${path}` : `APK: ${path}`, title: ru ? 'Поделиться APK' : 'Share APK' });
    } catch (_) {}
  };

  // «Журнал» — расшарить ПОЛНЫЙ вывод сборки. Весь вывод идёт в нативный терминал,
  // поэтому в первую очередь забираем его транскрипт (весь скроллбэк), а state-массив
  // logs и build.log — только запасные варианты.
  const shareJournal = async () => {
    let text = '';
    try {
      const t = await terminalRef.current?.getTranscriptText?.();
      if (t && String(t).trim()) text = String(t).trim();
    } catch (e) {}
    if (!text) text = logs.map(l => l.text).join('\n').trim();
    if (!text) {
      try {
        const cwd = getProjectDir(currentProject);
        const f = await execute('cat build.log 2>/dev/null', cwd);
        if (f?.output && f.output.trim()) text = `=== build.log (${cwd}/build.log) ===\n${f.output}`;
      } catch (e) {}
    }
    if (!text) text = ru ? '(журнал пуст — запустите сборку)' : '(log empty — run a build)';
    try { await Share.share({ message: text, title: ru ? 'Журнал сборки' : 'Build log' }); }
    catch (e) { append(`${ru ? 'Не удалось открыть' : 'Share failed'}: ${e?.message || e}`, 'error'); }
  };

  if (!currentProject) return <AppScreen><TopBar title={copy.title} onBack={() => navigation.goBack()} /><View style={styles.empty}><Icon name="logo-react" size={40} color={colors.textTertiary} /><Text style={styles.muted}>{copy.noProject}</Text></View></AppScreen>;

  const cur = tasks[task];

  return (
    <AppScreen>
      <TopBar title={copy.title} subtitle={`${currentProject.name} · ${copy.subtitle}`} onBack={() => navigation.goBack()} right={<IconButton name="options-outline" label={width >= 720 ? 'Настройки' : null} onPress={() => navigation.navigate('ProjectSettings')} />} />
      <View style={[styles.main, !desktop && styles.mainMobile]}>
        <ScrollView style={[styles.settingsPane, !desktop && styles.settingsMobile]} contentContainerStyle={styles.settingsContent}>
          <SectionCard title={copy.choose} icon="hammer-outline">
            <OptionPicker value={task} onChange={setTask} grid={useGridPicker} colors={colors} options={Object.entries(tasks).map(([v, it]) => ({ value: v, label: it.label, icon: it.icon }))} />
            <View style={styles.taskSummary}>
              <View style={styles.taskIcon}><Icon name={cur.icon} size={23} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>
                <Text style={styles.taskTitle} numberOfLines={1}>{cur.label}</Text>
                <Text style={styles.taskMeta} numberOfLines={1}>{task === 'android' ? (variant === 'aab' ? 'bundleRelease' : variant === 'release' ? 'assembleRelease' : 'assembleDebug') : cur.cmd}</Text>
                <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, marginTop: 2 }}>{cur.desc}</Text>
              </View>
              <View style={{ flexShrink: 0 }}>
                <StatusPill label={cur.label} tone={cur.tone} />
              </View>
            </View>
          </SectionCard>
          {task === 'android' ? (
            <SectionCard title={ru ? 'Тип сборки' : 'Build type'} icon={variant === 'aab' ? 'cube-outline' : variant === 'release' ? 'lock-closed-outline' : 'bug-outline'}>
              <OptionPicker value={variant} onChange={setVariant} grid={useGridPicker} colors={colors} options={[
                { value: 'debug', label: 'Debug', icon: 'bug-outline' },
                { value: 'release', label: 'Release', icon: 'lock-closed-outline' },
                { value: 'aab', label: 'AAB', icon: 'cube-outline' },
              ]} />
              <Text style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 6 }}>
                {variant === 'aab'
                  ? (ru ? 'AAB: bundleRelease для Google Play (подпись из keystore.properties).' : 'AAB: bundleRelease for Google Play (signed via keystore.properties).')
                  : variant === 'release'
                    ? (ru ? 'Release: R8 + minify + подпись. Нужен keystore.properties; иначе APK будет неподписан.' : 'Release: R8 + minify + signing. Needs keystore.properties; otherwise unsigned APK.')
                    : (ru ? 'Debug: app-debug.apk с debug-keystore. Подходит для установки и теста.' : 'Debug: app-debug.apk with debug keystore. Good for install & test.')}
              </Text>
            </SectionCard>
          ) : null}
          <View style={styles.note}><Icon name="information-circle-outline" size={17} color={colors.info} /><Text style={styles.noteText}>{copy.note}</Text></View>
          <View style={{ flexDirection: stackButtons ? 'column' : 'row', gap: 8 }}>
            <PrimaryButton title={running ? copy.running : (task === 'android' ? `${copy.run} · ${variant === 'aab' ? 'AAB' : variant === 'release' ? 'Release' : 'Debug'}` : copy.run)} icon="hammer-outline" loading={running} onPress={() => run()} style={stackButtons ? { width: '100%' } : { flex: 1 }} />
            <IconButton name="shield-checkmark-outline" label="Prepare" loading={running} onPress={runPrepare} style={stackButtons ? { width: '100%' } : { flex: 1 }} />
          </View>
          <IconButton name="trash-outline" label={copy.clean} disabled={running} onPress={async () => { await execute('rm -rf dist android/app/src/main/assets/* android/app/build 2>/dev/null; echo cleaned', getProjectDir(currentProject)); append('cleaned', 'info'); }} />
        </ScrollView>
        <View style={[styles.consoleWrap, !desktop && styles.consoleMobile]}>
          <View style={styles.consoleHead}>{narrow ? null : <View style={styles.dots}><View style={[styles.dot, { backgroundColor: '#F87171' }]} /><View style={[styles.dot, { backgroundColor: '#FBBF24' }]} /><View style={[styles.dot, { backgroundColor: '#34D399' }]} /></View>}<Text style={styles.consoleTitle} numberOfLines={1}>{copy.terminal}</Text><View style={{ flex: 1 }} />
            {narrow ? null : <IconButton name="remove-outline" onPress={() => setFontSize(v => Math.max(10, v - 2))} />}
            {narrow ? null : <IconButton name="add-outline" onPress={() => setFontSize(v => Math.min(34, v + 2))} />}
            {!narrow && resultState !== 'idle' ? <StatusPill label={resultState === 'success' ? copy.success : resultState === 'error' ? 'Error' : '…'} tone={resultState === 'success' ? 'success' : resultState === 'error' ? 'error' : 'info'} /> : null}
            <Pressable onPress={shareJournal} style={[styles.clear, { flexDirection: 'row', gap: 4, backgroundColor: '#253046', paddingHorizontal: 8, borderRadius: 6 }]}><Icon name="share-outline" size={13} color="#4ADE80" />{narrow ? null : <Text style={{ color: '#4ADE80', fontSize: 10, fontWeight: '700' }}>{ru ? 'Журнал' : 'Log'}</Text>}</Pressable>
            <Pressable onPress={clearConsole} style={styles.clear}><Icon name="trash-outline" size={14} color="#8B98AD" /></Pressable>
          </View>
          {terminalAvailable() ? (
            <View style={styles.consoleTerminalWrap}>
              <TerminalView
                ref={terminalRef}
                style={styles.consoleTerminal}
                fontSize={fontSize}
                extraKeys={EXTRA_KEYS}
                readOnly
                workingDirectory={getProjectDir(currentProject)}
                initialCommand={ru ? 'echo "Сборка: ' + currentProject.name + ' (proot). Нажмите «Запустить»."' : 'echo "Build: ' + currentProject.name + ' (proot). Press Run."'}
                onTerminalEvent={onTerminalEvent}
              />
            </View>
          ) : (
            <ScrollView ref={scrollRef} style={styles.console} contentContainerStyle={styles.consoleContent} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
              {!logs.length ? <View style={styles.consoleEmpty}><Icon name="logo-react" size={30} color="#526079" /><Text style={styles.consoleEmptyText}>{cur.cmd}</Text></View> : logs.map(l => <Text selectable key={l.id} style={[styles.log, l.level === 'command' && styles.command, l.level === 'success' && styles.success, l.level === 'error' && styles.error, l.level === 'warning' && styles.warning]}>{l.text}</Text>)}
            </ScrollView>
          )}
          {artifact ? <View style={styles.artifactBar}><Icon name="cube-outline" size={20} color={colors.success} /><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.artifactLabel}>{copy.artifact}</Text><Text style={styles.artifactPath} numberOfLines={1}>{artifact}</Text></View><PrimaryButton title={narrow ? '' : copy.install} icon="download-outline" disabled={!artifact.endsWith('.apk')} onPress={installDebug} style={narrow ? { width: 46, paddingHorizontal: 0 } : null} /></View> : null}
          <AdsBanner />
        </View>
      </View>
    </AppScreen>
  );
};

const createStyles = c => StyleSheet.create({
  main: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'row', overflow: 'hidden' },
  mainMobile: { flexDirection: 'column' },
  settingsPane: { width: '40%', maxWidth: 440, minWidth: 340, flexGrow: 0 },
  settingsMobile: { width: '100%', maxWidth: '100%', minWidth: 0, flex: 0, maxHeight: '53%' },
  settingsContent: { padding: 13, gap: 12, paddingBottom: 40 },
  taskSummary: { minHeight: 66, padding: 10, borderRadius: 11, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  taskIcon: { width: 43, height: 43, borderRadius: 11, backgroundColor: c.primarySurface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  taskTitle: { color: c.text, fontSize: 13, fontWeight: '750' },
  taskMeta: { color: c.textTertiary, fontFamily: 'monospace', fontSize: 9, marginTop: 3 },

  note: { padding: 11, borderRadius: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.infoBg },
  noteText: { flex: 1, minWidth: 0, color: c.infoText, fontSize: 10, lineHeight: 16 },

  consoleWrap: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c.terminal, borderLeftWidth: 1, borderLeftColor: '#253046' },
  consoleMobile: { width: '100%', borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: '#253046' },
  consoleHead: { height: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: c.terminalRaised, borderBottomWidth: 1, borderBottomColor: '#253046' },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  consoleTitle: { color: '#D6DEEB', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  clear: { padding: 7 },
  // Отступ слева/справа: строки терминала не рисуются впритык к краю экрана
  // (на телефоне без этого первые символы строк срезаются скруглением).
  consoleTerminalWrap: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c.terminal, paddingHorizontal: 10 },
  consoleTerminal: { flex: 1, backgroundColor: c.terminal },
  console: { flex: 1 },
  consoleContent: { padding: 14, paddingBottom: 40 },
  consoleEmpty: { minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 9 },
  consoleEmptyText: { color: '#526079', fontFamily: 'monospace', fontSize: 10 },
  log: { color: '#C9D3E3', fontFamily: 'monospace', fontSize: 10, lineHeight: 17 },
  command: { color: '#FFFFFF', fontWeight: '700', marginTop: 8 },
  success: { color: '#4ADE80' },
  error: { color: '#F87171' },
  warning: { color: '#FBBF24' },
  artifactBar: { minHeight: 64, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: c.bgCard, borderTopWidth: 1, borderTopColor: c.border },
  artifactLabel: { color: c.text, fontSize: 10, fontWeight: '700' },
  artifactPath: { color: c.textSecondary, fontFamily: 'monospace', fontSize: 8, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9 },
  muted: { color: c.textSecondary },
});

export default BuildScreen;
