import { app, session, shell, type BrowserWindow } from 'electron';

/**
 * Security hardening for the renderer.
 *
 * The threat model is specific: LocalChat opens documents that are commercially sensitive
 * and runs a language model whose output is untrusted text. The renderer must therefore be
 * unable to reach the network, unable to touch the filesystem, and unable to be navigated
 * anywhere the app did not build. Every measure below exists to make one of those true.
 */

/** The only origin the renderer may talk to: the RAG service on loopback. */
export const SERVICE_ORIGIN = process.env.LOCALCHAT_SERVICE_URL ?? 'http://127.0.0.1:8000';

const DEV_SERVER_ORIGIN = 'http://localhost:5173';

export function applySessionHardening(isDevelopment: boolean): void {
  const partition = session.defaultSession;

  /**
   * Content-Security-Policy as a response header. The renderer also ships a `<meta>` CSP;
   * this one is authoritative, because a header cannot be stripped by injected markup.
   */
  partition.webRequest.onHeadersReceived((details, callback) => {
    const connect = [
      `'self'`,
      SERVICE_ORIGIN,
      isDevelopment ? `${DEV_SERVER_ORIGIN} ws://localhost:5173` : '',
    ]
      .filter(Boolean)
      .join(' ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            `default-src 'none'`,
            // 'unsafe-inline' for styles only: CSS Modules emit a stylesheet, but React
            // still sets inline style attributes for measured values.
            `script-src 'self'${isDevelopment ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
            `style-src 'self' 'unsafe-inline'`,
            `font-src 'self' data:`,
            `img-src 'self' data: blob: ${SERVICE_ORIGIN}`,
            `connect-src ${connect}`,
            `form-action 'none'`,
            `base-uri 'none'`,
            `frame-ancestors 'none'`,
            `object-src 'none'`,
          ].join('; '),
        ],
      },
    });
  });

  /**
   * Deny every device permission outright. LocalChat needs no camera, no microphone, no
   * geolocation and no notifications; a blanket deny means a future dependency cannot
   * quietly start asking for one.
   */
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);

  // Refuse to load any code that did not come from the bundle or the local service.
  partition.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const allowed =
      details.url.startsWith(SERVICE_ORIGIN) ||
      details.url.startsWith('app://') ||
      details.url.startsWith('devtools://') ||
      (isDevelopment && details.url.startsWith(DEV_SERVER_ORIGIN));
    callback({ cancel: !allowed });
  });
}

/**
 * Navigation and window-opening guards, applied per window.
 *
 * A link in an answer is text the model produced. If it ever becomes clickable, it opens in
 * the user's browser — never inside the app, where it would inherit the renderer's context.
 */
export function guardWindow(window: BrowserWindow, isDevelopment: boolean): void {
  const contents = window.webContents;

  contents.on('will-navigate', (event, url) => {
    const isInternal =
      url.startsWith('app://') || (isDevelopment && url.startsWith(DEV_SERVER_ORIGIN));
    if (!isInternal) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // A renderer process that dies should not leave a blank window with no explanation.
  contents.on('render-process-gone', (_event, details) => {
    console.error('[localchat] renderer process gone:', details.reason);
    if (!window.isDestroyed()) window.reload();
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** Single-instance lock: two copies would fight over the index and the model file. */
export function enforceSingleInstance(onSecondInstance: () => void): boolean {
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    app.quit();
    return false;
  }
  app.on('second-instance', onSecondInstance);
  return true;
}
