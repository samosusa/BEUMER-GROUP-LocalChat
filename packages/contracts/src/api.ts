import { z } from 'zod';
import {
  ApprovedToolSchema,
  ComputeMode,
  ModelBenchmarkRunSchema,
  ChatSchema,
  CitationSchema,
  DocumentSchema,
  EmbeddingBenchmarkRunSchema,
  EmbeddingModelSchema,
  FigureSchema,
  IndexStatsSchema,
  MessageSchema,
  ModelSchema,
  ProjectSchema,
  RagEvalDatasetInfoSchema,
  RagEvalRunSchema,
  ReindexJobSchema,
  RetrievalScope,
  SettingsSchema,
  ToolCallSchema,
} from './domain.js';

/**
 * Request and response shapes for the local RAG service.
 *
 * The service is expected to listen on 127.0.0.1 only. There is no authentication because
 * there is no remote caller: binding to loopback and OS file permissions are the boundary.
 */

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  /** False while the model file is still being read into memory. */
  modelLoaded: z.boolean(),
  /** True when strict offline mode is engaged. Mirrors Settings for cheap polling. */
  offline: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const ListProjectsResponse = z.object({ projects: z.array(ProjectSchema) });
export type ListProjectsResponse = z.infer<typeof ListProjectsResponse>;

export const CreateProjectRequest = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  folderPath: z.string().nullable().default(null),
  instructions: z.string().max(4000).default(''),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = CreateProjectRequest.partial();
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const ProjectResponse = z.object({ project: ProjectSchema });
export type ProjectResponse = z.infer<typeof ProjectResponse>;

export const ListDocumentsResponse = z.object({
  documents: z.array(DocumentSchema),
  stats: IndexStatsSchema,
});
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponse>;

export const ListApprovedToolsResponse = z.object({ tools: z.array(ApprovedToolSchema) });
export type ListApprovedToolsResponse = z.infer<typeof ListApprovedToolsResponse>;

// ---------------------------------------------------------------------------
// Documents / ingestion
// ---------------------------------------------------------------------------

/**
 * Ingestion is asynchronous. The client posts paths and polls (or subscribes to) document
 * status; it never blocks on a 200-page manual.
 */
export const IngestDocumentsRequest = z.object({
  projectId: z.string().nullable(),
  /** Absolute paths on the engineer's machine, resolved by the desktop shell. */
  paths: z.array(z.string().min(1)).min(1),
  /** Also surface these documents in the general corpus. Meaningless when projectId is null. */
  alsoGeneral: z.boolean().default(false),
});
export type IngestDocumentsRequest = z.infer<typeof IngestDocumentsRequest>;

