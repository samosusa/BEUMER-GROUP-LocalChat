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

export interface ChosenDocuments {
  /** Absolute paths, from the desktop file picker. Empty in a browser. */
  paths: string[];
  /** The files themselves, from a browser picker or a drop. Empty in the desktop shell. */
  files: File[];
}

export const EMPTY_CHOICE: ChosenDocuments = { paths: [], files: [] };

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

    // A cancelled picker fires no event in most browsers, so the promise would otherwise
    // never settle and the mutation would sit pending forever. `oncancel` covers modern
    // browsers; the focus fallback covers the rest.
    const settle = (files: File[]) => {
      window.removeEventListener('focus', onFocus);
      resolve(files);
    };
    const onFocus = () => setTimeout(() => settle(Array.from(input.files ?? [])), 400);

    input.addEventListener('change', () => settle(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => settle([]), { once: true });
    window.addEventListener('focus', onFocus, { once: true });

    input.click();
  });
}

/** Asks the host for documents, whichever host this is. */
export async function chooseDocuments(): Promise<ChosenDocuments> {
  const bridge = globalThis.window?.localchat;
  if (bridge?.pickDocuments) {
    return { paths: await bridge.pickDocuments(), files: [] };
  }
  return { paths: [], files: await pickInBrowser() };
}

/**
 * Splits a drop into whichever of the two the host provided.
 *
 * `File.path` is an Electron addition. Reading it in a browser yields undefined, which is
 * why the original drop handler filtered everything away and appeared to do nothing.
 */
export function documentsFromDrop(transfer: DataTransfer): ChosenDocuments {
  const dropped = Array.from(transfer.files);
  const paths = dropped
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);

  return paths.length === dropped.length ? { paths, files: [] } : { paths: [], files: dropped };
}
