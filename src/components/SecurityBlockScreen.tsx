import React from 'react';
import { View, Text, TouchableOpacity, BackHandler, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SecurityIntegrityResult } from '../utils/security';
import { useAppSettings } from '../store/appSettings';

interface Props {
  result: SecurityIntegrityResult;
}

export const SecurityBlockScreen: React.FC<Props> = ({ result }) => {
  const { language } = useAppSettings();
  const isRu = language === 'ru';

  const handleExit = () => {
    BackHandler.exitApp();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
        <View style={styles.iconCircle}>
          <Ionicons name="shield-disprotective" size={64} color="#EF4444" />
        </View>

        <Text style={styles.title}>
          {isRu ? 'Доступ заблокирован' : 'Access Blocked'}
        </Text>

        <Text style={styles.subtitle}>
          {isRu
            ? 'Обнаружено несанкционированное изменение приложения или цифровой подписи (модификация APK).'
            : 'Unauthorized modification or invalid app signature detected (modified APK).'}
        </Text>

        <View style={styles.warningBox}>
          <Ionicons name="warning-outline" size={20} color="#F59E0B" style={styles.warnIcon} />
          <Text style={styles.warningText}>
            {isRu
              ? 'В целях безопасности запуск модифицированных версий запрещён. Пожалуйста, установите официальный оригинальный APK.'
              : 'For security reasons, modified versions are prohibited from running. Please install the official APK.'}
          </Text>
        </View>

        <View style={styles.detailsBox}>
          <Text style={styles.detailsTitle}>
            {isRu ? 'Детали проверки целостности:' : 'Security Integrity Details:'}
          </Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{isRu ? 'Причина:' : 'Reason:'}</Text>
            <Text style={styles.detailValue}>{result.statusMessage || (isRu ? 'Нарушение подписи' : 'Signature violation')}</Text>
          </View>

          {result.expectedSha256 ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{isRu ? 'Ожидаемый SHA-256:' : 'Expected SHA-256:'}</Text>
              <Text style={styles.codeText}>{result.expectedSha256}</Text>
            </View>
          ) : null}

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{isRu ? 'Фактический SHA-256:' : 'Actual SHA-256:'}</Text>
            <Text style={styles.codeText}>{result.actualSha256 || (isRu ? 'Неизвестен' : 'Unknown')}</Text>
          </View>

          {result.isFridaDetected ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{isRu ? 'Детекция хуков:' : 'Hook Detection:'}</Text>
              <Text style={styles.detailValueRed}>{isRu ? 'Обнаружен Frida / Xposed' : 'Frida / Xposed detected'}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={styles.button} onPress={handleExit} activeOpacity={0.8}>
          <Ionicons name="close-circle-outline" size={22} color="#FFFFFF" />
          <Text style={styles.buttonText}>
            {isRu ? 'Закрыть приложение' : 'Close Application'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    width: '100%',
  },
  warnIcon: {
    marginRight: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#FBBF24',
    lineHeight: 18,
  },
  detailsBox: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 24,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 12,
  },
  detailRow: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
  },
  detailValueRed: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '700',
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#38BDF8',
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#DC2626',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
