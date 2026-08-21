// @ts-nocheck — экран сохранён без визуальных изменений относительно main.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { AppScreen, IconButton, PrimaryButton, SectionCard, StatusPill } from '../components/AppUI';
import { useAppSettings } from '../store/appSettings';
import { SETUP_STEPS, runRaiSetup, runRaiSetupPty, SETUP_STEP_FILE } from '../utils/raiSetup';
import { TerminalView, isAvailable as terminalAvailable } from '../../modules/termux-terminal/src/index';
import {
  startBackground, stopBackground, updateBackground,
  hasStorageAccess, openStorageSettings, requestStoragePermissions,
  hasNotificationPermission, requestNotificationPermission,
} from '../utils/background';
import { execute } from '../utils/shellExecutor';

// Без строки спец-клавиш (ESC/CTRL/...): в установщике она не нужна,
// терминал — для чтения вывода apt/dpkg/rai.
const EXTRA_KEYS = '[]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RaiSetupScreen = ({ onComplete, resume = false, resumeStep = null }) => {
  const { colors, language } = useAppSettings();
  const ru = language === 'ru';
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [phase, setPhase] = useState('idle'); // idle | running | done | error
  const [stepStates, setStepStates] = useState({});
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [fontSize, setFontSize] = useState(24); // крупный шрифт терминала по умолчанию
  const [storageGranted, setStorageGranted] = useState(false);
  const [notifGranted, setNotifGranted] = useState(true);
  const permissionsAskedRef = useRef(false);
  const scrollRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalReadyRef = useRef(false);
  const busyRef = useRef(false);
  const startedAtRef = useRef(0);
  const runRef = useRef(() => {});
  const statusOutputRef = useRef('');

  const copy = {
    title: ru ? 'Установка среды (Storm Build)' : 'Environment setup (Storm Build)',
    subtitle: ru
      ? 'Реальный терминал Ubuntu (proot). Команды идут прямо в нём — можно вводить вручную.'
      : 'Real Ubuntu terminal (proot). Commands run right in it — you can type manually.',
    stepsTitle: ru ? 'Шаги установки' : 'Setup steps',
    start: ru ? 'Начать установку' : 'Start setup',
    resume: ru ? 'Продолжить установку' : 'Resume setup',
    running: ru ? 'Установка идёт…' : 'Installing…',
    retry: ru ? 'Повторить' : 'Retry',
    continueAnyway: ru ? 'Продолжить в проекты' : 'Continue to projects',
    done: ru ? 'Среда готова' : 'Environment is ready',
    doneText: ru
      ? 'JDK и Storm Build готовы: сборка проектов работает без Gradle. Сейчас откроется список проектов.'
      : 'JDK and Storm Build are ready: projects build without Gradle. Opening the project list.',
    background: ru
      ? 'Установка идёт в фоне (foreground service + wakelock). Закрыли приложение? При следующем запуске она сама продолжится с того же шага.'
      : 'Setup runs in the background (foreground service + wakelock). Closed the app? It resumes automatically from the same step.',
    noShell: ru
      ? 'Нативный терминал недоступен. Откройте development-сборку.'
      : 'Native terminal unavailable. Open the development build.',
    logTitle: ru ? 'Терминал Ubuntu' : 'Ubuntu terminal',
    permissionsTitle: ru ? 'Разрешения' : 'Permissions',
    permissionsSub: ru ? 'Нужны для фоновой установки и сохранения APK.' : 'Needed for background setup and saving APKs.',
    storage: ru ? 'Память' : 'Storage',
    storageText: ru
      ? 'Сохранять собранные APK в /sdcard/Download и видеть файлы.'
      : 'Save built APKs to /sdcard/Download and access files.',
    storageGrant: ru ? 'Разрешить доступ' : 'Grant access',
    granted: ru ? 'Разрешено' : 'Granted',
    notGranted: ru ? 'Не разрешено' : 'Not granted',
    notif: ru ? 'Уведомления' : 'Notifications',
    notifText: ru ? 'Показывать статус фоновой установки/сборки.' : 'Show background setup/build status.',
    notifGrant: ru ? 'Разрешить' : 'Allow',
    notifGranted: ru ? 'Разрешены' : 'Allowed',
    notifDenied: ru ? 'Не разрешены' : 'Not allowed',
    resumeInfo: ru
      ? 'Установка не была завершена. Продолжаем с места обрыва — готовые шаги будут пропущены.'
      : 'Setup was not finished. Resuming — finished steps will be skipped.',
    resumeStepInfo: (label) => ru
      ? `Продолжаем с шага: ${label}`
      : `Resuming from step: ${label}`,
    errorText: ru
      ? 'Установка не завершилась. Смотрите терминал выше. «Повторить» пропустит готовые шаги.'
      : 'Setup failed. See the terminal above. Retry skips finished steps.',
    waiting: ru ? 'Запускаю терминал…' : 'Starting terminal…',
  };

  const stepMeta = useMemo(() => {
    const m = {};
    SETUP_STEPS.forEach((s) => { m[s.id] = s; });
    return m;
  }, []);

  // Разрешения: статус + авто-запрос при первом показе экрана.
  const refreshPermissions = useCallback(async () => {
    setStorageGranted(await hasStorageAccess());
    setNotifGranted(await hasNotificationPermission());
  }, []);

  useEffect(() => { refreshPermissions(); }, [refreshPermissions]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermissions();
    });
    return () => sub.remove();
  }, [refreshPermissions]);

  // «Первоначально — дать разрешения»: запрашиваем сразу, как экран открылся.
  useEffect(() => {
    if (permissionsAskedRef.current) return;
    permissionsAskedRef.current = true;
    const t = setTimeout(async () => {
      try {
        const storageOk = await hasStorageAccess();
        if (!storageOk) {
          await requestStoragePermissions();
          await openStorageSettings();
        }
      } catch (_) {}
      try {
        const notifOk = await hasNotificationPermission();
        if (!notifOk) await requestNotificationPermission();
      } catch (_) {}
      setTimeout(refreshPermissions, 800);
    }, 600);
    return () => clearTimeout(t);
  }, [refreshPermissions]);

  const grantStorage = async () => {
    const granted = await hasStorageAccess();
    if (!granted) {
      await requestStoragePermissions();
      await openStorageSettings();
    }
    setTimeout(refreshPermissions, 600);
  };

  const grantNotif = async () => {
    const granted = await hasNotificationPermission();
    if (!granted) await requestNotificationPermission();
    setTimeout(refreshPermissions, 600);
  };

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const setStep = useCallback((id, state) => {
    setStepStates((s) => ({ ...s, [id]: state }));
  }, []);

  const waitTerminalReady = async () => {
    if (terminalReadyRef.current) return;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !terminalReadyRef.current) {
      await sleep(300);
    }
    // Даём bash закончить загрузку profile перед первым вводом.
    if (terminalReadyRef.current) await sleep(600);
  };

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase('running');
    setError('');
    setElapsed(0);
    startedAtRef.current = Date.now();
    SETUP_STEPS.forEach((s) => setStep(s.id, 'pending'));
    await startBackground(copy.title);
    await updateBackground(copy.subtitle);

    const onStepStart = (id) => setStep(id, 'running');
    const onStepEnd = (id, step, res) => {
      setStep(id, res.status === 'done' ? 'done' : res.status === 'skipped' ? 'skipped' : 'error');
      const label = stepMeta[id]?.title?.ru || id;
      updateBackground(`${copy.title}: ${res.status === 'skipped' ? '✓' : res.status === 'done' ? '✓' : '✗'} ${label}`).catch(() => {});
    };

    try {
      let result;
      if (terminalRef.current && terminalAvailable()) {
        // Ждём, пока PTY-сессия терминала реально стартует (bash --login в proot).
        await waitTerminalReady();
        if (terminalReadyRef.current) {
          result = await runRaiSetupPty({
            terminal: { write: (text) => { try { terminalRef.current?.writeText?.(text); } catch (_) {} } },
            onStepStart,
            onStepEnd,
            onStatusOutput: (parsed) => { statusOutputRef.current = parsed; },
          });
        } else {
          // Терминал не стартовал — фолбэк на журнальный режим (без UI-лога).
          result = await runRaiSetup({ onStepStart, onStepEnd, onLine: () => {} });
        }
      } else {
        result = await runRaiSetup({ onStepStart, onStepEnd, onLine: () => {} });
      }

      if (result.ok) {
        setPhase('done');
        try { terminalRef.current?.writeText?.('\r\n\u2705 ' + copy.done + '\r\n'); } catch (_) {}
        await stopBackground();
        setTimeout(onComplete, 900);
      } else {
        const failed = result.summary.find((r) => r.status === 'failed');
        setError(failed ? (stepMeta[failed.id]?.title?.ru || failed.id) : copy.errorText);
        setPhase('error');
        try { terminalRef.current?.writeText?.('\r\n\u274c ' + copy.errorText + '\r\n'); } catch (_) {}
      }
    } catch (e) {
      setError(e?.message || String(e));
      setPhase('error');
    } finally {
      busyRef.current = false;
      if (phase !== 'done') stopBackground().catch(() => {});
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [copy, onComplete, phase, setStep, stepMeta]);

  runRef.current = run;

  // Авто-продолжение после закрытия (resume): стартуем сами, без кнопки.
  useEffect(() => {
    if (resume) {
      const t = setTimeout(() => { runRef.current(); }, 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [resume]);

  const restartFromScratch = async () => {
    try { await execute(`rm -f ${SETUP_STEP_FILE}`, '/'); } catch (_) {}
    setStepStates({});
    runRef.current();
  };

  const onTerminalEvent = (event) => {
    const value = event?.nativeEvent || event;
    if (value?.type === 'started') {
      terminalReadyRef.current = true;
    }
    if (value?.type === 'exit') {
      // Сессия завершилась (например, при перезапуске rootfs) — терминал пересоздастся.
      terminalReadyRef.current = false;
    }
  };

  const stepIcon = (state) => {
    switch (state) {
      case 'done': return <Icon name="checkmark-circle" size={17} color={colors.success} />;
      case 'skipped': return <Icon name="checkmark-done-circle-outline" size={17} color={colors.textTertiary} />;
      case 'error': return <Icon name="close-circle" size={17} color={colors.error} />;
      case 'running': return <Icon name="sync" size={15} color={colors.primary} />;
      default: return <View style={[styles.dot, { backgroundColor: colors.border }]} />;
    }
  };
  const stepTone = (state) => (state === 'error' ? 'error' : state === 'done' || state === 'skipped' ? 'success' : 'neutral');

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" ref={scrollRef}>
        <View style={styles.content}>
          <View style={styles.brandMark}><Icon name="terminal-outline" size={30} color="#FFFFFF" /></View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>

          {resume && phase === 'idle' ? (
            <View style={styles.resumeBox}>
              <Icon name="information-circle-outline" size={18} color={colors.info} />
              <Text style={styles.resumeText}>
                {copy.resumeInfo}
                {resumeStep && stepMeta[resumeStep] ? `\n${copy.resumeStepInfo(stepMeta[resumeStep].title[ru ? 'ru' : 'en'])}` : ''}
              </Text>
            </View>
          ) : null}

          <SectionCard title={copy.stepsTitle} icon="list-outline" style={styles.card}>
            {SETUP_STEPS.map((s) => {
              const state = stepStates[s.id] || 'pending';
              return (
                <View key={s.id} style={styles.stepRow}>
                  {stepIcon(state)}
                  <Text style={[styles.stepText, state === 'error' && { color: colors.error }]} numberOfLines={1}>
                    {s.title[ru ? 'ru' : 'en']}
                  </Text>
                  <StatusPill
                    label={state === 'done' ? (ru ? 'Готово' : 'Done') : state === 'skipped' ? (ru ? 'Пропущен' : 'Skipped') : state === 'running' ? (ru ? 'Идёт' : 'Run') : state === 'error' ? (ru ? 'Ошибка' : 'Error') : ''}
                    tone={stepTone(state)}
                  />
                </View>
              );
            })}
          </SectionCard>

          {phase === 'error' && error ? (
            <View style={styles.errorBox}>
              <Icon name="alert-circle-outline" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Разрешения — в начале установки */}
          <SectionCard title={copy.permissionsTitle} icon="shield-checkmark-outline" style={styles.card}>
            <Text style={styles.permissionsSub}>{copy.permissionsSub}</Text>
            <View style={styles.permRow}>
              <View style={styles.permIcon}><Icon name="folder-open-outline" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.permTitle}>{copy.storage}</Text>
                <Text style={styles.permText}>{copy.storageText}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <StatusPill label={storageGranted ? copy.granted : copy.notGranted} tone={storageGranted ? 'success' : 'warning'} />
                {!storageGranted ? <Pressable onPress={grantStorage} style={styles.miniBtn}><Text style={styles.miniBtnText}>{copy.storageGrant}</Text></Pressable> : null}
              </View>
            </View>
            <View style={styles.permRow}>
              <View style={styles.permIcon}><Icon name="notifications-outline" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.permTitle}>{copy.notif}</Text>
                <Text style={styles.permText}>{copy.notifText}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <StatusPill label={notifGranted ? copy.notifGranted : copy.notifDenied} tone={notifGranted ? 'success' : 'warning'} />
                {!notifGranted ? <Pressable onPress={grantNotif} style={styles.miniBtn}><Text style={styles.miniBtnText}>{copy.notifGrant}</Text></Pressable> : null}
              </View>
            </View>
          </SectionCard>

          {/* Реальный интерактивный терминал */}
          <View style={styles.consoleWrap}>
            <View style={styles.consoleHead}>
              <View style={styles.dots}><View style={[styles.dot, { backgroundColor: '#F87171' }]} /><View style={[styles.dot, { backgroundColor: '#FBBF24' }]} /><View style={[styles.dot, { backgroundColor: '#34D399' }]} /></View>
              <Text style={styles.consoleTitle}>{copy.logTitle}</Text>
              <View style={{ flex: 1 }} />
              <IconButton name="remove-outline" onPress={() => setFontSize((v) => Math.max(10, v - 2))} />
              <IconButton name="add-outline" onPress={() => setFontSize((v) => Math.min(34, v + 2))} />
              {phase === 'running' ? <StatusPill label={`${elapsed}s`} tone="info" /> : null}
            </View>
            <View style={styles.terminalWrap}>
              {terminalAvailable() ? (
                <TerminalView
                  ref={terminalRef}
                  style={styles.terminal}
                  fontSize={fontSize}
                  extraKeys={EXTRA_KEYS}
                  readOnly
                  onTerminalEvent={onTerminalEvent}
                />
              ) : (
                <View style={styles.fallbackTerminal}>
                  <Icon name="hardware-chip-outline" size={28} color="#526079" />
                  <Text style={styles.fallbackText}>{copy.noShell}</Text>
                </View>
              )}
            </View>
          </View>

          {phase === 'done' ? (
            <View style={styles.successBox}>
              <Icon name="checkmark-circle" size={26} color={colors.success} />
              <Text style={styles.successText}>{copy.doneText}</Text>
            </View>
          ) : (
            <View style={{ width: '100%', gap: 8, marginTop: 14 }}>
              <PrimaryButton
                title={phase === 'running' ? copy.running : phase === 'error' ? copy.retry : resume && phase === 'idle' ? copy.resume : copy.start}
                icon={phase === 'running' ? undefined : 'download-outline'}
                loading={phase === 'running'}
                disabled={phase === 'running'}
                onPress={run}
                style={{ width: '100%' }}
              />
              {phase === 'error' ? (
                <Pressable onPress={restartFromScratch} style={styles.link}>
                  <Text style={styles.linkText}>{ru ? 'Сбросить и начать заново' : 'Reset & restart'}</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          <Text style={styles.backgroundHint}>{copy.background}</Text>

          {phase === 'done' ? (
            <Pressable onPress={onComplete} style={styles.link}>
              <Text style={styles.linkText}>{copy.continueAnyway}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </AppScreen>
  );
};

const createStyles = (c) => StyleSheet.create({
  page: { flexGrow: 1, padding: 20 },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', alignItems: 'center' },
  brandMark: { width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, marginBottom: 18 },
  title: { color: c.text, fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { color: c.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 520, marginTop: 8, marginBottom: 20 },
  resumeBox: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 11, backgroundColor: c.infoBg, marginBottom: 12 },
  resumeText: { flex: 1, color: c.infoText, fontSize: 12, lineHeight: 18 },
  card: { width: '100%', padding: 16 },
  stepRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 9 },
  stepText: { flex: 1, color: c.text, fontSize: 13, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  errorBox: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 11, backgroundColor: c.errorBg, marginTop: 12 },
  errorText: { flex: 1, color: c.errorText, fontSize: 12, lineHeight: 18 },
  consoleWrap: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: c.terminal, borderWidth: 1, borderColor: '#253046', marginTop: 14 },
  consoleHead: { minHeight: 44, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.terminalRaised, borderBottomWidth: 1, borderBottomColor: '#253046' },
  dots: { flexDirection: 'row', gap: 5 },
  consoleTitle: { color: '#D6DEEB', fontSize: 11, fontWeight: '700' },
  terminalWrap: { height: 440, backgroundColor: c.terminal },
  terminal: { flex: 1, backgroundColor: c.terminal },
  fallbackTerminal: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  fallbackText: { color: '#8B98AD', fontSize: 12, textAlign: 'center', paddingHorizontal: 20 },
  successBox: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, backgroundColor: c.successBg, marginTop: 14 },
  successText: { flex: 1, color: c.successText, fontSize: 13, fontWeight: '700' },
  permissionsSub: { color: c.textSecondary, fontSize: 11, marginTop: -8 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 11, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg },
  permIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: c.primarySurface, alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: c.text, fontSize: 13, fontWeight: '750' },
  permText: { color: c.textSecondary, fontSize: 10, lineHeight: 14, marginTop: 2 },
  miniBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.primary },
  miniBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  backgroundHint: { color: c.textSecondary, fontSize: 11, lineHeight: 17, textAlign: 'center', maxWidth: 540, marginTop: 14 },
  link: { marginTop: 10, padding: 8 },
  linkText: { color: c.primary, fontSize: 13, fontWeight: '700' },
});

export default RaiSetupScreen;
