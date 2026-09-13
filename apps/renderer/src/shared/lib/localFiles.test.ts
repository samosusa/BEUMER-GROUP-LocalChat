import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseFolderDocuments, documentsFromDrop } from './localFiles';

/**
 * `DataTransfer` is not implemented in jsdom, and only `.files`/`.items` are read here.
 */
const drop = (files: File[], items?: DataTransferItem[]) =>
  ({ files, items }) as unknown as DataTransfer;

const withPath = (name: string, path: string) =>
  Object.assign(new File(['x'], name), { path }) as File;

/** A `DataTransferItem` whose `webkitGetAsEntry()` returns a fixed `FileSystemEntry`. */
const itemFor = (entry: FileSystemEntry) =>
  ({ webkitGetAsEntry: () => entry }) as unknown as DataTransferItem;

const fileEntry = (file: File): FileSystemFileEntry =>
  ({
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) => resolve(file),
  }) as unknown as FileSystemFileEntry;

/** A directory entry whose reader yields `children` once, then an empty batch (per spec). */
const directoryEntry = (children: FileSystemEntry[]): FileSystemDirectoryEntry => {
  let read = false;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
        const batch = read ? [] : children;
        read = true;
        resolve(batch);
      },
    }),
  } as unknown as FileSystemDirectoryEntry;
};

afterEach(() => {
  delete (globalThis.window as unknown as { localchat?: unknown }).localchat;
});

describe('documentsFromDrop', () => {
  it('takes the absolute paths when the desktop shell supplies them', async () => {
    const chosen = await documentsFromDrop(
      drop([withPath('a.pdf', '/docs/a.pdf'), withPath('b.pdf', '/docs/b.pdf')]),
    );
    expect(chosen.paths).toEqual(['/docs/a.pdf', '/docs/b.pdf']);
    expect(chosen.files).toEqual([]);
  });

  it('resolves dropped paths through the bridge when one is present, so folders expand', async () => {
    (globalThis.window as unknown as { localchat?: unknown }).localchat = {
      resolveDroppedPaths: async (paths: string[]) => ({
        paths: [...paths, '/docs/expanded-from-folder.pdf'],
        skipped: [],
      }),
    };
    const chosen = await documentsFromDrop(drop([withPath('a.pdf', '/docs/a.pdf')]));
    expect(chosen.paths).toEqual(['/docs/a.pdf', '/docs/expanded-from-folder.pdf']);
    expect(chosen.files).toEqual([]);
    expect(chosen.skipped).toEqual([]);
  });

  it('surfaces names the bridge reports as unprocessable when a dropped folder had some', async () => {
    (globalThis.window as unknown as { localchat?: unknown }).localchat = {
      resolveDroppedPaths: async (paths: string[]) => ({
        paths,
        skipped: ['notes.zip'],
      }),
    };
    const chosen = await documentsFromDrop(drop([withPath('a.pdf', '/docs/a.pdf')]));
    expect(chosen.skipped).toEqual(['notes.zip']);
  });

  it('hands over the files themselves in a browser, where File.path does not exist', async () => {
    // This is the case that used to filter down to an empty list, so the drop silently
    // did nothing at all outside Electron.
    const chosen = await documentsFromDrop(drop([new File(['x'], 'a.pdf')]));
    expect(chosen.paths).toEqual([]);
    expect(chosen.files.map((file) => file.name)).toEqual(['a.pdf']);
  });

  it('falls back to files when only some carry a path, rather than dropping the rest', async () => {
    const chosen = await documentsFromDrop(
      drop([withPath('a.pdf', '/docs/a.pdf'), new File(['x'], 'b.pdf')]),
    );
    expect(chosen.paths).toEqual([]);
    expect(chosen.files).toHaveLength(2);
  });

  it('returns nothing for an empty drop', async () => {
    expect(await documentsFromDrop(drop([]))).toEqual({ paths: [], files: [], skipped: [] });
  });

  it('expands a dropped folder in the browser via the FileSystem Entries API', async () => {
    const nested = new File(['x'], 'nested.pdf');
    const top = new File(['x'], 'top.pdf');
    const skipped = new File(['x'], 'ignored.zip');
    const entries = [directoryEntry([fileEntry(nested), fileEntry(skipped)]), fileEntry(top)];
    const chosen = await documentsFromDrop(
      drop(
        [],
        entries.map((entry) => itemFor(entry)),
      ),
    );
    expect(chosen.paths).toEqual([]);
    expect(chosen.files.map((file) => file.name).sort()).toEqual(['nested.pdf', 'top.pdf']);
    expect(chosen.skipped).toEqual(['ignored.zip']);
  });
});

describe('chooseFolderDocuments', () => {
  it('uses the desktop folder bridge when available', async () => {
    (globalThis.window as unknown as { localchat?: unknown }).localchat = {
      pickFolder: async () => '/docs/manuals',
      listFolderDocuments: async (path: string) => ({ paths: [`${path}/guide.pdf`], skipped: [] }),
    };

    const { folderPath, documents } = await chooseFolderDocuments();

    expect(folderPath).toBe('/docs/manuals');
    expect(documents).toEqual({ paths: ['/docs/manuals/guide.pdf'], files: [], skipped: [] });
  });

  it('reports names the bridge lists as unprocessable inside the folder', async () => {
    (globalThis.window as unknown as { localchat?: unknown }).localchat = {
      pickFolder: async () => '/docs/manuals',
      listFolderDocuments: async () => ({ paths: [], skipped: ['archive.zip'] }),
    };

    const { documents } = await chooseFolderDocuments();
    expect(documents.skipped).toEqual(['archive.zip']);
  });

  it('uses the browser directory picker and filters unsupported files', async () => {
    const input = document.createElement('input');
    vi.spyOn(document, 'createElement').mockReturnValue(input);
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const promise = chooseFolderDocuments();
    const files = [new File(['x'], 'guide.pdf'), new File(['x'], 'archive.zip')];
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change'));

    const result = await promise;
    expect(result.folderPath).toBeNull();
    expect(result.documents.files.map((file) => file.name)).toEqual(['guide.pdf']);
    expect(result.documents.skipped).toEqual(['archive.zip']);
    vi.restoreAllMocks();
  });
});
