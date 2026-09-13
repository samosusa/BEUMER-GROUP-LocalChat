import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ComputeMode,
  CreateChatRequest,
  CreateProjectRequest,
  ReindexRequest,
  RunBenchmarkRequest,
  RunEmbeddingBenchmarkRequest,
  UpdateChatContextRequest,
  UpdateSettingsRequest,
} from '@localchat/contracts';
import { api, type IngestInput } from './client';
import { ApiError, describeError } from './http';
import { useNotificationStore } from '@/shared/store/notificationStore';

/**
 * Query keys are declared once, hierarchically, so an invalidation can target exactly the
 * slice that changed (`keys.chats.all` after a new chat, `keys.chat.messages(id)` after a
 * turn) rather than blanket-refetching the app.
 */
export const keys = {
  health: ['health'] as const,
  projects: {
    all: ['projects'] as const,
    detail: (id: string) => ['projects', id] as const,
    documents: (id: string) => ['projects', id, 'documents'] as const,
    tools: (id: string) => ['projects', id, 'tools'] as const,
  },
  documents: (projectId: string | null) => ['documents', projectId] as const,
  chats: {
    all: (projectId?: string | null, query?: string) =>
      ['chats', { projectId: projectId ?? null, query: query ?? '' }] as const,
    detail: (id: string) => ['chats', id] as const,
    messages: (id: string) => ['chats', id, 'messages'] as const,
  },
  settings: ['settings'] as const,
  activeModel: ['activeModel'] as const,
  models: ['models'] as const,
  benchmark: ['benchmark'] as const,
  embeddingModels: ['embeddingModels'] as const,
  activeEmbeddingModel: ['activeEmbeddingModel'] as const,
  reindexJob: ['reindexJob'] as const,
  embeddingBenchmark: ['embeddingBenchmark'] as const,
};

/** Anything the retriever wrote is cheap to refetch and expensive to show stale. */
const LIVE = { staleTime: 5_000 } as const;
/** Hardware and model lists change only when the engineer changes them. */
const STATIC = { staleTime: 5 * 60_000 } as const;

/** The only per-call knobs any screen needs; typing them concretely keeps inference intact. */
interface QueryOverrides {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => api.health(signal),
    // The service can be mid-start; poll gently rather than showing a hard failure.
    refetchInterval: (query) => (query.state.error ? 3_000 : 30_000),
    retry: false,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects.all,
    queryFn: ({ signal }) => api.listProjects(signal),
    select: (data) => data.projects,
    ...LIVE,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: keys.projects.detail(id ?? ''),
    queryFn: ({ signal }) => api.getProject(id as string, signal),
    select: (data) => data.project,
    enabled: Boolean(id),
    ...LIVE,
  });
}

export function useProjectDocuments(id: string | undefined, overrides?: QueryOverrides) {
  return useQuery({
    queryKey: keys.projects.documents(id ?? ''),
    queryFn: ({ signal }) => api.listProjectDocuments(id as string, signal),
    enabled: Boolean(id),
    ...LIVE,
    ...overrides,
  });
}

export function useProjectTools(id: string | undefined) {
  return useQuery({
    queryKey: keys.projects.tools(id ?? ''),
    queryFn: ({ signal }) => api.listProjectTools(id as string, signal),
    select: (data) => data.tools,
    enabled: Boolean(id),
    ...STATIC,
  });
}

export function useDocuments(projectId: string | null, overrides?: QueryOverrides) {
  return useQuery({
    queryKey: keys.documents(projectId),
    queryFn: ({ signal }) => api.listDocuments(projectId, signal),
    ...LIVE,
    ...overrides,
  });
}

export function useChats(params: { projectId?: string | null; query?: string } = {}) {
  return useQuery({
    queryKey: keys.chats.all(params.projectId, params.query),
    queryFn: ({ signal }) => api.listChats(params, signal),
    select: (data) => data.chats,
    ...LIVE,
  });
}

export function useChat(id: string | undefined) {
  const client = useQueryClient();
  const key = keys.chats.detail(id ?? '');
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const data = await api.getChat(id as string, signal);
      /**
       * `scope` has no persistent server representation — the live service re-derives it
       * from `projectId` alone on every fetch (see `chatFromService`), always landing on
       * 'project' for a project-linked chat. `useUpdateChatContext` writes a client-chosen
       * scope straight into this same cache entry, so if that entry already exists, it holds
       * the true current choice — trust it over the server's one-bit guess. Otherwise this
       * query would silently revert 'both' back to 'project' on ANY refetch of this chat:
       * window focus, or — the one that actually bit here — the chat-list invalidation that
       * runs after every turn completes (see `useAsk`'s `commit`).
       */
      const previous = client.getQueryData<typeof data>(key);
      return previous ? { chat: { ...data.chat, scope: previous.chat.scope } } : data;
    },
    select: (data) => data.chat,
    enabled: Boolean(id),
    ...LIVE,
  });
}

