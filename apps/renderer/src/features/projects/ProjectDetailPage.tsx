import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { IngestDocumentsResponse } from '@localchat/contracts';
import {
  useChats,
  useDeleteDocument,
  useIngestDocuments,
  useProject,
  useProjectDocuments,
} from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Toggle } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Callout, Mono } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DropOverlay } from '@/shared/ui/DropOverlay';
import { DocumentTable } from '@/features/documents/DocumentTable';
import { formatCount, formatRelative } from '@/shared/lib/format';
import {
  chooseDocuments,
  chooseFolderDocuments,
  type ChosenDocuments,
} from '@/shared/lib/localFiles';
import { withUnprocessableConfirm } from '@/shared/lib/confirmUnprocessable';
import { useDocumentDrop } from '@/shared/hooks/useDocumentDrop';
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
  // See GeneralDocumentsPage: the notification stack covers the case where the engineer has
  // already left this page by the time ingestion finishes; this is the in-page detail view
  // for whoever is still here.
  const [rejected, setRejected] = useState<IngestDocumentsResponse['rejected']>([]);
  // Off by default: an upload stays project-only unless the engineer explicitly asks for it
  // to also be searchable company-wide.
  const [alsoGeneral, setAlsoGeneral] = useState(false);

  // While anything is mid-ingestion the table polls, so progress moves without a refresh.
  const documents = useProjectDocuments(projectId, { refetchInterval: 1_500 });
  const rows = documents.data?.documents ?? [];

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
        .mutateAsync({
          projectId: projectId ?? null,
          paths: confirmed.paths,
          files: confirmed.files,
          alsoGeneral,
        })
        .catch(() => null);
      if (result) setRejected(result.rejected);
    },
    [ingest, projectId, alsoGeneral],
  );

  async function addDocuments() {
    await ingestChosen(await chooseDocuments());
  }

  async function addFolder() {
    const { documents } = await chooseFolderDocuments();
    await ingestChosen(documents);
  }

  const drop = useDocumentDrop(ingestChosen);

  return (
    <div
      className={styles.page}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
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
                navigate('/chat', { state: { presetProjectId: projectId, presetScope: 'project' } })
              }
            >
              New chat
            </Button>
            <Button variant="outline" icon="folder" onClick={addFolder}>
              Add folder
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
      </nav>

      <div className={styles.body}>
        <div className={styles.main}>
          {tab === 'documents' && (
            <Toggle
              checked={alsoGeneral}
              onChange={setAlsoGeneral}
              label="Also add new uploads to general documents"
              description="Applies to documents you add from here, so they're searchable outside this project too."
            />
          )}
          {tab === 'documents' && rejected.length > 0 && (
            <div className={styles.rejectedCallout}>
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
            </div>
          )}
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

      {drop.active && (
        <DropOverlay
          title="Drop to add to this project"
          hint="PDF, DOCX, Markdown, TXT, PNG, JPG — files or folders"
        />
      )}
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
