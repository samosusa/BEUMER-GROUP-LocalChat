import { useCallback, useRef, useState, type DragEvent } from 'react';

/**
 * Whole-window drag and drop for documents.
 *
 * Drag events fire for every child element, so a naive `dragleave` handler flickers the
 * overlay as the pointer crosses internal boundaries. Counting enter/leave pairs is the fix.
 *
 * In the packaged app `File.path` gives the absolute path the service needs. In a browser
 * that property does not exist, so the drop degrades to the file picker rather than
 * pretending to have ingested something.
 */
export function useDocumentDrop(onFiles: (paths: string[]) => void | Promise<void>) {
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

      const paths = Array.from(event.dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0);

      if (paths.length > 0) void onFiles(paths);
    },
    [onFiles],
  );

  return { active, onDragOver, onDragLeave, onDrop };
}
