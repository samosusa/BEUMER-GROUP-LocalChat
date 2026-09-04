import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChats, useDeleteDocument, useIngestDocuments, useProject, useProjectDocuments } from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DocumentTable } from '@/features/documents/DocumentTable';
import { formatCount, formatRelative } from '@/shared/lib/format';
import { chooseDocuments, chooseFolderDocuments, hasDesktopBridge } from '@/shared/lib/localFiles';
import { cn } from '@/shared/lib/cn';
import styles from './ProjectDetail.module.css';

type Tab = 'documents' | 'chats';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const ingest = useIngestDocuments();
  const deleteDocument = useDeleteDocument();
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

  async function addFolder() {
    const { documents: chosen } = await chooseFolderDocuments();
    if (chosen.paths.length === 0) return;
    await ingest.mutateAsync({ projectId: projectId ?? null, paths: chosen.paths, files: [] });
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
              icon="chat"
              onClick={() =>
                navigate('/chat', { state: { presetProjectId: projectId, presetScope: 'both' } })
              }
            >
              New chat
            </Button>
            {hasDesktopBridge() && (
              <Button variant="outline" icon="folder" onClick={addFolder}>
                Add folder
              </Button>
            )}
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
      </nav>

      <div className={styles.body}>
        <div className={styles.main}>
          {tab === 'documents' && (
            <DocumentTable
              documents={rows}
              emptyLabel="No documents yet. Add a folder or drop files in."
              onDelete={(document) => deleteDocument.mutate(document.id)}
            />
          )}
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
