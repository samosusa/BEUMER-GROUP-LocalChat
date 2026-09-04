import {
  AnswerEvent,
  type AskRequest,
  BenchmarkResponse,
  ChatResponse,
  type ComputeMode,
  type CreateChatRequest,
  type CreateProjectRequest,
  HealthResponse,
  type IndexStats,
  type IngestDocumentsRequest,
  IngestDocumentsResponse,
  ListApprovedToolsResponse,
  ListChatsResponse,
  ListDocumentsResponse,
  ListMessagesResponse,
  ListModelsResponse,
  ListProjectsResponse,
  type Message,
  ProjectResponse,
  type ReindexRequest,
  type RunBenchmarkRequest,
  SettingsResponse,
  type UpdateChatContextRequest,
  type UpdateProjectRequest,
  type UpdateSettingsRequest,
  routes,
} from '@localchat/contracts';
import { z } from 'zod';
import { ApiError, request, serviceUrl } from './http';
import * as service from './service';

/**
 * One function per endpoint. Nothing above this layer knows a URL or an HTTP verb.
 *
 * ── Two backends ───────────────────────────────────────────────────────────
 * `__LIVE_SERVICE__` is baked in at build time (`LOCALCHAT_SERVICE=live`). When it is
 * false — the default, and what CI and the review container run — every call goes to the
 * in-process mock and the app needs no Python, no model and no GPU.
 *
 * When it is true, the calls below fork. Read the `LIVE ?` branches and you have the exact
 * list of what is real; everything without one is still a fixture. Two groups have no live
 * branch, each for a stated reason:
 *
 *   settings   Theme, hotkey, hardware and retrieval parameters have no server-side home —
 *              the service has no `/api/settings` route at all — so these stay mock-only in
 *              both modes. The active model and device are the one part of "settings" that
 *              IS real, which is exactly why they are not handled here: see
 *              `getActiveModel`/`setActiveModel` below, which talk to
 *              `GET/POST /models/active` directly and never touch this mock row.
 *   benchmark  The two sides measure different things. See `service/index.ts`.
 *
 * Projects, and project-scoped documents/ingestion/chats, ARE wired: the service has a
 * real `Project` entity and a `project_id` on documents and conversations. What it does
 * not have — description, folder watching, per-project instructions, approved tools, index
 * rebuild stats, re-index-on-demand — stays mocked or falls back to the honest empty value;
 * see the comments on each of those below.
 */
const LIVE = __LIVE_SERVICE__;

/**
 * `GET /docs` returns documents but no index statistics — no chunk total, no on-disk size,
 * no embedding model name. Rather than invent them, report what is knowable and leave the
 * rest at zero, which the interface renders as a plain zero instead of a confident wrong
 * number.
 */
function statsFromDocuments(documentCount: number): IndexStats {
  return {
    projectId: null,
    chunkCount: 0,
    documentCount,
    embeddingModel: '',
    indexSizeBytes: 0,
    lastRebuiltAt: null,
    staleDocumentCount: 0,
  };
}

