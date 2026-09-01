import { describe, expect, it } from 'vitest';
import { documentsFromDrop } from './localFiles';

/**
 * `DataTransfer` is not implemented in jsdom, and only `.files` is read here.
 */
const drop = (files: File[]) => ({ files }) as unknown as DataTransfer;

const withPath = (name: string, path: string) =>
  Object.assign(new File(['x'], name), { path }) as File;

describe('documentsFromDrop', () => {
  it('takes the absolute paths when the desktop shell supplies them', () => {
    const chosen = documentsFromDrop(
      drop([withPath('a.pdf', '/docs/a.pdf'), withPath('b.pdf', '/docs/b.pdf')]),
    );
    expect(chosen.paths).toEqual(['/docs/a.pdf', '/docs/b.pdf']);
    expect(chosen.files).toEqual([]);
  });

  it('hands over the files themselves in a browser, where File.path does not exist', () => {
    // This is the case that used to filter down to an empty list, so the drop silently
    // did nothing at all outside Electron.
    const chosen = documentsFromDrop(drop([new File(['x'], 'a.pdf')]));
    expect(chosen.paths).toEqual([]);
    expect(chosen.files.map((file) => file.name)).toEqual(['a.pdf']);
  });

  it('falls back to files when only some carry a path, rather than dropping the rest', () => {
    const chosen = documentsFromDrop(
      drop([withPath('a.pdf', '/docs/a.pdf'), new File(['x'], 'b.pdf')]),
    );
    expect(chosen.paths).toEqual([]);
    expect(chosen.files).toHaveLength(2);
  });

  it('returns nothing for an empty drop', () => {
    expect(documentsFromDrop(drop([]))).toEqual({ paths: [], files: [] });
  });
});
