import { z } from 'zod';
import type { Chat, Document, HealthResponse, Message, Model } from '@localchat/contracts';
import { request } from '../http';
import {
  ServiceActiveModel,
  ServiceBenchmarkAccepted,
  ServiceConversationDetail,
  ServiceConversationList,
  ServiceDocumentList,
  ServiceHealth,
  ServiceIngestAccepted,
  ServiceIngestStatus,
  ServiceMessage,
  ServiceModelList,
} from './dto';
import {
  chatDetailFromService,
  chatFromService,
  createDocumentIndex,
  documentFromService,
  ingestionProgressFromService,
  ingestionStatusFromService,
  messageFromService,
  modelFromService,
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
 * Ingestion is a multipart upload followed by polling, so this returns the job id rather
 * than a document: the row does not exist until the pipeline has finished chunking it.
 */
export async function startIngestion(file: File, title: string): Promise<string> {
  const form = new FormData();
  form.set('file', file, file.name);
  form.set('title', title);
  form.set('project', 'false');
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

export async function createChat(title?: string): Promise<Chat> {
  const dto = await request('/conversations', {
    method: 'POST',
    body: { title: title ?? null },
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
 */
export async function postMessage(chatId: string, question: string): Promise<Message> {
  const dto = await request(`/conversations/${toServiceId(chatId, 'conversation')}/messages`, {
    method: 'POST',
    body: { q: question },
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
// Benchmark — deliberately not mapped; see docs/backend-wiring.md
// ---------------------------------------------------------------------------

/**
 * Kicks off a run. Results are NOT translated into `BenchmarkRun`: the service measures
 * generation throughput per model and device (load time, time to first token, tokens per
 * second), while the domain type describes answer quality over a fixed question set
 * (median and p95 answer latency, share of answers carrying a citation). Neither is
 * derivable from the other, and mapping `total_s` onto `medianAnswerMs` would put a
 * fabricated number in a report. The benchmark screen stays on fixtures until the team
 * agrees which measurement the product actually reports.
 */
export function startBenchmark(devices: Array<'cpu' | 'gpu'>, models?: string[]) {
  return request('/benchmark', {
    method: 'POST',
    body: { devices, models: models ?? null },
    schema: ServiceBenchmarkAccepted,
  });
}
