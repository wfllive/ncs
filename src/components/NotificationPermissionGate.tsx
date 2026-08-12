import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { PropsWithChildren, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, PrimaryButton, SectionCard } from './AppUI';
import { Icon } from './Icon';
import { useAppSettings } from '../store/appSettings';
import {
  getNotificationPermissionStatus,
  notificationNeedsSettings,
  openNotificationSettings,
  requestNotificationPermission,
  type NotificationPermissionStatus,
} from '../utils/background';
import { cn } from '../utils/cn';

const PROMPT_SEEN_KEY = '@nova_notification_access_prompt_v1';
type GatePhase = 'checking' | 'prompt' | 'ready';

/**
 * Presents an in-app explanation first, then requests POST_NOTIFICATIONS from a direct user tap.
 * Older Android versions have no runtime notification dialog, so blocked app/channel states route
 * to the correct system Settings page instead. A user can always continue without notifications.
 */
const NotificationPermissionGate = ({ children }: PropsWithChildren) => {
  const { colors, language } = useAppSettings();
  const { width, height } = useWindowDimensions();
  const ru = language === 'ru';
  const compact = width < 390;
  const short = height < 700;
  const [phase, setPhase] = useState<GatePhase>(Platform.OS === 'android' ? 'checking' : 'ready');
  const [status, setStatus] = useState<NotificationPermissionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const copy = {
    title: ru ? 'Не пропускайте ход установки' : 'Keep background progress visible',
    subtitle: ru
      ? 'NovaCompose показывает уведомление, пока устанавливает среду или собирает APK в фоне.'
      : 'NovaCompose shows a notification while it prepares the workspace or builds an APK in the background.',
    why: ru ? 'Зачем это нужно' : 'Why this is needed',
    progress: ru ? 'Видимый статус долгих установок и сборок' : 'Visible status for long installs and builds',
    return: ru ? 'Быстрый возврат к активной фоновой задаче' : 'A quick way back to an active background task',
    noSpam: ru ? 'Только рабочий прогресс — без рекламы и рассылок' : 'Work progress only — no marketing messages',
    allow: ru ? 'Показать системный запрос' : 'Continue to system prompt',
    settings: ru ? 'Открыть настройки уведомлений' : 'Open notification settings',
    later: ru ? 'Продолжить без уведомлений' : 'Continue without notifications',
    denied: ru
      ? 'Android не разрешил уведомления. Можно повторить запрос или продолжить и включить их позже в Настройках.'
      : 'Android did not allow notifications. You can try again or continue and enable them later in Settings.',
    settingsHint: ru
      ? 'Разрешение приложения или канал фоновых задач выключен. Включите его на странице Android.'
      : 'The app notification switch or background-work channel is off. Enable it on the Android settings page.',
    oldAndroid: ru
      ? 'На Android 7–12 отдельного системного запроса нет: уведомления управляются переключателем приложения в настройках.'
      : 'Android 7–12 has no notification runtime dialog; notifications use the app switch in system settings.',
    modernAndroid: ru
      ? 'На Android 13–17 следующий шаг откроет системный запрос разрешения.'
      : 'On Android 13–17, the next step opens Android’s notification permission prompt.',
  };

  const refresh = useCallback(async () => {
    const next = await getNotificationPermissionStatus();
    setStatus(next);
    if (next.granted) setPhase('ready');
    return next;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      setPhase('ready');
      return;
    }
    let mounted = true;
    Promise.all([getNotificationPermissionStatus(), AsyncStorage.getItem(PROMPT_SEEN_KEY)])
      .then(([next, seen]) => {
        if (!mounted) return;
        setStatus(next);
        setPhase(next.granted || seen === '1' ? 'ready' : 'prompt');
      })
      .catch(() => mounted && setPhase('ready'));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (phase !== 'prompt') return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [phase, refresh]);

  const rememberPrompt = () => AsyncStorage.setItem(PROMPT_SEEN_KEY, '1').catch(() => {});

  const enable = async () => {
    if (!status || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (notificationNeedsSettings(status)) {
        await rememberPrompt();
        const result = await openNotificationSettings();
        if (!result?.success) setMessage(copy.settingsHint);
        return;
      }
      const next = await requestNotificationPermission();
      await rememberPrompt();
      setStatus(next);
      if (next.granted) {
        setPhase('ready');
      } else {
        setMessage(notificationNeedsSettings(next) ? copy.settingsHint : copy.denied);
      }
    } finally {
      setBusy(false);
    }
  };

  const continueWithout = async () => {
    await rememberPrompt();
    setPhase('ready');
  };

  if (phase === 'ready') return <>{children}</>;

  if (phase === 'checking') {
    return <AppScreen className="items-center justify-center gap-[12px]">
      <View className="w-[54px] h-[54px] rounded-[16px] bg-primary items-center justify-center">
        <Icon name="notifications-outline" size={26} color="#FFFFFF" />
      </View>
      <ActivityIndicator color={colors.primary} />
    </AppScreen>;
  }

  const settingsRequired = status ? notificationNeedsSettings(status) : false;
  const platformHint = status?.runtimePermissionRequired ? copy.modernAndroid : copy.oldAndroid;

  return <AppScreen>
    <ScrollView
      contentContainerClassName={cn('grow justify-center', compact ? 'px-[12px] py-[16px]' : 'px-[20px] py-[24px]')}
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-[560px] self-center items-center">
        <View className={cn(
          'items-center justify-center bg-primary shadow-sm',
          short ? 'w-[58px] h-[58px] rounded-[17px] mb-[14px]' : 'w-[72px] h-[72px] rounded-[21px] mb-[20px]',
        )}>
          <Icon name="notifications-outline" size={short ? 28 : 34} color="#FFFFFF" />
        </View>
        <Text className={cn(
          'text-text font-bold text-center tracking-[-0.4px]',
          compact ? 'text-[22px] leading-[28px]' : 'text-[27px] leading-[34px]',
        )}>{copy.title}</Text>
        <Text className={cn(
          'text-text-secondary text-center max-w-[500px]',
          short ? 'text-[12px] leading-[18px] mt-[7px] mb-[14px]' : 'text-[14px] leading-[21px] mt-[9px] mb-[20px]',
        )}>{copy.subtitle}</Text>

        <SectionCard title={copy.why} icon="shield-checkmark-outline" className={cn('w-full', compact ? 'p-[14px]' : 'p-[18px]')}>
          <PermissionReason icon="hourglass-outline" text={copy.progress} color={colors.primary} />
          <PermissionReason icon="arrow-undo-outline" text={copy.return} color={colors.primary} />
          <PermissionReason icon="checkmark-circle-outline" text={copy.noSpam} color={colors.success} />
          <View className="flex-row items-start gap-[8px] rounded-[10px] bg-info-bg p-[10px] mt-[2px]">
            <Icon name="information-circle-outline" size={18} color={colors.info} />
            <Text className="flex-1 text-info-text text-[11px] leading-[17px]">{platformHint}</Text>
          </View>
        </SectionCard>

        {message ? <View className="w-full flex-row items-start gap-[8px] rounded-[10px] bg-warning-bg p-[11px] mt-[12px]">
          <Icon name="alert-circle-outline" size={18} color={colors.warning} />
          <Text className="flex-1 text-warning-text text-[11px] leading-[17px]">{message}</Text>
        </View> : null}

        <PrimaryButton
          title={settingsRequired ? copy.settings : copy.allow}
          icon={settingsRequired ? 'settings-outline' : 'notifications-outline'}
          loading={busy}
          disabled={busy}
          onPress={enable}
          style={{ width: '100%', marginTop: short ? 14 : 18 }}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={continueWithout}
          className="min-h-[44px] px-[12px] items-center justify-center active:opacity-60"
        >
          <Text className="text-text-secondary text-[12px] font-semibold text-center">{copy.later}</Text>
        </Pressable>
      </View>
    </ScrollView>
  </AppScreen>;
};

const PermissionReason = ({ icon, text, color }) => <View className="min-h-[34px] flex-row items-center gap-[10px]">
  <View className="w-[28px] h-[28px] rounded-[8px] bg-primary-surface items-center justify-center">
    <Icon name={icon} size={16} color={color} />
  </View>
  <Text className="flex-1 text-text text-[12px] leading-[17px] font-semibold">{text}</Text>
</View>;

export default NotificationPermissionGate;
