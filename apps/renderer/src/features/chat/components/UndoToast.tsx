import { useEffect } from 'react';
import { useUiStore } from '@/shared/store/uiStore';
import styles from './UndoToast.module.css';

/**
 * Undo for a document removed from context.
 *
 * Context is easy to destroy by accident and expensive to rebuild — the engineer has to
 * remember which four documents were pinned. Ten seconds of undo is cheap insurance.
 */
export function UndoToast({ onUndo }: { onUndo: (documentId: string) => void }) {
  const removal = useUiStore((state) => state.lastRemovedAttachment);
  const clear = useUiStore((state) => state.clearRemoval);

  useEffect(() => {
    if (!removal) return;
    const timer = window.setTimeout(clear, 10_000);
    return () => window.clearTimeout(timer);
  }, [removal, clear]);

  if (!removal) return null;

  return (
    <div className={styles.toast} role="status">
      <span className={styles.text}>
        Removed <strong>{removal.title}</strong> from context
      </span>
      <button
        type="button"
        className={styles.action}
        onClick={() => {
          onUndo(removal.documentId);
          clear();
        }}
      >
        Undo
      </button>
    </div>
  );
}
