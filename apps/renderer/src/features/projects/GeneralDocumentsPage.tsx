import { useState } from 'react';
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
import { DocumentTable } from '@/features/documents/DocumentTable';
import { chooseDocuments, chooseFolderDocuments, hasDesktopBridge } from '@/shared/lib/localFiles';
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

  async function addFiles() {
    const chosen = await chooseDocuments();
    if (chosen.paths.length === 0 && chosen.files.length === 0) return;
    setRejected([]);
    const result = await ingest.mutateAsync({
      projectId: null,
      paths: chosen.paths,
      files: chosen.files,
    });
    setRejected(result.rejected);
  }

  async function addFolder() {
    const { documents } = await chooseFolderDocuments();
    if (documents.paths.length === 0) return;
    setRejected([]);
    const result = await ingest.mutateAsync({ projectId: null, paths: documents.paths, files: [] });
    setRejected(result.rejected);
  }

  return (
    <div className={styles.page}>
      <LibraryNav />

      <div className={styles.content}>
        <PageHeader
          title="General documents"
          description="Company-wide documentation, searched by every chat not scoped to a single project."
          actions={
            <>
              {hasDesktopBridge() && (
                <Button variant="outline" icon="folder" onClick={addFolder}>
                  Add folder
                </Button>
              )}
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
      </div>
    </div>
  );
}
