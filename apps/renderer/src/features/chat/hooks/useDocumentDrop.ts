import { useCallback, useRef, useState, type DragEvent } from 'react';
import { documentsFromDrop, type ChosenDocuments } from '@/shared/lib/localFiles';

/**
 * Whole-window drag and drop for documents.
 *
 * Drag events fire for every child element, so a naive `dragleave` handler flickers the
 * overlay as the pointer crosses internal boundaries. Counting enter/leave pairs is the fix.
 *
 * In the packaged app `File.path` gives the absolute path the desktop shell reads. A browser
 * has no such property — and should not — so there the dropped `File` objects are passed
 * along instead. Previously the browser case filtered everything out and the drop appeared
 * to do nothing at all.
 */
export function useDocumentDrop(onFiles: (chosen: ChosenDocuments) => void | Promise<void>) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    depth.current += 1;
    setActive(true);
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

      const chosen = documentsFromDrop(event.dataTransfer);
      if (chosen.paths.length > 0 || chosen.files.length > 0) void onFiles(chosen);
    },
    [onFiles],
  );

  return { active, onDragOver, onDragLeave, onDrop };
}
