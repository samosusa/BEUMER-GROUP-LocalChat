import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Document, IngestionStatus } from '@localchat/contracts';
import {
  useIngestDocuments,
  useProject,
  useProjectDocuments,
  useProjectTools,
  useReindex,
} from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono, ProgressBar, SectionLabel, StatusDot, type Tone } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { formatBytes, formatCount, formatRelative } from '@/shared/lib/format';
import { chooseDocuments } from '@/shared/lib/localFiles';
import { cn } from '@/shared/lib/cn';
import styles from './ProjectDetail.module.css';

type Tab = 'documents' | 'chats' | 'instructions' | 'index';

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

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const tools = useProjectTools(projectId);
  const reindex = useReindex();
  const ingest = useIngestDocuments();
  const [tab, setTab] = useState<Tab>('documents');

  // While anything is mid-ingestion the table polls, so progress moves without a refresh.
  const documents = useProjectDocuments(projectId, { refetchInterval: 1_500 });
  const rows = documents.data?.documents ?? [];
  const stats = documents.data?.stats;
  const busy = rows.some((document) => document.status === 'indexing');

  async function addDocuments() {
    const chosen = await chooseDocuments();
    if (chosen.paths.length === 0 && chosen.files.length === 0) return;
    await ingest.mutateAsync({
      projectId: projectId ?? null,
      paths: chosen.paths,
      files: chosen.files,
    });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/projects">Projects</Link>
            <Icon name="chevronRight" size={12} />
            <span>{project.data?.name ?? '…'}</span>
          </>
        }
        title={project.data?.name ?? 'Loading…'}
        description={
          project.data?.folderPath ? (
            <span className={styles.folderLine}>
              <Icon name="folder" size={13} />
              <Mono>{project.data.folderPath}</Mono>
              <span aria-hidden="true">·</span>
              <Mono className={styles.watched}>
                {project.data.watched ? 'watched for changes' : 'not watched'}
              </Mono>
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              icon="refresh"
              loading={reindex.isPending || busy}
              onClick={() => reindex.mutate({ projectId: projectId ?? null, full: false })}
            >
              Re-index now
            </Button>
            <Button variant="accent" icon="plus" loading={ingest.isPending} onClick={addDocuments}>
              Add documents
            </Button>
          </>
        }
      />

      <nav className={styles.tabs} role="tablist" aria-label="Project sections">
        <Tab id="documents" active={tab} onSelect={setTab} count={rows.length}>
          Documents
        </Tab>
        <Tab id="chats" active={tab} onSelect={setTab} count={project.data?.chatCount}>
          Chats
        </Tab>
        <Tab id="instructions" active={tab} onSelect={setTab}>
          Project instructions
        </Tab>
        <Tab id="index" active={tab} onSelect={setTab}>
          Index &amp; storage
        </Tab>
      </nav>

      <div className={styles.body}>
        <div className={styles.main}>
          {tab === 'documents' && <DocumentTable documents={rows} />}
          {tab === 'chats' && (
            <p className={styles.placeholder}>
              {formatCount(project.data?.chatCount ?? 0)} chats in this project. Open one from the
              sidebar.
            </p>
          )}
          {tab === 'instructions' && (
            <p className={styles.instructionsFull}>
              {project.data?.instructions || 'No project instructions set.'}
            </p>
          )}
          {tab === 'index' && stats && (
            <dl className={styles.statList}>
              <Stat label="Chunks" value={formatCount(stats.chunkCount)} />
              <Stat label="Documents" value={formatCount(stats.documentCount)} />
              <Stat label="Embedding model" value={stats.embeddingModel} />
              <Stat label="Index size" value={formatBytes(stats.indexSizeBytes)} />
              <Stat label="Last rebuild" value={formatRelative(stats.lastRebuiltAt)} />
              <Stat label="Changed on disk" value={formatCount(stats.staleDocumentCount)} />
            </dl>
          )}
        </div>

        <aside className={styles.rail}>
          <section className={styles.railCard}>
            <SectionLabel>Project instructions</SectionLabel>
            <p className={styles.instructions}>
              {project.data?.instructions || 'None set. Chats use the default behaviour.'}
            </p>
            <Mono className={styles.railFoot}>applies to every chat in this project</Mono>
          </section>

          {stats && (
            <section className={styles.railCard}>
              <SectionLabel>Index</SectionLabel>
              <dl className={styles.railStats}>
                <Stat label="Chunks" value={formatCount(stats.chunkCount)} />
                <Stat label="Embedding model" value={stats.embeddingModel} />
                <Stat label="Index size" value={formatBytes(stats.indexSizeBytes)} />
                <Stat label="Last rebuild" value={formatRelative(stats.lastRebuiltAt)} />
              </dl>
            </section>
          )}

          <section className={styles.railCard}>
            <SectionLabel>Approved tools</SectionLabel>
            {tools.data?.map((tool) => (
              <div className={styles.toolRow} key={tool.id}>
                <StatusDot tone={tool.enabled ? 'success' : 'muted'} label="" />
                <Mono className={cn(styles.toolName, !tool.enabled && styles.toolOff)}>
                  {tool.server}
                </Mono>
                <span className={styles.toolMode}>
                  {tool.enabled ? (tool.readOnly ? 'read only' : 'read/write') : 'off'}
                </span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Tab({
  id,
  active,
  count,
  onSelect,
  children,
}: {
  id: Tab;
  active: Tab;
  count?: number;
  onSelect: (tab: Tab) => void;
  children: React.ReactNode;
}) {
  const selected = id === active;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(styles.tab, selected && styles.tabActive)}
      onClick={() => onSelect(id)}
    >
      {children}
      {count !== undefined && <Mono className={styles.tabCount}>{formatCount(count)}</Mono>}
    </button>
  );
}

function DocumentTable({ documents }: { documents: Document[] }) {
  if (documents.length === 0) {
    return <p className={styles.placeholder}>No documents yet. Add a folder or drop files in.</p>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Document</th>
          <th scope="col" className={styles.colRevision}>
            Revision
          </th>
          <th scope="col" className={styles.colChunks}>
            Chunks
          </th>
          <th scope="col" className={styles.colStatus}>
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.id} className={cn(document.stale && styles.rowStale)}>
            <td>
              <span className={styles.docCell}>
                <Icon
                  name={document.format === 'image' ? 'image' : 'document'}
                  size={15}
                  className={cn(styles.docIcon, styles[`format_${document.format}`])}
                />
                <span className={styles.docName}>{document.filename}</span>
              </span>
            </td>
            <td className={styles.colRevision}>
              <Mono>
                {document.revision ?? '—'}
                {document.supersedes && (
                  <span className={styles.superseded}> {document.supersedes}</span>
                )}
              </Mono>
            </td>
            <td className={styles.colChunks}>
              <Mono>{formatCount(document.chunkCount)}</Mono>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        <Mono>{value}</Mono>
      </dd>
    </div>
  );
}
