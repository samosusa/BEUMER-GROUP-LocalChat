import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RetrievalScope } from '@localchat/contracts';
import {
  useChat,
  useCreateChat,
  useDocuments,
  useIngestDocuments,
  useMessages,
  useProject,
  useProjects,
  useSettings,
  useUpdateChatContext,
} from '@/shared/api/queries';
import { ContextWidget } from '@/features/context/ContextWidget';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/Button';
import { Mono, StatusDot } from '@/shared/ui/Indicators';
import { formatCount } from '@/shared/lib/format';
import { useUiStore } from '@/shared/store/uiStore';
import { Transcript } from './components/Transcript';
import { Composer } from './components/Composer';
import { NewChatIntro } from './components/NewChatIntro';
import { UndoToast } from './components/UndoToast';
import { useAsk } from './hooks/useAsk';
import { chooseDocuments, type ChosenDocuments } from '@/shared/lib/localFiles';
import { useDocumentDrop } from './hooks/useDocumentDrop';
import styles from './ChatPage.module.css';

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();

  const chat = useChat(chatId);
  const messages = useMessages(chatId);
  const settings = useSettings();
  const projects = useProjects();
  const project = useProject(chat.data?.projectId ?? undefined);

  const projectDocuments = useDocuments(chat.data?.projectId ?? null);
  const generalDocuments = useDocuments(null);

  const updateContext = useUpdateChatContext(chatId);
  const createChat = useCreateChat();
  const ingest = useIngestDocuments();
  const ask = useAsk(chatId);

  const [seed, setSeed] = useState<string | null>(null);
  const clearRemoval = useUiStore((state) => state.clearRemoval);

  const available = useMemo(
    () => [
      ...(projectDocuments.data?.documents ?? []),
      ...(generalDocuments.data?.documents ?? []),
    ],
    [projectDocuments.data, generalDocuments.data],
  );

  const stats = projectDocuments.data?.stats ?? generalDocuments.data?.stats;

  const addDocuments = useCallback(
    async (chosen: ChosenDocuments) => {
      if (chosen.paths.length === 0 && chosen.files.length === 0) return;
      const result = await ingest.mutateAsync({
        projectId: chat.data?.projectId ?? null,
        paths: chosen.paths,
        files: chosen.files,
      });
      if (chatId && result.accepted.length > 0) {
        updateContext.mutate({
          attachmentIds: [
            ...(chat.data?.attachmentIds ?? []),
            ...result.accepted.map((document) => document.id),
          ],
        });
      }
    },
    [chat.data, chatId, ingest, updateContext],
  );

  const drop = useDocumentDrop(addDocuments);

  /**
   * A question typed into the quick-ask strip arrives here over IPC. It seeds the composer
   * rather than firing straight away, so the engineer can see and adjust the scope the answer
   * will be drawn from before committing to it.
   */
  useEffect(() => window.localchat?.onQuickAsk(setSeed), []);

  async function pickFiles() {
    await addDocuments(await chooseDocuments());
  }

  /** Folders are a desktop concept; a browser has no way to hand one over. */
  async function pickFolder() {
    const folder = await window.localchat?.pickFolder();
    if (folder) await addDocuments({ paths: [folder], files: [] });
  }

  /** Asking from the empty state has to create the chat first, then run the turn in it. */
  async function submit(question: string) {
    clearRemoval();
    if (chatId) {
      void ask.ask(question, chat.data?.scope ?? 'general', chat.data?.attachmentIds ?? []);
      return;
    }
    const created = await createChat.mutateAsync({
      projectId: null,
      scope: 'general',
      attachmentIds: [],
    });
    navigate(`/chat/${created.chat.id}`, { state: { question } });
    setSeed(question);
  }

  const hasTranscript = (messages.data?.length ?? 0) > 0 || ask.phase !== 'idle';

  return (
    <div
      className={styles.page}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      <header className={styles.topbar}>
        {chat.data ? (
          <ContextWidget
            chat={chat.data}
            project={project.data}
            available={available}
            onScopeChange={(scope: RetrievalScope) => updateContext.mutate({ scope })}
            onAttachmentsChange={(attachmentIds) => updateContext.mutate({ attachmentIds })}
            onAddFiles={pickFiles}
            onAddFolder={pickFolder}
          />
        ) : (
          <span className={styles.topbarPlaceholder}>
            <Icon name="database" size={15} />
            No context yet
          </span>
        )}

        <div className={styles.topbarRight}>
          {stats && (
            <StatusDot
              tone={stats.staleDocumentCount > 0 ? 'warning' : 'success'}
              label={
                stats.staleDocumentCount > 0
                  ? `${stats.staleDocumentCount} ${stats.staleDocumentCount === 1 ? 'document has' : 'documents have'} changed on disk`
                  : `index up to date · ${formatCount(stats.chunkCount)} chunks`
              }
            />
          )}
          <IconButton icon="refresh" label="Re-index changed files" />
          <span className={styles.topbarDivider} aria-hidden="true" />
          <IconButton icon="more" label="Chat options" />
        </div>
      </header>

      {hasTranscript ? (
        <Transcript messages={messages.data ?? []} ask={ask} onSuggestion={setSeed} />
      ) : (
        <NewChatIntro
          projects={projects.data ?? []}
          activeProjectId={chat.data?.projectId ?? null}
          scope={chat.data?.scope ?? 'general'}
          generalDocumentCount={generalDocuments.data?.documents.length ?? 0}
          onScopeChange={(scope, projectId) => {
            if (chatId) updateContext.mutate({ scope });
            else if (projectId) navigate(`/projects/${projectId}`);
          }}
          onStarter={setSeed}
          onDropFiles={pickFiles}
        />
      )}

      <Composer
        placeholder={
          project.data
            ? `Ask anything about ${project.data.name}…`
            : 'Ask about the documents in this context…'
        }
        busy={ask.busy}
        topK={settings.data?.retrieval.topK ?? 6}
        historyTurns={settings.data?.retrieval.historyTurns ?? 5}
        onSubmit={submit}
        onCancel={ask.cancel}
        onAttach={pickFiles}
        seed={seed}
      />

      <UndoToast
        onUndo={(documentId) => {
          if (!chat.data) return;
          updateContext.mutate({ attachmentIds: [...chat.data.attachmentIds, documentId] });
        }}
      />

      {drop.active && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <div className={styles.dropCard}>
            <Icon name="upload" size={26} strokeWidth={1.6} />
            <p className={styles.dropTitle}>Drop to add to this chat’s context</p>
            <Mono className={styles.dropHint}>
              PDF, DOCX, Markdown, TXT · hold Shift to add to the project instead
            </Mono>
          </div>
        </div>
      )}
    </div>
  );
}
