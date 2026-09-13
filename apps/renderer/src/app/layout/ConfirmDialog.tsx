import { useEffect, useRef } from 'react';
import { Button } from '@/shared/ui/Button';
import { Mono } from '@/shared/ui/Indicators';
import { useConfirmStore } from '@/shared/store/confirmStore';
import styles from './ConfirmDialog.module.css';

/**
 * The single app-wide modal for a yes/no question that has to block whatever asked it — e.g.
 * a folder drop containing files the pipeline can't read, where the engineer needs to say
 * whether to proceed with the rest before anything is ingested. Mounted once, above the
 * router, next to NotificationStack (which covers the opposite case: an outcome that has
 * already happened and needs no answer).
 */
export function ConfirmDialog() {
  const pending = useConfirmStore((state) => state.pending);
  const settle = useConfirmStore((state) => state.settle);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  if (!pending) return null;

  const { title, body, detail, confirmLabel, cancelLabel } = pending;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
      onClose={() => settle(false)}
    >
      <p className={styles.title}>{title}</p>
      {body && <p className={styles.body}>{body}</p>}
      {detail && detail.length > 0 && (
        <ul className={styles.detailList}>
          {detail.map((line) => (
            <li key={line}>
              <Mono>{line}</Mono>
            </li>
          ))}
        </ul>
      )}
      <footer className={styles.footer}>
        {cancelLabel !== null && (
          <Button variant="ghost" onClick={() => settle(false)}>
            {cancelLabel ?? 'Cancel'}
          </Button>
        )}
        <Button variant="accent" onClick={() => settle(true)}>
          {confirmLabel ?? 'Proceed'}
        </Button>
      </footer>
    </dialog>
  );
}
