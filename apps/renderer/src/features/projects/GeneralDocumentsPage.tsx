import { useCallback, useState } from 'react';
import type { IngestDocumentsResponse } from '@localchat/contracts';
import {
  useDeleteAllGeneralDocuments,
  useDeleteDocument,
  useDocuments,
  useIngestDocuments,
} from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Callout, Mono, SectionLabel } from '@/shared/ui/Indicators';
import { DangerAction } from '@/shared/ui/DangerAction';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DropOverlay } from '@/shared/ui/DropOverlay';
import { DocumentTable } from '@/features/documents/DocumentTable';
import {
  chooseDocuments,
  chooseFolderDocuments,
  type ChosenDocuments,
} from '@/shared/lib/localFiles';
import { withUnprocessableConfirm } from '@/shared/lib/confirmUnprocessable';
import { useDocumentDrop } from '@/shared/hooks/useDocumentDrop';
import { LibraryNav } from './LibraryNav';
import styles from './Projects.module.css';

export function GeneralDocumentsPage() {
  // While anything is mid-ingestion the table polls, so progress moves without a refresh —
  // otherwise a document stays showing "queued" until something else happens to invalidate
  // this query, even after the service has actually finished indexing it.
  const generalDocuments = useDocuments(null, { refetchInterval: 1_500 });
  const ingest = useIngestDocuments();
  const deleteDocument = useDeleteDocument();
  const deleteAllGeneralDocuments = useDeleteAllGeneralDocuments();
  // In-page copy of the last batch's failures, for as long as this page stays mounted. The
  // notification stack (see notificationStore.ts) is what catches the case where the
  // engineer has already navigated away by the time ingestion finishes; this is just the
  // faster, more detailed view for whoever is still looking at the table.
  const [rejected, setRejected] = useState<IngestDocumentsResponse['rejected']>([]);

  const ingestChosen = useCallback(
    async (chosen: ChosenDocuments) => {
      if (chosen.paths.length === 0 && chosen.files.length === 0 && chosen.skipped.length === 0) {
        return;
      }
      const confirmed = await withUnprocessableConfirm(chosen);
      if (!confirmed || (confirmed.paths.length === 0 && confirmed.files.length === 0)) return;
      setRejected([]);
      // A failed request already reports itself through the notification stack (see
      // useIngestDocuments' onError); swallowed here so it doesn't also surface as an
      // unhandled rejection from this click handler.
      const result = await ingest
        .mutateAsync({ projectId: null, paths: confirmed.paths, files: confirmed.files })
        .catch(() => null);
      if (result) setRejected(result.rejected);
    },
    [ingest],
  );

  async function addFiles() {
    await ingestChosen(await chooseDocuments());
  }

  async function addFolder() {
    const { documents } = await chooseFolderDocuments();
    await ingestChosen(documents);
  }

  const drop = useDocumentDrop(ingestChosen);

  return (
    <div className={styles.page}>
      <LibraryNav />

      <div
        className={styles.content}
        onDragEnter={drop.onDragEnter}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
      >
        <PageHeader
          title="General documents"
          description="Company-wide documentation, searched by every chat not scoped to a single project."
          actions={
            <>
              <Button variant="outline" icon="folder" onClick={addFolder}>
                Add folder
              </Button>
              <Button variant="accent" icon="plus" loading={ingest.isPending} onClick={addFiles}>
                Add files
              </Button>
            </>
          }
        />

        {rejected.length > 0 && (
          <Callout
            title={
              rejected.length === 1
                ? '1 file could not be indexed'
                : `${rejected.length} files could not be indexed`
            }
          >
            <ul className={styles.rejectedList}>
              {rejected.map((item) => (
                <li key={item.path}>
                  <Mono>{item.path}</Mono> — {item.reason}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <SectionLabel
              action={
                <span className={styles.sectionActions}>
                  <Mono className={styles.cardHeaderMeta}>
                    {generalDocuments.data?.documents.length ?? 0} documents
                  </Mono>
                  <DangerAction
                    label="Delete all general documents"
                    confirmText={`Delete all ${generalDocuments.data?.documents.length ?? 0} general documents from the index? This can't be undone.`}
                    pending={deleteAllGeneralDocuments.isPending}
                    disabled={!generalDocuments.data?.documents.length}
                    onConfirm={() => deleteAllGeneralDocuments.mutate()}
                  />
                </span>
              }
            >
              General documents
            </SectionLabel>
          </header>

          <DocumentTable
            documents={generalDocuments.data?.documents ?? []}
            emptyLabel="No general documents yet. Add files or a folder to the company-wide corpus."
            onDelete={(document) => deleteDocument.mutate(document.id)}
          />
        </section>

        {drop.active && (
          <DropOverlay
            title="Drop to add to general documents"
            hint="PDF, DOCX, Markdown, TXT, PNG, JPG — files or folders"
          />
        )}
      </div>
    </div>
  );
}
