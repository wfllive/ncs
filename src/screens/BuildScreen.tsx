// Экран сборки: КАСТОМНЫЙ пайплайн без Gradle (aapt2 → javac → d8 → zipalign → apksigner).
// @ts-nocheck — экран собран по образцу прежнего, типы не строже исходника.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, IconButton, PrimaryButton, SectionCard, SegmentedControl, StatusPill, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { execute } from '../utils/shellExecutor';
import { shellQuote } from '../utils/workspace';
import { getProjectDir, slugifyProject } from '../config/runtime';
import { syncJavaProject, ensureJavaProjectIntegrity, refreshJavaScaffold } from '../utils/javaProject';
import { checkBuildEnv } from '../utils/nativeBuild';
import * as apt from '../../modules/apt-manager/src/index';
import { startBackground, stopBackground } from '../utils/background';
import { TerminalView, isAvailable as terminalAvailable, copyToClipboard } from '../../modules/termux-terminal/src/index';
import AdsBanner from '../components/AdsBanner';
import { maybeShowInterstitial } from '../ads/yandexAds';

// Терминал сборки — только вывод: ручной ввод запрещён, всё запускается кнопками.
const EXTRA_KEYS = '[]';

const tasks = {
  debug: { icon: 'bug-outline', label: 'Debug APK', cmd: 'bash build.sh debug', desc: 'быстрая сборка (D8) с debug-подписью', tone: 'success' },
  release: { icon: 'lock-closed-outline', label: 'Release APK', cmd: 'bash build.sh release', desc: 'R8 + подпись из storm.m', tone: 'warning' },
  aab: { icon: 'cube-outline', label: 'AAB (Play)', cmd: 'bash build.sh aab', desc: 'Android App Bundle для магазинов', tone: 'info' },
  keystore: { icon: 'key-outline', label: 'Ключ подписи', cmd: 'bash build.sh keystore', desc: 'release-keystore для публикации', tone: 'info' },
  clean: { icon: 'trash-outline', label: 'Очистка', cmd: 'bash build.sh clean', desc: 'удалить артефакты сборки', tone: 'info' },
};

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
  const [task, setTask] = useState('debug');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [resultState, setResultState] = useState('idle');

  useEffect(() => {
    if (resultState === 'success' && (task === 'debug' || task === 'release')) void maybeShowInterstitial();
  }, [resultState]);

  const [artifact, setArtifact] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const scrollRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalReadyRef = useRef(false);
  const terminalPendingRef = useRef([]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  const desktop = width >= 800;
  const narrow = width < 560;
  const useGridPicker = width < 620;
  const stackButtons = width < 400;
  const ru = language === 'ru';

  const copy = ru ? {
    title: 'Сборка', subtitle: 'Java + XML · без Gradle', choose: 'Задача сборки', run: 'Запустить', running: 'Выполняется…', success: 'Успешно', failed: 'Ошибка',
    terminal: 'Журнал сборки', clear: 'Очистить', install: 'Установить APK', launch: 'Открыть',
    note: 'Кастомный пайплайн: aapt2 → javac → d8 → zipalign → apksigner. Без Gradle-демона и разрешения зависимостей — сборка занимает секунды. Перед сборкой исходники экранов автоматически записываются на диск.',
    noProject: 'Сначала откройте проект.', artifact: 'Артефакт', clean: 'Очистить',
  } : {
    title: 'Build', subtitle: 'Java + XML · no Gradle', choose: 'Build task', run: 'Run', running: 'Running…', success: 'Success', failed: 'Failed',
    terminal: 'Build log', clear: 'Clear', install: 'Install APK', launch: 'Open',
    note: 'Custom pipeline: aapt2 → javac → d8 → zipalign → apksigner. No Gradle daemon, no dependency resolution — builds take seconds. Screen sources are written to disk automatically before the build.',
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

  // Строки журнала выводим комментариями bash, чтобы терминал не пытался их выполнить.
  const sayInTerminal = (text) => {
    const s = String(text ?? '').replace(/\r/g, '');
    writeTerminal(s.split('\n').map((l) => (l ? `# ${l}` : '')).join('\n'));
  };

  // Выполнить команду внутри терминала (PTY), вернуть true/false по маркеру.
  const runInTerminal = async (label, command, { timeoutMs = 30 * 60 * 1000, cwd } = {}) => {
    if (!terminalReadyRef.current) {
      append(`$ ${label}`, 'command');
      const r = await execute(`${command} 2>&1; echo RC:$?`, cwd);
      String(r.output || '').split('\n').filter(Boolean).forEach((l) => append(l));
      return /RC:0\b/.test(r.output || '');
    }
    const marker = '/root/.rai-build.done';
    const full = `echo "" > ${marker}; cd ${cwd ? shellQuote(cwd) : '$PWD'} && ${command}; rc=$?; echo "rc:$rc" > ${marker}`;
    sayInTerminal(`── ${label} ──`);
    try { terminalRef.current?.writeText?.(full + '\n'); } catch (_) {}
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
      await new Promise((r) => setTimeout(r, 1200));
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
    try { terminalRef.current?.writeText?.('\u001b[2J\u001b[H'); } catch (_) {}
  };

  const append = (text, level = 'normal') => {
    setLogs(v => [...v, { id: `${Date.now()}-${v.length}`, text, level }]);
    sayInTerminal(text);
  };

  const run = async () => {
    if (!currentProject || running) return;
    const selected = task;
    setRunning(true); setResultState('running'); setArtifact('');
    const cwd = getProjectDir(currentProject);
    await startBackground(`${copy.title}: ${tasks[selected].label}`);
    try {
      if (selected === 'clean') {
        const ok = await runInTerminal('build.sh clean', 'bash build.sh clean', { timeoutMs: 2 * 60 * 1000, cwd });
        if (!ok) throw new Error('Очистка не завершилась');
        setArtifact('');
        setResultState('success');
        return;
      }
      if (selected === 'keystore') {
        const ok = await runInTerminal('build.sh keystore (storm keygen)', 'bash build.sh keystore', { timeoutMs: 5 * 60 * 1000, cwd });
        if (!ok) throw new Error('Не удалось создать keystore');
        setResultState('success');
        return;
      }

      // Шаг 1. Синхронизация исходников на диск (макеты + Activity + манифест).
      try {
        const integ = await ensureJavaProjectIntegrity(currentProject);
        if (integ?.restored?.length) append(`✓ Восстановлены файлы проекта: ${integ.restored.join(', ')}`, 'warning');
        const sync = await syncJavaProject(currentProject);
        append(sync?.success ? `✓ ${sync.output}` : `⚠ ${sync?.output || 'синхронизация не удалась'}`, sync?.success ? 'success' : 'warning');
        const rf = await refreshJavaScaffold(currentProject);
        if (rf?.success) append('✓ Сборщик актуален (build.sh)', 'info');
      } catch (e) {
        append(`⚠ не удалось синхронизировать исходники: ${e?.message || String(e)}`, 'warning');
      }

      // Шаг 2. Окружение: JDK + build-tools + платформа (без сети).
      const env = await checkBuildEnv();
      String(env.output || '').split('\n').filter(Boolean).forEach((l) => append(l, 'info'));
      if (!env.ok) {
        env.problems.forEach((p) => append(`⚠ ${p}`, 'error'));
        throw new Error('Окружение не готово — откройте страницу установки среды');
      }

      // Шаг 3. Кастомная сборка (без Gradle) — пайплайн выполняет Storm Build.
      const label = selected === 'release' ? 'Release APK (Storm Build)' : selected === 'aab' ? 'AAB (Storm Build)' : 'Debug APK (Storm Build)';
      const ok = await runInTerminal(label, `bash build.sh ${selected}`, { timeoutMs: 30 * 60 * 1000, cwd });
      if (!ok) throw new Error('Сборка не завершилась — смотрите терминал');

      // Шаг 4. Артефакт: найти, проверить (aapt2), экспортировать в Загрузки.
      const slug = String(currentProject.slug || slugifyProject(currentProject.name || 'app') || 'app').replace(/[^a-z0-9-]/g, '-');
      const ext = selected === 'aab' ? 'aab' : 'apk';
      const probe = await execute(`find build/outputs -name '*.${ext}' 2>/dev/null | head -1`, cwd);
      const outPath = String(probe.output || '').trim();
      if (outPath) {
        const absArtifact = outPath.startsWith('/') ? outPath : `${cwd}/${outPath}`;
        setArtifact(absArtifact);
        sayInTerminal(`✅ ${ext.toUpperCase()}: ${absArtifact}`);
        if (ext === 'apk') {
        await runInTerminal('проверка артефакта (aapt2)',
          `SDK="\${ANDROID_HOME:-$HOME/android-sdk}"; BT=$(ls "$SDK/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1);` +
          `if [ -x "$SDK/build-tools/$BT/aapt2" ]; then "$SDK/build-tools/$BT/aapt2" dump badging ${shellQuote(absArtifact)} 2>/dev/null | grep -E '^(package|application-label|sdkVersion|targetSdkVersion|launchable-activity):' | head -7 || echo 'aapt2 не смог разобрать файл'; ` +
          `else echo 'aapt2 не найден — пропускаю проверку'; fi`,
          { timeoutMs: 60000, cwd });
        }
        const artifactFile = `${slug}-v${currentProject.versionName || '1.0.0'}-${selected}.${ext}`;
        const exportDir = `/sdcard/Download/NovaJava/${currentProject.name || slug}/apk`;
        const okExport = await runInTerminal('экспорт в Загрузки',
          `DEST=${shellQuote(exportDir)}; mkdir -p "$DEST" 2>/dev/null && cp -f ${shellQuote(absArtifact)} "$DEST/${artifactFile}" && ls -lh "$DEST/${artifactFile}"`,
          { timeoutMs: 60000, cwd });
        if (okExport) { append(`✓ Экспортировано: ${exportDir}/${artifactFile}`, 'success'); addWorkspaceLog(`${ext.toUpperCase()} экспортирован: ${exportDir}/${artifactFile}`, 'success'); }
        else append(`⚠ Не удалось записать в ${exportDir} — артефакт остался в папке проекта`, 'warning');
        setResultState('success'); addWorkspaceLog(`${selected} ${ext}: ${copy.success}`, 'success');
      } else {
        setArtifact('');
        sayInTerminal(`❌ Сборка завершилась, но ${ext.toUpperCase()} не найден — проверьте терминал`);
        setResultState('error');
        const msg = ru ? `Сборка завершилась, но файл ${ext.toUpperCase()} не найден — проверьте терминал` : `Build finished but the ${ext.toUpperCase()} file was not found — check the terminal`;
        addWorkspaceLog(msg, 'error'); append(`✗ ${msg}`, 'error');
      }
    } catch (e) { append(e?.message || String(e), 'error'); setResultState('error'); addWorkspaceLog(String(e), 'error'); }
    finally {
      setRunning(false);
      await stopBackground();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const installDebug = async () => {
    const path = artifact && artifact.endsWith('.apk') ? artifact : `${getProjectDir(currentProject)}/build/outputs/app-debug.apk`;
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
      append(ru ? `Запрос на установку APK отправлен: ${r.output || path}` : `Install APK requested: ${r.output || path}`, 'success');
      // Сразу предложим запустить приложение после установки
      if (currentProject?.packageName) {
        setTimeout(async () => {
          const lr = await apt.launchPackage?.(currentProject.packageName);
          if (lr?.success) append(ru ? 'Приложение запущено' : 'App launched', 'success');
        }, 2500);
      }
      return;
    }
    append(ru ? `Не удалось установить автоматически — файл: ${path}` : `Auto-install failed — file: ${path}`, 'warning');
  };

  const shareJournal = async () => {
    try {
      const text = logs.map(l => l.text).join('\n') || 'Build log is empty';
      await Share.share({ title: 'NovaJava build log', message: text });
    } catch (_) {}
  };

  // «Скопировать» — транскрипт терминала (или JS-журнал) в буфер обмена:
  // удобно вставить вывод в чат/багрепорт.
  const [copied, setCopied] = useState(false);
  const copyJournal = async () => {
    try {
      let text = '';
      try { text = (await terminalRef.current?.getTranscriptText?.()) || ''; } catch (_) {}
      if (!text || !text.trim()) text = logs.map(l => l.text).join('\n');
      await copyToClipboard(text || 'Build log is empty');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const cur = tasks[task];

  if (!currentProject) {
    return (
      <AppScreen>
        <TopBar title={copy.title} subtitle={copy.subtitle} navigation={navigation} />
        <View style={styles.empty}><Icon name="hammer-outline" size={34} color={colors.textTertiary} /><Text style={styles.muted}>{copy.noProject}</Text></View>
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <TopBar title={copy.title} subtitle={copy.subtitle} navigation={navigation} />
      <View style={[styles.main, !desktop && styles.mainMobile]}>
        <ScrollView style={[styles.settingsPane, !desktop && styles.settingsMobile]} contentContainerStyle={styles.settingsContent}>
          <SectionCard title={copy.choose} icon="hammer-outline">
            <OptionPicker value={task} onChange={setTask} grid={useGridPicker} colors={colors} options={Object.entries(tasks).map(([v, it]) => ({ value: v, label: it.label, icon: it.icon }))} />
            <View style={styles.taskSummary}>
              <View style={styles.taskIcon}><Icon name={cur.icon} size={23} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>
                <Text style={styles.taskTitle} numberOfLines={1}>{cur.label}</Text>
                <Text style={styles.taskMeta} numberOfLines={1}>{cur.cmd}</Text>
                <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, marginTop: 2 }}>{cur.desc}</Text>
              </View>
              <View style={{ flexShrink: 0 }}>
                <StatusPill label={cur.label} tone={cur.tone} />
              </View>
            </View>
          </SectionCard>
          <View style={styles.note}><Icon name="information-circle-outline" size={17} color={colors.info} /><Text style={styles.noteText}>{copy.note}</Text></View>
          <PrimaryButton title={running ? copy.running : copy.run} icon="hammer-outline" loading={running} onPress={() => run()} style={{ width: '100%' }} />
          <IconButton name="flash-outline" label={ru ? 'Быстрая проверка окружения' : 'Quick env check'} disabled={running} onPress={async () => {
            const env = await checkBuildEnv();
            String(env.output || '').split('\n').filter(Boolean).forEach((l) => append(l, 'info'));
            if (env.ok) append('✓ окружение готово к сборке', 'success');
            else env.problems.forEach((p) => append(`⚠ ${p}`, 'warning'));
          }} />
        </ScrollView>
        <View style={[styles.consoleWrap, !desktop && styles.consoleMobile]}>
          <View style={styles.consoleHead}>{narrow ? null : <View style={styles.dots}><View style={[styles.dot, { backgroundColor: '#F87171' }]} /><View style={[styles.dot, { backgroundColor: '#FBBF24' }]} /><View style={[styles.dot, { backgroundColor: '#34D399' }]} /></View>}<Text style={styles.consoleTitle} numberOfLines={1}>{copy.terminal}</Text><View style={{ flex: 1 }} />
            {narrow ? null : <IconButton name="remove-outline" onPress={() => setFontSize(v => Math.max(10, v - 2))} />}
            {narrow ? null : <IconButton name="add-outline" onPress={() => setFontSize(v => Math.min(34, v + 2))} />}
            {!narrow && resultState !== 'idle' ? <StatusPill label={resultState === 'success' ? copy.success : resultState === 'error' ? 'Error' : '…'} tone={resultState === 'success' ? 'success' : resultState === 'error' ? 'error' : 'info'} /> : null}
            <Pressable onPress={shareJournal} style={[styles.clear, { flexDirection: 'row', gap: 4, backgroundColor: '#253046', paddingHorizontal: 8, borderRadius: 6 }]}><Icon name="share-outline" size={13} color="#4ADE80" />{narrow ? null : <Text style={{ color: '#4ADE80', fontSize: 10, fontWeight: '700' }}>{ru ? 'Журнал' : 'Log'}</Text>}</Pressable>
            <Pressable onPress={copyJournal} style={[styles.clear, { flexDirection: 'row', gap: 4, backgroundColor: '#253046', paddingHorizontal: 8, borderRadius: 6 }]}><Icon name={copied ? 'checkmark-outline' : 'copy-outline'} size={13} color="#7FB8E8" />{narrow ? null : <Text style={{ color: '#7FB8E8', fontSize: 10, fontWeight: '700' }}>{copied ? (ru ? 'Готово' : 'Done') : (ru ? 'Копия' : 'Copy')}</Text>}</Pressable>
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
                initialCommand={ru ? 'echo "Кастомная сборка: ' + currentProject.name + ' (без Gradle). Нажмите «Запустить»."' : 'echo "Custom build: ' + currentProject.name + ' (no Gradle). Press Run."'}
                onTerminalEvent={onTerminalEvent}
              />
            </View>
          ) : (
            <ScrollView ref={scrollRef} style={styles.console} contentContainerStyle={styles.consoleContent} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
              {!logs.length ? <View style={styles.consoleEmpty}><Icon name="logo-android" size={30} color="#526079" /><Text style={styles.consoleEmptyText}>{cur.cmd}</Text></View> : logs.map(l => <Text selectable key={l.id} style={[styles.log, l.level === 'command' && styles.command, l.level === 'success' && styles.success, l.level === 'error' && styles.error, l.level === 'warning' && styles.warning]}>{l.text}</Text>)}
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
