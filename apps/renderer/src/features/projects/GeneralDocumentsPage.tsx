import {
  useDeleteAllGeneralDocuments,
  useDeleteDocument,
  useDocuments,
  useIngestDocuments,
} from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Mono, SectionLabel } from '@/shared/ui/Indicators';
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

  async function addFiles() {
    const chosen = await chooseDocuments();
    if (chosen.paths.length === 0 && chosen.files.length === 0) return;
    await ingest.mutateAsync({ projectId: null, paths: chosen.paths, files: chosen.files });
  }

  async function addFolder() {
    const { documents } = await chooseFolderDocuments();
    if (documents.paths.length === 0) return;
    await ingest.mutateAsync({ projectId: null, paths: documents.paths, files: [] });
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
