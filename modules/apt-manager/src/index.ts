import { requireNativeModule } from 'expo-modules-core';

let native: any = null;
try { native = requireNativeModule('AptManager'); } catch (e) {}

export const isAvailable = () => !!native;
export const isBootstrapInstalled = async () => native?.isBootstrapInstalled?.() || false;
export const ensurePermissions = async () => native?.ensurePermissions?.() || { success: false };
export const getExecBinDir = async () => native?.getExecBinDir?.() || { path: '' };
export const testExec = async () => native?.testExec?.() || { success: false };
export const installBootstrap = async () => native?.installBootstrap?.() || { success: false, output: 'Not available' };
export const install = async (pkg: string) => native?.install?.(pkg) || { success: false, output: 'Not available' };
export const remove = async (pkg: string) => native?.remove?.(pkg) || { success: false, output: 'Not available' };
export const search = async (q: string) => native?.search?.(q) || { success: false, output: 'Not available' };
export const info = async (pkg: string) => native?.info?.(pkg) || { success: false, output: 'Not available' };
export const update = async () => native?.update?.() || { success: false, output: 'Not available' };
export const listInstalled = async () => native?.listInstalled?.() || [];
export const whichCommand = async (cmd: string) => native?.whichCommand?.(cmd) || { exists: false, path: '' };
export const getPrefix = async () => native?.getPrefix?.() || { prefix: '' };
export const getHome = async () => native?.getHome?.() || { home: '' };
export const isProotRootfsInstalled = async () => native?.isProotRootfsInstalled?.() || false;
export const getProotRootfsDir = async () => native?.getProotRootfsDir?.() || { path: '' };
export const installProotRootfs = async (url?: string) =>
  native?.installProotRootfs?.(url || null) || { success: false, output: 'Not available' };
export const deleteRootfs = async () =>
  native?.deleteRootfs?.() || { success: false, deleted: false };
export const getRootfsProgress = async () =>
  native?.getRootfsProgress?.() || { stage: 'idle', url: '', downloadedBytes: 0, totalBytes: 0, message: '' };
export const seedRaiBundle = async () =>
  native?.seedRaiBundle?.() || { success: false, output: 'Not available' };
export const canInstallApks = async () => native?.canInstallApks?.() || false;
export const installApk = async (path: string) => native?.installApk?.(path) || { success: false, output: 'Native APK installer is unavailable' };
export const launchPackage = async (packageName: string) => native?.launchPackage?.(packageName) || { success: false, output: 'Native package launcher is unavailable' };

// Shared storage ("память") — All files access (API 30+) / legacy runtime dialog
export const hasAllFilesAccess = async () => native?.hasAllFilesAccess?.() || false;
export const openAllFilesAccessSettings = async () =>
  native?.openAllFilesAccessSettings?.() || { success: false, output: 'Not available' };
export const requestStoragePermissions = async () =>
  native?.requestStoragePermissions?.() || { success: false, output: 'Not available' };

// Notification access on Android 7+: app switch + channel state + Android 13 runtime permission.
export interface NativeNotificationPermissionStatus {
  granted: boolean;
  apiLevel?: number;
  runtimePermissionRequired?: boolean;
  runtimeGranted?: boolean;
  appNotificationsEnabled?: boolean;
  channelCreated?: boolean;
  channelEnabled?: boolean;
  blockingReason?: 'none' | 'runtime-permission' | 'app-disabled' | 'channel-disabled' | 'unavailable';
  status?: 'granted' | 'denied' | 'undetermined';
  canAskAgain?: boolean;
  openedSettings?: boolean;
  success?: boolean;
  output?: string;
}
export const initializeNotifications = async () =>
  native?.initializeNotifications?.() || { success: false, output: 'Not available' };
export const getNotificationsPermissionStatus = async (): Promise<NativeNotificationPermissionStatus> =>
  native?.getNotificationsPermissionStatus?.()
  || native?.hasNotificationsPermission?.()
  || { granted: true, blockingReason: 'unavailable' };
export const hasNotificationsPermission = async (): Promise<NativeNotificationPermissionStatus> =>
  native?.hasNotificationsPermission?.()
  || native?.getNotificationsPermissionStatus?.()
  || { granted: true, blockingReason: 'unavailable' };