export const IngestDocumentsResponse = z.object({
  accepted: z.array(DocumentSchema),
  /** Files the service will not ingest, with the reason to show the engineer. */
  rejected: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type IngestDocumentsResponse = z.infer<typeof IngestDocumentsResponse>;

export const ReindexRequest = z.object({
  projectId: z.string().nullable(),
  /** Reindex everything rather than only files whose mtime changed. */
  full: z.boolean().default(false),
});
export type ReindexRequest = z.infer<typeof ReindexRequest>;

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export const ListChatsQuery = z.object({
  projectId: z.string().nullable().optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});
export type ListChatsQuery = z.infer<typeof ListChatsQuery>;

export const ListChatsResponse = z.object({ chats: z.array(ChatSchema) });
export type ListChatsResponse = z.infer<typeof ListChatsResponse>;

export const CreateChatRequest = z.object({
  projectId: z.string().nullable(),
  scope: RetrievalScope,
  attachmentIds: z.array(z.string()).default([]),
});
export type CreateChatRequest = z.infer<typeof CreateChatRequest>;

export const ChatResponse = z.object({ chat: ChatSchema });
export type ChatResponse = z.infer<typeof ChatResponse>;

export const ListMessagesResponse = z.object({ messages: z.array(MessageSchema) });
export type ListMessagesResponse = z.infer<typeof ListMessagesResponse>;

export const UpdateChatContextRequest = z.object({
  scope: RetrievalScope.optional(),
  attachmentIds: z.array(z.string()).optional(),
});
export type UpdateChatContextRequest = z.infer<typeof UpdateChatContextRequest>;

export const AskRequest = z.object({
  question: z.string().min(1).max(8000),
  scope: RetrievalScope,
  attachmentIds: z.array(z.string()).default([]),
});
export type AskRequest = z.infer<typeof AskRequest>;

// ---------------------------------------------------------------------------
// Answer stream
// ---------------------------------------------------------------------------

/**
 * `POST /api/chats/{id}/ask` responds with `text/event-stream`.
 *
 * Retrieval finishes before generation starts, so the client can show which documents are
 * being read while the first token is still seconds away — the difference between a UI that
 * feels stalled and one that feels like it is working.
 */
export const AnswerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted'), messageId: z.string(), chatId: z.string() }),
  z.object({
    type: z.literal('retrieval'),
    citations: z.array(CitationSchema),
    elapsedMs: z.number(),
  }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('figure'), figure: FigureSchema }),
  z.object({ type: z.literal('tool'), toolCall: ToolCallSchema }),
  z.object({ type: z.literal('done'), message: MessageSchema }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AnswerEvent = z.infer<typeof AnswerEvent>;

// ---------------------------------------------------------------------------
// Settings, models, benchmark
// ---------------------------------------------------------------------------

export const SettingsResponse = z.object({ settings: SettingsSchema });
export type SettingsResponse = z.infer<typeof SettingsResponse>;

export const UpdateSettingsRequest = SettingsSchema.partial().omit({ hardware: true });
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

export const ListModelsResponse = z.object({ models: z.array(ModelSchema) });
export type ListModelsResponse = z.infer<typeof ListModelsResponse>;

export const BenchmarkResponse = z.object({ run: ModelBenchmarkRunSchema.nullable() });
export type BenchmarkResponse = z.infer<typeof BenchmarkResponse>;

/**
 * Past runs, oldest first, so speed can be read as a trend rather than a single figure.
 *
 * A separate endpoint from `BenchmarkResponse` on purpose: the newest run is polled every
 * few seconds while a job is in flight, and the history is not - it only changes when a run
 * finishes.
 */
export const BenchmarkHistoryResponse = z.object({ runs: z.array(ModelBenchmarkRunSchema) });
export type BenchmarkHistoryResponse = z.infer<typeof BenchmarkHistoryResponse>;

export const RunBenchmarkRequest = z.object({
  /** Devices to benchmark on. Asking for `gpu` without one is refused by the service. */
  devices: z.array(ComputeMode).min(1),
  /** Omit to benchmark every installed model. */
  models: z.array(z.string()).nullable().default(null),
});
export type RunBenchmarkRequest = z.infer<typeof RunBenchmarkRequest>;

// ---------------------------------------------------------------------------
// Embedding models, re-embedding, embedding benchmark
// ---------------------------------------------------------------------------

export const ListEmbeddingModelsResponse = z.object({
  embeddingModels: z.array(EmbeddingModelSchema),
});
export type ListEmbeddingModelsResponse = z.infer<typeof ListEmbeddingModelsResponse>;

export const ActiveEmbeddingModelResponse = z.object({
  model: z.string(),
  dimension: z.number().int().positive(),
});
export type ActiveEmbeddingModelResponse = z.infer<typeof ActiveEmbeddingModelResponse>;

export const SetActiveEmbeddingModelRequest = z.object({ model: z.string() });
export type SetActiveEmbeddingModelRequest = z.infer<typeof SetActiveEmbeddingModelRequest>;

/** A model switch always queues a re-embed; the job id lets the caller poll its progress. */
export const SetActiveEmbeddingModelResponse = ActiveEmbeddingModelResponse.extend({
  reindexJobId: z.string(),
});
export type SetActiveEmbeddingModelResponse = z.infer<typeof SetActiveEmbeddingModelResponse>;

export const ReindexJobResponse = z.object({ job: ReindexJobSchema.nullable() });
export type ReindexJobResponse = z.infer<typeof ReindexJobResponse>;

export const EmbeddingBenchmarkResponse = z.object({ run: EmbeddingBenchmarkRunSchema.nullable() });
export type EmbeddingBenchmarkResponse = z.infer<typeof EmbeddingBenchmarkResponse>;

/** Past embedding-benchmark runs, oldest first — mirrors `BenchmarkHistoryResponse`. */
export const EmbeddingBenchmarkHistoryResponse = z.object({
  runs: z.array(EmbeddingBenchmarkRunSchema),
});
export type EmbeddingBenchmarkHistoryResponse = z.infer<typeof EmbeddingBenchmarkHistoryResponse>;

export const RunEmbeddingBenchmarkRequest = z.object({
  /** Omit to benchmark every embedding model the service offers. */
  models: z.array(z.string()).nullable().default(null),
});
export type RunEmbeddingBenchmarkRequest = z.infer<typeof RunEmbeddingBenchmarkRequest>;

// ---------------------------------------------------------------------------
// RAG evaluation
// ---------------------------------------------------------------------------

export const RagEvalDatasetsResponse = z.array(RagEvalDatasetInfoSchema);
export type RagEvalDatasetsResponse = z.infer<typeof RagEvalDatasetsResponse>;

export const StartRagEvalRequest = z.object({
  projectId: z.string().nullable(),
  /** Matches the service's own default (src/rag_eval.py DEFAULT_DATASET_ID). */
  datasetId: z.string().default('rag_qa_pairs'),
});
export type StartRagEvalRequest = z.infer<typeof StartRagEvalRequest>;

export const RagEvalRunResponse = z.object({ run: RagEvalRunSchema.nullable() });
export type RagEvalRunResponse = z.infer<typeof RagEvalRunResponse>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ApiErrorBody = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** Route table, so the client and the mock server cannot drift apart on a path string. */
export const routes = {
  health: () => '/health',
  projects: () => '/api/projects',
  project: (id: string) => `/api/projects/${id}`,
  projectDocuments: (id: string) => `/api/projects/${id}/documents`,
  projectTools: (id: string) => `/api/projects/${id}/tools`,
  documents: () => '/api/documents',
  document: (id: string) => `/api/documents/${id}`,
  ingest: () => '/api/documents/ingest',
  reindex: () => '/api/index/reindex',
  indexStats: () => '/api/index/stats',
  chats: () => '/api/chats',
  chat: (id: string) => `/api/chats/${id}`,
  chatMessages: (id: string) => `/api/chats/${id}/messages`,
  chatContext: (id: string) => `/api/chats/${id}/context`,
  ask: (id: string) => `/api/chats/${id}/ask`,
  settings: () => '/api/settings',
  models: () => '/api/models',
  benchmark: () => '/api/benchmark',
  benchmarkHistory: () => '/api/benchmark/history',
  embeddingModels: () => '/api/embeddings/models',
  activeEmbeddingModel: () => '/api/embeddings/active',
  /** The current or most recent re-embed job — there is at most one meaningful at a time. */
  reindexJob: () => '/api/embeddings/reindex',
  embeddingBenchmark: () => '/api/embeddings/benchmark',
  embeddingBenchmarkHistory: () => '/api/embeddings/benchmark/history',
  ragEvalDatasets: () => '/api/rag-eval/datasets',
  /** The current or most recent evaluation run - there is at most one meaningful at a time. */
  ragEval: () => '/api/rag-eval',
} as const;
