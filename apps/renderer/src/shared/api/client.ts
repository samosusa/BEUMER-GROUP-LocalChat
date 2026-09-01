import {
  AnswerEvent,
  type AskRequest,
  BenchmarkResponse,
  ChatResponse,
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
 * list of what is real; everything without one is still a fixture. Three groups have no
 * live branch, each for a stated reason:
 *
 *   projects   The service has no project entity at all — only a `project: bool` flag on
 *              ingest. Agreed as out of scope for this pass.
 *   settings   The service holds model and device; theme, hotkey, hardware and retrieval
 *              parameters have no server-side home. Only the model swap is wired through.
 *   benchmark  The two sides measure different things. See `service/index.ts`.
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

  // --- projects -----------------------------------------------------------
  // No live branch: the service has no project entity.
  listProjects: (signal?: AbortSignal) =>
    request(routes.projects(), { schema: ListProjectsResponse, signal }),

  getProject: (id: string, signal?: AbortSignal) =>
    request(routes.project(id), { schema: ProjectResponse, signal }),

  createProject: (body: CreateProjectRequest) =>
    request(routes.projects(), { method: 'POST', body, schema: ProjectResponse }),

  updateProject: (id: string, body: UpdateProjectRequest) =>
    request(routes.project(id), { method: 'PATCH', body, schema: ProjectResponse }),

  listProjectDocuments: (id: string, signal?: AbortSignal) =>
    request(routes.projectDocuments(id), { schema: ListDocumentsResponse, signal }),

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
    // The service knows one corpus. A project filter cannot be honoured, so asking for a
    // project's documents returns nothing rather than the whole corpus mislabelled.
    if (projectId !== null) return { documents: [], stats: statsFromDocuments(0) };
    const documents = await service.listDocuments(signal);
    return { documents, stats: statsFromDocuments(documents.length) };
  },

  /**
   * Documents arrive either as absolute paths (the desktop picker) or as `File` objects (a
   * browser picker or a drop). Both are accepted here rather than forcing one shape on
   * callers, because which one the host can supply is not the caller's business.
   */
  ingestDocuments: async (input: IngestInput): Promise<IngestDocumentsResponse> => {
    // Project screens read their documents from the mock, because the service has no
    // project entity. Ingesting from one must therefore go to the mock too: uploading to
    // the service's single corpus would put the file somewhere the page cannot show it,
    // and the row would simply never appear. The general corpus is the live one.
    if (LIVE && input.projectId === null) return ingestLive(input);
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
    const chats = await service.listChats(signal);
    // The service offers no search parameter, so filtering happens here. Titles are the
    // only text the list endpoint returns; a body search would need N detail requests.
    const needle = params.query?.trim().toLowerCase();
    return { chats: needle ? chats.filter((c) => c.title.toLowerCase().includes(needle)) : chats };
  },

  getChat: async (id: string, signal?: AbortSignal): Promise<ChatResponse> =>
    LIVE
      ? { chat: await service.getChat(id, signal) }
      : request(routes.chat(id), { schema: ChatResponse, signal }),

  createChat: async (body: CreateChatRequest): Promise<ChatResponse> =>
    LIVE
      ? { chat: await service.createChat() }
      : request(routes.chats(), { method: 'POST', body, schema: ChatResponse }),

  listMessages: async (id: string, signal?: AbortSignal): Promise<ListMessagesResponse> =>
    LIVE
      ? { messages: await service.listMessages(id, signal) }
      : request(routes.chatMessages(id), { schema: ListMessagesResponse, signal }),

  /**
   * Scope and per-chat attachments have no server-side representation: `/query` accepts
   * only a question. The change is kept client-side so the control still works and the
   * chat still records what the engineer chose, but it does not yet reach the retriever.
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
  getSettings: (signal?: AbortSignal) =>
    request(routes.settings(), { schema: SettingsResponse, signal }),

  /** A model or device change is a real service call; everything else is local. */
  updateSettings: async (body: UpdateSettingsRequest): Promise<SettingsResponse> => {
    if (LIVE && (body.activeModelId !== undefined || body.compute !== undefined)) {
      const current = await service.activeModel();
      const model = body.activeModelId ?? current.model;
      const device = body.compute ?? (current.device === 'gpu' ? 'gpu' : 'cpu');
      if (model) await service.setActiveModel(model, device);
    }
    return request(routes.settings(), { method: 'PATCH', body, schema: SettingsResponse });
  },

  listModels: async (signal?: AbortSignal): Promise<ListModelsResponse> =>
    LIVE
      ? { models: await service.listModels(signal) }
      : request(routes.models(), { schema: ListModelsResponse, signal }),

  getBenchmark: (signal?: AbortSignal) =>
    request(routes.benchmark(), { schema: BenchmarkResponse, signal }),

  runBenchmark: () => request(routes.benchmark(), { method: 'POST', schema: BenchmarkResponse }),

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
    jobs.push({ path: label, jobId: await service.startIngestion(file, title) });
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
    message = await service.postMessage(chatId, body.question);
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
