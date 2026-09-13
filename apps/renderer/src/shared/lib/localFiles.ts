/**
 * Choosing documents when there is no desktop shell.
 *
 * The app was written assuming Electron: `pickDocuments()` returns absolute paths, and a
 * dropped file carries a non-standard `File.path`. Neither exists in a browser, so both
 * affordances silently did nothing there — the "Add documents" button appeared to work and
 * produced no result, in the review container as much as in `npm run dev`.
 *
 * A browser cannot know a file's path, and should not: that is the sandbox working. What it
 * can hand over is the file itself, which is what the service's multipart upload wants
 * anyway. So the two hosts supply different things, and everything downstream accepts
 * either.
 */

/** Formats either backend will consider. Each rejects what it cannot read, with a reason. */
const ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.png,.jpg,.jpeg';
const ACCEPTED_EXTENSIONS = new Set(ACCEPT.split(','));

/** Mirrors the desktop folder walk's caps (see `main/ipc.ts`), so a dragged-in root
 * directory can't hang the browser tab the same way it can't hang the main process. */
const MAX_DROPPED_DOCUMENTS = 500;
const MAX_DROP_DEPTH = 8;

function isAcceptedFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && ACCEPTED_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export interface ChosenDocuments {
  /** Absolute paths, from the desktop file picker. Empty in a browser. */
  paths: string[];
  /** The files themselves, from a browser picker or a drop. Empty in the desktop shell. */
  files: File[];
  /**
   * Names of anything found alongside `paths`/`files` — directly, or inside a chosen/dropped
   * folder — that isn't a format the pipeline reads. Never populated for an individual file
   * pick, since the OS dialog's own filter already keeps those out; only a folder walk or a
   * drop can turn up something unsupported without the engineer having chosen it by name.
   */
  skipped: string[];
}

export const EMPTY_CHOICE: ChosenDocuments = { paths: [], files: [], skipped: [] };

export function hasDesktopBridge(): boolean {
  return typeof globalThis.window?.localchat?.pickDocuments === 'function';
}

/**
 * Opens the browser's own file picker.
 *
 * The input is never attached to the document: appending it would let page CSS reach it and
 * risk it becoming visible for a frame. `showPicker()` is not used because it throws
 * without a user gesture in some browsers, and this is always called from a click anyway.
 */
function pickInBrowser(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ACCEPT;

    // `cancel` (Chrome 113+, Firefox 116+, Safari 17+ — all well below this app's minimum
    // supported versions) is what a cancelled picker fires, so both outcomes settle cleanly.
    // An earlier version of this also raced a `window.addEventListener('focus', …)` fallback
    // against these, on the theory that a cancelled picker fires no event at all in some
    // browsers — but window focus returns the instant the native picker closes, which for a
    // multi-file *or* directory pick can be well before the browser's own follow-up "upload
    // these N files?" confirmation is answered (Firefox shows one for exactly this). That
    // fallback settled with whatever `input.files` held at that early moment — empty — and
    // the real `change` that fired later, once the engineer actually confirmed, was ignored:
    // a promise only resolves once. Removing it trades support for browsers with neither
    // event for closing that silent-failure hole in current ones.
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });

    input.click();
  });
}

/** Asks the host for documents, whichever host this is. */
export async function chooseDocuments(): Promise<ChosenDocuments> {
  const bridge = globalThis.window?.localchat;
  if (bridge?.pickDocuments) {
    return { paths: await bridge.pickDocuments(), files: [], skipped: [] };
  }
  return { paths: [], files: await pickInBrowser(), skipped: [] };
}

/**
 * Opens the folder picker and returns every document found inside it (recursively), ready
 * to hand to the same ingestion path as an individual pick.
 *
 * Desktop-only: a browser has no way to enumerate a folder's contents, so there `folderPath`
 * is always null and `documents` always empty — same degrade-gracefully rule as everywhere
 * else a host cannot supply something.
 */
export async function chooseFolderDocuments(): Promise<{
  folderPath: string | null;
  documents: ChosenDocuments;
}> {
  const bridge = globalThis.window?.localchat;
  if (bridge?.pickFolder && bridge.listFolderDocuments) {
    const folderPath = await bridge.pickFolder();
    if (folderPath === null) return { folderPath, documents: EMPTY_CHOICE };
    const { paths, skipped } = await bridge.listFolderDocuments(folderPath);
    return { folderPath, documents: { paths, files: [], skipped } };
  }

  const { files, skipped } = await pickFolderInBrowser();
  return { folderPath: null, documents: { paths: [], files, skipped } };
}

