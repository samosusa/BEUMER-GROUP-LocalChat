import { useState } from 'react';
import { Button, IconButton } from './Button';
import styles from './DangerAction.module.css';

interface DangerActionProps {
  /** Accessible name for the trigger, e.g. "Delete all chats". */
  label: string;
  /** The consequence, spelled out, e.g. "Delete all 12 chats? This can't be undone." */
  confirmText: string;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
}

/**
 * A destructive, irreversible bulk action gated behind an inline confirmation — the same
 * "ask first, in place" rule every single-item delete in this app already follows, scaled up
 * to "delete everything at once," where a stray click is that much more expensive.
 */
export function DangerAction({
  label,
  confirmText,
  onConfirm,
  pending = false,
  disabled = false,
}: DangerActionProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <IconButton
        icon="trash"
        label={label}
        size={13}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      />
    );
  }

  return (
    <span className={styles.confirm}>
      <span className={styles.confirmText}>{confirmText}</span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button
        variant="danger"
        size="sm"
        loading={pending}
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        Delete
      </Button>
    </span>
  );
}
