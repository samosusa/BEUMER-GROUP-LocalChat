import { join } from 'node:path';
import { Menu, Tray, app, nativeImage } from 'electron';
import { showMainWindow, toggleQuickAsk } from './windows';

/**
 * The tray icon is the app's real front door: LocalChat starts with Windows, loads the model
 * once, and spends most of its life here. The menu therefore carries the two things worth
 * doing without opening a window — asking, and re-indexing — plus an honest quit.
 */

let tray: Tray | null = null;

export interface TrayState {
  modelLoaded: boolean;
  indexing: boolean;
  offline: boolean;
  staleDocumentCount: number;
  activeProjectName: string | null;
}

const initialState: TrayState = {
  modelLoaded: false,
  indexing: false,
  offline: true,
  staleDocumentCount: 0,
  activeProjectName: null,
};

let state: TrayState = initialState;

export function createTray(hotkey: string): Tray {
  if (tray) return tray;

  tray = new Tray(iconFor(state));
  tray.setToolTip('BEUMER LocalChat');

  // Left click opens the app; the menu is on right click, as Windows users expect.
  tray.on('click', () => showMainWindow());

  rebuildMenu(hotkey);
  return tray;
}

export function updateTrayState(next: Partial<TrayState>, hotkey: string): void {
  state = { ...state, ...next };
  tray?.setImage(iconFor(state));
  tray?.setToolTip(tooltipFor(state));
  rebuildMenu(hotkey);
}

function rebuildMenu(hotkey: string): void {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: state.modelLoaded ? 'Model loaded · offline' : 'Loading model…',
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Open LocalChat', click: () => showMainWindow() },
    { label: 'Quick ask', accelerator: hotkey, click: () => toggleQuickAsk() },
    ...(state.activeProjectName
      ? [{ label: `Project: ${state.activeProjectName}`, enabled: false }]
      : []),
    { type: 'separator' },
    {
      label:
        state.staleDocumentCount > 0
          ? `Re-index changed files (${state.staleDocumentCount})`
          : 'Re-index changed files',
      click: () => showMainWindow('#/projects'),
    },
    {
      label: state.indexing ? 'Pause background indexing' : 'Background indexing idle',
      enabled: state.indexing,
      click: () => showMainWindow('#/projects'),
    },
    { type: 'separator' },
    { label: 'Settings', click: () => showMainWindow('#/settings') },
    {
      // Named for its consequence: quitting unloads the model, and the next question waits.
      label: 'Quit — unloads the model',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
}

function tooltipFor(current: TrayState): string {
  if (!current.modelLoaded) return 'BEUMER LocalChat — loading model';
  if (current.indexing) return 'BEUMER LocalChat — indexing';
  return `BEUMER LocalChat — ready${current.offline ? ' · offline' : ''}`;
}

/**
 * Three icon states, matching the design: ready, indexing (amber dot), model unloaded
 * (desaturated). Resolved from disk so the icons stay assets rather than base64 in code.
 */
function iconFor(current: TrayState): Electron.NativeImage {
  const name = !current.modelLoaded
    ? 'tray-idle'
    : current.indexing
      ? 'tray-indexing'
      : 'tray-ready';
  const image = nativeImage.createFromPath(join(__dirname, `../../resources/${name}.png`));
  // An empty image renders as a blank gap in the tray, which reads as a crash.
  return image.isEmpty()
    ? nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    : image;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