export const api = {
  health: (signal?: AbortSignal): Promise<HealthResponse> =>
    LIVE ? service.health(signal) : request(routes.health(), { schema: HealthResponse, signal }),

  // --- projects -------------------------------------------------------------
  listProjects: async (signal?: AbortSignal): Promise<ListProjectsResponse> =>
    LIVE
      ? { projects: await service.listProjects(signal) }
      : request(routes.projects(), { schema: ListProjectsResponse, signal }),

  getProject: async (id: string, signal?: AbortSignal): Promise<ProjectResponse> =>
    LIVE
      ? { project: await service.getProject(id, signal) }
      : request(routes.project(id), { schema: ProjectResponse, signal }),

  createProject: async (body: CreateProjectRequest): Promise<ProjectResponse> =>
    LIVE
      ? { project: await service.createProject(body.name) }
      : request(routes.projects(), { method: 'POST', body, schema: ProjectResponse }),

  /**
   * Only a rename reaches the service: `description`, `folderPath` and `instructions` have
   * no column on the service's `Project` row, so editing them stays mock-only, the same way
   * theme and hotkey do for settings.
   */
  updateProject: async (id: string, body: UpdateProjectRequest): Promise<ProjectResponse> =>
    LIVE && body.name !== undefined
      ? { project: await service.renameProject(id, body.name) }
      : request(routes.project(id), { method: 'PATCH', body, schema: ProjectResponse }),

  /**
   * Cascades to the project's own documents and chats on both backends (the live service's
   * `ON DELETE CASCADE`, the mock's equivalent filtering); there is no undo.
   */
  deleteProject: (id: string): Promise<undefined> =>
    LIVE
      ? service.deleteProject(id)
      : request(routes.project(id), { method: 'DELETE', schema: z.undefined() }),

  /** Every project, cascading to their documents and chats exactly like one at a time would. */
  deleteAllProjects: (): Promise<undefined> =>
    LIVE
      ? service.deleteAllProjects()
      : request(routes.projects(), { method: 'DELETE', schema: z.undefined() }),

  /** No scoped endpoint on the service, so this is the full corpus filtered by project_id. */
  listProjectDocuments: async (
    id: string,
    signal?: AbortSignal,
  ): Promise<ListDocumentsResponse> => {
    if (!LIVE)
      return request(routes.projectDocuments(id), { schema: ListDocumentsResponse, signal });
    const documents = (await service.listDocuments(signal)).filter((doc) => doc.projectId === id);
    return { documents, stats: statsFromDocuments(documents.length) };
  },

  // No live branch: the service has no concept of an approved tool.
  listProjectTools: (id: string, signal?: AbortSignal) =>
    request(routes.projectTools(id), { schema: ListApprovedToolsResponse, signal }),

  // --- documents ----------------------------------------------------------
  listDocuments: async (
    projectId: string | null,
    signal?: AbortSignal,
  ): Promise<ListDocumentsResponse> => {
    if (!LIVE) {
      return request(routes.documents(), {
        schema: ListDocumentsResponse,
        signal,
        query: { projectId },
      });
    }
    const all = await service.listDocuments(signal);
    const documents = projectId === null ? all : all.filter((doc) => doc.projectId === projectId);
    return { documents, stats: statsFromDocuments(documents.length) };
  },

  /**
   * Documents arrive either as absolute paths (the desktop picker) or as `File` objects (a
   * browser picker or a drop). Both are accepted here rather than forcing one shape on
   * callers, because which one the host can supply is not the caller's business.
   */
  ingestDocuments: async (input: IngestInput): Promise<IngestDocumentsResponse> => {
    if (LIVE) return ingestLive(input);
    // The mock indexes by path. A browser cannot supply one, so the file's name stands in;
    // the mock only ever reads the extension and the basename off it.
    const body: IngestDocumentsRequest = {
      projectId: input.projectId,
      paths: input.paths?.length ? input.paths : (input.files ?? []).map((file) => file.name),
    };
    if (body.paths.length === 0) return { accepted: [], rejected: [] };
    return request(routes.ingest(), { method: 'POST', body, schema: IngestDocumentsResponse });
  },

  /**
   * Removes a document from the index. Not undoable on either backend: the vectors are
   * gone and the original bytes were never kept, so the caller must confirm first rather
   * than offering an undo it cannot honour.
   */
  deleteDocument: (id: string): Promise<undefined> =>
    LIVE
      ? service.deleteDocument(id)
      : request(routes.document(id), { method: 'DELETE', schema: z.undefined() }),

  /**
   * Only the general (project-less) corpus — a project's own documents go with the project,
   * via `deleteAllProjects`, so this never touches them.
   */
  deleteAllGeneralDocuments: (): Promise<undefined> =>
    LIVE
      ? service.deleteAllDocuments(null)
      : request(routes.documents(), {
          method: 'DELETE',
          schema: z.undefined(),
          query: { projectId: 'null' },
        }),

  // No live branch: the service has no re-index-on-demand endpoint.
  reindex: (body: ReindexRequest) =>
    request(routes.reindex(), { method: 'POST', body, schema: ListDocumentsResponse }),

  // --- chats --------------------------------------------------------------
  listChats: async (
    params: { projectId?: string | null; query?: string },
    signal?: AbortSignal,
  ): Promise<ListChatsResponse> => {
    if (!LIVE) {
      return request(routes.chats(), {
        schema: ListChatsResponse,
        signal,
        query: { projectId: params.projectId, query: params.query },
      });
    }
    const all = await service.listChats(signal);
    // The service offers no filter or search parameter, so both happen here. Titles are
    // the only text the list endpoint returns; a body search would need N detail requests.
    const scoped =
      params.projectId === undefined ? all : all.filter((c) => c.projectId === params.projectId);
    const needle = params.query?.trim().toLowerCase();
    return {
      chats: needle ? scoped.filter((c) => c.title.toLowerCase().includes(needle)) : scoped,
    };
  },

  getChat: async (id: string, signal?: AbortSignal): Promise<ChatResponse> =>
    LIVE
      ? { chat: await service.getChat(id, signal) }
      : request(routes.chat(id), { schema: ChatResponse, signal }),

  createChat: async (body: CreateChatRequest): Promise<ChatResponse> =>
    LIVE
      ? { chat: await service.createChat(body.projectId) }
      : request(routes.chats(), { method: 'POST', body, schema: ChatResponse }),

  /** Cascades to the chat's messages on both backends; there is no undo. */
  deleteChat: (id: string): Promise<undefined> =>
    LIVE
      ? service.deleteChat(id)
      : request(routes.chat(id), { method: 'DELETE', schema: z.undefined() }),

  /** Every chat, cascading to their messages on both backends; there is no undo. */
  deleteAllChats: (): Promise<undefined> =>
    LIVE
      ? service.deleteAllConversations()
      : request(routes.chats(), { method: 'DELETE', schema: z.undefined() }),

  listMessages: async (id: string, signal?: AbortSignal): Promise<ListMessagesResponse> =>
    LIVE
      ? { messages: await service.listMessages(id, signal) }
      : request(routes.chatMessages(id), { schema: ListMessagesResponse, signal }),

  /**
   * Scope and per-chat attachments have no *persistent* server-side representation: there is
   * no endpoint to store a chat's chosen scope, so this only updates the local cache (the
   * widget still records what the engineer picked, and `askLive` below re-sends `scope` with
   * every turn so it actually reaches the retriever — attachments still don't, `/messages`
   * has no field for them).
   */
  updateChatContext: async (id: string, body: UpdateChatContextRequest): Promise<ChatResponse> => {
    if (!LIVE) {
      return request(routes.chatContext(id), { method: 'PATCH', body, schema: ChatResponse });
    }
    const chat = await service.getChat(id);
    return {
      chat: {
        ...chat,
        scope: body.scope ?? chat.scope,
        attachmentIds: body.attachmentIds ?? chat.attachmentIds,
      },
    };
  },

  // --- settings and hardware ---------------------------------------------
  // No live branch: the service has no `/api/settings` route. Theme, hotkey, hardware and
  // retrieval parameters stay mock-only in both modes — see docs/backend-wiring.md. The
  // model and device, which ARE real, are handled below by getActiveModel/setActiveModel
  // instead of here, so this blob never has to guess at a value the service actually owns.
  getSettings: (signal?: AbortSignal): Promise<SettingsResponse> =>
    request(routes.settings(), { schema: SettingsResponse, signal }),

  updateSettings: (body: UpdateSettingsRequest): Promise<SettingsResponse> =>
    request(routes.settings(), { method: 'PATCH', body, schema: SettingsResponse }),

  /**
   * The active model and device, read straight off the service's own `GET /models/active`
   * — no mock involved. That endpoint is the only place this is actually known; folding it
   * into the settings mock meant the model chip depended on a route
   * (`GET /api/settings`) the real service does not have, and could never resolve.
   *
   * `gpuAvailable` comes from the same response: whether the installed `llama-cpp-python`
   * build actually has CUDA/GPU offload compiled in. That is the real reason a GPU option
   * would be disabled, not whatever GPU name happens to be sitting in the settings mock.
   */
  getActiveModel: async (
    signal?: AbortSignal,
  ): Promise<{ activeModelId: string | null; compute: ComputeMode; gpuAvailable: boolean }> => {
    if (!LIVE) {
      const { settings } = await request(routes.settings(), { schema: SettingsResponse, signal });
      return {
        activeModelId: settings.activeModelId,
        compute: settings.compute,
        gpuAvailable: settings.hardware.gpuName !== null,
      };
    }
    const active = await service.activeModel(signal);
    return {
      activeModelId: active.model,
      compute: active.device === 'gpu' ? 'gpu' : 'cpu',
      gpuAvailable: active.gpu_available,
    };
  },

  /**
   * Loads a model onto a device via the service's own `POST /models/active`. That call is
   * one combined operation, not two independent toggles — switching only the device (or
   * only the model) reads the currently active one first and fills in the other half.
   */
  setActiveModel: async (body: {
    modelId?: string;
    compute?: ComputeMode;
  }): Promise<{ activeModelId: string | null; compute: ComputeMode; gpuAvailable: boolean }> => {
    if (!LIVE) {
      const { settings } = await request(routes.settings(), {
        method: 'PATCH',
        body: { activeModelId: body.modelId, compute: body.compute },
        schema: SettingsResponse,
      });
      return {
        activeModelId: settings.activeModelId,
        compute: settings.compute,
        gpuAvailable: settings.hardware.gpuName !== null,
      };
    }
    const current = await service.activeModel();
    const modelId = body.modelId ?? current.model;
    if (!modelId) {
      throw new ApiError(0, 'no_model_selected', 'Choose a model before changing the device.');
    }
    const device = body.compute ?? (current.device === 'gpu' ? 'gpu' : 'cpu');
    const active = await service.setActiveModel(modelId, device);
    return {
      activeModelId: active.model,
      compute: active.device === 'gpu' ? 'gpu' : 'cpu',
      gpuAvailable: active.gpu_available,
    };
  },

  listModels: async (signal?: AbortSignal): Promise<ListModelsResponse> =>
    LIVE
      ? { models: await service.listModels(signal) }
      : request(routes.models(), { schema: ListModelsResponse, signal }),

  getBenchmark: async (signal?: AbortSignal): Promise<BenchmarkResponse> =>
    LIVE
      ? { run: await service.latestBenchmark(signal) }
      : request(routes.benchmark(), { schema: BenchmarkResponse, signal }),

  /**
   * Starts a run. Against the live service this returns as soon as the job is accepted —
   * the rows arrive through `getBenchmark` polling, the same way ingestion progress does.
   */
  runBenchmark: async (body: RunBenchmarkRequest): Promise<BenchmarkResponse> => {
    if (!LIVE) {
      return request(routes.benchmark(), { method: 'POST', body, schema: BenchmarkResponse });
    }
    await service.startBenchmark(body.devices, body.models);
    return { run: await service.latestBenchmark() };
  },

  ask: (chatId: string, body: AskRequest, signal?: AbortSignal) =>
    LIVE ? askLive(chatId, body, signal) : streamAnswer(chatId, body, signal),
};

