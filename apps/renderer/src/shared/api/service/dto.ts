import { z } from 'zod';

/**
 * The RAG service's wire shapes, exactly as FastAPI emits them.
 *
 * This file is deliberately NOT the domain contract. `@localchat/contracts` describes the
 * vocabulary the interface thinks in; this describes what the Python service happens to
 * send today — snake_case keys, integer primary keys, and only the fields it actually has.
 * Every disagreement between the two lives in `map.ts` and nowhere else, so when the
 * service changes there is exactly one file to edit.
 *
 * Parsing through these schemas rather than trusting `any` means a backend change shows up
 * here, at the boundary, with the field name in the error — instead of as an undefined
 * three components deep in a transcript.
 */

/** SQLAlchemy primary keys are integers; the domain uses opaque strings. */
const pk = z.number().int().nonnegative();

/**
 * FastAPI serialises `datetime` without a timezone designator (`2026-09-01T12:30:00`)
 * because the service stores naive UTC. Left as-is here; `map.ts` appends the Z.
 */
const naiveDateTime = z.string().min(1);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const ServiceHealth = z.object({ status: z.string() });

// ---------------------------------------------------------------------------
// Documents — GET/POST/DELETE /docs
// ---------------------------------------------------------------------------

/** Matches src/complexity.py's tiers; shared verbatim between documents and messages. */
export const ServiceComplexityTier = z.enum(['simple', 'moderate', 'complex']);
export type ServiceComplexityTier = z.infer<typeof ServiceComplexityTier>;

export const ServiceDocument = z.object({
  id: pk,
  title: z.string(),
  path: z.string(),
  checksum: z.string(),
  version: z.number().int().positive(),
  project_id: pk.nullable(),
  also_general: z.boolean(),
  uploaded_at: naiveDateTime,
  indexed_at: naiveDateTime.nullable(),
  complexity_tier: ServiceComplexityTier.nullable(),
  complexity_score: z.number().nullable(),
});
export type ServiceDocument = z.infer<typeof ServiceDocument>;

export const ServiceDocumentList = z.array(ServiceDocument);

// ---------------------------------------------------------------------------
// Projects — GET/POST /projects, GET/PATCH/DELETE /projects/{id}
// ---------------------------------------------------------------------------

/**
 * The service knows only a name and its timestamps. Description, folder watching,
 * per-project instructions and index/chat counts all live in `map.ts`'s honest defaults
 * or are computed client-side from documents/conversations — see `projectFromService`.
 */
export const ServiceProject = z.object({
  id: pk,
  name: z.string(),
  created_at: naiveDateTime,
  updated_at: naiveDateTime,
});
export type ServiceProject = z.infer<typeof ServiceProject>;

export const ServiceProjectList = z.array(ServiceProject);

// ---------------------------------------------------------------------------
// Ingestion — POST /ingest, GET /status/{job_id}
// ---------------------------------------------------------------------------

export const ServiceIngestAccepted = z.object({ job_id: pk });

/**
 * `last_checkpoint` is an opaque resume token the pipeline writes; the interface only
 * needs to know whether one exists, never what is in it.
 */
export const ServiceIngestStatus = z.object({
  status: z.string(),
  offset: z.number().int().nonnegative(),
  total_chunks: z.number().int().nonnegative(),
  last_checkpoint: z.record(z.string(), z.unknown()).nullable(),
});
export type ServiceIngestStatus = z.infer<typeof ServiceIngestStatus>;

// ---------------------------------------------------------------------------
// Retrieval — the citation shape shared by /query and /conversations/*/messages
// ---------------------------------------------------------------------------

/**
 * Note what is absent: no document id, and no excerpt. `rag_service.answer()` builds these
 * from the retrieved chunk and keeps only four fields. `map.ts` resolves the id by title
 * where it can and leaves it empty where it cannot; see the note there.
 */
export const ServiceCitation = z.object({
  title: z.string(),
  section: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  score: z.number(),
});
export type ServiceCitation = z.infer<typeof ServiceCitation>;

export const ServiceComplexity = z.object({
  tier: ServiceComplexityTier,
  score: z.number(),
});
export type ServiceComplexity = z.infer<typeof ServiceComplexity>;

export const ServiceAnswer = z.object({
  answer: z.string().nullable(),
  citations: z.array(ServiceCitation),
  not_found: z.boolean(),
  suggestion: z.string().optional(),
  complexity: ServiceComplexity.optional(),
});
export type ServiceAnswer = z.infer<typeof ServiceAnswer>;

// ---------------------------------------------------------------------------
// Conversations — the chat entity
// ---------------------------------------------------------------------------

export const ServiceConversation = z.object({
  id: pk,
  title: z.string().nullable(),
  project_id: pk.nullable(),
  created_at: naiveDateTime,
  updated_at: naiveDateTime,
});
export type ServiceConversation = z.infer<typeof ServiceConversation>;

export const ServiceConversationList = z.array(ServiceConversation);

