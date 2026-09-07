import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { RetrievalScope } from '@localchat/contracts';
import {
  keys,
  useChat,
  useCreateChat,
  useIngestDocuments,
  useMessages,
  useProject,
  useProjects,
  useUpdateChatContext,
} from '@/shared/api/queries';
import { ScopeSelector } from './components/ScopeSelector';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/Button';
import { Mono } from '@/shared/ui/Indicators';
import { Transcript } from './components/Transcript';
import { describeError } from '@/shared/api/http';
import { Composer } from './components/Composer';
import { NewChatIntro } from './components/NewChatIntro';
import { useAsk } from './hooks/useAsk';
import { chooseDocuments, type ChosenDocuments } from '@/shared/lib/localFiles';
import { useDocumentDrop } from './hooks/useDocumentDrop';
import styles from './ChatPage.module.css';

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const chat = useChat(chatId);
  const messages = useMessages(chatId);
  const projects = useProjects();
  const chatProject = useProject(chat.data?.projectId ?? undefined);

  const updateContext = useUpdateChatContext(chatId);
  const createChat = useCreateChat();
  const ingest = useIngestDocuments();
  const ask = useAsk(chatId);

  const [seed, setSeed] = useState<string | null>(null);
  // Scope is decided once, before the chat exists — the chat's projectId is fixed forever at
  // creation (the service has no way to reattach one later), so this is the only moment a
  // project can be chosen at all.
  const [pendingScope, setPendingScope] = useState<RetrievalScope>('general');
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  const pendingProject = projects.data?.find((project) => project.id === pendingProjectId);
  const activeProject = chatId ? chatProject.data : pendingProject;

  /**
   * Why a document did not make it in.
   *
   * The contract has always returned `rejected: [{ path, reason }]` with a reason worth
   * reading, and nothing rendered it — so a file the service would not take looked exactly
   * like a file that worked. A thrown error was worse: `mutateAsync` rejected into an
   * unhandled promise and the screen did not change at all.
   */
  const [ingestNote, setIngestNote] = useState<string | null>(null);

  const addDocuments = useCallback(
    async (chosen: ChosenDocuments) => {
      if (chosen.paths.length === 0 && chosen.files.length === 0) return;
      setIngestNote(null);
      try {
        const result = await ingest.mutateAsync({
          projectId: chatId ? (chat.data?.projectId ?? null) : pendingProjectId,
          paths: chosen.paths,
          files: chosen.files,
        });
        if (result.rejected.length > 0) {
          setIngestNote(
            result.rejected
              .map((entry) => `${entry.path.split(/[\\/]/).pop()}: ${entry.reason}`)
              .join('\n'),
          );
        }
      } catch (cause) {
        setIngestNote(describeError(cause));
      }
    },
    [chat.data, chatId, ingest, pendingProjectId],
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
   *
   * The scope travels in the same state rather than being read off `chat.data.scope`: this
   * effect fires the instant `chatId` appears, which is before `useChat`'s own fetch for that
   * brand-new id has resolved, so `chat.data` is still undefined here. Falling back to
   * 'general' in that gap silently asked every first message in the wrong scope — the pending
   * chat's actual choice (general/project/both) is only known for certain in `pendingScope` at
   * the moment it was submitted, so that's what rides along.
   */
  useEffect(() => {
    const pending = location.state as { question?: string; scope?: RetrievalScope } | null;
    if (!chatId || !pending?.question) return;
    void ask.ask(pending.question, pending.scope ?? chat.data?.scope ?? 'general', []);
    navigate(location.pathname, { replace: true, state: null });
    // Fires once per pending question: `location.state` is cleared in the same tick it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, location.state]);

  /**
   * A project's "New chat" button lands here with the project pre-picked, since that's now
   * the only place a project-scoped chat can be started — the scope selector otherwise has no
   * way to know which project to offer. Applied during render rather than in an effect (same
   * reasoning as the composer's seed prop below): the preset is picked up on the very render
   * that sees it, not a frame late.
   */
  const presetProjectId = !chatId
    ? (location.state as { presetProjectId?: string } | null)?.presetProjectId
    : undefined;
  const [appliedPreset, setAppliedPreset] = useState<string | undefined>(undefined);
  if (presetProjectId !== undefined && presetProjectId !== appliedPreset) {
    setAppliedPreset(presetProjectId);
    setPendingProjectId(presetProjectId);
    setPendingScope(
      (location.state as { presetScope?: RetrievalScope } | null)?.presetScope ?? 'both',
    );
  }
  useEffect(() => {
    if (presetProjectId !== undefined) navigate(location.pathname, { replace: true, state: null });
  }, [presetProjectId, location.pathname, navigate]);

  async function pickFiles() {
    await addDocuments(await chooseDocuments());
  }

  /** Asking from the empty state has to create the chat first, then run the turn in it. */
  async function submit(question: string) {
    if (chatId) {
      void ask.ask(question, chat.data?.scope ?? 'general', []);
      return;
    }
    // "Project" turns blue the instant it's clicked, before a project is actually picked from
    // the dropdown — so a message can still be sent while nothing is chosen yet. There's
    // nothing to scope to at that point, so it falls back to general rather than creating a
    // chat claiming a project it doesn't have.
    const scope = pendingProjectId ? pendingScope : 'general';
    const created = await createChat.mutateAsync({
      projectId: pendingProjectId,
      scope,
      attachmentIds: [],
    });
    // The live service has no persistent scope of its own — it re-derives 'general'/'project'
    // from projectId alone (see `chatFromService`), which would silently forget a 'both' pick
    // the instant this response landed. Correcting it in the cache here, before the widget
    // ever renders the fresh chat, means it shows the scope actually chosen, not the service's
    // one-bit guess.
    queryClient.setQueryData(keys.chats.detail(created.chat.id), {
      chat: { ...created.chat, scope },
    });
    navigate(`/chat/${created.chat.id}`, { state: { question, scope } });
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
          <ScopeSelector
            scope={chatId ? (chat.data?.scope ?? 'general') : pendingScope}
            onScopeChange={(scope) =>
              chatId ? updateContext.mutate({ scope }) : setPendingScope(scope)
            }
            projectId={chatId ? (chat.data?.projectId ?? null) : pendingProjectId}
            projectName={activeProject?.name}
            locked={Boolean(chatId)}
            projects={projects.data ?? []}
            onProjectChange={setPendingProjectId}
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
        <NewChatIntro onDropFiles={pickFiles} />
      )}

      {ingestNote && (
        <div className={styles.ingestNote} role="status">
          <Icon name="warning" size={15} className={styles.ingestNoteIcon} />
          <p className={styles.ingestNoteText}>{ingestNote}</p>
          <IconButton icon="close" label="Dismiss" size={14} onClick={() => setIngestNote(null)} />
        </div>
      )}

      <Composer
        placeholder={
          activeProject
            ? `Ask anything about ${activeProject.name}…`
            : 'Ask about the documents in this context…'
        }
        busy={ask.busy}
        onSubmit={submit}
        onCancel={ask.cancel}
        onAttach={pickFiles}
        seed={seed}
      />

      {drop.active && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <div className={styles.dropCard}>
            <Icon name="upload" size={26} strokeWidth={1.6} />
            <p className={styles.dropTitle}>Drop to add to this chat’s context</p>
            <Mono className={styles.dropHint}>PDF, DOCX, Markdown, TXT</Mono>
          </div>
        </div>
      )}
    </div>
  );
}
