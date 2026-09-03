import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ComputeMode,
  CreateChatRequest,
  CreateProjectRequest,
  ReindexRequest,
  RunBenchmarkRequest,
  UpdateChatContextRequest,
  UpdateSettingsRequest,
} from '@localchat/contracts';
import { api, type IngestInput } from './client';
import { ApiError } from './http';

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

export function useDocuments(projectId: string | null) {
  return useQuery({
    queryKey: keys.documents(projectId),
    queryFn: ({ signal }) => api.listDocuments(projectId, signal),
    ...LIVE,
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
  return useQuery({
    queryKey: keys.chats.detail(id ?? ''),
    queryFn: ({ signal }) => api.getChat(id as string, signal),
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

export function useCreateChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChatRequest) => api.createChat(body),
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
    onError: (_error, _body, context) => {
      if (context?.key) client.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      if (chatId) void client.invalidateQueries({ queryKey: keys.chats.detail(chatId) });
    },
  });
}

export function useIngestDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: IngestInput) => api.ingestDocuments(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: keys.projects.all });
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

/** Shared retry policy: never retry a contract violation or a 4xx. */
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return error.retryable && failureCount < 2;
  return false;
}
