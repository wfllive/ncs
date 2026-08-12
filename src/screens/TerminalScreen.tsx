// @ts-nocheck — экран сохранён без визуальных изменений относительно main.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, IconButton, PrimaryButton, SectionCard, StatusPill, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { useAppSettings } from '../store/appSettings';
import { ROOTFS_NAME, ROOTFS_URL } from '../config/runtime';
import { TerminalView, copyToClipboard, diagnoseProot, getProotStatus, isAvailable, prepareProot } from '../../modules/termux-terminal/src/index';
// prepareProot is kept imported (used by repairAptDpkg below, which is not exposed in the UI).
import * as apt from '../../modules/apt-manager/src/index';

// Терминал Ubuntu — интерактивный: экранная клавиатура и ввод команд разрешены,
// но без панели спец-клавиш (ESC/CTRL/…) — интерфейс проще и чище.
const EXTRA_KEYS = '[]';

const TerminalScreen = ({ navigation, route }) => {
  const { width } = useWindowDimensions();
  const { colors, language, t } = useAppSettings();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const terminalRef = useRef(null);
  const [fontSize, setFontSize] = useState(13);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(null);
  const copy = language === 'ru' ? {
    title: 'Терминал Ubuntu', ready: 'Готов', unavailable: 'Нативный терминал недоступен. Откройте development client.',
    environment: 'Среда', diagnostics: 'Диагностика', reinstall: 'Переустановить Ubuntu', image: 'Единственный поддерживаемый образ',
    reinstallText: 'Текущий rootfs будет заменён фиксированным Ubuntu arm64 образом проекта.', installing: 'Установка рабочей среды',
    copy: 'Копировать', close: 'Закрыть', restart: 'Перезапустить',
  } : {
    title: 'Ubuntu terminal', ready: 'Ready', unavailable: 'The native terminal is unavailable. Open the development client.',
    environment: 'Environment', diagnostics: 'Diagnostics', reinstall: 'Reinstall Ubuntu', image: 'Only supported image',
    reinstallText: 'The current rootfs will be replaced with the fixed project Ubuntu arm64 image.', installing: 'Installing workspace',
    copy: 'Copy', close: 'Close', restart: 'Restart',
  };
  const available = isAvailable();

  const refreshStatus = useCallback(async () => {
    if (!available) return;
    try { setStatus(await getProotStatus()); } catch (e) {}
  }, [available]);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (!installing) return undefined;
    const timer = setInterval(async () => {
      try { setProgress(await apt.getRootfsProgress()); } catch (e) {}
    }, 700);
    return () => clearInterval(timer);
  }, [installing]);

  const runDiagnostics = async () => {
    setDiagnostics({ loading: true, output: '' });
    try {
      const result = await diagnoseProot();
      setDiagnostics({ loading: false, output: result.output, ok: result.ok });
    } catch (e) {
      setDiagnostics({ loading: false, output: e?.message || String(e), ok: false });
    }
  };

  const repairAptDpkg = async () => {
    setDiagnostics({ loading: true, output: '' });
    try {
      const result = await prepareProot(true);
      setDiagnostics({ loading: false, output: result.output, ok: result.success });
    } catch (e) {
      setDiagnostics({ loading: false, output: e?.message || String(e), ok: false });
    }
  };
  // Note: "Repair apt/dpkg" is not exposed in the UI anymore — the preparation
  // runs automatically on install and before every apt/dpkg command. The function
  // is kept so diagnostics/terminal internals can still trigger it.

  const reinstall = async () => {
    if (!apt.isAvailable()) return;
    setInstalling(true);
    setProgress(null);
    try {
      const result = await apt.installProotRootfs(ROOTFS_URL);
      if (!result.success) throw new Error(result.output || 'Installation failed');
      await refreshStatus();
      setEnvironmentOpen(false);
      setTimeout(() => terminalRef.current?.restart?.(), 300);
    } catch (e) {
      setDiagnostics({ loading: false, output: e?.message || String(e), ok: false });
    } finally {
      setInstalling(false);
    }
  };

  const onTerminalEvent = (event) => {
    const value = event.nativeEvent || event;
    if (value.type === 'started') setSession(value);
    if (value.type === 'exit') setSession((current) => ({ ...current, exited: true, exitCode: value.exitCode }));
  };

  const subtitle = session?.pid ? `proot · pid ${session.pid}${session.exited ? ` · exit ${session.exitCode}` : ''}` : status?.ready ? copy.ready : 'proot';
  return (
    <AppScreen style={{ backgroundColor: colors.terminal }}>
      <TopBar
        compact
        title={copy.title}
        subtitle={subtitle}
        onBack={() => navigation.goBack()}
        right={<>
          <IconButton name="remove-outline" onPress={() => setFontSize((value) => Math.max(8, value - 1))} />
          <IconButton name="add-outline" onPress={() => setFontSize((value) => Math.min(30, value + 1))} />
          <IconButton name="clipboard-outline" onPress={() => terminalRef.current?.pasteFromClipboard?.()} />
          <IconButton name="copy-outline" onPress={() => terminalRef.current?.copyTranscriptToClipboard?.()} />
          <IconButton name="keyboard-outline" onPress={() => terminalRef.current?.toggleKeyboard?.()} />
          {width >= 600 ? <IconButton name="refresh-outline" onPress={() => terminalRef.current?.restart?.()} /> : null}
          <IconButton name="server-outline" active={environmentOpen} onPress={() => setEnvironmentOpen((value) => !value)} />
          <IconButton name="pulse-outline" onPress={runDiagnostics} />
        </>}
      />

      {environmentOpen ? (
        <View style={styles.environment}>
          <View style={styles.environmentHead}><View style={styles.serverIcon}><Icon name="server-outline" size={20} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.environmentTitle}>{ROOTFS_NAME}</Text><Text style={styles.environmentMeta}>{copy.image} · arm64</Text></View><StatusPill label={status?.rootfsInstalled ? copy.ready : 'Missing'} tone={status?.rootfsInstalled ? 'success' : 'error'} /></View>
          <Text selectable style={styles.url}>{ROOTFS_URL}</Text>
          <Text style={styles.environmentText}>{copy.reinstallText}</Text>
          <PrimaryButton title={copy.reinstall} icon="download-outline" loading={installing} onPress={reinstall} />
          {installing ? <View style={styles.progressRow}><ActivityIndicator color={colors.primary} /><Text style={styles.progressText}>{progress?.message || copy.installing}{progress?.totalBytes ? ` · ${Math.round((progress.downloadedBytes / progress.totalBytes) * 100)}%` : ''}</Text></View> : null}
        </View>
      ) : null}

      {available ? (
        <TerminalView
          ref={terminalRef}
          style={styles.terminal}
          fontSize={fontSize}
          extraKeys={EXTRA_KEYS}
          initialCommand={route.params?.initialCommand}
          onTerminalEvent={onTerminalEvent}
        />
      ) : (
        <View style={styles.fallback}><Icon name="hardware-chip-outline" size={40} color={colors.textTertiary} /><Text style={styles.fallbackText}>{copy.unavailable}</Text></View>
      )}

      <Modal visible={Boolean(diagnostics)} transparent animationType="fade" onRequestClose={() => setDiagnostics(null)}>
        <View style={styles.overlay}>
          <SectionCard style={styles.diagnosticCard} title={copy.diagnostics} icon="pulse-outline" right={diagnostics && !diagnostics.loading ? <StatusPill label={diagnostics.ok ? 'OK' : 'Error'} tone={diagnostics.ok ? 'success' : 'error'} /> : null}>
            {diagnostics?.loading ? <ActivityIndicator color={colors.primary} /> : <ScrollView style={styles.diagnosticOutput}><Text selectable style={styles.diagnosticText}>{diagnostics?.output}</Text></ScrollView>}
            <View style={styles.dialogButtons}><IconButton name="copy-outline" label={copy.copy} onPress={() => copyToClipboard(diagnostics?.output || '')} style={{ flex: 1 }} /><PrimaryButton title={copy.close} icon="close" onPress={() => setDiagnostics(null)} style={{ flex: 1 }} /></View>
          </SectionCard>
        </View>
      </Modal>
    </AppScreen>
  );
};