export function useMessages(id: string | undefined) {
  return useQuery({
    queryKey: keys.chats.messages(id ?? ''),
    queryFn: ({ signal }) => api.listMessages(id as string, signal),
    select: (data) => data.messages,
    enabled: Boolean(id),
    ...LIVE,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => api.getSettings(signal),
    select: (data) => data.settings,
    ...STATIC,
  });
}

/**
 * The model and device actually loaded, straight off `GET /models/active` in live mode —
 * see `api.getActiveModel`. Deliberately its own query rather than a field on `useSettings`:
 * the service has no settings route at all, so folding this into that blob meant it could
 * never resolve on a real deployment.
 */
export function useActiveModel() {
  return useQuery({
    queryKey: keys.activeModel,
    queryFn: ({ signal }) => api.getActiveModel(signal),
    ...STATIC,
  });
}

export function useModels() {
  return useQuery({
    queryKey: keys.models,
    queryFn: ({ signal }) => api.listModels(signal),
    select: (data) => data.models,
    ...STATIC,
  });
}

/**
 * Polls only while a run is in flight. A benchmark loads several multi-gigabyte models in
 * sequence, so a fixed interval would keep asking long after the last one finished.
 */
export function useBenchmark() {
  return useQuery({
    queryKey: keys.benchmark,
    queryFn: ({ signal }) => api.getBenchmark(signal),
    select: (data) => data.run,
    ...STATIC,
    // Loading a multi-gigabyte model takes tens of seconds, so this is slow on purpose:
    // a tighter interval would add nothing and a fixed one would keep asking forever.
    refetchInterval: (query) => (query.state.data?.run?.status === 'running' ? 3_000 : false),
  });
}

export function useEmbeddingModels() {
  return useQuery({
    queryKey: keys.embeddingModels,
    queryFn: ({ signal }) => api.listEmbeddingModels(signal),
    select: (data) => data.embeddingModels,
    ...STATIC,
  });
}

/** The embedding model actually indexing and searching with, straight off the service. */
export function useActiveEmbeddingModel() {
  return useQuery({
    queryKey: keys.activeEmbeddingModel,
    queryFn: ({ signal }) => api.getActiveEmbeddingModel(signal),
    ...STATIC,
  });
}

/**
 * The current or most recent re-embed job. Polls while running: switching models queues a
 * pass over every indexed document, which can take minutes on a large corpus, and a fixed
 * interval would either lag an active run or keep polling long after a finished one.
 */
export function useReindexJob() {
  return useQuery({
    queryKey: keys.reindexJob,
    queryFn: ({ signal }) => api.getReindexJob(signal),
    select: (data) => data.job,
    ...STATIC,
    refetchInterval: (query) => (query.state.data?.job?.status === 'running' ? 2_000 : false),
  });
}

/** Same shape as `useBenchmark`, for the embedding-model benchmark instead of the answer model. */
export function useEmbeddingBenchmark() {
  return useQuery({
    queryKey: keys.embeddingBenchmark,
    queryFn: ({ signal }) => api.getEmbeddingBenchmark(signal),
    select: (data) => data.run,
    ...STATIC,
    refetchInterval: (query) => (query.state.data?.run?.status === 'running' ? 3_000 : false),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectRequest) => api.createProject(body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects.all }),
  });
}

/** Cascades to the project's own documents and chats on both backends; there is no undo. */
export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: (_data, id) => {
      void client.invalidateQueries({ queryKey: keys.projects.all });
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['chats'] });
      client.removeQueries({ queryKey: keys.projects.detail(id) });
    },
  });
}

/** Every project, cascading to their documents and chats on both backends; there is no undo. */
export function useDeleteAllProjects() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteAllProjects(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.projects.all });
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useCreateChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChatRequest) => api.createChat(body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['chats'] }),
  });
}

export function useDeleteChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteChat(id),
    onSuccess: (_data, id) => {
      void client.invalidateQueries({ queryKey: ['chats'] });
      client.removeQueries({ queryKey: keys.chats.detail(id) });
      client.removeQueries({ queryKey: keys.chats.messages(id) });
    },
  });
}

/** Every chat, cascading to their messages on both backends; there is no undo. */
export function useDeleteAllChats() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteAllChats(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['chats'] }),
  });
}

