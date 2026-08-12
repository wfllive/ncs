/**
 * background.js — foreground-service helper.
 *
 * Пока идёт установка среды или сборка APK, приложение держит foreground
 * service (нативное уведомление «NovaCompose Studio — …») + wakelock, чтобы
 * Android не убивал процесс, когда пользователь свернул приложение или
 * заблокировал экран. На web/iOS — безопасный no-op.
 */
import { Platform } from 'react-native';
import * as apt from '../../modules/apt-manager/src/index';

const enabled = Platform.OS === 'android' && apt.isAvailable();

export type NotificationBlockingReason =
  | 'none'
  | 'runtime-permission'
  | 'app-disabled'
  | 'channel-disabled'
  | 'unavailable';

export interface NotificationPermissionStatus {
  granted: boolean;
  apiLevel: number;
  runtimePermissionRequired: boolean;
  runtimeGranted: boolean;
  appNotificationsEnabled: boolean;
  channelCreated: boolean;
  channelEnabled: boolean;
  blockingReason: NotificationBlockingReason;
  status?: 'granted' | 'denied' | 'undetermined';
  canAskAgain?: boolean;
  openedSettings?: boolean;
  success?: boolean;
  output?: string;
}

const androidApiLevel = () => typeof Platform.Version === 'number' ? Platform.Version : 0;

const normalizeNotificationStatus = (value: any = {}): NotificationPermissionStatus => {
  const apiLevel = Number(value.apiLevel ?? androidApiLevel());
  const runtimePermissionRequired = value.runtimePermissionRequired ?? (Platform.OS === 'android' && apiLevel >= 33);
  const runtimeGranted = value.runtimeGranted ?? value.granted ?? !enabled;
  const appNotificationsEnabled = value.appNotificationsEnabled ?? value.granted ?? !enabled;
  const channelEnabled = value.channelEnabled ?? value.granted ?? !enabled;
  const granted = !!(value.granted ?? (runtimeGranted && appNotificationsEnabled && channelEnabled));
  const blockingReason: NotificationBlockingReason = value.blockingReason
    ?? (!runtimeGranted ? 'runtime-permission'
      : !appNotificationsEnabled ? 'app-disabled'
        : !channelEnabled ? 'channel-disabled' : 'none');
  return {
    ...value,
    granted,
    apiLevel,
    runtimePermissionRequired: !!runtimePermissionRequired,
    runtimeGranted: !!runtimeGranted,
    appNotificationsEnabled: !!appNotificationsEnabled,
    channelCreated: !!value.channelCreated,
    channelEnabled: !!channelEnabled,
    blockingReason,
  };
};

export const startBackground = async (label) => {
  if (!enabled) return { success: false };
  try {
    return await apt.startBackgroundService(label);
  } catch (e) {
    return { success: false, output: String(e) };
  }
};

export const updateBackground = async (label) => {
  if (!enabled) return { success: false };
  try {
    return await apt.updateBackgroundService(label);
  } catch (e) {
    return { success: false, output: String(e) };
  }
};

export const stopBackground = async () => {
  if (!enabled) return { success: false };
  try {
    return await apt.stopBackgroundService();
  } catch (e) {
    return { success: false, output: String(e) };
  }
};

// Shared storage («память»)
export const hasStorageAccess = async () => {
  if (!enabled) return false;
  try {
    return Boolean(await apt.hasAllFilesAccess());
  } catch (e) {
    return false;
  }
};

export const openStorageSettings = async () => {
  if (!enabled) return { success: false, output: 'Not available' };
  try {
    return await apt.openAllFilesAccessSettings();
  } catch (e) {
    return { success: false, output: String(e) };
  }
};

export const requestStoragePermissions = async () => {
  if (!enabled) return { success: false, output: 'Not available' };
  try {
    return await apt.requestStoragePermissions();
  } catch (e) {
    return { success: false, output: String(e) };
  }
};

/** Create the Android 8+ channel before checking or requesting notification access. */
export const initializeNotifications = async () => {
  if (!enabled) return { success: false };
  try { return await apt.initializeNotifications(); } catch (_) { return { success: false }; }
};

/**
 * Cross-version status for Android 7 through Android 17+: Android 13's runtime permission is only
 * one layer; global app and Android 8+ channel switches are checked independently.
 */
export const getNotificationPermissionStatus = async (): Promise<NotificationPermissionStatus> => {
  if (!enabled) return normalizeNotificationStatus({ granted: true });
  try {
    await initializeNotifications();
    return normalizeNotificationStatus(await apt.getNotificationsPermissionStatus());
  } catch (error) {
    return normalizeNotificationStatus({
      granted: false,
      blockingReason: 'unavailable',
      output: error instanceof Error ? error.message : String(error),
    });
  }
};

export const hasNotificationPermission = async () => (await getNotificationPermissionStatus()).granted;

export const requestNotificationPermission = async (): Promise<NotificationPermissionStatus> => {
  if (!enabled) return normalizeNotificationStatus({ granted: true, status: 'granted' });
  try {
    await initializeNotifications();
    const request = await apt.requestNotificationsPermission();
    const status = await getNotificationPermissionStatus();
    // Native request metadata (especially canAskAgain) is useful, while the fresh status is the
    // source of truth for app/channel switches after returning from an OEM permission surface.
    return normalizeNotificationStatus({ ...status, ...request, granted: status.granted });
  } catch (error) {
    return normalizeNotificationStatus({
      granted: false,
      status: 'denied',
      blockingReason: 'unavailable',
      output: error instanceof Error ? error.message : String(error),
    });
  }
};

export const openNotificationSettings = async () => {
  if (!enabled) return { success: false, openedSettings: false };
  try { return await apt.openNotificationSettings(); } catch (_) {
    return { success: false, openedSettings: false };
  }
};

/** A runtime request cannot repair these states; only Android Settings can. */
export const notificationNeedsSettings = (status: NotificationPermissionStatus) =>
  !status.granted && (
    status.blockingReason === 'app-disabled'
    || status.blockingReason === 'channel-disabled'
    || !status.runtimePermissionRequired
    || (status.blockingReason === 'runtime-permission' && status.canAskAgain === false)
  );

export default {
  startBackground, updateBackground, stopBackground,
  hasStorageAccess, openStorageSettings, requestStoragePermissions,
  initializeNotifications, getNotificationPermissionStatus, hasNotificationPermission,
  requestNotificationPermission, openNotificationSettings, notificationNeedsSettings,
};
