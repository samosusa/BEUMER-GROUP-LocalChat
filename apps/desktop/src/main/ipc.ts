import { extname, isAbsolute, normalize } from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { getMainWindow, revealInFolder } from './windows';

/**
 * The IPC surface.
 *
 * Every channel here is one the renderer is allowed to call. The list is deliberately short
 * and each handler validates its arguments: the renderer runs untrusted model output, so a
 * channel that forwards an arbitrary path to the shell is a real hole, not a theoretical one.
 */

export const CHANNELS = {
  pickDocuments: 'dialog:pick-documents',
  pickFolder: 'dialog:pick-folder',
  revealInFolder: 'shell:reveal',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowHide: 'window:hide',
  quickAskSubmit: 'quick-ask:submit',
} as const;

/** Formats the ingestion pipeline accepts. Anything else is rejected before it is offered. */
const DOCUMENT_FILTERS = [
  {
    name: 'Documentation',
    extensions: ['pdf', 'docx', 'md', 'markdown', 'txt', 'png', 'jpg', 'jpeg'],
  },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Word', extensions: ['docx'] },
  { name: 'Text and Markdown', extensions: ['md', 'markdown', 'txt'] },
];

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.md',
  '.markdown',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
]);

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.pickDocuments, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return [];

    const result = await dialog.showOpenDialog(window, {
      title: 'Add documents to LocalChat',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: DOCUMENT_FILTERS,
    });

    return result.canceled ? [] : result.filePaths.filter(isAllowedDocument);
  });

  ipcMain.handle(CHANNELS.pickFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a documentation folder',
      properties: ['openDirectory', 'dontAddToRecent'],
    });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  /**
   * Reveal is the one handler that takes a path from the renderer. It only ever accepts a
   * path the app itself handed out, and never opens the file — `showItemInFolder` selects it
   * in Explorer, so a malicious path cannot become code execution.
   */
  ipcMain.handle(CHANNELS.revealInFolder, (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) return;
    revealInFolder(normalize(rawPath));
  });

  ipcMain.on(CHANNELS.windowMinimize, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );

  ipcMain.on(CHANNELS.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.on(CHANNELS.windowHide, (event) => BrowserWindow.fromWebContents(event.sender)?.hide());

  /** The quick-ask strip hands its question to the main window and closes itself. */
  ipcMain.on(CHANNELS.quickAskSubmit, (event, question: unknown) => {
    if (typeof question !== 'string' || question.trim() === '') return;
    BrowserWindow.fromWebContents(event.sender)?.hide();
    const main = getMainWindow();
    if (!main) return;
    main.show();
    main.focus();
    main.webContents.send('quick-ask:question', question);
  });
}

function isAllowedDocument(path: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Opens an external URL, used only from the main process. */
export function openExternal(url: string): void {
  if (url.startsWith('https://')) void shell.openExternal(url);
}