// ---------------------------------------------------------------------------
// Live ingestion
// ---------------------------------------------------------------------------

/**
 * What a caller can hand to `ingestDocuments`. Exactly one of the two is populated,
 * depending on which host is running; see `shared/lib/localFiles.ts`.
 */
export interface IngestInput {
  projectId: string | null;
  paths?: string[];
  files?: File[];
}

const INGEST_POLL_MS = 750;
const INGEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `POST /ingest` takes a multipart upload, while the desktop picker hands us absolute
 * paths. The file bytes therefore come back through the preload bridge, which will only
 * read paths its own dialog returned.
 *
 * The service answers 202 with a job id and indexes in the background, so this waits for
 * each job to reach a terminal state before reporting. The alternative — returning
 * immediately — would show an empty document list for as long as chunking takes, with
 * nothing on screen explaining why.
 */
async function ingestLive(input: IngestInput): Promise<IngestDocumentsResponse> {
  const rejected: Array<{ path: string; reason: string }> = [];
  const jobs: Array<{ path: string; jobId: string }> = [];

  const start = async (label: string, file: File) => {
    const title = file.name.replace(/\.[^.]+$/, '');
    jobs.push({ path: label, jobId: await service.startIngestion(file, title, input.projectId) });
  };

  // Files the host already handed over need no bridge at all.
  for (const file of input.files ?? []) {
    try {
      await start(file.name, file);
    } catch (cause) {
      rejected.push({
        path: file.name,
        reason: cause instanceof Error ? cause.message : 'Upload failed',
      });
    }
  }

  // Paths do: the service ingests by upload, so the bytes come back through the preload
  // bridge, which reads only files its own dialog produced.
  const bridge = globalThis.window?.localchat;
  for (const path of input.paths ?? []) {
    if (!bridge?.readDocument) {
      rejected.push({ path, reason: 'Reading a file by path needs the desktop shell.' });
      continue;
    }
    try {
      const read = await bridge.readDocument(path);
      await start(path, new File([read.bytes], read.name));
    } catch (cause) {
      rejected.push({ path, reason: cause instanceof Error ? cause.message : 'Upload failed' });
    }
  }

  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (const job of jobs) {
    for (;;) {
      const status = await service.ingestionStatus(job.jobId);
      if (status.status === 'indexed') break;
      if (status.status === 'failed') {
        rejected.push({ path: job.path, reason: 'The service could not index this file.' });
        break;
      }
      if (Date.now() > deadline) {
        rejected.push({ path: job.path, reason: 'Indexing is still running; check back shortly.' });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, INGEST_POLL_MS));
    }
  }

  const accepted = await service.listDocuments();
  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Live answers
