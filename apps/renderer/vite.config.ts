import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The renderer is loaded two ways:
 *   - in development and in Docker, from a dev/preview server over http;
 *   - in the packaged app, from disk via a custom `app://` protocol.
 *
 * `base: './'` keeps every asset reference relative so the same build works in both.
 */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // Baked in at build time so the mock service is impossible to ship by accident.
    __USE_MOCKS__: JSON.stringify(mode !== 'production' || process.env.LOCALCHAT_MOCKS === '1'),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode !== 'production',
    // Chromium's exact version ships with Electron, so there is no browser matrix to support.
    target: 'chrome128',
    // No manual chunking: the bundle is loaded from disk by the desktop shell, where an
    // extra request costs nothing and vendor splitting only adds cache-invalidation risk.
  },
  css: {
    modules: {
      // Readable class names in devtools; hashed enough to stay collision-free.
      generateScopedName: mode === 'production' ? '[hash:base64:6]' : '[name]__[local]',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