const createStyles = (c) => StyleSheet.create({
  terminal: { flex: 1, backgroundColor: c.terminal },
  environment: { padding: 13, gap: 10, backgroundColor: c.bgCard, borderBottomWidth: 1, borderBottomColor: c.border },
  environmentHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, serverIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySurface },
  environmentTitle: { color: c.text, fontSize: 13, fontWeight: '750' }, environmentMeta: { color: c.textSecondary, fontSize: 10, marginTop: 2 }, environmentText: { color: c.textSecondary, fontSize: 10, lineHeight: 16 },
  url: { color: c.textTertiary, fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }, progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, progressText: { color: c.textSecondary, fontSize: 10 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 11, padding: 30 }, fallbackText: { color: c.textSecondary, textAlign: 'center', fontSize: 12, maxWidth: 400 },
  overlay: { flex: 1, justifyContent: 'center', padding: 18, backgroundColor: c.overlay }, diagnosticCard: { width: '100%', maxWidth: 720, maxHeight: '78%', alignSelf: 'center' }, diagnosticOutput: { maxHeight: 430, borderRadius: 9, padding: 11, backgroundColor: c.terminal }, diagnosticText: { color: '#C9D3E3', fontFamily: 'monospace', fontSize: 9, lineHeight: 15 }, dialogButtons: { flexDirection: 'row', gap: 8 },
});

export default TerminalScreen;