import { z } from 'zod';
import type {
  Chat,
  ComputeMode,
  Document,
  HealthResponse,
  Message,
  Model,
  ModelBenchmarkRun,
  Project,
  RetrievalScope,
} from '@localchat/contracts';
import { request } from '../http';
import {
  ServiceActiveModel,
  ServiceBenchmarkAccepted,
  ServiceBenchmarkResults,
  ServiceBenchmarkRunList,
  ServiceBenchmarkStatus,
  ServiceConversationDetail,
  ServiceConversationList,
  ServiceDocumentList,
  ServiceHealth,
  ServiceIngestAccepted,
  ServiceIngestStatus,
  ServiceMessage,
  ServiceModelList,
  ServiceProject,
  ServiceProjectList,
} from './dto';
import {
  benchmarkRunFromService,
  chatDetailFromService,
  chatFromService,
  createDocumentIndex,
  documentFromService,
  ingestionProgressFromService,
  ingestionStatusFromService,
  messageFromService,
  modelFromService,
  projectFromService,
  toId,
  toServiceId,
} from './map';

/**
 * The live RAG service, expressed in the domain's vocabulary.
 *
 * Routes here are the service's own — `/docs`, `/conversations`, `/ingest` — with no
 * `/api` prefix, because that is what FastAPI serves. The mock's `/api/...` routes are a
 * separate namespace; nothing addresses both.
 */

// ---------------------------------------------------------------------------
// Document title -> id, for citation resolution
// ---------------------------------------------------------------------------

/**
 * Citations arrive carrying a document *title* and no id, so this is the only way back to
 * the document a claim came from. Refreshed as a side effect of listing documents, which
 * every screen that renders citations already does.
 */
const documentIndex = createDocumentIndex();
const resolveDocumentId = (title: string) => documentIndex.resolve(title);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * `GET /health` reports only `{"status": "ok"}`, but the status strip also shows whether
 * the model is resident — the difference between "the service is up" and "it can answer".
 * `/models/active` is the only place that says so, hence the second call; it is a dict
 * lookup on the service side, not a model load.
 *
 * `version` is empty because the service exposes none. `offline` is true because the
 * service makes no outbound requests by construction, not because it was asked.
 */