export function useUpdateChatContext(chatId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateChatContextRequest) => api.updateChatContext(chatId as string, body),
    /**
     * Scope changes are applied optimistically: the widget must feel instant, because the
     * engineer flips it mid-thought and a spinner there reads as the app second-guessing them.
     */
    onMutate: async (body) => {
      if (!chatId) return;
      const key = keys.chats.detail(chatId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData(key);
      client.setQueryData(key, (current: { chat: unknown } | undefined) =>
        current ? { chat: { ...(current.chat as object), ...body } } : current,
      );
      return { previous, key };
    },
    /**
     * Written directly into the cache rather than invalidated: a refetch would re-derive
     * `scope` from `projectId` (the live service has no independent scope field, see
     * `chatFromService`), which would immediately overwrite a client-chosen 'general'/'both'
     * scope on a project chat right back to 'project'.
     */
    onSuccess: (data, _body, context) => {
      const key = context?.key ?? (chatId ? keys.chats.detail(chatId) : undefined);
      if (key) client.setQueryData(key, data);
    },
    onError: (_error, _body, context) => {
      if (context?.key) client.setQueryData(context.key, context.previous);
    },
  });
}

export function useIngestDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: IngestInput) => api.ingestDocuments(input),
    /**
     * Runs even if the page that started the ingest has since unmounted — mutation
     * callbacks live on the query client, not the component — so a rejection is still
     * reported when the engineer has already moved on to another screen.
     */
    onSuccess: (data, input) => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: keys.projects.all });
      if (data.rejected.length > 0) {
        useNotificationStore.getState().push({
          tone: 'warning',
          title:
            data.rejected.length === 1
              ? '1 file could not be indexed'
              : `${data.rejected.length} files could not be indexed`,
          detail: data.rejected.map((item) => `${item.path} — ${item.reason}`),
        });
      }

      const rejected = new Set(data.rejected.map((item) => item.path));
      const names = [
        ...(input.paths ?? [])
          .filter((path) => !rejected.has(path))
          .map((path) => path.split(/[\\/]/).pop() ?? path),
        ...(input.files ?? []).filter((file) => !rejected.has(file.name)).map((file) => file.name),
      ];
      if (names.length > 0) {
        const scope =
          input.projectId === null ? 'General' : input.alsoGeneral ? 'Both' : 'Project-specific';
        useNotificationStore.getState().push({
          tone: 'info',
          title:
            names.length === 1
              ? 'Document indexed and ready to use'
              : `${names.length} documents indexed and ready to use`,
          detail: names.map((name) => `${name} — ${scope}`),
        });
      }
    },
    /**
     * The request itself failing — the local service unreachable, or down — would otherwise
     * vanish silently: every caller just `await`s `mutateAsync` and has nothing of its own to
     * catch the rejection with, so "add folder"/"add files" would visibly do nothing at all
     * rather than explain why.
     */
    onError: (error) => {
      useNotificationStore.getState().push({
        tone: 'warning',
        title: 'Could not add documents',
        detail: [describeError(error)],
      });
    },
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['projects'] });
      // A pinned document that no longer exists would leave the chat claiming context it
      // cannot search, so the chat is refetched too.
      void client.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/** Only the general (project-less) corpus — a project's own documents go with the project. */
export function useDeleteAllGeneralDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteAllGeneralDocuments(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useReindex() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReindexRequest) => api.reindex(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: (data) => {
      client.setQueryData(keys.settings, data);
      void client.invalidateQueries({ queryKey: keys.models });
    },
  });
}

/**
 * Loads a model onto a device via `POST /models/active` in live mode. Kept apart from
 * `useUpdateSettings` for the same reason `useActiveModel` is kept apart from `useSettings`:
 * this is the one field of "settings" the service actually owns.
 */
export function useSetActiveModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { modelId?: string; compute?: ComputeMode }) => api.setActiveModel(body),
    onSuccess: (data) => client.setQueryData(keys.activeModel, data),
  });
}

export function useRunBenchmark() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RunBenchmarkRequest) => api.runBenchmark(body),
    onSuccess: (data) => client.setQueryData(keys.benchmark, data),
  });
}

/**
 * Switching always queues a re-embed of the existing corpus — there is no way to switch
 * without one. `onSuccess` seeds both the new active model and the freshly-queued job so the
 * interface reflects the switch immediately rather than waiting on the next poll of each.
 */
export function useSetActiveEmbeddingModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => api.setActiveEmbeddingModel(model),
    onSuccess: (data) => {
      client.setQueryData(keys.activeEmbeddingModel, { model: data.model, dimension: data.dimension });
      void client.invalidateQueries({ queryKey: keys.reindexJob });
    },
  });
}

export function useRunEmbeddingBenchmark() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RunEmbeddingBenchmarkRequest) => api.runEmbeddingBenchmark(body),
    onSuccess: (data) => client.setQueryData(keys.embeddingBenchmark, data),
  });
}

/** Shared retry policy: never retry a contract violation or a 4xx. */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return error.retryable && failureCount < 2;
  return false;
}
