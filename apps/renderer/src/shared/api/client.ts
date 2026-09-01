import {
  AnswerEvent,
  type AskRequest,
  BenchmarkResponse,
  ChatResponse,
  type CreateChatRequest,
  type CreateProjectRequest,
  HealthResponse,
  type IngestDocumentsRequest,
  IngestDocumentsResponse,
  ListApprovedToolsResponse,
  ListChatsResponse,
  ListDocumentsResponse,
  ListMessagesResponse,
  ListModelsResponse,
  ListProjectsResponse,
  ProjectResponse,
  type ReindexRequest,
  SettingsResponse,
  type UpdateChatContextRequest,
  type UpdateProjectRequest,
  type UpdateSettingsRequest,
  routes,
} from '@localchat/contracts';
import { ApiError, request, serviceUrl } from './http';

/**
 * One function per endpoint. Nothing above this layer knows a URL or an HTTP verb.
 */
export const api = {
  health: (signal?: AbortSignal) => request(routes.health(), { schema: HealthResponse, signal }),

  // --- projects -----------------------------------------------------------
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
  listDocuments: (projectId: string | null, signal?: AbortSignal) =>
    request(routes.documents(), {
      schema: ListDocumentsResponse,
      signal,
      query: { projectId },
    }),

  ingestDocuments: (body: IngestDocumentsRequest) =>
    request(routes.ingest(), { method: 'POST', body, schema: IngestDocumentsResponse }),

  reindex: (body: ReindexRequest) =>
    request(routes.reindex(), { method: 'POST', body, schema: ListDocumentsResponse }),

  // --- chats --------------------------------------------------------------
  listChats: (params: { projectId?: string | null; query?: string }, signal?: AbortSignal) =>
    request(routes.chats(), {
      schema: ListChatsResponse,
      signal,
      query: { projectId: params.projectId, query: params.query },
    }),

  getChat: (id: string, signal?: AbortSignal) =>
    request(routes.chat(id), { schema: ChatResponse, signal }),

  createChat: (body: CreateChatRequest) =>
    request(routes.chats(), { method: 'POST', body, schema: ChatResponse }),

  listMessages: (id: string, signal?: AbortSignal) =>
    request(routes.chatMessages(id), { schema: ListMessagesResponse, signal }),

  updateChatContext: (id: string, body: UpdateChatContextRequest) =>
    request(routes.chatContext(id), { method: 'PATCH', body, schema: ChatResponse }),

  // --- settings and hardware ---------------------------------------------
  getSettings: (signal?: AbortSignal) =>
    request(routes.settings(), { schema: SettingsResponse, signal }),

  updateSettings: (body: UpdateSettingsRequest) =>
    request(routes.settings(), { method: 'PATCH', body, schema: SettingsResponse }),

  listModels: (signal?: AbortSignal) =>
    request(routes.models(), { schema: ListModelsResponse, signal }),

  getBenchmark: (signal?: AbortSignal) =>
    request(routes.benchmark(), { schema: BenchmarkResponse, signal }),

  runBenchmark: () => request(routes.benchmark(), { method: 'POST', schema: BenchmarkResponse }),

  /**
   * Ask a question. Server-sent events, because retrieval finishes long before the last
   * token: the UI can name the documents it is reading while generation is still running.
   */
  ask: (chatId: string, body: AskRequest, signal?: AbortSignal) =>
    streamAnswer(chatId, body, signal),
};

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
