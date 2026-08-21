import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, SectionCard, SegmentedControl, StatusPill, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { useAppSettings } from '../store/appSettings';
import {
  getNotificationPermissionStatus,
  hasStorageAccess,
  notificationNeedsSettings,
  openNotificationSettings,
  openStorageSettings,
  requestNotificationPermission,
  requestStoragePermissions,
  type NotificationPermissionStatus,
} from '../utils/background';
import { RAI_VERSION } from '../utils/raiSetup';
import { cn } from "../utils/cn";
const AppSettingsScreen = ({
  navigation
}) => {
  const {
    colors,
    t,
    language,
    setLanguage,
    themeMode,
    setThemeMode,
    editor,
    setEditorSetting
  } = useAppSettings();
  const { width, height } = useWindowDimensions();
  const narrow = width < 430;
  const short = height < 700;
  const [storageGranted, setStorageGranted] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermissionStatus | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const styles = useMemo(() => createStyles(colors), [colors]);
  const refreshPermissions = useCallback(async () => {
    const [storage, notifications] = await Promise.all([
      hasStorageAccess(),
      getNotificationPermissionStatus(),
    ]);
    setStorageGranted(storage);
    setNotificationStatus(notifications);
  }, []);
  useEffect(() => {
    refreshPermissions();
  }, [refreshPermissions]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshPermissions();
    });
    return () => sub.remove();
  }, [refreshPermissions]);
  const grantStorage = async () => {
    const granted = await hasStorageAccess();
    if (!granted) {
      await requestStoragePermissions();
      await openStorageSettings();
    }
    setTimeout(refreshPermissions, 600);
  };
  const notifGranted = notificationStatus?.granted === true;
  const notificationSettingsRequired = notificationStatus ? notificationNeedsSettings(notificationStatus) : false;
  const notificationStatusLabel = !notificationStatus
    ? (language === 'ru' ? 'Проверяем…' : 'Checking…')
    : notifGranted
      ? (language === 'ru' ? 'Разрешены' : 'Allowed')
      : notificationStatus.blockingReason === 'channel-disabled'
        ? (language === 'ru' ? 'Канал выключен' : 'Channel off')
        : notificationStatus.blockingReason === 'app-disabled'
          ? (language === 'ru' ? 'Выключены в Android' : 'Off in Android')
          : (language === 'ru' ? 'Нужно разрешение' : 'Permission needed');
  const notificationPlatformText = notificationStatus?.runtimePermissionRequired === false
    ? (language === 'ru'
      ? 'Android 7–12 не показывает отдельный запрос: доступ управляется переключателем приложения и каналом в настройках.'
      : 'Android 7–12 has no separate runtime prompt; access is controlled by the app switch and channel in system settings.')
    : (language === 'ru'
      ? 'На Android 13–17 сначала требуется системное разрешение. Переключатель приложения и канал фоновых задач также должны быть включены.'
      : 'Android 13–17 first requires system permission. The app switch and background-work channel must also remain enabled.');
  const grantNotif = async () => {
    if (notificationBusy) return;
    setNotificationBusy(true);
    setNotificationMessage('');
    try {
      const current = notificationStatus || await getNotificationPermissionStatus();
      if (notificationNeedsSettings(current)) {
        const opened = await openNotificationSettings();
        if (!opened?.success) {
          setNotificationMessage(language === 'ru' ? 'Не удалось открыть настройки уведомлений.' : 'Could not open notification settings.');
        }
      } else {
        const next = await requestNotificationPermission();
        setNotificationStatus(next);
        if (!next.granted) {
          setNotificationMessage(notificationNeedsSettings(next)
            ? (language === 'ru' ? 'Разрешение заблокировано. Нажмите ещё раз, чтобы открыть настройки Android.' : 'Permission is blocked. Tap again to open Android settings.')
            : (language === 'ru' ? 'Уведомления пока не разрешены.' : 'Notifications are not allowed yet.'));
        }
      }
    } finally {
      setNotificationBusy(false);
      setTimeout(refreshPermissions, 700);
    }
  };
  return <AppScreen>
      <TopBar title={t('settings')} subtitle={narrow ? undefined : t('appSubtitle')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName={cn(styles.page, narrow && styles.pageNarrow, short && styles.pageShort)}>
        <View className={styles.column}>
          <SectionCard title={t('appearance')} icon="color-palette-outline">
            <Text className={styles.label}>{t('theme')}</Text>
            <SegmentedControl value={themeMode} onChange={setThemeMode} options={[{
            value: 'system',
            label: t('system'),
            icon: 'phone-portrait-outline'
          }, {
            value: 'light',
            label: t('light'),
            icon: 'sunny-outline'
          }, {
            value: 'dark',
            label: t('dark'),
            icon: 'moon-outline'
          }]} />
            <View className={cn(styles.previewRow, narrow && styles.previewRowNarrow)}>
              <View className={cn(styles.previewWindow, narrow && styles.previewWindowNarrow)}>
                <View className={styles.previewBar} />
                <View className={styles.previewBody}>
                  <View className={styles.previewSide} />
                  <View style={{
                  flex: 1,
                  gap: 7
                }}><View className={styles.previewLine} /><View className={styles.previewLine} style={{
                    width: '62%'
                  }} /><View className={styles.previewButton} /></View>
                </View>
              </View>
              <Text className={styles.description}>
                {language === 'ru' ? 'Контрастная палитра применяется ко всем экранам. Системные панели и заголовки остаются непрозрачными.' : 'The high-contrast palette applies across the app. System bars and headers remain opaque.'}
              </Text>
            </View>
          </SectionCard>

          <SectionCard title={t('language')} icon="language-outline">
            <SegmentedControl value={language} onChange={setLanguage} options={[{
            value: 'ru',
            label: t('russian')
          }, {
            value: 'en',
            label: t('english')
          }]} />
            <Text className={styles.description}>
              {language === 'ru' ? 'Язык интерфейса сохраняется на устройстве и применяется сразу.' : 'The interface language is stored on this device and applied immediately.'}
            </Text>
          </SectionCard>

          <SectionCard title={language === 'ru' ? 'Дизайн предпросмотр (двойная защита)' : 'Design Preview (double guard)'} icon="eye-outline">
            <View className={styles.toggleRow}>
              <View style={{
              flex: 1
            }}>
                <Text className={styles.toggleTitle}>{language === 'ru' ? 'Предпросмотр дизайна' : 'Design preview'}</Text>
                <Text className={styles.toggleDesc}>{language === 'ru' ? 'Рендер дерева в вкладке Дизайн / Превью' : 'Render tree in Design / Preview tabs'}</Text>
              </View>
              <Switch value={editor.designPreview !== false} onValueChange={v => setEditorSetting('designPreview', v)} trackColor={{
              false: colors.borderLight,
              true: colors.primary
            }} thumbColor="#FFFFFF" />
            </View>
            <View className={styles.toggleRow} style={{
            opacity: editor.designPreview === false ? 0.4 : 1
          }}>
              <View style={{
              flex: 1
            }}>
                <Text className={styles.toggleTitle}>{language === 'ru' ? 'Двойная защита' : 'Double guard'}</Text>
                <Text className={styles.toggleDesc}>{language === 'ru' ? 'Требовать подтверждение при включении (второй выключатель)' : 'Require confirmation when enabling (second switch)'}</Text>
              </View>
              <Switch value={!!editor.designPreviewGuard} onValueChange={v => setEditorSetting('designPreviewGuard', v)} disabled={editor.designPreview === false} trackColor={{
              false: colors.borderLight,
              true: colors.warning
            }} thumbColor="#FFFFFF" />
            </View>
            {!editor.designPreview ? <View className={styles.guardNote}><Icon name="shield-outline" size={14} color={colors.warning} /><Text className={styles.guardText}>{language === 'ru' ? 'Предпросмотр полностью выключен — Design/Preview покажут заглушку. Включите для рендера.' : 'Preview fully disabled — Design/Preview will show placeholder. Enable to render.'}</Text></View> : editor.designPreviewGuard ? <View className={styles.guardNote}><Icon name="shield-checkmark-outline" size={14} color={colors.primary} /><Text className={styles.guardText}>{language === 'ru' ? 'Двойная защита включена: предпросмотр потребует тап «Показать» при каждом открытии.' : 'Double guard on: preview will require tap "Show" on each open.'}</Text></View> : null}
          </SectionCard>

          <SectionCard title={language === 'ru' ? 'Память и фон' : 'Storage & background'} icon="folder-open-outline">
            <View className={cn(styles.permissionRow, narrow && styles.permissionRowNarrow)}>
              <View className={styles.permissionCopy}>
                <Text className={styles.toggleTitle}>{language === 'ru' ? 'Доступ к памяти' : 'Storage access'}</Text>
                <Text className={styles.toggleDesc}>{language === 'ru' ? 'All files access — сохранение APK в /sdcard/Download и общий доступ к файлам' : 'All files access — save APKs to /sdcard/Download and share files'}</Text>
              </View>
              <View className={cn(styles.permissionAction, narrow && styles.permissionActionNarrow)}>
                <StatusPill
                  label={storageGranted ? (language === 'ru' ? 'Разрешён' : 'Allowed') : (language === 'ru' ? 'Не разрешён' : 'Not allowed')}
                  tone={storageGranted ? 'success' : 'warning'}
                />
                {!storageGranted ? <Pressable onPress={grantStorage} className={cn(styles.smallBtn, narrow && styles.smallBtnNarrow)}>
                  <Text className={styles.smallBtnText}>{language === 'ru' ? 'Разрешить' : 'Grant'}</Text>
                </Pressable> : null}
              </View>
            </View>

            <View className={cn(styles.permissionRow, narrow && styles.permissionRowNarrow)}>
              <View className={styles.permissionCopy}>
                <Text className={styles.toggleTitle}>{language === 'ru' ? 'Уведомления о фоновых задачах' : 'Background task notifications'}</Text>
                <Text className={styles.toggleDesc}>{language === 'ru' ? 'Статус установки/сборки, пока приложение свёрнуто' : 'Install/build status while the app is minimized'}</Text>
              </View>
              <View className={cn(styles.permissionAction, narrow && styles.permissionActionNarrow)}>
                <StatusPill label={notificationStatusLabel} tone={notifGranted ? 'success' : 'warning'} />
                {!notifGranted ? <Pressable disabled={notificationBusy} onPress={grantNotif} className={cn(styles.smallBtn, narrow && styles.smallBtnNarrow, notificationBusy && 'opacity-60')}>
                  <Text className={styles.smallBtnText}>
                    {notificationBusy
                      ? (language === 'ru' ? 'Проверяем…' : 'Checking…')
                      : notificationSettingsRequired
                        ? (language === 'ru' ? 'Настройки Android' : 'Android settings')
                        : (language === 'ru' ? 'Разрешить' : 'Allow')}
                  </Text>
                </Pressable> : null}
              </View>
            </View>
            <View className={styles.compatNote}>
              <Icon name="phone-portrait-outline" size={15} color={colors.info} />
              <Text className={styles.compatText}>{notificationPlatformText}</Text>
            </View>
            {notificationMessage ? <View className={styles.warningNote}>
              <Icon name="alert-circle-outline" size={15} color={colors.warning} />
              <Text className={styles.warningText}>{notificationMessage}</Text>
            </View> : null}
            <View className={styles.guardNote}>
              <Icon name="information-circle-outline" size={14} color={colors.info} />
              <Text className={styles.guardText}>{language === 'ru' ? 'Установка RAI и сборка APK продолжаются в фоне (foreground service). При закрытии приложения незавершённые шаги установки продолжатся при следующем запуске.' : 'RAI setup and APK builds keep running in the background (foreground service). If the app is closed, unfinished setup steps resume on the next launch.'}</Text>
            </View>
          </SectionCard>

          <SectionCard title={language === 'ru' ? 'О приложении' : 'About'} icon="information-circle-outline">
            <View className={styles.infoRow}><Text className={styles.infoLabel}>NovaJava Studio</Text><Text className={styles.infoValue}>1.0.0</Text></View>
            <View className={styles.infoRow}><Text className={styles.infoLabel}>React</Text><Text className={styles.infoValue}>19.2.3</Text></View>
            <View className={styles.infoRow}><Text className={styles.infoLabel}>Vite</Text><Text className={styles.infoValue}>5.4.0</Text></View>
            <View className={styles.infoRow}><Text className={styles.infoLabel}>{language === 'ru' ? 'Поддержка Android' : 'Android support'}</Text><Text className={styles.infoValue}>7–17+ · API 24–37+</Text></View>
            <View className={styles.infoRow}><Text className={styles.infoLabel}>Android SDK</Text><Text className={styles.infoValue}>API 37</Text></View>
            <View className={styles.infoRow}><Text className={styles.infoLabel}>SDK</Text><Text className={styles.infoValue}>37.0.0 (обязателен)</Text></View>
            <View className={styles.infoRow}><Text className={styles.infoLabel}>RAI</Text><Text className={styles.infoValue}>v{RAI_VERSION} (локально)</Text></View>
          </SectionCard>
        </View>
      </ScrollView>
    </AppScreen>;
};
const createStyles = c => ({
  page: "p-[16px] pb-[40px]",
  pageNarrow: "px-[10px] pt-[12px]",
  pageShort: "pb-[24px]",
  column: "w-full max-w-[760px] self-center gap-[14px]",
  label: "text-text-secondary text-[12px] font-semibold mb-[-5px]",
  description: "text-text-secondary text-[12px] leading-[18px] flex-1",
  toggleRow: "flex-row items-center gap-[12px] py-[8px] border-b border-b-border-light",
  toggleTitle: "text-text text-[13px] font-bold",
  toggleDesc: "text-text-secondary text-[11px] mt-[2px] leading-[15px]",
  permissionRow: "flex-row items-center gap-[12px] py-[10px] border-b border-b-border-light",
  permissionRowNarrow: "flex-col items-stretch gap-[8px]",
  permissionCopy: "flex-1 min-w-0",
  permissionAction: "items-end gap-[6px]",
  permissionActionNarrow: "w-full flex-row items-center justify-between",
  guardNote: "flex-row items-start gap-[8px] p-[10px] rounded-[8px] bg-bg-elevated mt-[4px]",
  guardText: "flex-1 text-text-secondary text-[11px] leading-[15px]",
  compatNote: "flex-row items-start gap-[8px] p-[10px] rounded-[8px] bg-info-bg mt-[8px]",
  compatText: "flex-1 text-info-text text-[11px] leading-[16px]",
  warningNote: "flex-row items-start gap-[8px] p-[10px] rounded-[8px] bg-warning-bg mt-[6px]",
  warningText: "flex-1 text-warning-text text-[11px] leading-[16px]",
  smallBtn: "px-[12px] py-[8px] rounded-[8px] bg-primary active:bg-primary-dark",
  smallBtnNarrow: "min-w-[128px] items-center",
  smallBtnText: "text-white text-[11px] font-bold text-center",
  previewRow: "flex-row items-center gap-[16px]",
  previewRowNarrow: "flex-col items-stretch gap-[10px]",
  previewWindow: "w-[140px] h-[88px] rounded-[9px] overflow-hidden border border-border-light bg-bg",
  previewWindowNarrow: "w-full h-[104px]",
  previewBar: "h-[18px] bg-bg-card border-b border-b-border",
  previewBody: "flex-1 flex-row p-[8px] gap-[8px]",
  previewSide: "w-[25px] rounded-[4px] bg-bg-elevated",
  previewLine: "h-[7px] rounded-[3px] bg-border-light w-[88%]",
  previewButton: "h-[15px] rounded-[4px] bg-primary w-[42px] mt-[3px]",
  infoRow: "flex-row flex-wrap justify-between gap-x-[12px] gap-y-[3px] py-[6px]",
  infoLabel: "text-text-secondary text-[13px] flex-shrink",
  infoValue: "text-text text-[13px] font-semibold font-mono text-right"
});
export default AppSettingsScreen;
