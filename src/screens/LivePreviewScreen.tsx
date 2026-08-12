import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, Text, useWindowDimensions } from 'react-native';
import { AppScreen, IconButton, PrimaryButton, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { WebView } from 'react-native-webview';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { execute, isPortServingHttp } from '../utils/shellExecutor';
import { getProjectDir } from '../config/runtime';

const PREVIEW_PORT = 5173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;

// Состояния предпросмотра
const ST = { CHECKING: 'checking', READY: 'ready', STARTING: 'starting', ERROR: 'error' };

const LivePreviewScreen = ({ navigation }) => {
  const { currentProject, getCurrentScreen } = useProject();
  const { colors, language } = useAppSettings();
  const { width } = useWindowDimensions();
  const phone = width < 560;
  const screen = getCurrentScreen();
  const ru = language === 'ru';
  const [status, setStatus] = useState(ST.CHECKING);
  const [detail, setDetail] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const webviewRef = useRef(null);
  const cancelledRef = useRef(false);
  const viteProcRef = useRef(null);

  const cwd = getProjectDir(currentProject);

  const checkVite = useCallback(async () => {
    const r = await execute(
      `node -e 'const h=require("http");h.get({host:"127.0.0.1",port:${PREVIEW_PORT},path:"/",timeout:2500},x=>process.exit(x.statusCode<500?0:1)).on("error",()=>process.exit(1))' 2>/dev/null; echo RC_$?; echo "|"; pgrep -f "vite" | head -1`,
      cwd,
    );
    const out = r?.output || '';
    return { http: /RC_0\b/.test(out), running: /RC_0\b/.test(out), raw: out };
  }, [cwd]);

  const startVite = useCallback(async () => {
    if (!cwd) return;
    setStatus(ST.STARTING);
    setDetail(ru ? 'Устанавливаю зависимости и запускаю Vite…' : 'Installing deps and starting Vite…');
    await execute('[ -f node_modules/.bin/vite ] || npm install --silent 2>&1 | tail -5', cwd);
    await execute('pkill -f "vite" 2>/dev/null; sleep 1; rm -f /tmp/vite.log', cwd);
    // Vite foreground через НЕ-await execute — нативный мост держит его живым.
    // (nohup/& убивал Vite, когда execute возвращался → CONNECTION_REFUSED.)
    viteProcRef.current = execute(`npm run dev -- --host 0.0.0.0 --port ${PREVIEW_PORT} > /tmp/vite.log 2>&1`, cwd).catch(() => {});
    // Подаём Vite несколько секунд на подъём
    for (let i = 0; i < 12; i += 1) {
      if (cancelledRef.current) return;
      await new Promise(res => setTimeout(res, 1500));
      const c = await checkVite();
      if (c.http) {
        setStatus(ST.READY);
        setDetail('');
        setReloadKey(k => k + 1);
        return;
      }
    }
    const log = await execute('cat /tmp/vite.log 2>/dev/null | tail -12', cwd);
    setStatus(ST.ERROR);
    setDetail((log?.output || 'Vite не ответил').slice(0, 400));
  }, [cwd, checkVite, ru]);

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      if (!cwd) { setStatus(ST.ERROR); setDetail(ru ? 'Папка проекта неизвестна' : 'Project dir unknown'); return; }
      setStatus(ST.CHECKING);
      const c = await checkVite();
      if (cancelledRef.current) return;
      if (c.http) { setStatus(ST.READY); }
      else { await startVite(); }
    })();
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const stopVite = useCallback(async () => {
    await execute('pkill -f vite 2>/dev/null; echo stopped', cwd);
    setStatus(ST.CHECKING);
    setDetail('');
  }, [cwd]);

  return (
    <AppScreen>
      <TopBar
        title={ru ? 'Живой React preview' : 'Live React preview'}
        subtitle={`${currentProject?.name || ''} · ${screen?.name || ''} · Vite HMR`}
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            name="refresh-outline"
            label={phone ? null : (ru ? 'Перезагрузить' : 'Reload')}
            onPress={async () => { const c = await checkVite(); if (c.http) { setStatus(ST.READY); setReloadKey(k => k + 1); } else { await startVite(); } }}
          />
        }
      />
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ padding: 8, backgroundColor: '#EFF6FF', flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#DBEAFE' }}>
          <Icon name={status === ST.READY ? 'checkmark-circle' : 'time-outline'} size={14} color={status === ST.READY ? '#16A34A' : '#D97706'} />
          <Text style={{ flex: 1, fontSize: 11, color: '#1E40AF' }} numberOfLines={1}>
            {status === ST.READY ? (ru ? `Vite dev → WebView • ${PREVIEW_URL}` : `Vite dev → WebView • ${PREVIEW_URL}`)
              : status === ST.STARTING ? (detail || (ru ? 'Запуск Vite…' : 'Starting Vite…'))
              : status === ST.CHECKING ? (ru ? 'Проверка Vite…' : 'Checking Vite…')
              : (ru ? 'Vite недоступен' : 'Vite unavailable')}
          </Text>
          {status === ST.READY ? (
            <Pressable onPress={stopVite} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#FEE2E2' }}>
              <Text style={{ fontSize: 10, color: '#B91C1C', fontWeight: '700' }}>{ru ? 'Стоп' : 'Stop'}</Text>
            </Pressable>
          ) : null}
        </View>

        {status === ST.READY ? (
          <WebView
            key={`live-${reloadKey}`}
            ref={webviewRef}
            source={{ uri: PREVIEW_URL }}
            style={{ flex: 1 }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 8 }}>{ru ? 'Загрузка Vite…' : 'Loading Vite…'}</Text>
              </View>
            )}
            onError={() => { setStatus(ST.ERROR); setDetail(ru ? 'WebView не смог загрузить Vite' : 'WebView failed to load Vite'); }}
            onHttpError={() => { setStatus(ST.ERROR); }}
          />
        ) : status === ST.ERROR ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg }}>
            <Icon name="globe-outline" size={42} color={colors.warning} />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>
              {ru ? 'Нет соединения с Vite dev-сервером' : 'No connection to Vite dev server'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 15 }}>
              {ru ? `Vite не отвечает на ${PREVIEW_URL}. Проверьте лог:` : `Vite not responding at ${PREVIEW_URL}. Log:`}{'\n'}{detail}
            </Text>
            <View style={{ flexDirection: phone ? 'column' : 'row', gap: 8, width: phone ? '100%' : undefined }}>
              <PrimaryButton title={ru ? 'Запустить Vite' : 'Start Vite'} icon="play-outline" onPress={startVite} style={phone ? { width: '100%' } : undefined} />
              <IconButton name="refresh-outline" label={ru ? 'Перепроверить' : 'Recheck'} onPress={async () => { setStatus(ST.CHECKING); const c = await checkVite(); setStatus(c.http ? ST.READY : ST.ERROR); }} style={phone ? { width: '100%' } : undefined} />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.bg }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{detail || (ru ? 'Подключение к Vite…' : 'Connecting to Vite…')}</Text>
          </View>
        )}
      </View>
    </AppScreen>
  );
};

export default LivePreviewScreen;