import { useEffect, useRef, useState } from 'react';
import type { CreateProjectRequest } from '@localchat/contracts';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import styles from './NewProjectDialog.module.css';

/**
 * Native `<dialog>`, so focus trapping, Escape and the backdrop come from the platform
 * rather than from hand-rolled key handlers that are always subtly wrong.
 */
export function NewProjectDialog({
  pending,
  onCreate,
  onCancel,
}: {
  pending: boolean;
  onCreate: (values: CreateProjectRequest) => void | Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function pickFolder() {
    const picked = await window.localchat?.pickFolder();
    if (picked) setFolderPath(picked);
  }

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === '') return;
          void onCreate({ name: name.trim(), description, folderPath, instructions });
        }}
      >
        <h2 className={styles.title}>New project</h2>

        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            value={name}
            autoFocus
            required
            maxLength={120}
            placeholder="CPH T3 — LS-4000E"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Description</span>
          <textarea
            className={styles.textarea}
            value={description}
            rows={2}
            placeholder="What this project covers, in a sentence."
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Documentation folder</span>
          <div className={styles.folderRow}>
            {folderPath ? (
              <Mono className={styles.folderPath}>{folderPath}</Mono>
            ) : (
              <span className={styles.folderEmpty}>
                Not set — you can add documents individually later.
              </span>
            )}
            <Button variant="outline" size="sm" icon="folder" onClick={pickFolder}>
              Choose
            </Button>
          </div>
          <p className={styles.hint}>
            <Icon name="refresh" size={12} />
            LocalChat watches this folder and re-indexes documents when they change on disk.
          </p>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Project instructions (optional)</span>
          <textarea
            className={styles.textarea}
            value={instructions}
            rows={3}
            placeholder="Applies to every chat in this project. e.g. Always give the rev letter of the drawing you cite."
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>

        <footer className={styles.footer}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="cta" loading={pending} disabled={name.trim() === ''}>
            Create project
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