// ---------------------------------------------------------------------------

/**
 * The service generates the whole answer before responding, so there is no stream to read.
 * Rather than change every consumer, this produces the same event sequence from one
 * request — but it does NOT fake token-by-token arrival. Emitting the body in a single
 * `token` event keeps the transcript rendering path identical while being truthful that
 * nothing was incremental: the interface waits, then shows the answer.
 *
 * `retrieval` is emitted after the fact for the same reason. Its `elapsedMs` is the whole
 * round trip, which is the only number actually measured, and the citations it carries are
 * the real ones.
 */
async function* askLive(
  chatId: string,
  body: AskRequest,
  signal?: AbortSignal,
): AsyncGenerator<AnswerEvent> {
  const startedAt = Date.now();
  yield { type: 'accepted', messageId: `pending-${startedAt}`, chatId };

  let message: Message;
  try {
    message = await service.postMessage(chatId, body.question, body.scope);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    yield {
      type: 'error',
      code: cause instanceof ApiError ? cause.code : 'ask_failed',
      message: cause instanceof Error ? cause.message : 'The local service could not answer.',
    };
    return;
  }

  if (signal?.aborted) return;

  yield { type: 'retrieval', citations: message.citations, elapsedMs: Date.now() - startedAt };
  if (message.content) yield { type: 'token', text: message.content };
  yield { type: 'done', message };
}

// ---------------------------------------------------------------------------
// Mock answers (server-sent events)
// ---------------------------------------------------------------------------

async function* streamAnswer(
  chatId: string,
  body: AskRequest,
  signal?: AbortSignal,
): AsyncGenerator<AnswerEvent> {
  let response: Response;
  try {
    response = await fetch(`${serviceUrl()}${routes.ask(chatId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    throw new ApiError(0, 'service_unreachable', 'LocalChat cannot reach the local service.');
  }

  if (!response.ok || !response.body) {
    throw new ApiError(
      response.status,
      'ask_failed',
      `The local service could not answer (${response.status}).`,
    );
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): AnswerEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) return null;

  try {
    const parsed = AnswerEvent.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
