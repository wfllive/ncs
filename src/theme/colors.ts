import { useColorScheme } from 'react-native';

/**
 * Semantic colour tokens used by the builder. Both palettes are deliberately
 * opaque: system bars, headers and navigation surfaces never rely on blur or
 * transparency to remain readable.
 * 
 * Theme 2026: Modern IDE (Deep Slate & Cobalt Blue) - No Purple.
 */
export const lightColors = {
  mode: 'light',
  // Основной цвет: Чистый синий (Cobalt Blue)
  primary: '#0055FF',
  primaryLight: '#3377FF',
  primaryDark: '#003FCC',
  primarySurface: '#E6F0FF',
  // Акцент: Бирюзовый / Мятный
  accent: '#0D9488',
  accentLight: '#14B8A6',
  // Фоны: Чистые, прохладные, бумажные оттенки
  bg: '#F6F8FA',
  bgCard: '#FFFFFF',
  bgElevated: '#F0F3F6',
  bgInput: '#FFFFFF',
  bgHover: '#E5E8EC',
  surface: '#FFFFFF',
  surfaceLight: '#F3F5F8',
  surfaceHigh: '#E1E5EA',
  // Текст: Глубокий сине-серый (не чисто черный)
  text: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#64748B',
  textInverse: '#FFFFFF',
  // Границы
  border: '#D1D5DB',
  borderLight: '#E5E7EB',
  borderFocus: '#0055FF',
  // Статусы (чистые и контрастные)
  success: '#059669',
  successBg: '#D1FAE5',
  successText: '#065F46',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  warningText: '#92400E',
  error: '#DC2626',
  errorBg: '#FEE2E2',
  errorText: '#991B1B',
  info: '#2563EB',
  infoBg: '#DBEAFE',
  infoText: '#1E40AF',
  // Блоки визуального программирования (заменены фиолетовые)
  blockEvent: '#D97706',      // Оранжевый
  blockControl: '#DC2626',    // Красный
  blockOperator: '#059669',   // Изумрудный
  blockVariable: '#EA580C',   // Терракотовый
  blockLogic: '#2563EB',      // Синий
  blockComponent: '#0891B2',  // Циан (вместо фиолетового)
  blockMath: '#0D9488',       // Бирюзовый
  blockText: '#16A34A',       // Зеленый
  blockList: '#E11D48',       // Розово-красный (Rose)
  // Компоненты UI (заменены фиолетовые)
  compLayout: '#0284C7',      // Небесно-синий (Sky)
  compWidget: '#2563EB',      // Синий
  compInput: '#EA580C',       // Терракотовый
  compMedia: '#0D9488',       // Бирюзовый
  // Выделение и холст
  selection: '#DBEAFE',
  selectionBorder: '#0055FF',
  canvas: '#EAECEF',
  canvasGrid: '#D0D5DB',
  canvasDot: '#A9B4C2',
  shadow: '#0F172A',
  overlay: '#0F172A99',       // 60% opacity
  systemBar: '#FFFFFF',
  terminal: '#0D1117',
  terminalRaised: '#161B22',
};

export const darkColors = {
  mode: 'dark',
  // Основной цвет: Неоново-синий (Electric Blue), отлично читается на темном
  primary: '#3B82F6',
  primaryLight: '#60A5FA',
  primaryDark: '#2563EB',
  primarySurface: '#172554',
  // Акцент: Светлая бирюза
  accent: '#2DD4BF',
  accentLight: '#5EEAD4',
  // Фоны: Очень глубокий Slate (почти черный, комфортный для глаз)
  bg: '#0B0F19',
  bgCard: '#131825',
  bgElevated: '#1C2333',
  bgInput: '#0F1420',
  bgHover: '#232D40',
  surface: '#131825',
  surfaceLight: '#1C2333',
  surfaceHigh: '#273449',
  // Текст
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textInverse: '#0B0F19',
  // Границы
  border: '#2A3649',
  borderLight: '#37475F',
  borderFocus: '#3B82F6',
  // Статусы (адаптированы для темной темы)
  success: '#10B981',
  successBg: '#064E3B',
  successText: '#A7F3D0',
  warning: '#F59E0B',
  warningBg: '#78350F',
  warningText: '#FDE68A',
  error: '#EF4444',
  errorBg: '#7F1D1D',
  errorText: '#FECACA',
  info: '#3B82F6',
  infoBg: '#1E3A8A',
  infoText: '#BFDBFE',
  // Блоки визуального программирования (пастельные, чтобы не резать глаз)
  blockEvent: '#FBBF24',      // Желто-янтарный
  blockControl: '#F87171',    // Мягкий красный
  blockOperator: '#34D399',   // Мягкий изумрудный
  blockVariable: '#FB923C',   // Оранжевый
  blockLogic: '#60A5FA',      // Голубой
  blockComponent: '#22D3EE',  // Светлый циан (вместо фиолетового)
  blockMath: '#2DD4BF',       // Бирюзовый
  blockText: '#4ADE80',       // Светло-зеленый
  blockList: '#FB7185',       // Светлый Rose
  // Компоненты UI
  compLayout: '#38BDF8',      // Светлый Sky
  compWidget: '#60A5FA',      // Голубой
  compInput: '#FB923C',       // Оранжевый
  compMedia: '#2DD4BF',       // Бирюзовый
  // Выделение и холст
  selection: '#1E3A8A',
  selectionBorder: '#3B82F6',
  canvas: '#090C14',
  canvasGrid: '#172033',
  canvasDot: '#2A3649',
  shadow: '#000000',
  overlay: '#0B0F19CC',       // 80% opacity
  systemBar: '#131825',
  terminal: '#05070B',
  terminalRaised: '#0B0F19',
};

const addLegacyAliases = (palette) => ({
  ...palette,
  background: palette.bg,
  secondary: palette.accent,
  onSurface: palette.text,
  onSurfaceVariant: palette.textSecondary,
  onPrimary: '#FFFFFF',
});

export const themes = {
  light: addLegacyAliases(lightColors),
  dark: addLegacyAliases(darkColors),
};

// Compatibility for older generator/editor modules that have not moved to the
// settings context yet. New UI should use useAppSettings().colors.
const colors = themes.light;

export const useTheme = () => {
  const scheme = useColorScheme();
  return themes[scheme === 'dark' ? 'dark' : 'light'];
};

export default colors;