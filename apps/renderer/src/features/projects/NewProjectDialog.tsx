import { useEffect, useRef, useState } from 'react';
import type { CreateProjectRequest } from '@localchat/contracts';
import { Button, IconButton } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import { formatCount } from '@/shared/lib/format';
import {
  chooseDocuments,
  chooseFolderDocuments,
  hasDesktopBridge,
  type ChosenDocuments,
} from '@/shared/lib/localFiles';
import styles from './NewProjectDialog.module.css';

const EMPTY_DOCUMENTS: ChosenDocuments = { paths: [], files: [] };

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
  /** `documents` is what to ingest into the project right after it's created. */
  onCreate: (values: CreateProjectRequest, documents: ChosenDocuments) => void | Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [documents, setDocuments] = useState<ChosenDocuments>(EMPTY_DOCUMENTS);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function addFolder() {
    const picked = await chooseFolderDocuments();
    if (picked.folderPath) setFolderPath(picked.folderPath);
    setDocuments((prev) => mergeDocuments(prev, picked.documents));
  }

  async function addFiles() {
    const chosen = await chooseDocuments();
    setDocuments((prev) => mergeDocuments(prev, chosen));
  }

  function removeQueued(key: string) {
    setDocuments((prev) => ({
      paths: prev.paths.filter((path) => pathKey(path) !== key),
      files: prev.files.filter((file) => fileKey(file) !== key),
    }));
  }

  const queued = [
    ...documents.paths.map((path) => ({ key: pathKey(path), name: basename(path) })),
    ...documents.files.map((file) => ({ key: fileKey(file), name: file.name })),
  ];

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === '') return;
          void onCreate({ name: name.trim(), description, folderPath, instructions }, documents);
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
          <span className={styles.label}>Documents</span>
          <div className={styles.actionsRow}>
            {hasDesktopBridge() && (
              <Button variant="outline" size="sm" icon="folder" onClick={addFolder}>
                Add folder
              </Button>
            )}
            <Button variant="outline" size="sm" icon="plus" onClick={addFiles}>
              Add files
            </Button>
          </div>

          {folderPath && (
            <p className={styles.hint}>
              <Icon name="folder" size={12} />
              <Mono className={styles.folderPath}>{folderPath}</Mono>
            </p>
          )}

          {queued.length > 0 ? (
            <ul className={styles.queuedList}>
              {queued.map((doc) => (
                <li key={doc.key} className={styles.queuedRow}>
                  <Icon name="document" size={13} className={styles.queuedIcon} />
                  <span className={styles.queuedName}>{doc.name}</span>
                  <IconButton
                    icon="close"
                    label={`Remove ${doc.name}`}
                    size={12}
                    onClick={() => removeQueued(doc.key)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>
              Nothing queued yet — you can also add documents from the project once it exists.
            </p>
          )}

          {queued.length > 0 && (
            <p className={styles.hint}>
              <Icon name="upload" size={12} />
              {formatCount(queued.length)} {queued.length === 1 ? 'document' : 'documents'} will
              be added once the project is created.
            </p>
          )}
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

function pathKey(path: string): string {
  return `path:${path}`;
}

function fileKey(file: File): string {
  return `file:${file.name}:${file.size}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** De-dupes by path (desktop) or by name+size (browser `File`, which has no stable id). */
function mergeDocuments(prev: ChosenDocuments, next: ChosenDocuments): ChosenDocuments {
  const paths = Array.from(new Set([...prev.paths, ...next.paths]));
  const seen = new Set(prev.files.map(fileKey));
  const files = [...prev.files];
  for (const file of next.files) {
    if (!seen.has(fileKey(file))) {
      seen.add(fileKey(file));
      files.push(file);
    }
  }
  return { paths, files };
}
