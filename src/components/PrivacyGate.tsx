import React, { type PropsWithChildren, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppSettings } from '../store/appSettings';

const PRIVACY_ACCEPTED_KEY = '@nova_privacy_accepted_v2';

const STRINGS = {
  ru: {
    title: 'Политика конфиденциальности',
    intro: 'NovaCompose Studio работает полностью на вашем устройстве. Приложению не нужны аккаунты, и оно не передаёт ваши данные разработчику.',
    points: [
      'Приложение не собирает персональные данные у разработчика: нет своих серверов, аналитики и трекеров.',
      'Приложение бесплатное и показывает рекламу Рекламной сети Яндекса. Для подбора объявлений Яндекс может использовать рекламный идентификатор устройства — он обрабатывается по политике конфиденциальности Яндекса (yandex.ru/legal/confidential).',
      'Доступ к файлам нужен только для чтения и записи проектов и результатов сборки (APK) — файлы остаются на устройстве.',
      'Установка приложений используется исключительно для установки APK, собранных вами в конструкторе, и только через системный диалог Android.',
      'Сеть используется для загрузки открытого инструментария сборки (Ubuntu, Node.js, Gradle, Android SDK) с официальных источников по HTTPS и для показа рекламы.',
      'Уведомления показывают ход фоновых операций: подготовки среды и сборки.',
    ],
    accept: 'Принимаю и продолжаю',
    note: 'Нажимая кнопку, вы подтверждаете, что ознакомлены с политикой конфиденциальности.',
  },
  en: {
    title: 'Privacy policy',
    intro: 'NovaCompose Studio works entirely on your device. It needs no accounts and does not send your data to the developer.',
    points: [
      'The developer collects no personal data: the app has no servers, analytics or trackers of its own.',
      'The app is free and shows ads from the Yandex Advertising Network. To select ads Yandex may use the device advertising ID, processed under the Yandex privacy policy (yandex.ru/legal/confidential).',
      'File access is used only to read and write your projects and build results (APK) — files stay on the device.',
      'App installation is used solely to install APKs you built, via the standard Android system dialog.',
      'The network is used only to download open build tooling (Ubuntu, Node.js, Gradle, Android SDK) from official sources over HTTPS and to display ads.',
      'Notifications show the progress of background work: environment setup and builds.',
    ],
    accept: 'Accept and continue',
    note: 'By tapping the button you confirm that you have read the privacy policy.',
  },
};

type PrivacyGateProps = PropsWithChildren<{ onConsentReady?: () => void }>;

const PrivacyGate = ({ children, onConsentReady }: PrivacyGateProps) => {
  const { colors, language } = useAppSettings();
  const insets = useSafeAreaInsets();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const copy = STRINGS[language as keyof typeof STRINGS] || STRINGS.en;

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PRIVACY_ACCEPTED_KEY)
      .then((value) => { if (!cancelled) setAccepted(value === '1'); })
      .catch(() => { if (!cancelled) setAccepted(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (accepted) onConsentReady?.();
  }, [accepted, onConsentReady]);

  if (accepted === null) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (accepted) return children;

  const onAccept = async () => {
    try { await AsyncStorage.setItem(PRIVACY_ACCEPTED_KEY, '1'); } catch {}
    setAccepted(true);
  };

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4 pt-6" keyboardShouldPersistTaps="handled">
        <Text className="mb-3 text-[22px] font-bold text-text">{copy.title}</Text>
        <Text className="mb-4 text-[15px] leading-[22px] text-text">{copy.intro}</Text>
        {copy.points.map((point) => (
          <View key={point} className="mb-2.5 flex-row">
            <Text className="mr-2 text-[15px] leading-[21px] text-primary">•</Text>
            <Text className="flex-1 text-sm leading-[21px] text-text-secondary">{point}</Text>
          </View>
        ))}
      </ScrollView>
      <View className="px-5 py-3">
        <TouchableOpacity className="items-center rounded-xl bg-primary py-3.5" activeOpacity={0.85} onPress={onAccept}>
          <Text className="text-base font-semibold text-white">{copy.accept}</Text>
        </TouchableOpacity>
        <Text className="mt-2.5 text-center text-xs leading-[17px] text-text-secondary">{copy.note}</Text>
      </View>
    </View>
  );
};

export default PrivacyGate;
