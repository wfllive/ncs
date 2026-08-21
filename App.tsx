import './global.css';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationBar } from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';

import { ProjectProvider } from './src/store/projectStore';
import { AppSettingsProvider, useAppSettings } from './src/store/appSettings';
import PrivacyGate from './src/components/PrivacyGate';
import NotificationPermissionGate from './src/components/NotificationPermissionGate';
import InstallerScreen from './src/screens/InstallerScreen';
import RaiSetupScreen from './src/screens/RaiSetupScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import EditorScreen from './src/screens/EditorScreen';
import BuildScreen from './src/screens/BuildScreen';
import LibrariesScreen from './src/screens/LibrariesScreen';
import ProjectSettingsScreen from './src/screens/ProjectSettingsScreen';
import AppSettingsScreen from './src/screens/AppSettingsScreen';
import LivePreviewScreen from './src/screens/LivePreviewScreen';
import TerminalScreen from './src/screens/TerminalScreen';
import { getProotStatus, isAvailable as terminalAvailable } from './modules/termux-terminal/src/index';
import * as apt from './modules/apt-manager/src/index';
import { getRaiSetupStatus, probeRaiReady } from './src/utils/raiSetup';
import { checkSecurityOnBoot, SecurityIntegrityResult } from './src/utils/security';
import { SecurityBlockScreen } from './src/components/SecurityBlockScreen';
import { nativeWindTheme } from './src/theme/nativewind';

void SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

const AppRoot = () => {
  const { loaded, colors, language, resolvedTheme } = useAppSettings();
  const nativeReady = terminalAvailable() && apt.isAvailable();
  const [stage, setStage] = useState('checking');
  const [resumeStep, setResumeStep] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<SecurityIntegrityResult | null>(null);
  const themeVariables = useMemo(() => nativeWindTheme(colors), [colors]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
    void (async () => {
      const res = await checkSecurityOnBoot({ alertOnTamper: false });
      if (res) {
        setSecurityStatus(res);
      }
    })();
  }, [colors.bg]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!nativeReady) {
          if (!cancelled) setStage('unavailable');
          return;
        }
        const status = await getProotStatus();
        if (!status?.rootfsInstalled) {
          if (!cancelled) setStage('installer');
          return;
        }
        // A persisted marker is only a setup checkpoint, not proof that the toolchain still
        // works. Every cold start must run the live environment probe before projects unlock.
        const ready = await probeRaiReady();
        if (ready) {
          if (!cancelled) setStage('ready');
          return;
        }
        const setupStatus = await getRaiSetupStatus();
        if (setupStatus?.startsWith('step:')) {
          const match = setupStatus.match(/^step:(.+)$/);
          if (!cancelled) setResumeStep(match ? match[1] : null);
          if (!cancelled) setStage('setup-resume');
          return;
        }
        // Even `done` must not bypass a failed live probe: a stale marker can survive an
        // interrupted/corrupted SDK installation.
        if (!cancelled) setStage('setup');
      } catch {
        if (!cancelled) setStage('installer');
      }
    })();
    return () => { cancelled = true; };
  }, [nativeReady]);

  // A process is not always recreated when the user leaves and reopens the app. Revalidate the
  // live RAI status on foreground as well, without tearing down the current screen when it is OK.
  useEffect(() => {
    if (!nativeReady || stage !== 'ready') return undefined;
    let cancelled = false;
    let checking = false;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active' || checking) return;
      checking = true;
      void (async () => {
        try {
          const proot = await getProotStatus();
          if (!proot?.rootfsInstalled) {
            if (!cancelled) setStage('installer');
            return;
          }
          const ready = await probeRaiReady();
          if (ready || cancelled) return;
          const setupStatus = await getRaiSetupStatus();
          if (cancelled) return;
          if (setupStatus?.startsWith('step:')) {
            const match = setupStatus.match(/^step:(.+)$/);
            setResumeStep(match ? match[1] : null);
            setStage('setup-resume');
          } else {
            setResumeStep(null);
            setStage('setup');
          }
        } catch {
          if (!cancelled) setStage('installer');
        } finally {
          checking = false;
        }
      })();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [nativeReady, stage]);

  useEffect(() => {
    if (!loaded || stage === 'checking') return;
    void SplashScreen.hideAsync().catch(() => {});
  }, [loaded, stage]);

  const onUbuntuInstalled = useCallback(() => setStage('setup'), []);
  const onRaiReady = useCallback(() => setStage('ready'), []);

  const navigationTheme = useMemo(() => ({
    dark: resolvedTheme === 'dark',
    colors: {
      primary: colors.primary,
      background: colors.bg,
      card: colors.bgCard,
      text: colors.text,
      border: colors.border,
      notification: colors.error,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' as const },
      medium: { fontFamily: 'System', fontWeight: '500' as const },
      bold: { fontFamily: 'System', fontWeight: '700' as const },
      heavy: { fontFamily: 'System', fontWeight: '800' as const },
    },
  }), [colors, resolvedTheme]);

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-bg" style={themeVariables}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (securityStatus?.isTampered) {
    return <SecurityBlockScreen result={securityStatus} />;
  }

  return (
    <View className="flex-1 bg-bg" style={themeVariables}>
      <PrivacyGate>
        <StatusBar hidden={false} style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
        <NavigationBar hidden={false} style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
        <NotificationPermissionGate>
          {stage === 'checking' ? (
            <View className="flex-1 items-center justify-center gap-3 bg-bg px-6">
              <ActivityIndicator color={colors.primary} />
              <Text className="text-center text-sm text-text-secondary">
                {language === 'ru' ? 'Проверяем Ubuntu и статус RAI…' : 'Checking Ubuntu and RAI status…'}
              </Text>
            </View>
          ) : stage === 'setup' || stage === 'setup-resume' ? (
            <RaiSetupScreen onComplete={onRaiReady} resume={stage === 'setup-resume'} resumeStep={resumeStep} />
          ) : stage === 'ready' ? (
            <ProjectProvider>
              <NavigationContainer theme={navigationTheme}>
                <Stack.Navigator
                  id="RootStack"
                  initialRouteName="Projects"
                  screenOptions={{
                    headerShown: false,
                    animation: 'slide_from_right',
                    contentStyle: { backgroundColor: colors.bg },
                    navigationBarColor: colors.systemBar,
                    statusBarStyle: resolvedTheme === 'dark' ? 'light' : 'dark',
                  }}
                >
                  <Stack.Screen name="Projects" component={ProjectsScreen} />
                  <Stack.Screen name="Editor" component={EditorScreen} />
                  <Stack.Screen name="Build" component={BuildScreen} />
                  <Stack.Screen name="Libraries" component={LibrariesScreen} />
                  <Stack.Screen name="ProjectSettings" component={ProjectSettingsScreen} />
                  <Stack.Screen name="AppSettings" component={AppSettingsScreen} />
                  <Stack.Screen name="LivePreview" component={LivePreviewScreen} />
                  <Stack.Screen name="Terminal" component={TerminalScreen} />
                </Stack.Navigator>
              </NavigationContainer>
            </ProjectProvider>
          ) : (
            <InstallerScreen onInstalled={onUbuntuInstalled} />
          )}
        </NotificationPermissionGate>
      </PrivacyGate>
    </View>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <AppSettingsProvider>
          <AppRoot />
        </AppSettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
