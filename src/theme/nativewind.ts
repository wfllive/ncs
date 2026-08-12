import { vars } from 'nativewind';

const tokenNames: Record<string, string> = {
  primary: 'primary', primaryLight: 'primary-light', primaryDark: 'primary-dark', primarySurface: 'primary-surface',
  accent: 'accent', accentLight: 'accent-light',
  bg: 'bg', bgCard: 'bg-card', bgElevated: 'bg-elevated', bgInput: 'bg-input', bgHover: 'bg-hover',
  surface: 'surface', surfaceLight: 'surface-light', surfaceHigh: 'surface-high',
  text: 'text', textSecondary: 'text-secondary', textTertiary: 'text-tertiary', textInverse: 'text-inverse',
  border: 'border', borderLight: 'border-light', borderFocus: 'border-focus',
  success: 'success', successBg: 'success-bg', successText: 'success-text',
  warning: 'warning', warningBg: 'warning-bg', warningText: 'warning-text',
  error: 'error', errorBg: 'error-bg', errorText: 'error-text',
  info: 'info', infoBg: 'info-bg', infoText: 'info-text',
  selection: 'selection', selectionBorder: 'selection-border',
  canvas: 'canvas', canvasGrid: 'canvas-grid', canvasDot: 'canvas-dot',
  shadow: 'shadow', overlay: 'overlay', systemBar: 'system-bar', terminal: 'terminal', terminalRaised: 'terminal-raised',
};

/** Makes the settings palette available to NativeWind utilities such as bg-bg-card and text-text. */
export const nativeWindTheme = (colors: Record<string, string>) => vars(
  Object.fromEntries(
    Object.entries(tokenNames).map(([paletteKey, cssName]) => [
      `--color-${cssName}`,
      colors[paletteKey],
    ]),
  ),
);
