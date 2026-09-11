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
