import { join } from 'node:path';
import { BrowserWindow, screen, shell } from 'electron';
import { guardWindow } from './security';

/**
 * Window management.
 *
 * Two windows exist. The main window is the app. The quick-ask window is a frameless
 * always-on-top strip summoned by the global hotkey — the path most questions take, because
 * an engineer with a torque wrench in one hand will not alt-tab to a full application.
 */

const isDevelopment = !process.env.LOCALCHAT_PACKAGED;
const DEV_SERVER_URL = 'http://localhost:5173';
const APP_URL = 'app://localchat/index.html';

const PRELOAD = join(__dirname, '../preload/index.cjs');

let mainWindow: BrowserWindow | null = null;
let quickAskWindow: BrowserWindow | null = null;

const SHARED_WEB_PREFERENCES = {
  preload: PRELOAD,
  // The three settings that matter. Together they mean the renderer runs as an ordinary
  // web page with no Node access, reaching the host only through the preload bridge.
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  // Nothing in this app is a document viewer or an embedder.
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
} as const;

function load(window: BrowserWindow, hash = ''): void {
  const url = isDevelopment ? `${DEV_SERVER_URL}/${hash}` : `${APP_URL}${hash}`;
  void window.loadURL(url);
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, Math.round(width * 0.9)),
    height: Math.min(900, Math.round(height * 0.9)),
    minWidth: 1024,
    minHeight: 640,
    // Painting a white window and then the dark app is the flash everyone notices.
    backgroundColor: '#001c25',
    show: false,
    title: 'BEUMER LocalChat',
    autoHideMenuBar: true,
    webPreferences: SHARED_WEB_PREFERENCES,
  });

  guardWindow(mainWindow, isDevelopment);

  // Show only once the first frame is ready, so the window never appears empty.
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  /**
   * Closing the window hides it rather than quitting. The point of the tray app is that the
   * model stays loaded: quitting on a close button would put a 20 second model load in front
   * of the next question.
   */
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  load(mainWindow);
  return mainWindow;
}

export function createQuickAskWindow(): BrowserWindow {
  if (quickAskWindow && !quickAskWindow.isDestroyed()) return quickAskWindow;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  quickAskWindow = new BrowserWindow({
    width: 620,
    height: 108,
    x: Math.round((width - 620) / 2),
    y: Math.round(height * 0.22),
    frame: false,
    transparent: false,
    backgroundColor: '#041f28',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: SHARED_WEB_PREFERENCES,
  });

  guardWindow(quickAskWindow, isDevelopment);

  // Dismiss on focus loss: an always-on-top strip left behind is worse than no strip.
  quickAskWindow.on('blur', () => quickAskWindow?.hide());
  quickAskWindow.on('closed', () => {
    quickAskWindow = null;
  });

  load(quickAskWindow, '#/quick-ask');
  return quickAskWindow;
}

export function toggleQuickAsk(): void {
  const window = createQuickAskWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }
  window.show();
  window.focus();
}

export function showMainWindow(hash?: string): void {
  const window = createMainWindow();
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
  if (hash) load(window, hash);
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function revealInFolder(path: string): void {
  shell.showItemInFolder(path);
}

let isQuitting = false;

/** Set before `app.quit()` so the close handler stops intercepting. */
export function beginQuit(): void {
  isQuitting = true;
}
