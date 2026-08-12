import { NativeModules, Platform, Alert } from 'react-native';

const { SecurityModule } = NativeModules;

export interface SecurityIntegrityResult {
  isTampered: boolean;
  actualSha256: string;
  expectedSha256: string;
  isDebug: boolean;
  isDebuggerAttached: boolean;
  isFridaDetected: boolean;
  isPackageNameValid: boolean;
  statusMessage: string;
}

/**
 * Returns the SHA-256 certificate fingerprint of the running APK.
 */
export async function getAppSignature(): Promise<string> {
  if (Platform.OS !== 'android' || !SecurityModule) {
    return '';
  }
  try {
    return await SecurityModule.getAppSignature();
  } catch (error) {
    console.warn('Failed to get app signature:', error);
    return '';
  }
}

/**
 * Runs full security integrity check (Signature check, Frida detection, Debugger check).
 */
export async function verifyAppIntegrity(): Promise<SecurityIntegrityResult | null> {
  if (Platform.OS !== 'android' || !SecurityModule) {
    return null;
  }
  try {
    const result: SecurityIntegrityResult = await SecurityModule.verifyIntegrity();
    return result;
  } catch (error) {
    console.warn('Failed to verify app integrity:', error);
    return null;
  }
}

/**
 * Checks security integrity on app launch.
 */
export async function checkSecurityOnBoot(
  options: { alertOnTamper?: boolean } = { alertOnTamper: true }
): Promise<SecurityIntegrityResult | null> {
  const result = await verifyAppIntegrity();
  if (!result) return null;

  if (result.isTampered && options.alertOnTamper) {
    Alert.alert(
      '⚠️ Ошибка целостности / Защита от мод',
      `Обнаружено изменение цифровой подписи или вмешательство в APK.\n\nДетали: ${result.statusMessage}\n\nОтпечаток: ${result.actualSha256 || 'Неизвестен'}`,
      [{ text: 'OK' }]
    );
  }

  return result;
}
