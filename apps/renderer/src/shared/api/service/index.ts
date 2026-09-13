import { z } from 'zod';
import type {
  Chat,
  ComputeMode,
  Document,
  EmbeddingBenchmarkRun,
  EmbeddingModel,
  HealthResponse,
  Message,
  Model,
  ModelBenchmarkRun,
  Project,
  RagEvalDatasetInfo,
  RagEvalRun,
  ReindexJob,
  RetrievalScope,
} from '@localchat/contracts';
import { request } from '../http';
import {
  ServiceActiveEmbeddingModel,
  ServiceActiveModel,
  ServiceBenchmarkAccepted,
  ServiceBenchmarkResults,
  ServiceBenchmarkRunList,
  ServiceBenchmarkStatus,
  ServiceConversationDetail,
  ServiceConversationList,
  ServiceDocumentList,
  ServiceEmbeddingBenchmarkAccepted,
  ServiceEmbeddingBenchmarkResults,
  ServiceEmbeddingBenchmarkRunList,
  ServiceEmbeddingBenchmarkStatus,
  ServiceEmbeddingModelList,
  ServiceHealth,
  ServiceIngestAccepted,
  ServiceIngestStatus,
  ServiceMessage,
  ServiceModelList,
  ServiceProject,
  ServiceProjectList,
  ServiceRagEvalAccepted,
  ServiceRagEvalDatasetList,
  ServiceRagEvalResults,
  ServiceRagEvalRunList,
  ServiceRagEvalStatus,
  ServiceReindexRunList,
  ServiceReindexStatus,
  ServiceSetActiveEmbeddingModel,
} from './dto';
import {
  benchmarkRunFromService,
  chatDetailFromService,
  chatFromService,
  createDocumentIndex,
  documentFromService,
  embeddingBenchmarkRunFromService,
  embeddingModelFromService,
  ingestionProgressFromService,
  ingestionStatusFromService,
  messageFromService,
  modelFromService,
  projectFromService,
  ragEvalDatasetInfoFromService,
  ragEvalRunFromService,
  reindexJobFromService,
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
  alsoGeneral = false,
): Promise<string> {
  const form = new FormData();
  form.set('file', file, file.name);
  form.set('title', title);
  if (projectId !== null) form.set('project_id', String(toServiceId(projectId, 'project')));
  if (alsoGeneral) form.set('also_general', 'true');
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

/**
 * Every completed run, oldest first, with its rows.
 *
 * `/benchmark/results` gives the summaries and `/benchmark/results/{id}` the rows, so a
 * history is one request per run. Capped at the most recent 20: a chart of forty runs is
 * unreadable, and the fan-out is the only reason this is not free.
 *
 * Running and failed jobs are dropped. A failed job has no usable rows, and a running one
 * is still moving - plotting a half-finished run beside completed ones would show a model
 * "getting slower" when the real story is that its GPU pass had not started yet.
 */
export async function benchmarkHistory(signal?: AbortSignal): Promise<ModelBenchmarkRun[]> {
  const runs = await request('/benchmark/results', { schema: ServiceBenchmarkRunList, signal });

  const completed = runs
    .filter((run) => run.status.toLowerCase() === 'completed')
    .sort((a, b) => a.benchmark_job_id - b.benchmark_job_id)
    .slice(-20);

  const detailed = await Promise.all(
    completed.map(async (run) => {
      const results = await request(`/benchmark/results/${run.benchmark_job_id}`, {
        schema: ServiceBenchmarkResults,
        signal,
      });
      return benchmarkRunFromService(results, {
        startedAt: run.created_at,
        finishedAt: run.finished_at,
      });
    }),
  );

  return detailed;
}

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

export async function listEmbeddingModels(signal?: AbortSignal): Promise<EmbeddingModel[]> {
  const dto = await request('/embeddings/models', { schema: ServiceEmbeddingModelList, signal });
  return dto.map(embeddingModelFromService);
}

export function activeEmbeddingModel(signal?: AbortSignal) {
  return request('/embeddings/active', { schema: ServiceActiveEmbeddingModel, signal });
}

/**
 * Switching always queues a full re-embed of the existing corpus (see `latestReindexJob`
 * below) — unlike the answer model, there is no way to switch without one: the old vectors
 * are not merely stale, they live in a different, now-incompatible space.
 */
export function setActiveEmbeddingModel(model: string) {
  return request('/embeddings/active', {
    method: 'POST',
    body: { model },
    schema: ServiceSetActiveEmbeddingModel,
  });
}

// ---------------------------------------------------------------------------
// Re-embedding
// ---------------------------------------------------------------------------

/**
 * The current or most recent re-embed job, assembled from two endpoints the same way
 * `latestBenchmark` joins three: `/embeddings/reindex` lists jobs with their timestamps but
 * no live progress, `/embeddings/reindex/status/{id}` has progress but no timestamps.
 */
export async function latestReindexJob(signal?: AbortSignal): Promise<ReindexJob | null> {
  const runs = await request('/embeddings/reindex', { schema: ServiceReindexRunList, signal });
  if (runs.length === 0) return null;

  const newest = [...runs].sort((a, b) => b.reindex_job_id - a.reindex_job_id)[0];
  if (!newest) return null;

  const status = await request(`/embeddings/reindex/status/${newest.reindex_job_id}`, {
    schema: ServiceReindexStatus,
    signal,
  });
  return reindexJobFromService(status, {
    id: toId(newest.reindex_job_id),
    startedAt: newest.created_at,
    finishedAt: newest.finished_at,
  });
}

// ---------------------------------------------------------------------------
// Embedding benchmark
// ---------------------------------------------------------------------------

/** Starts a run and returns its job id. Loads each embedding model in sequence, on CPU only. */
export async function startEmbeddingBenchmark(models: string[] | null): Promise<string> {
  const dto = await request('/embeddings/benchmark', {
    method: 'POST',
    body: { models },
    schema: ServiceEmbeddingBenchmarkAccepted,
  });
  return toId(dto.embedding_benchmark_job_id);
}

/** The most recent run, assembled the same three-endpoint way as `latestBenchmark`. */
export async function latestEmbeddingBenchmark(
  signal?: AbortSignal,
): Promise<EmbeddingBenchmarkRun | null> {
  const runs = await request('/embeddings/benchmark/results', {
    schema: ServiceEmbeddingBenchmarkRunList,
    signal,
  });
  if (runs.length === 0) return null;

  const newest = [...runs].sort(
    (a, b) => b.embedding_benchmark_job_id - a.embedding_benchmark_job_id,
  )[0];
  if (!newest) return null;

  const results = await request(
    `/embeddings/benchmark/results/${newest.embedding_benchmark_job_id}`,
    {
      schema: ServiceEmbeddingBenchmarkResults,
      signal,
    },
  );

  let status;
  if (newest.status.toLowerCase() === 'running') {
    status = await request(`/embeddings/benchmark/status/${newest.embedding_benchmark_job_id}`, {
      schema: ServiceEmbeddingBenchmarkStatus,
      signal,
    });
  }

  return embeddingBenchmarkRunFromService(results, {
    startedAt: newest.created_at,
    finishedAt: newest.finished_at,
    status,
  });
}

// ---------------------------------------------------------------------------
// RAG evaluation
// ---------------------------------------------------------------------------

export async function ragEvalDatasets(signal?: AbortSignal): Promise<RagEvalDatasetInfo[]> {
  const dto = await request('/rag-eval/datasets', { schema: ServiceRagEvalDatasetList, signal });
  return dto.map(ragEvalDatasetInfoFromService);
}

/** Starts a run against a project's currently-ingested documents and returns its job id. */
export async function startRagEval(projectId: string | null, datasetId: string): Promise<string> {
  const dto = await request('/rag-eval', {
    method: 'POST',
    body: {
      project_id: projectId === null ? null : toServiceId(projectId, 'project'),
      dataset_id: datasetId,
    },
    schema: ServiceRagEvalAccepted,
  });
  return toId(dto.rag_eval_job_id);
}

/** The most recent run, assembled the same three-endpoint way as `latestBenchmark`. */
export async function latestRagEval(signal?: AbortSignal): Promise<RagEvalRun | null> {
  const runs = await request('/rag-eval/results', { schema: ServiceRagEvalRunList, signal });
  if (runs.length === 0) return null;

  const newest = [...runs].sort((a, b) => b.rag_eval_job_id - a.rag_eval_job_id)[0];
  if (!newest) return null;

  const results = await request(`/rag-eval/results/${newest.rag_eval_job_id}`, {
    schema: ServiceRagEvalResults,
    signal,
  });

  let status;
  if (newest.status.toLowerCase() === 'running') {
    status = await request(`/rag-eval/status/${newest.rag_eval_job_id}`, {
      schema: ServiceRagEvalStatus,
      signal,
    });
  }

  return ragEvalRunFromService(results, {
    projectId: newest.project_id === null ? null : toId(newest.project_id),
    startedAt: newest.created_at,
    finishedAt: newest.finished_at,
    status,
  });
}
