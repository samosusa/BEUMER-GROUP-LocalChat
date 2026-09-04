import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, normalize } from 'node:path';
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
  readDocument: 'documents:read',
  listFolderDocuments: 'dialog:list-folder-documents',
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

/**
 * Paths this session's own file dialogs returned.
 *
 * The RAG service ingests by multipart upload, so the renderer needs the file's bytes, not
 * its path. A general "read any file" channel would hand the renderer — which runs model
 * output — the ability to read the user's disk and post it anywhere it can reach. Instead
 * only files the engineer explicitly chose through our dialog are readable, and the set is
 * built by the dialog handler rather than supplied by the caller.
 */
const pickedDocuments = new Set<string>();

/**
 * Folders this session's own folder dialog returned. Same reasoning as `pickedDocuments`:
 * enumerating an arbitrary path the renderer hands over would let model output that ever
 * became reachable here walk the whole disk, so only a folder the engineer explicitly chose
 * through our dialog may be listed.
 */
const pickedFolders = new Set<string>();

/** A generous ceiling on one document; the pipeline is not the place to discover OOM. */
const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;

/** Stops a folder pick from turning into "index my entire drive" by accident. */
const MAX_FOLDER_DOCUMENTS = 500;
const MAX_FOLDER_DEPTH = 8;

/**
 * Recursively collects documents under `dir`, in whatever format the ingestion pipeline
 * already accepts. An unreadable subdirectory (permissions, a race with something deleting
 * it) is skipped rather than failing the whole pick — one bad folder should not block every
 * other file the engineer selected.
 */
async function walkForDocuments(dir: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH || found.length >= MAX_FOLDER_DOCUMENTS) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (found.length >= MAX_FOLDER_DOCUMENTS) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForDocuments(full, depth + 1, found);
    } else if (entry.isFile() && isAllowedDocument(full)) {
      found.push(normalize(full));
    }
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.pickDocuments, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return [];

    const result = await dialog.showOpenDialog(window, {
      title: 'Add documents to LocalChat',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: DOCUMENT_FILTERS,
    });

    if (result.canceled) return [];
    const paths = result.filePaths.filter(isAllowedDocument).map((path) => normalize(path));
    for (const path of paths) pickedDocuments.add(path);
    return paths;
  });

  /**
   * Reads one previously-picked document for upload. Refuses anything the dialog did not
   * produce, so the channel cannot be turned into arbitrary file read.
   */
  ipcMain.handle(CHANNELS.readDocument, async (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) {
      throw new Error('A document path is required.');
    }
    const path = normalize(rawPath);
    if (!pickedDocuments.has(path)) {
      throw new Error('That file was not chosen through the LocalChat file picker.');
    }

    const info = await stat(path);
    if (!info.isFile()) throw new Error('That path is not a file.');
    if (info.size > MAX_DOCUMENT_BYTES) {
      throw new Error('That file is larger than 256 MB and cannot be ingested.');
    }

    // `readFile` returns a Buffer that may be a view onto Node's shared pool, so copy the
    // exact byte range out before it crosses the bridge; sending the pool would leak
    // unrelated file contents into the renderer.
    const buffer = await readFile(path);
    const bytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    return { name: basename(path), bytes };
  });

  ipcMain.handle(CHANNELS.pickFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a documentation folder',
      properties: ['openDirectory', 'dontAddToRecent'],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    const folder = normalize(result.filePaths[0]);
    pickedFolders.add(folder);
    return folder;
  });

  /**
   * Lists the documents inside a previously-picked folder, so they can be queued for
   * ingestion the same way individually-picked files are. Refuses any folder the dialog did
   * not produce, and the paths it returns become readable through `readDocument` exactly
   * like an individual pick — there is no other way bytes leave the disk.
   */
  ipcMain.handle(CHANNELS.listFolderDocuments, async (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) {
      throw new Error('A folder path is required.');
    }
    const folder = normalize(rawPath);
    if (!pickedFolders.has(folder)) {
      throw new Error('That folder was not chosen through the LocalChat folder picker.');
    }

    const found: string[] = [];
    await walkForDocuments(folder, 0, found);
    for (const path of found) pickedDocuments.add(path);
    return found;
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