export const ServiceMessage = z.object({
  id: pk,
  conversation_id: pk,
  role: z.string(),
  text: z.string(),
  citations: z.array(ServiceCitation).nullable(),
  not_found: z.boolean().nullable(),
  complexity_tier: ServiceComplexityTier.nullable(),
  complexity_score: z.number().nullable(),
  created_at: naiveDateTime,
});
export type ServiceMessage = z.infer<typeof ServiceMessage>;

export const ServiceConversationDetail = ServiceConversation.extend({
  messages: z.array(ServiceMessage),
});
export type ServiceConversationDetail = z.infer<typeof ServiceConversationDetail>;

// ---------------------------------------------------------------------------
// Models — GET /models, GET/POST /models/active
// ---------------------------------------------------------------------------

export const ServiceModel = z.object({
  name: z.string(),
  size_bytes: z.number().int().nonnegative(),
  family: z.string(),
});
export type ServiceModel = z.infer<typeof ServiceModel>;

export const ServiceModelList = z.array(ServiceModel);

export const ServiceActiveModel = z.object({
  model: z.string().nullable(),
  device: z.string().nullable(),
  gpu_available: z.boolean(),
});
export type ServiceActiveModel = z.infer<typeof ServiceActiveModel>;

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

export const ServiceBenchmarkAccepted = z.object({ benchmark_job_id: pk });

/** `progress` is pre-formatted by the service ("3 of 6", "starting"), not a number. */
export const ServiceBenchmarkStatus = z.object({
  status: z.string(),
  progress: z.string(),
  current: z.string().nullable(),
});
export type ServiceBenchmarkStatus = z.infer<typeof ServiceBenchmarkStatus>;

export const ServiceBenchmarkRow = z.object({
  model: z.string(),
  device: z.string(),
  device_name: z.string().nullable(),
  status: z.string(),
  detail: z.string().nullable(),
  load_s: z.number().nullable(),
  ttft_s: z.number().nullable(),
  gen_tokens: z.number().int().nullable(),
  tok_s: z.number().nullable(),
  total_s: z.number().nullable(),
  peak_mem_mb: z.number().nullable(),
  peak_vram_mb: z.number().nullable(),
  /*
   * The service has sent these since the benchmark grew a prompt set; zod strips unknown
   * keys silently, so until they were declared here they arrived and were thrown away.
   */
  question: z.string().nullable().default(null),
  prompt_label: z.string().nullable().default(null),
  complexity_tier: ServiceComplexityTier.nullable().default(null),
  complexity_score: z.number().nullable().default(null),
  run_at: naiveDateTime,
});
export type ServiceBenchmarkRow = z.infer<typeof ServiceBenchmarkRow>;

export const ServiceBenchmarkResults = z.object({
  benchmark_job_id: pk,
  status: z.string(),
  results: z.array(ServiceBenchmarkRow),
});
export type ServiceBenchmarkResults = z.infer<typeof ServiceBenchmarkResults>;

export const ServiceBenchmarkRunList = z.array(
  z.object({
    benchmark_job_id: pk,
    status: z.string(),
    devices: z.array(z.string()),
    models: z.array(z.string()).nullable(),
    created_at: naiveDateTime,
    finished_at: naiveDateTime.nullable(),
  }),
);

// ---------------------------------------------------------------------------
// Embedding models — GET /embeddings/models, GET/POST /embeddings/active
// ---------------------------------------------------------------------------

export const ServiceEmbeddingModel = z.object({
  name: z.string(),
  dimension: z.number().int().positive(),
  description: z.string(),
});
export type ServiceEmbeddingModel = z.infer<typeof ServiceEmbeddingModel>;

export const ServiceEmbeddingModelList = z.array(ServiceEmbeddingModel);

export const ServiceActiveEmbeddingModel = z.object({
  model: z.string(),
  dimension: z.number().int().positive(),
});
export type ServiceActiveEmbeddingModel = z.infer<typeof ServiceActiveEmbeddingModel>;

/** A model switch always queues a re-embed job, hence the id alongside the new active model. */
export const ServiceSetActiveEmbeddingModel = ServiceActiveEmbeddingModel.extend({
  reindex_job_id: pk,
});
export type ServiceSetActiveEmbeddingModel = z.infer<typeof ServiceSetActiveEmbeddingModel>;

// ---------------------------------------------------------------------------
// Re-embedding — GET /embeddings/reindex/status/{id}, GET /embeddings/reindex
// ---------------------------------------------------------------------------

export const ServiceReindexStatus = z.object({
  status: z.string(),
  model: z.string(),
  progress: z.string(),
  current_document: z.string().nullable(),
});
export type ServiceReindexStatus = z.infer<typeof ServiceReindexStatus>;

export const ServiceReindexRunList = z.array(
  z.object({
    reindex_job_id: pk,
    status: z.string(),
    model: z.string(),
    created_at: naiveDateTime,
    finished_at: naiveDateTime.nullable(),
  }),
);
export type ServiceReindexRunList = z.infer<typeof ServiceReindexRunList>;

