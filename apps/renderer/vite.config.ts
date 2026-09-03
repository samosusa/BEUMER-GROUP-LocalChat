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
const LIVE = process.env.LOCALCHAT_SERVICE === 'live';

/**
 * The service's own routes, proxied through the dev server in live mode.
 *
 * `src/app.py` installs no CORS middleware, so a page on http://localhost:5173 calling
 * http://127.0.0.1:8000 is refused by the browser before the request is even sent. Proxying
 * makes those calls same-origin, which means the interface can be developed against the
 * real service today without a backend change.
 *
 * This is a development convenience, not the fix. The packaged app loads from `app://` and
 * will still need `CORSMiddleware` on the service — see docs/backend-wiring.md.
 */
const SERVICE_ROUTES = [
  '/health',
  '/docs',
  '/ingest',
  '/status',
  '/query',
  '/conversations',
  '/models',
  '/benchmark',
  '/projects',
];

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
    // LOCALCHAT_SERVICE=live points chats, documents, ingestion and models at the Python
    // service on 127.0.0.1:8000. Off by default: `npm run dev` must keep working with no
    // backend, no model and no GPU, which is what CI and the review container rely on.
    __LIVE_SERVICE__: JSON.stringify(process.env.LOCALCHAT_SERVICE === 'live'),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    proxy: LIVE
      ? Object.fromEntries(
          SERVICE_ROUTES.map((route) => [
            route,
            { target: 'http://127.0.0.1:8000', changeOrigin: false },
          ]),
        )
      : undefined,
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
