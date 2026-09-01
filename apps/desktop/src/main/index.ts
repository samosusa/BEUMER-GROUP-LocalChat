import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { app, globalShortcut, protocol, net } from 'electron';
import { applySessionHardening, enforceSingleInstance } from './security';
import { registerIpcHandlers } from './ipc';
import { createTray, destroyTray, updateTrayState } from './tray';
import { beginQuit, createMainWindow, showMainWindow, toggleQuickAsk } from './windows';
import { startServiceWatch, stopServiceWatch } from './service';

/**
 * Main process entry point.
 *
 * Responsibilities, in order: hold the single-instance lock, register the `app://` protocol
 * the packaged renderer is served from, harden the session, then bring up the window, the
 * tray and the global hotkey.
 */

const isDevelopment = !app.isPackaged;
if (app.isPackaged) process.env.LOCALCHAT_PACKAGED = '1';

const QUICK_ASK_HOTKEY = process.env.LOCALCHAT_HOTKEY ?? 'CommandOrControl+Shift+Space';

/**
 * The renderer is served from a custom scheme rather than `file://`.
 *
 * A custom scheme gives the app a real, stable origin, which means CSP, `fetch` and storage
 * all behave the way they do in a browser — instead of the special-cased, permission-flavoured
 * mess that `file://` origins are.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const renderer = join(__dirname, '../../../renderer/dist');

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);

    // Contain path traversal: everything served must resolve inside the bundle directory.
    const resolved = join(renderer, relative);
    if (!resolved.startsWith(renderer)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await readFile(resolved);
      return new Response(body, { headers: { 'Content-Type': contentType(resolved) } });
    } catch {
      // Hash routing means unknown paths are assets, not routes — but fall back to the
      // document anyway so a stale deep link cannot produce a blank window.
      return net.fetch(`app://localchat/index.html`);
    }
  });
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function contentType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.'));
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

if (enforceSingleInstance(() => showMainWindow())) {
  void app.whenReady().then(async () => {
    registerAppProtocol();
    applySessionHardening(isDevelopment);
    registerIpcHandlers();

    createMainWindow();
    createTray(QUICK_ASK_HOTKEY);

    /**
     * The global hotkey can already be taken by another application. Registration returns
     * false rather than throwing, and silently losing the app's main entry point is worth
     * saying out loud.
     */
    const registered = globalShortcut.register(QUICK_ASK_HOTKEY, toggleQuickAsk);
    if (!registered) {
      console.error(
        `[localchat] could not register ${QUICK_ASK_HOTKEY}; another application holds it. ` +
          'Change the shortcut in Settings → Startup & window.',
      );
    }

    startServiceWatch((health) =>
      updateTrayState(
        {
          modelLoaded: health.modelLoaded,
          offline: health.offline,
        },
        QUICK_ASK_HOTKEY,
      ),
    );
  });

  app.on('window-all-closed', () => {
    // Deliberately does nothing on Windows and Linux: the app lives in the tray, and
    // closing the last window is how a user puts it away, not how they quit it.
  });

  app.on('activate', () => showMainWindow());

  app.on('before-quit', () => {
    beginQuit();
    globalShortcut.unregisterAll();
    stopServiceWatch();
    destroyTray();
  });
}
