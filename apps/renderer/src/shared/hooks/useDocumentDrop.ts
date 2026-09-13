import { useCallback, useRef, useState, type DragEvent } from 'react';
import { documentsFromDrop, type ChosenDocuments } from '@/shared/lib/localFiles';

/**
 * Drag and drop for documents (and folders of documents), for whichever container wires up
 * the three handlers this returns.
 *
 * Drag events fire for every child element, so a naive `dragleave` handler flickers the
 * overlay as the pointer crosses internal boundaries. Counting enter/leave pairs is the fix.
 *
 * In the packaged app `File.path` gives the absolute path the desktop shell reads, and a
 * dropped folder's path is expanded and validated on the main-process side. A browser has no
 * such property — and should not — so there the dropped `File` objects (folders expanded via
 * the FileSystem Entries API) are passed along instead.
 */
export function useDocumentDrop(onFiles: (chosen: ChosenDocuments) => void | Promise<void>) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    depth.current += 1;
    setActive(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setActive(false);

      // Captured synchronously, before any await: entries pulled off `dataTransfer` this way
      // stay valid, but the drag data store itself is only guaranteed live for this tick.
      const transfer = event.dataTransfer;
      void (async () => {
        const chosen = await documentsFromDrop(transfer);
        // Fires even when everything dropped was unsupported (paths/files both empty), so the
        // caller can still tell the engineer why nothing happened instead of going quiet.
        if (chosen.paths.length > 0 || chosen.files.length > 0 || chosen.skipped.length > 0) {
          void onFiles(chosen);
        }
      })();
    },
    [onFiles],
  );

  return { active, onDragEnter, onDragOver, onDragLeave, onDrop };
}
