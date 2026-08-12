import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, View } from 'react-native';

import { ADS } from '../ads/adsConfig';
import { ensureAdsInitialized, getBannerApi, isAdsSupported } from '../ads/yandexAds';

/**
 * Страховка от падения: если нативная часть рекламного SDK не собрана
 * или рекламный компонент упал при рендере — приложение продолжает
 * работать, баннер просто не показывается.
 */
class AdsErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {}

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/**
 * Sticky-баннер РСЯ (адаптивная высота, прижат к низу экрана).
 * Если нативный SDK недоступен или реклама не загрузилась — баннер
 * просто не занимает место (рендерится null).
 *
 * ВАЖНО по API текущей версии yandex-mobile-ads:
 * adUnitId передаётся ВНУТРИ объекта adRequest:
 *   <BannerView size={adSize} adRequest={{ adUnitId: 'demo-banner-yandex' }} />
 * (см. примеры в репозитории yandexmobile/yandex-ads-react-native-plugin).
 */
const AdsBanner = () => {
  const [adSize, setAdSize] = useState(null);

  // Объект запроса стабильный (мемоизирован), чтобы перерендер родителя
  // не перезапускал загрузку рекламы.
  const adRequest = useMemo(() => ({ adUnitId: ADS.bannerUnitId }), []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isAdsSupported()) return;
      const ok = await ensureAdsInitialized();
      const api = getBannerApi();
      if (!ok || !api) return;
      try {
        const size = await api.BannerAdSize.stickySize(Dimensions.get('window').width);
        if (mounted) setAdSize(size);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const api = getBannerApi();
  const BannerView = api ? api.BannerView : null;
  if (!BannerView || !adSize) return null;

  return (
    <View style={{ alignItems: 'center', overflow: 'hidden' }}>
      <AdsErrorBoundary>
        <BannerView
          size={adSize}
          adRequest={adRequest}
          onAdFailedToLoad={() => setAdSize(null)}
        />
      </AdsErrorBoundary>
    </View>
  );
};

export default AdsBanner;
