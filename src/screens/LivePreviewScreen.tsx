/**
 * LivePreviewScreen — ГОРЯЧИЙ предпросмотр макета (hot reload).
 *
 * Как это работает (без эмулятора и без сервера):
 *   1. Макет экрана (res/layout/*.xml) читается с диска.
 *   2. Встроенный движок (layoutPreview) превращает его в HTML-копию
 *      интерфейса — с ресурсами из res/values, темой проекта, рамкой устройства.
 *   3. Экран следит за файлом: как только макет меняется (сохранение в
 *      редакторе), превью перерисовывается само — это и есть hot reload.
 *
 * Для проверки на реальном устройстве — кнопка «Собрать и установить»:
 * кастомный пайплайн (без Gradle) собирает APK за секунды.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, Text, useWindowDimensions } from 'react-native';
import { AppScreen, IconButton, PrimaryButton, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { WebView } from 'react-native-webview';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { execute } from '../utils/shellExecutor';
import { getProjectDir } from '../config/runtime';
import { renderScreenPreviewHtml, invalidatePreviewCache } from '../utils/layoutPreview';
import { layoutFileName } from '../utils/javaProject';
import { buildProject, exportApk, installApk, launchApp } from '../utils/nativeBuild';

const ST = { LOADING: 'loading', READY: 'ready', EMPTY: 'empty', BUILDING: 'building' };

const LivePreviewScreen = ({ navigation }) => {
  const { currentProject, getCurrentScreen, currentScreenId } = useProject();
  const { colors, language } = useAppSettings();
  const { width } = useWindowDimensions();
  const phone = width < 560;
  const ru = language === 'ru';
  const screen = getCurrentScreen();
  const [status, setStatus] = useState(ST.LOADING);
  const [html, setHtml] = useState('');
  const [detail, setDetail] = useState('');
  const [buildLog, setBuildLog] = useState('');
  const [lastReload, setLastReload] = useState(0);
  const lastSigRef = useRef('');
  const cancelledRef = useRef(false);

  const screenIndex = Math.max(0, (currentProject?.screens || []).findIndex((s) => s.id === currentScreenId));
  const layoutRel = `app/res/layout/${layoutFileName(screen, screenIndex)}`;
  const cwd = getProjectDir(currentProject);

  const renderFrom = useCallback(async (sourceXml, sig) => {
    if (!currentProject) return;
    invalidatePreviewCache(currentProject);
    const doc = await renderScreenPreviewHtml(currentProject, sourceXml, {
      fileName: layoutRel,
      title: screen?.name || currentProject.name,
      widthDp: phone ? 340 : 390,
      heightDp: phone ? 640 : 780,
    });
    if (cancelledRef.current) return;
    lastSigRef.current = sig;
    setHtml(doc);
    setLastReload(Date.now());
    setStatus(ST.READY);
    setDetail('');
  }, [currentProject, layoutRel, phone, screen?.name]);

  /** Прочитать макет с диска и перерисовать, если он изменился. */
  const refresh = useCallback(async (force = false) => {
    if (!currentProject || !cwd) {
      setStatus(ST.EMPTY);
      setDetail(ru ? 'Откройте проект' : 'Open a project');
      return;
    }
    try {
      const r = await execute(
        `if [ -f ${JSON.stringify(layoutRel)} ]; then sig="$(stat -c '%Y.%s' ${JSON.stringify(layoutRel)} 2>/dev/null || echo 0)"; echo "SIG:$sig"; cat ${JSON.stringify(layoutRel)}; else echo SIG:MISSING; fi`,
        cwd,
      );
      if (cancelledRef.current) return;
      const out = String(r?.output || '');
      const m = /SIG:([^\n]*)/.exec(out);
      const sig = m ? m[1] : 'MISSING';
      if (sig === 'MISSING') {
        // Файла ещё нет (проект не записан) — рендерим из памяти проекта.
        const memXml = screen?.layoutXml || '';
        if (!force && lastSigRef.current === `mem:${memXml.length}`) return;
        if (!memXml && !screen?.rootComponent) {
          setStatus(ST.EMPTY);
          setDetail(ru ? 'Макет пуст — добавьте виджеты на вкладке «Дизайн»' : 'Layout is empty');
          return;
        }
        await renderFrom(memXml || '<LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" />', `mem:${memXml.length}`);
        return;
      }
      if (!force && sig === lastSigRef.current) return; // без изменений — пропускаем
      const body = out.slice(out.indexOf('\n') + 1);
      await renderFrom(body, sig);
    } catch (e) {
      if (!cancelledRef.current) {
        setStatus(ST.EMPTY);
        setDetail(String(e?.message || e).slice(0, 200));
      }
    }
  }, [currentProject, cwd, layoutRel, renderFrom, ru, screen]);

  // Горячее слежение: опрос файла раз в 1.2 с — превью само обновляется
  // после каждого сохранения в редакторе.
  useEffect(() => {
    cancelledRef.current = false;
    setStatus(ST.LOADING);
    lastSigRef.current = '';
    refresh(true);
    const timer = setInterval(() => { if (!cancelledRef.current) refresh(false); }, 1200);
    return () => { cancelledRef.current = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, layoutRel]);

  /** Кастомная сборка + установка: «настоящий» запуск на устройстве. */
  const buildAndInstall = async () => {
    if (!currentProject || status === ST.BUILDING) return;
    setStatus(ST.BUILDING);
    setBuildLog(ru ? 'Кастомная сборка (без Gradle)…' : 'Custom build (no Gradle)…');
    try {
      const r = await buildProject(currentProject, 'debug', (line) => {
        setBuildLog((prev) => (prev + '\n' + line).slice(-4000));
      });
      if (!r.success) throw new Error(ru ? 'Сборка упала — см. журнал' : 'Build failed — see log');
      const ex = await exportApk(currentProject, r.apkPath, 'debug');
      const inst = await installApk(r.apkPath);
      setBuildLog((prev) => prev + '\n' + (inst.success
        ? (ru ? '✓ APK передан на установку' : '✓ APK handed to installer')
        : (ru ? `Установка: ${inst.output}` : `Install: ${inst.output}`)));
      if (inst.success && currentProject.packageName) {
        setTimeout(() => launchApp(currentProject.packageName), 2500);
      }
      setStatus(ST.READY);
    } catch (e) {
      setBuildLog((prev) => prev + '\n✗ ' + String(e?.message || e));
      setStatus(ST.READY);
    }
  };

  const reloadLabel = lastReload
    ? new Date(lastReload).toLocaleTimeString(ru ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <AppScreen>
      <TopBar title={ru ? 'Горячий предпросмотр' : 'Hot Preview'} subtitle={screen?.name || ''} navigation={navigation} />
      <View style={{ flex: 1, flexDirection: phone ? 'column' : 'row', minWidth: 0 }}>
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: colors.bg }}>
          {status === ST.LOADING && !html ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{ru ? 'Читаю макет…' : 'Reading layout…'}</Text>
            </View>
          ) : status === ST.EMPTY && !html ? (
            <View style={{ alignItems: 'center', gap: 10, padding: 20 }}>
              <Icon name="phone-portrait-outline" size={40} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{detail || (ru ? 'Нет макета' : 'No layout')}</Text>
              <PrimaryButton title={ru ? 'Обновить' : 'Refresh'} icon="refresh-outline" onPress={() => refresh(true)} />
            </View>
          ) : (
            <View style={{ width: phone ? 344 : 394, maxWidth: '100%', flex: 1, maxHeight: phone ? 660 : 800, borderRadius: 20, overflow: 'hidden' }}>
              <WebView
                key={`pv-${lastReload}`}
                originWhitelist={['*']}
                source={{ html, baseUrl: 'about:blank' }}
                style={{ flex: 1, backgroundColor: 'transparent' }}
                androidLayerType="hardware"
              />
            </View>
          )}
        </View>

        <ScrollView
          style={{ width: phone ? '100%' : 320, borderTopWidth: phone ? 1 : 0, borderLeftWidth: phone ? 0 : 1, borderColor: colors.border, backgroundColor: colors.bgCard }}
          contentContainerStyle={{ padding: 14, gap: 10 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="flash-outline" size={16} color={colors.success} />
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
              {ru ? 'Hot reload включён' : 'Hot reload on'}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 10 }}>{reloadLabel}</Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 17 }}>
            {ru
              ? 'Сохраните макет в редакторе — превью перерисуется автоматически (опрос файла раз в секунду). Ресурсы @string/@color/@dimen подтягиваются из res/values.'
              : 'Save the layout in the editor — the preview re-renders automatically (file watched once per second). @string/@color/@dimen resources are resolved from res/values.'}
          </Text>
          <Text style={{ color: colors.textTertiary, fontFamily: 'monospace', fontSize: 10 }} numberOfLines={2}>{layoutRel}</Text>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton name="refresh-outline" label={ru ? 'Обновить' : 'Refresh'} onPress={() => refresh(true)} style={{ flex: 1 }} />
          </View>

          <PrimaryButton
            title={status === ST.BUILDING ? (ru ? 'Собирается…' : 'Building…') : (ru ? 'Собрать и установить' : 'Build & install')}
            icon="rocket-outline"
            loading={status === ST.BUILDING}
            disabled={status === ST.BUILDING}
            onPress={buildAndInstall}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 15 }}>
            {ru
              ? 'Полная проверка на устройстве: кастомная сборка APK (aapt2 → javac → d8 → zipalign → apksigner), без Gradle — занимает секунды.'
              : 'Full on-device check: custom APK build (aapt2 → javac → d8 → zipalign → apksigner), no Gradle — takes seconds.'}
          </Text>
          {buildLog ? (
            <View style={{ backgroundColor: colors.terminal, borderRadius: 10, padding: 10, maxHeight: 220, overflow: 'hidden' }}>
              <Text style={{ color: '#C9D3E3', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }} numberOfLines={40}>
                {buildLog.slice(-2200)}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </AppScreen>
  );
};

export default LivePreviewScreen;