export const requestNotificationsPermission = async (): Promise<NativeNotificationPermissionStatus> =>
  native?.requestNotificationsPermission?.() || { granted: true, success: false, output: 'Not available' };
export const openNotificationSettings = async () =>
  native?.openNotificationSettings?.() || { success: false, openedSettings: false, output: 'Not available' };

// Foreground service — keeps install/build running in the background
export const startBackgroundService = async (text: string) =>
  native?.startBackgroundService?.(text) || { success: false, output: 'Not available' };
export const updateBackgroundService = async (text: string) =>
  native?.updateBackgroundService?.(text) || { success: false, output: 'Not available' };
export const stopBackgroundService = async () =>
  native?.stopBackgroundService?.() || { success: false, output: 'Not available' };
export const getBackgroundServiceStatus = async () =>
  native?.getBackgroundServiceStatus?.() || { active: false, text: '', jobId: '' };

export type DetachedJobStatus = 'queued' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'cancelled' | 'missing' | 'idle';
export interface DetachedJob {
  exists?: boolean;
  id: string;
  command?: string;
  workDir?: string;
  label?: string;
  kind?: string;
  metadata?: string;
  status: DetachedJobStatus;
  attempt?: number;
  exitCode?: number | null;
  createdAt?: number;
  updatedAt?: number;
  stopRequested?: boolean;
  reused?: boolean;
  error?: string;
}

/** Start a service-owned proot command, persisted before any process is spawned. */
export const startDetachedJob = async (
  command: string,
  workDir?: string,
  label = 'Background operation',
  kind = 'shell',
  metadata?: string,
): Promise<DetachedJob> => native?.startDetachedJob?.(
  command, workDir || null, label, kind, metadata || null,
) || { id: '', status: 'failed', error: 'Native background jobs are unavailable' };
export const getDetachedJob = async (id: string): Promise<DetachedJob> =>
  native?.getDetachedJob?.(id) || { exists: false, id, status: 'missing' };
export const getCurrentDetachedJob = async (): Promise<DetachedJob> =>
  native?.getCurrentDetachedJob?.() || { exists: false, id: '', status: 'idle' };
export const readDetachedJobLog = async (id: string, offset = 0, maxBytes = 65536) =>
  native?.readDetachedJobLog?.(id, offset, maxBytes) || { text: '', nextOffset: offset, done: true };
export const stopDetachedJob = async (id: string) =>
  native?.stopDetachedJob?.(id) || { success: false, id };

export const isIgnoringBatteryOptimizations = async () =>
  native?.isIgnoringBatteryOptimizations?.() ?? true;
export const openBatteryOptimizationSettings = async () =>
  native?.openBatteryOptimizationSettings?.() || { success: false, output: 'Not available' };

/**
 * Render a Compose Studio component tree through the real Android View
 * framework and receive a base64-encoded PNG. The editor uses this to
 * replace the old "fake" React Native preview with a true native render
 * (the same FrameLayout/LinearLayout/CardView widgets the generated APK
 * will use at runtime).
 */
export const renderComposePreview = async (payload) => {
  if (!native?.renderComposePreview) return { success: false, output: 'Native preview renderer is unavailable' };
  return await native.renderComposePreview(payload);
};

export default {
  isAvailable, isBootstrapInstalled, ensurePermissions, getExecBinDir, testExec, installBootstrap,
  install, remove, search, info, update,
  listInstalled, whichCommand, getPrefix, getHome,
  isProotRootfsInstalled, getProotRootfsDir, installProotRootfs, getRootfsProgress, deleteRootfs,
  seedRaiBundle,
  canInstallApks, installApk, launchPackage, renderComposePreview,
  hasAllFilesAccess, openAllFilesAccessSettings, requestStoragePermissions,
  initializeNotifications, getNotificationsPermissionStatus, hasNotificationsPermission,
  requestNotificationsPermission, openNotificationSettings,
  startBackgroundService, updateBackgroundService, stopBackgroundService, getBackgroundServiceStatus,
  startDetachedJob, getDetachedJob, getCurrentDetachedJob, readDetachedJobLog, stopDetachedJob,
  isIgnoringBatteryOptimizations, openBatteryOptimizationSettings
};
