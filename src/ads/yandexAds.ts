/**
 * Безопасная обёртка над yandex-mobile-ads:
 * плагин — нативный модуль, поэтому в Expo Go / web / при отсутствии SDK
 * любой вызов просто возвращает «недоступно», не роняя приложение.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ADS } from './adsConfig';

let lib = null;
try { lib = require('yandex-mobile-ads'); } catch { lib = null; }

const LAST_INTERSTITIAL_KEY = '@nova_last_interstitial_ts';
let initPromise = null;

export const isAdsSupported = () => !!(ADS.enabled && lib && lib.MobileAds);

export const getBannerApi = () => (lib && lib.BannerView ? lib : null);

/**
 * Инициализация SDK (однократно). Вызывается из рекламных компонентов,
 * которые монтируются только после экрана политики конфиденциальности —
 * то есть consent уже дан пользователем.
 */
export const ensureAdsInitialized = () => {
  if (!isAdsSupported()) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = (async () => {
      try {
        if (lib.MobileAds.setUserConsent) await lib.MobileAds.setUserConsent(true);
        await lib.MobileAds.initialize();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return initPromise;
};

/**
 * Полноэкранная реклама после успешной сборки.
 * Ограничение частоты: не чаще ADS.interstitialMinIntervalMs.
 * Любая ошибка/отсутствие рекламы — тихий no-op.
 */
export const maybeShowInterstitial = async () => {
  if (!isAdsSupported()) return;
  try {
    const now = Date.now();
    const last = Number(await AsyncStorage.getItem(LAST_INTERSTITIAL_KEY)) || 0;
    if (now - last < ADS.interstitialMinIntervalMs) return;

    await ensureAdsInitialized();
    const loader = await lib.InterstitialAdLoader.create().catch(() => null);
    if (!loader) return;
    // API плагина принимает простой объект { adUnitId, ... }
    // (см. примеры в репозитории yandexmobile/yandex-ads-react-native-plugin).
    const ad = await loader
      .loadAd({ adUnitId: ADS.interstitialUnitId })
      .then((a) => a)
      .catch(() => null);
    if (!ad) return;

    // Метку времени ставим только при реальном показе.
    ad.onAdShown = () => {
      AsyncStorage.setItem(LAST_INTERSTITIAL_KEY, String(Date.now())).catch(() => {});
    };
    ad.onAdFailedToShow = () => {};
    ad.onAdDismissed = () => {};
    ad.show();
  } catch {}
};