export async function health(signal?: AbortSignal): Promise<HealthResponse> {
  const dto = await request('/health', { schema: ServiceHealth, signal });

  let modelLoaded = false;
  try {
    const active = await request('/models/active', { schema: ServiceActiveModel, signal });
    modelLoaded = active.model !== null;
  } catch {
    // A service that answers /health but not /models/active is degraded, not down.
    return { status: 'degraded', version: '', modelLoaded: false, offline: true };
  }

  return {
    status: dto.status === 'ok' ? 'ok' : 'degraded',
    version: '',
    modelLoaded,
    offline: true,
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * The service has no scoped "documents in this project" or "chats in this project"
 * endpoint, so counts come from the same full lists every other screen already fetches,
 * filtered here rather than trusting a number the service was never asked to compute.
 */
async function withProjectCounts(project: ServiceProject, signal?: AbortSignal): Promise<Project> {
  const id = toId(project.id);
  const [documents, chats] = await Promise.all([listDocuments(signal), listChats(signal)]);
  return projectFromService(
    project,
    documents.filter((document) => document.projectId === id),
    chats.filter((chat) => chat.projectId === id).length,
  );
}

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const [projects, documents, chats] = await Promise.all([
    request('/projects', { schema: ServiceProjectList, signal }),
    listDocuments(signal),
    listChats(signal),
  ]);
  return projects.map((project) => {
    const id = toId(project.id);
    return projectFromService(
      project,
      documents.filter((document) => document.projectId === id),
      chats.filter((chat) => chat.projectId === id).length,
    );
  });
}

export async function getProject(id: string, signal?: AbortSignal): Promise<Project> {
  const dto = await request(`/projects/${toServiceId(id, 'project')}`, {
    schema: ServiceProject,
    signal,
  });
  return withProjectCounts(dto, signal);
}

export async function createProject(name: string): Promise<Project> {
  const dto = await request('/projects', {
    method: 'POST',
    body: { name },
    schema: ServiceProject,
  });
  // A project is created empty; no document or chat can reference it yet.
  return projectFromService(dto, [], 0);
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const dto = await request(`/projects/${toServiceId(id, 'project')}`, {
    method: 'PATCH',
    body: { name },
    schema: ServiceProject,
  });
  return withProjectCounts(dto);
}

export function deleteProject(id: string): Promise<undefined> {
  return request(`/projects/${toServiceId(id, 'project')}`, {
    method: 'DELETE',
    schema: z.undefined(),
  });
}

/** Every project, cascading to their documents (and each one's vector index) and chats. */
export function deleteAllProjects(): Promise<undefined> {
  return request('/projects', { method: 'DELETE', schema: z.undefined() });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listDocuments(signal?: AbortSignal): Promise<Document[]> {
  const dto = await request('/docs', { schema: ServiceDocumentList, signal });
  const documents = dto.map(documentFromService);
  documentIndex.remember(documents);
  return documents;
}

export function deleteDocument(id: string): Promise<undefined> {
  return request(`/docs/${toServiceId(id, 'document')}`, {
    method: 'DELETE',
    schema: z.undefined(),
  });
}

/**
 * `projectId: null` maps to the service's `project_id=null` sentinel, meaning the general
 * (project-less) corpus — the only case the renderer actually calls this with today.
 */
export function deleteAllDocuments(projectId: string | null): Promise<undefined> {
  return request('/docs', {
    method: 'DELETE',
    schema: z.undefined(),
    query: { project_id: projectId === null ? 'null' : toServiceId(projectId, 'project') },
  });
}

/**
 * Ingestion is a multipart upload followed by polling, so this returns the job id rather
 * than a document: the row does not exist until the pipeline has finished chunking it.
 */
export async function startIngestion(
  file: File,
  title: string,
  projectId: string | null,
): Promise<string> {
  const form = new FormData();
  form.set('file', file, file.name);
  form.set('title', title);
  if (projectId !== null) form.set('project_id', String(toServiceId(projectId, 'project')));
  const dto = await request('/ingest', {
    method: 'POST',
    body: form,
    schema: ServiceIngestAccepted,
  });
  return String(dto.job_id);
}

export async function ingestionStatus(jobId: string, signal?: AbortSignal) {
  const dto = await request(`/status/${toServiceId(jobId, 'ingestion job')}`, {
    schema: ServiceIngestStatus,
    signal,
  });
  return {
    jobId,
    status: ingestionStatusFromService(dto),
    progress: ingestionProgressFromService(dto),
    chunksDone: dto.offset,
    chunksTotal: dto.total_chunks,
    resumable: dto.last_checkpoint !== null,
  };
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export async function listChats(signal?: AbortSignal): Promise<Chat[]> {
  const dto = await request('/conversations', { schema: ServiceConversationList, signal });
  return dto.map((conversation) => chatFromService(conversation));
}

export async function getChat(id: string, signal?: AbortSignal): Promise<Chat> {
  const dto = await request(`/conversations/${toServiceId(id, 'conversation')}`, {
    schema: ServiceConversationDetail,
    signal,
  });
  return chatDetailFromService(dto);
}

export async function createChat(projectId: string | null): Promise<Chat> {
  const dto = await request('/conversations', {
    method: 'POST',
    body: {
      title: null,
      project_id: projectId === null ? null : toServiceId(projectId, 'project'),
    },
    schema: ServiceConversationDetail.omit({ messages: true }),
  });
  return chatFromService(dto);
}

export async function renameChat(id: string, title: string): Promise<Chat> {
  const dto = await request(`/conversations/${toServiceId(id, 'conversation')}`, {
    method: 'PATCH',
    body: { title },
    schema: ServiceConversationDetail.omit({ messages: true }),
  });
  return chatFromService(dto);
}

export function deleteChat(id: string): Promise<undefined> {
  return request(`/conversations/${toServiceId(id, 'conversation')}`, {
    method: 'DELETE',
    schema: z.undefined(),
  });
}

/** Every chat, cascading to their messages the same way the single delete does. */
export function deleteAllConversations(): Promise<undefined> {
  return request('/conversations', { method: 'DELETE', schema: z.undefined() });
}

export async function listMessages(chatId: string, signal?: AbortSignal): Promise<Message[]> {
  const dto = await request(`/conversations/${toServiceId(chatId, 'conversation')}`, {
    schema: ServiceConversationDetail,
    signal,
  });
  return dto.messages.map((message) => messageFromService(message, resolveDocumentId));
}

/**
 * Ask a question inside a conversation. Blocking: the service generates the whole answer
 * before responding. `client.ts` wraps this to produce the event sequence the UI expects.
 *
 * `scope` is a per-turn override of the conversation's own project: 'general' searches the
 * project-less corpus even from inside a project-linked conversation, 'both' adds that
 * project-less corpus on top of the conversation's own project, and anything else keeps
 * the conversation's own project scope.
 */
export async function postMessage(
  chatId: string,
  question: string,
  scope?: RetrievalScope,
): Promise<Message> {
  const dto = await request(`/conversations/${toServiceId(chatId, 'conversation')}/messages`, {
    method: 'POST',
    body: { q: question, scope },
    schema: ServiceMessage,
  });
  return messageFromService(dto, resolveDocumentId);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function listModels(signal?: AbortSignal): Promise<Model[]> {
  const dto = await request('/models', { schema: ServiceModelList, signal });
  return dto.map(modelFromService);
}

export function activeModel(signal?: AbortSignal) {
  return request('/models/active', { schema: ServiceActiveModel, signal });
}

/**
 * Blocks until the swap completes — the service unloads the current model, loads the
 * requested one and only then answers, so `/query` can never race an in-flight load.
 * Callers must expect this to take tens of seconds on a multi-gigabyte GGUF.
 */
export function setActiveModel(model: string, device: 'cpu' | 'gpu') {
  return request('/models/active', {
    method: 'POST',
    body: { model, device },
    schema: ServiceActiveModel,
  });
}

// ---------------------------------------------------------------------------
// Model benchmark
// ---------------------------------------------------------------------------

/**
 * Starts a run and returns its job id.
 *
 * Note for callers: the service unloads whatever model `/models/active` currently holds
 * before benchmarking, so answering is unavailable for the duration. The interface has to
 * say so rather than let a question sit there timing out.
 */
export async function startBenchmark(
  devices: ComputeMode[],
  models: string[] | null,
): Promise<string> {
  const dto = await request('/benchmark', {
    method: 'POST',
    body: { devices, models },
    schema: ServiceBenchmarkAccepted,
  });
  return toId(dto.benchmark_job_id);
}

/**
 * The most recent run, assembled from three endpoints.
 *
 * `/benchmark/results` lists runs with their timestamps but no rows; `/benchmark/results/{id}`
 * has the rows but no timestamps; `/benchmark/status/{id}` has progress but neither. One
 * screen needs all three, so they are joined here rather than in a component.
 */
export async function latestBenchmark(signal?: AbortSignal): Promise<ModelBenchmarkRun | null> {
  const runs = await request('/benchmark/results', { schema: ServiceBenchmarkRunList, signal });
  if (runs.length === 0) return null;

  const newest = [...runs].sort((a, b) => b.benchmark_job_id - a.benchmark_job_id)[0];
  if (!newest) return null;

  const results = await request(`/benchmark/results/${newest.benchmark_job_id}`, {
    schema: ServiceBenchmarkResults,
    signal,
  });

  // Only worth a third request while something is actually moving.
  let status;
  if (newest.status.toLowerCase() === 'running') {
    status = await request(`/benchmark/status/${newest.benchmark_job_id}`, {
      schema: ServiceBenchmarkStatus,
      signal,
    });
  }

  return benchmarkRunFromService(results, {
    startedAt: newest.created_at,
    finishedAt: newest.finished_at,
    status,
  });
}
