import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' КРИТИЧНО для Android WebView: без него vite build кладёт в
// dist/index.html абсолютные пути (/assets/...), которые на хосте
// https://appassets.androidplatform.net/assets/index.html (WebViewAssetLoader)
// не резолвятся → белый экран. Относительные пути (./assets/...) грузятся корректно.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
})
