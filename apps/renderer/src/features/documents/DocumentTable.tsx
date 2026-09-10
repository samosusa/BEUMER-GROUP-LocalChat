import { useState } from 'react';
import type { Document, IngestionStatus } from '@localchat/contracts';
import { IconButton } from '@/shared/ui/Button';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Mono, ProgressBar, StatusDot, type Tone } from '@/shared/ui/Indicators';
import { formatBytes, formatCount } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import styles from './DocumentTable.module.css';

const STATUS_TONE: Record<IngestionStatus, Tone> = {
  pending: 'muted',
  indexing: 'accent',
  indexed: 'success',
  superseded: 'warning',
  no_text_layer: 'warning',
  unsupported: 'warning',
  failed: 'warning',
};

const STATUS_LABEL: Record<IngestionStatus, string> = {
  pending: 'queued',
  indexing: 'indexing',
  indexed: 'indexed',
  superseded: 'newer version',
  no_text_layer: 'no text layer',
  unsupported: 'unsupported',
  failed: 'failed',
};

const FORMAT_ICON: Record<Document['format'], IconName> = {
  pdf: 'document',
  docx: 'document',
  markdown: 'document',
  text: 'document',
  image: 'image',
};

interface DocumentTableProps {
  documents: Document[];
  emptyLabel: string;
  onDelete: (document: Document) => void;
}

/**
 * A document corpus, with the one action that cannot be undone gated behind an inline
 * confirmation — the vectors are dropped and the original file was never kept, so the choice
 * has to be made before, not after.
 */
export function DocumentTable({ documents, emptyLabel, onDelete }: DocumentTableProps) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (documents.length === 0) {
    return <p className={styles.placeholder}>{emptyLabel}</p>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Document</th>
          <th scope="col" className={styles.colStatus}>
            Status
          </th>
          <th scope="col" className={styles.colActions}>
            <span className={styles.srOnly}>Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) =>
          confirming === document.id ? (
            <tr key={document.id} className={styles.confirmRow}>
              <td colSpan={3}>
                <span className={styles.confirmText}>
                  Remove <strong>{document.filename}</strong> from the index? This cannot be undone
                  — the file would have to be added again.
                </span>
                <span className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.confirmCancel}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.confirmDelete}
                    onClick={() => {
                      setConfirming(null);
                      onDelete(document);
                    }}
                  >
                    Remove
                  </button>
                </span>
              </td>
            </tr>
          ) : (
            <tr key={document.id} className={cn(document.stale && styles.rowStale)}>
              <td>
                <span className={styles.docCell}>
                  <Icon
                    name={FORMAT_ICON[document.format]}
                    size={15}
                    className={cn(styles.docIcon, styles[`format_${document.format}`])}
                  />
                  <span className={styles.docText}>
                    <span className={styles.docName}>{document.filename}</span>
                    <Mono className={styles.docMeta}>{describeDocument(document)}</Mono>
                  </span>
                </span>
              </td>
              <td className={styles.colStatus}>
                {document.status === 'indexing' && document.progress !== null ? (
                  <span className={styles.statusProgress}>
                    <span className={styles.statusProgressLabel}>
                      {document.format === 'image' ? 'reading images' : 'indexing'}
                    </span>
                    <ProgressBar value={document.progress} thickness={2} label="Indexing" />
                  </span>
                ) : (
                  <StatusDot
                    tone={document.stale ? 'warning' : STATUS_TONE[document.status]}
                    label={document.stale ? 'changed on disk' : STATUS_LABEL[document.status]}
                  />
                )}
              </td>
              <td className={styles.colActions}>
                {!(document.status === 'indexing' && document.progress !== null) && (
                  <IconButton
                    icon="trash"
                    label={`Remove ${document.filename} from the index`}
                    size={14}
                    onClick={() => setConfirming(document.id)}
                  />
                )}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

/**
 * A backend that does not report chunk counts or file sizes sends zeroes. Printing
 * "0 chunks · 0 B" beside a document that just answered a question reads as a fault in the
 * index rather than a gap in what the service tells us, so those are dropped.
 */
function describeDocument(document: Document): string {
  if (document.status === 'no_text_layer') return 'no text layer — cannot be cited';
  if (document.status === 'indexing') return 'indexing…';
  if (document.format === 'image') return '1 figure · described on retrieval';

  const parts: string[] = [];
  if (document.chunkCount > 0) parts.push(`${formatCount(document.chunkCount)} chunks`);
  if (document.revision) parts.push(document.revision);
  if (document.sizeBytes > 0) parts.push(formatBytes(document.sizeBytes));
  if (parts.length === 0) parts.push(document.indexedAt ? 'indexed' : 'not indexed yet');
  return parts.join(' · ');
}
