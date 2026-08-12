// @ts-nocheck — экран сохранён без визуальных изменений относительно main.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { AppScreen, PrimaryButton, SectionCard, StatusPill } from '../components/AppUI';
import { useAppSettings } from '../store/appSettings';
import { ROOTFS_NAME, ROOTFS_URL } from '../config/runtime';
import { getProotStatus, isAvailable as terminalAvailable } from '../../modules/termux-terminal/src/index';
import * as apt from '../../modules/apt-manager/src/index';
import { startBackground, stopBackground, updateBackground } from '../utils/background';

const InstallerScreen = ({ onInstalled }) => {
  const { colors, language } = useAppSettings();
  const [phase, setPhase] = useState('checking');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const nativeReady = terminalAvailable() && apt.isAvailable();
  const copy = language === 'ru' ? {
    title: 'Подготовка рабочей среды',
    subtitle: 'Однократная установка Linux-окружения для JDK, Android SDK и Gradle',
    checking: 'Проверяем рабочую среду',
    ready: 'Ubuntu уже установлена',
    install: 'Установить Ubuntu',
    retry: 'Повторить установку',
    unavailable: 'Нужна нативная development-сборка',
    unavailableText: 'Установка rootfs использует нативные модули и недоступна в браузере. Установите нативную development-сборку NovaCompose Studio.',
    security: 'Фиксированный официальный образ проекта',
    size: 'Скачивание и распаковка могут занять несколько минут. Можно свернуть приложение — установка продолжится в фоне.',
    failed: 'Не удалось установить рабочую среду.',
    extracting: 'Распаковываем Ubuntu',
    connecting: 'Подключаемся к серверу',
    downloading: 'Скачиваем образ',
    preparing: 'Настраиваем apt и dpkg',
    verify: 'Проверяем установку',
  } : {
    title: 'Prepare the workspace',
    subtitle: 'One-time Linux environment setup for JDK, Android SDK and Gradle',
    checking: 'Checking the workspace',
    ready: 'Ubuntu is already installed',
    install: 'Install Ubuntu',
    retry: 'Retry installation',
    unavailable: 'A native development build is required',
    unavailableText: 'Rootfs installation uses native modules and is unavailable in the browser. Install the native NovaCompose Studio development build.',
    security: 'Fixed project-provided image',
    size: 'Downloading and extracting can take several minutes. You can minimize the app — it keeps running in the background.',
    failed: 'Workspace installation failed.',
    extracting: 'Extracting Ubuntu',
    connecting: 'Connecting to server',
    downloading: 'Downloading image',
    preparing: 'Configuring apt and dpkg',
    verify: 'Verifying installation',
  };

  const check = useCallback(async () => {
    setPhase('checking');
    setError('');
    if (!nativeReady) {
      setPhase('unavailable');
      return;
    }
    try {
      const status = await getProotStatus();
      if (status?.rootfsInstalled && (!status?.rootfsArch || status.rootfsArch === 64)) {
        setPhase('ready');
        setTimeout(onInstalled, 250);
      } else {
        setPhase('idle');
      }
    } catch (e) {
      setError(e?.message || String(e));
      setPhase('idle');
    }
  }, [nativeReady, onInstalled]);

  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    if (phase !== 'installing') return undefined;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      try { setProgress(await apt.getRootfsProgress()); } catch (e) {}
    }, 650);
    return () => clearInterval(timer);
  }, [phase]);

  const install = async () => {
    setPhase('installing');
    setError('');
    setProgress({ stage: 'connecting', downloadedBytes: 0, totalBytes: 0 });
    // Фоновая служба: скачивание/распаковка продолжается, даже если приложение свёрнуто.
    await startBackground(copy.install);
    try {
      const result = await apt.installProotRootfs(ROOTFS_URL);
      if (!result?.success) throw new Error(result?.output || copy.failed);
      // Note: apt/dpkg auto-preparation runs natively inside installProotRootfs
      // (stage "preparing"), so `apt update && apt upgrade` work right after install.
      setProgress({ stage: 'verifying', message: copy.verify });
      await updateBackground(copy.verify);
      const status = await getProotStatus();
      if (!status?.rootfsInstalled) throw new Error(copy.failed);
      if (status?.rootfsArch && status.rootfsArch !== 64) throw new Error('Installed rootfs is not arm64.');
      setPhase('ready');
      await stopBackground();
      // Дальше — страница установки RAI (base + sdk + status).
      setTimeout(onInstalled, 450);
    } catch (e) {
      await stopBackground();
      setError(e?.message || String(e));
      setPhase('error');
    }
  };

  const percentage = progress?.totalBytes > 0
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : 0;
  const stageLabel = progress?.stage === 'extracting' ? copy.extracting
    : progress?.stage === 'downloading' ? copy.downloading
      : progress?.stage === 'preparing' ? copy.preparing
        : progress?.stage === 'verifying' ? copy.verify : copy.connecting;
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.brandMark}>
            <Icon name="construct-outline" size={30} color="#FFFFFF" />
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>

          <SectionCard style={styles.card}>
            <View style={styles.imageHeader}>
              <View style={styles.serverIcon}><Icon name="server-outline" size={24} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.imageName}>{ROOTFS_NAME}</Text>
                <Text style={styles.arch}>GNU/Linux · arm64 · rootfs</Text>
              </View>
              <StatusPill label="ARM64" tone="info" />
            </View>

            <View style={styles.urlBox}>
              <Icon name="lock-closed-outline" size={15} color={colors.success} />
              <Text style={styles.url} numberOfLines={2}>{ROOTFS_URL}</Text>
            </View>

            {phase === 'checking' ? (
              <View style={styles.stateRow}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{copy.checking}</Text></View>
            ) : phase === 'installing' ? (
              <View style={{ gap: 10 }}>
                <View style={styles.progressHead}>
                  <Text style={styles.stateText}>{stageLabel}</Text>
                  <Text style={styles.progressMeta}>{percentage ? `${percentage}% · ` : ''}{elapsed}s</Text>
                </View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percentage || 8}%` }]} /></View>
                {progress?.downloadedBytes > 0 ? (
                  <Text style={styles.progressMeta}>
                    {(progress.downloadedBytes / 1048576).toFixed(1)} MB{progress.totalBytes > 0 ? ` / ${(progress.totalBytes / 1048576).toFixed(1)} MB` : ''}
                  </Text>
                ) : null}
              </View>
            ) : phase === 'ready' ? (
              <View style={styles.successRow}><Icon name="checkmark-circle" size={22} color={colors.success} /><Text style={styles.successText}>{copy.ready}</Text></View>
            ) : phase === 'unavailable' ? (
              <View style={styles.errorBox}>
                <Icon name="hardware-chip-outline" size={22} color={colors.warning} />
                <View style={{ flex: 1 }}><Text style={styles.errorTitle}>{copy.unavailable}</Text><Text style={styles.errorText}>{copy.unavailableText}</Text></View>
              </View>
            ) : (
              <>
                {error ? <View style={styles.errorBox}><Icon name="alert-circle-outline" size={22} color={colors.error} /><Text selectable style={[styles.errorText, { flex: 1 }]}>{error}</Text></View> : null}
                <PrimaryButton title={phase === 'error' ? copy.retry : copy.install} icon="download-outline" onPress={install} />
              </>
            )}
          </SectionCard>

          <View style={styles.note}>
            <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.noteText}>{copy.security}. {copy.size}</Text>
          </View>
          <Text style={styles.platform}>NovaCompose Studio · Android · Gradle · {Platform.OS}</Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
};

const createStyles = (c) => StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', alignItems: 'center' },
  brandMark: { width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, marginBottom: 20 },
  title: { color: c.text, fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { color: c.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 460, marginTop: 8, marginBottom: 24 },
  card: { width: '100%', padding: 20 },
  imageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  serverIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: c.primarySurface, alignItems: 'center', justifyContent: 'center' },
  imageName: { color: c.text, fontSize: 16, fontWeight: '750' },
  arch: { color: c.textSecondary, fontSize: 12, marginTop: 3 },
  urlBox: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 9, borderWidth: 1, borderColor: c.border, backgroundColor: c.bgElevated, padding: 11 },
  url: { color: c.textSecondary, fontFamily: 'monospace', fontSize: 10, flex: 1, lineHeight: 15 },
  stateRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { color: c.text, fontSize: 13, fontWeight: '650' },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressMeta: { color: c.textTertiary, fontSize: 11, fontFamily: 'monospace' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: c.bgElevated },
  progressFill: { height: '100%', minWidth: 10, backgroundColor: c.primary, borderRadius: 4 },
  successRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.successBg, borderRadius: 10 },
  successText: { color: c.successText, fontSize: 13, fontWeight: '700' },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, backgroundColor: c.errorBg, borderRadius: 10 },
  errorTitle: { color: c.errorText, fontSize: 13, fontWeight: '750' },
  errorText: { color: c.errorText, fontSize: 11, lineHeight: 17, marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: 520, marginTop: 18 },
  noteText: { color: c.textSecondary, fontSize: 11, lineHeight: 17, flex: 1 },
  platform: { color: c.textTertiary, fontSize: 10, marginTop: 22 },
});

export default InstallerScreen;
