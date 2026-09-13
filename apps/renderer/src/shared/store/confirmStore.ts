import { create } from 'zustand';

/**
 * A modal yes/no question that blocks the action that asked it — the opposite case from
 * notificationStore, which is for outcomes that already happened and need no answer. Used for
 * "this folder has files we can't process, continue with the rest?", asked right where the
 * engineer just clicked or dropped, before anything is sent anywhere.
 *
 * Deliberately a single slot rather than a queue: these are always raised synchronously from
 * one direct action (a folder pick, a drop), so there is never a real second question waiting
 * behind the first one.
 */
export interface ConfirmOptions {
  title: string;
  body?: string;
  /** Shown as a list under `body`, e.g. the names of files that will be skipped. */
  detail?: string[];
  confirmLabel?: string;
  /** Pass `null` to hide the cancel button, for a question with only one sane answer. */
  cancelLabel?: string | null;
}

interface PendingConfirm extends ConfirmOptions {
  id: string;
  resolve: (value: boolean) => void;
}

interface ConfirmState {
  pending: PendingConfirm | null;
  settle(value: boolean): void;
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  pending: null,
  settle: (value) => {
    const { pending } = get();
    if (!pending) return;
    pending.resolve(value);
    set({ pending: null });
  },
}));

/** Raises the modal and resolves once the engineer answers it (or cancel: `false`). */
export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ pending: { ...options, id: crypto.randomUUID(), resolve } });
  });
}