/**
 * Opens the browser directory picker and splits what it returns into accepted files and the
 * names of anything the ingestion pipeline can't read, so the caller can ask before dropping
 * the latter silently.
 */
function pickFolderInBrowser(): Promise<{ files: File[]; skipped: string[] }> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.accept = ACCEPT;

    // See `pickInBrowser` for why this settles only from `change`/`cancel` and not also a
    // window-focus fallback: a directory pick is exactly the case that fallback got wrong.
    // Firefox interposes its own "upload N files from this folder?" confirmation between the
    // native OS folder dialog closing (which already returns focus to the window) and
    // `change` actually firing — so the fallback settled on an empty `input.files` before the
    // engineer had even answered that prompt, and the real `change` that followed their
    // answer was silently dropped, making "Add folder" appear to do nothing at all.
    const settle = (files: File[]) => {
      const accepted: File[] = [];
      const skipped: string[] = [];
      for (const file of files) {
        if (isAcceptedFile(file.name)) accepted.push(file);
        else skipped.push(file.name);
      }
      resolve({ files: accepted, skipped });
    };

    input.addEventListener('change', () => settle(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => settle([]), { once: true });

    input.click();
  });
}

/** One `readEntries()` call only returns a batch; it must be called until it comes back empty. */
function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readDirectoryBatch(reader);
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Walks one dropped entry, recursing into folders. `webkitGetAsEntry()` is what exposes a
 * drop's folder structure at all in a browser — without it, a dropped directory is just an
 * opaque zero-byte `File`.
 */
async function collectFromEntry(
  entry: FileSystemEntry,
  depth: number,
  found: File[],
  skipped: string[],
): Promise<void> {
  if (found.length >= MAX_DROPPED_DOCUMENTS || depth > MAX_DROP_DEPTH) return;

  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    if (isAcceptedFile(file.name)) found.push(file);
    else skipped.push(file.name);
    return;
  }
  if (!entry.isDirectory) return;

  const children = await readAllDirectoryEntries(
    (entry as FileSystemDirectoryEntry).createReader(),
  );
  for (const child of children) {
    if (found.length >= MAX_DROPPED_DOCUMENTS) return;
    await collectFromEntry(child, depth + 1, found, skipped);
  }
}

/**
 * Expands a browser drop into the files it contains, including anything inside a dropped
 * folder. Falls back to the flat file list the transfer already carries when the entries API
 * isn't available (very old browsers) — the same, folder-blind behavior as before. `skipped`
 * names anything found, at any depth, that isn't a format the pipeline reads.
 */
async function filesFromBrowserDrop(
  transfer: DataTransfer,
): Promise<{ files: File[]; skipped: string[] }> {
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (entries.length === 0) return { files: Array.from(transfer.files), skipped: [] };

  const found: File[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (found.length >= MAX_DROPPED_DOCUMENTS) break;
    await collectFromEntry(entry, 0, found, skipped);
  }
  return { files: found, skipped };
}

/**
 * Splits a drop into whichever of the two the host provided, expanding any dropped folders
 * along the way.
 *
 * `File.path` is an Electron addition, and only ever appears on a `File` a genuine OS drag
 * produced — page script cannot fabricate it — so a path arriving this way is as trustworthy
 * as one the file/folder dialogs returned. Reading it in a browser yields undefined, which is
 * why the original drop handler filtered everything away and appeared to do nothing.
 */
export async function documentsFromDrop(transfer: DataTransfer): Promise<ChosenDocuments> {
  const dropped = Array.from(transfer.files);
  const rawPaths = dropped
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);

  if (dropped.length > 0 && rawPaths.length === dropped.length) {
    // Electron: hand the raw paths to the main process, which validates each one, expands
    // any that are folders, and returns only what it will actually let `readDocument` read.
    const bridge = globalThis.window?.localchat;
    if (!bridge?.resolveDroppedPaths) return { paths: rawPaths, files: [], skipped: [] };
    const { paths, skipped } = await bridge.resolveDroppedPaths(rawPaths);
    return { paths, files: [], skipped };
  }

  const { files, skipped } = await filesFromBrowserDrop(transfer);
  return { paths: [], files, skipped };
}
