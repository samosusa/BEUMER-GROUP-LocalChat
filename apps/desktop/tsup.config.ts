import { defineConfig } from 'tsup';

/**
 * Main and preload are bundled separately.
 *
 * Both emit CommonJS: Electron's preload runs in a sandboxed context that does not accept
 * ESM, and keeping the main process on the same format avoids a class of loader surprises
 * in the packaged app.
 */
export default defineConfig([
  {
    entry: { index: 'src/main/index.ts' },
    outDir: 'out/main',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    external: ['electron'],
    clean: true,
    sourcemap: true,
    outExtension: () => ({ js: '.cjs' }),
  },
  {
    entry: { index: 'src/preload/index.ts' },
    outDir: 'out/preload',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    external: ['electron'],
    sourcemap: true,
    outExtension: () => ({ js: '.cjs' }),
  },
]);
