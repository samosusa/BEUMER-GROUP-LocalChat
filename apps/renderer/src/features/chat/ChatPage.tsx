import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Chat, RetrievalScope } from '@localchat/contracts';
import {
  useChat,
  useCreateChat,
  useDeleteDocument,
  useDocuments,
  useIngestDocuments,
  useMessages,
  useProject,
  useProjects,
  useUpdateChatContext,
} from '@/shared/api/queries';
import { ContextWidget } from '@/features/context/ContextWidget';
import { Icon } from '@/shared/ui/Icon';
import { Mono } from '@/shared/ui/Indicators';
import { useUiStore } from '@/shared/store/uiStore';
import { Transcript } from './components/Transcript';
import { Composer } from './components/Composer';
import { NewChatIntro } from './components/NewChatIntro';
import { UndoToast } from './components/UndoToast';
import { useAsk } from './hooks/useAsk';
import {
  chooseDocuments,
  chooseFolderDocuments,
  type ChosenDocuments,
} from '@/shared/lib/localFiles';
import { useDocumentDrop } from './hooks/useDocumentDrop';
import styles from './ChatPage.module.css';

/**
 * Stands in for the chat before it exists. Landing on `/chat` searches the general corpus
 * exactly like a freshly created one would — the chat record itself is only written on the
 * first message — so the context widget should say so instead of claiming there's nothing
 * to search.
 */
const DRAFT_CHAT: Chat = {
  id: 'draft',
  title: '',
  projectId: null,
  scope: 'general',
  attachmentIds: [],
  messageCount: 0,
  preview: '',
  sourceCount: 0,
  hadNoEvidence: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const chat = useChat(chatId);
  const messages = useMessages(chatId);
  const projects = useProjects();
  const project = useProject(chat.data?.projectId ?? undefined);

  const chatProjectId = chat.data?.projectId ?? null;
  const projectDocuments = useDocuments(chatProjectId);
  const generalDocuments = useDocuments(null);

  const updateContext = useUpdateChatContext(chatId);
  const createChat = useCreateChat();
  const ingest = useIngestDocuments();
  const deleteDocument = useDeleteDocument();
  const ask = useAsk(chatId);

  const [seed, setSeed] = useState<string | null>(null);
  const clearRemoval = useUiStore((state) => state.clearRemoval);

  // A general (non-project) chat has chatProjectId === null, which makes projectDocuments
  // and generalDocuments the exact same query — concatenating them would show every
  // document twice. Only a project-scoped chat draws from two genuinely disjoint lists.
  const available = useMemo(() => {
    if (chatProjectId === null) return generalDocuments.data?.documents ?? [];
    return [
      ...(projectDocuments.data?.documents ?? []),
      ...(generalDocuments.data?.documents ?? []),
    ];
  }, [chatProjectId, projectDocuments.data, generalDocuments.data]);

  const addDocuments = useCallback(
    async (chosen: ChosenDocuments) => {
      if (chosen.paths.length === 0 && chosen.files.length === 0) return;
      const result = await ingest.mutateAsync({
        projectId: chat.data?.projectId ?? null,
        paths: chosen.paths,
        files: chosen.files,
      });
      // Attaching is skipped against the live service: it has no per-chat context, so the
      // next refetch of the chat wipes attachmentIds and the pin silently disappears. The
      // document is in the general corpus and is searched either way — the corpus list in
      // the context panel is where it shows up.
      if (!__LIVE_SERVICE__ && chatId && result.accepted.length > 0) {
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

  /**
   * Submitting from the empty state creates the chat first — there's nothing to ask against
   * yet — then navigates here with the question carried as router state rather than local
   * component state: the composer already clears its own input on submit, so stashing the
   * question in `seed` to "resend" it later would just fight that and leave stale text
   * sitting in the box. This picks the question back up once `chatId` is live and asks it,
   * rather than making the engineer submit a second time.
   */
  useEffect(() => {
    const pending = (location.state as { question?: string } | null)?.question;
    if (!chatId || !pending) return;
    void ask.ask(pending, chat.data?.scope ?? 'general', chat.data?.attachmentIds ?? []);
    navigate(location.pathname, { replace: true, state: null });
    // Fires once per pending question: `location.state` is cleared in the same tick it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, location.state]);

  async function pickFiles() {
    await addDocuments(await chooseDocuments());
  }

  /** Folders are a desktop concept; a browser has no way to hand one over. */
  async function pickFolder() {
    const { documents } = await chooseFolderDocuments();
    if (documents.paths.length > 0) await addDocuments(documents);
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
        {chat.data || !chatId ? (
          <ContextWidget
            chat={chat.data ?? DRAFT_CHAT}
            project={project.data}
            available={available}
            onScopeChange={(scope: RetrievalScope) => {
              if (chatId) updateContext.mutate({ scope });
            }}
            onAttachmentsChange={(attachmentIds) => {
              if (chatId) updateContext.mutate({ attachmentIds });
            }}
            onAddFiles={pickFiles}
            onAddFolder={pickFolder}
            onDeleteDocument={(document) => deleteDocument.mutate(document.id)}
          />
        ) : (
          <span className={styles.topbarPlaceholder}>
            <Icon name="database" size={15} />
            Loading…
          </span>
        )}
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
