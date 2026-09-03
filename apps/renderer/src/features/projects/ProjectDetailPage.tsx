import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Document, IngestionStatus } from '@localchat/contracts';
import { useChats, useIngestDocuments, useProject, useProjectDocuments } from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono, ProgressBar, StatusDot, type Tone } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { formatCount, formatRelative } from '@/shared/lib/format';
import { chooseDocuments } from '@/shared/lib/localFiles';
import { cn } from '@/shared/lib/cn';
import styles from './ProjectDetail.module.css';

type Tab = 'documents' | 'chats';

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
  const ingest = useIngestDocuments();
  const [tab, setTab] = useState<Tab>('documents');

  // While anything is mid-ingestion the table polls, so progress moves without a refresh.
  const documents = useProjectDocuments(projectId, { refetchInterval: 1_500 });
  const rows = documents.data?.documents ?? [];

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
          <Button variant="accent" icon="plus" loading={ingest.isPending} onClick={addDocuments}>
            Add documents
          </Button>
        }
      />

      <nav className={styles.tabs} role="tablist" aria-label="Project sections">
        <Tab id="documents" active={tab} onSelect={setTab} count={rows.length}>
          Documents
        </Tab>
        <Tab id="chats" active={tab} onSelect={setTab} count={project.data?.chatCount}>
          Chats
        </Tab>
      </nav>

      <div className={styles.body}>
        <div className={styles.main}>
          {tab === 'documents' && <DocumentTable documents={rows} />}
          {tab === 'chats' && <ChatList projectId={projectId} />}
        </div>
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

/**
 * The project's chats, opened from here.
 *
 * Previously this tab said "open one from the sidebar", which asked the engineer to leave
 * the screen they were on and find the chat among every other project's. A project page
 * that lists its own chats but cannot open them is a dead end.
 */
function ChatList({ projectId }: { projectId: string | undefined }) {
  const chats = useChats({ projectId: projectId ?? null });

  if (chats.isPending) return <p className={styles.placeholder}>Loading chats…</p>;

  const rows = chats.data ?? [];
  if (rows.length === 0) {
    return <p className={styles.placeholder}>No chats in this project yet.</p>;
  }

  return (
    <ul className={styles.chatList}>
      {rows.map((chat) => (
        <li key={chat.id}>
          <Link to={`/chat/${chat.id}`} className={styles.chatRow}>
            <Icon name="chat" size={15} className={styles.chatIcon} />
            <span className={styles.chatText}>
              <span className={styles.chatTitle}>{chat.title}</span>
              {/*
                The conversation list endpoint returns no messages, so a preview and a
                message count are not knowable here without one request per row. Show the
                time instead of a zero that would read as an empty chat.
              */}
              {chat.preview && <span className={styles.chatPreview}>{chat.preview}</span>}
            </span>
            <Mono className={styles.chatMeta}>{formatRelative(chat.updatedAt)}</Mono>
          </Link>
        </li>
      ))}
    </ul>
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
