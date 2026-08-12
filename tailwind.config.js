/** @type {import('tailwindcss').Config} */
const semanticColors = [
  'primary', 'primary-light', 'primary-dark', 'primary-surface',
  'accent', 'accent-light',
  'bg', 'bg-card', 'bg-elevated', 'bg-input', 'bg-hover',
  'surface', 'surface-light', 'surface-high',
  'text', 'text-secondary', 'text-tertiary', 'text-inverse',
  'border', 'border-light', 'border-focus',
  'success', 'success-bg', 'success-text',
  'warning', 'warning-bg', 'warning-text',
  'error', 'error-bg', 'error-text',
  'info', 'info-bg', 'info-text',
  'selection', 'selection-border',
  'canvas', 'canvas-grid', 'canvas-dot',
  'shadow', 'overlay', 'system-bar', 'terminal', 'terminal-raised',
];

module.exports = {
  content: ['./App.tsx', './index.{js,ts}', './src/**/*.{ts,tsx}', './modules/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: Object.fromEntries(
        semanticColors.map((name) => [name, `var(--color-${name})`]),
      ),
    },
  },
  plugins: [],
};