// ---------------------------------------------------------------------------
// Embedding benchmark — mirrors the model benchmark shapes above
// ---------------------------------------------------------------------------

export const ServiceEmbeddingBenchmarkAccepted = z.object({ embedding_benchmark_job_id: pk });

export const ServiceEmbeddingBenchmarkStatus = z.object({
  status: z.string(),
  progress: z.string(),
  current: z.string().nullable(),
});
export type ServiceEmbeddingBenchmarkStatus = z.infer<typeof ServiceEmbeddingBenchmarkStatus>;

export const ServiceEmbeddingBenchmarkRow = z.object({
  model: z.string(),
  dimension: z.number().int().nullable(),
  status: z.string(),
  detail: z.string().nullable(),
  load_s: z.number().nullable(),
  text_label: z.string().nullable(),
  text_count: z.number().int().nullable(),
  embed_s: z.number().nullable(),
  texts_per_s: z.number().nullable(),
  peak_mem_mb: z.number().nullable(),
  run_at: naiveDateTime,
});
export type ServiceEmbeddingBenchmarkRow = z.infer<typeof ServiceEmbeddingBenchmarkRow>;

export const ServiceEmbeddingBenchmarkResults = z.object({
  embedding_benchmark_job_id: pk,
  status: z.string(),
  results: z.array(ServiceEmbeddingBenchmarkRow),
});
export type ServiceEmbeddingBenchmarkResults = z.infer<typeof ServiceEmbeddingBenchmarkResults>;

export const ServiceEmbeddingBenchmarkRunList = z.array(
  z.object({
    embedding_benchmark_job_id: pk,
    status: z.string(),
    models: z.array(z.string()).nullable(),
    created_at: naiveDateTime,
    finished_at: naiveDateTime.nullable(),
  }),
);

// ---------------------------------------------------------------------------
// RAG evaluation — GET /rag-eval/datasets, POST /rag-eval, GET /rag-eval/status/{id},
// GET /rag-eval/results, GET /rag-eval/results/{id}
// ---------------------------------------------------------------------------

export const ServiceRagEvalDatasetInfo = z.object({
  id: z.string(),
  documents: z.array(
    z.object({
      source: z.string(),
      title_hint: z.string(),
      question_count: z.number().int().nonnegative(),
    }),
  ),
  total_questions: z.number().int().nonnegative(),
});
export type ServiceRagEvalDatasetInfo = z.infer<typeof ServiceRagEvalDatasetInfo>;

export const ServiceRagEvalDatasetList = z.array(ServiceRagEvalDatasetInfo);
export type ServiceRagEvalDatasetList = z.infer<typeof ServiceRagEvalDatasetList>;

export const ServiceRagEvalAccepted = z.object({ rag_eval_job_id: pk });

export const ServiceRagEvalStatus = z.object({
  status: z.string(),
  dataset_id: z.string(),
  progress: z.string(),
  current_question: z.string().nullable(),
});
export type ServiceRagEvalStatus = z.infer<typeof ServiceRagEvalStatus>;

export const ServiceRagEvalCitation = z.object({
  title: z.string(),
  section: z.string().nullable(),
  page: z.number().int().nullable(),
  score: z.number(),
});

export const ServiceRagEvalRow = z.object({
  source: z.string(),
  difficulty: z.string(),
  question: z.string(),
  expected_answer: z.string(),
  actual_answer: z.string().nullable(),
  not_found: z.boolean(),
  retrieval_hit: z.boolean(),
  judge_verdict: z.string().nullable(),
  judge_detail: z.string().nullable(),
  complexity_tier: z.string().nullable(),
  complexity_score: z.number().nullable(),
  latency_s: z.number().nullable(),
  citations: z.array(ServiceRagEvalCitation).nullable(),
  run_at: naiveDateTime,
});
export type ServiceRagEvalRow = z.infer<typeof ServiceRagEvalRow>;

export const ServiceRagEvalBucket = z.object({
  total: z.number().int().nonnegative(),
  retrieval_hit_rate: z.number().nullable(),
  judge_counts: z.record(z.string(), z.number().int().nonnegative()),
});

export const ServiceRagEvalSummary = ServiceRagEvalBucket.extend({
  by_difficulty: z.record(z.string(), ServiceRagEvalBucket),
});
export type ServiceRagEvalSummary = z.infer<typeof ServiceRagEvalSummary>;

export const ServiceRagEvalResults = z.object({
  rag_eval_job_id: pk,
  status: z.string(),
  dataset_id: z.string(),
  summary: ServiceRagEvalSummary,
  results: z.array(ServiceRagEvalRow),
});
export type ServiceRagEvalResults = z.infer<typeof ServiceRagEvalResults>;

export const ServiceRagEvalRunList = z.array(
  z.object({
    rag_eval_job_id: pk,
    status: z.string(),
    dataset_id: z.string(),
    project_id: pk.nullable(),
    created_at: naiveDateTime,
    finished_at: naiveDateTime.nullable(),
  }),
);
export type ServiceRagEvalRunList = z.infer<typeof ServiceRagEvalRunList>;
