import { z } from 'zod';

/**
 * Domain vocabulary for BEUMER LocalChat.
 *
 * These schemas are the single source of truth shared by the desktop client and the
 * local RAG service. Every response crossing the HTTP boundary is parsed through them,
 * so a backend change that breaks the contract fails loudly at the edge rather than
 * silently rendering wrong data in front of an engineer on a customer site.
 *
 * Timestamps are ISO-8601 strings in UTC. They stay strings across the boundary and are
 * converted to Date objects only at the point of formatting.
 */

const isoDateTime = z.string().min(1).describe('ISO-8601 timestamp, UTC');

// ---------------------------------------------------------------------------
// Retrieval scope
// ---------------------------------------------------------------------------

/**
 * What the retriever is allowed to search. Requirement: an engineer must be able to
 * change this from inside the chat in at most two clicks.
 */
export const RetrievalScope = z.enum(['general', 'project', 'both']);
export type RetrievalScope = z.infer<typeof RetrievalScope>;

// ---------------------------------------------------------------------------
// Complexity
// ---------------------------------------------------------------------------

/**
 * Shared by documents (readability of the parsed text, computed once at ingest) and
 * assistant messages (difficulty of the question that produced the turn). Both are cheap
 * offline heuristics on the service side, not a model judgment - treat as a rough signal.
 */
export const ComplexityTier = z.enum(['simple', 'moderate', 'complex']);
export type ComplexityTier = z.infer<typeof ComplexityTier>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DocumentFormat = z.enum(['pdf', 'docx', 'markdown', 'text', 'image']);
export type DocumentFormat = z.infer<typeof DocumentFormat>;

/**
 * Lifecycle of a document inside the index.
 *
 * `no_text_layer` is deliberately its own state rather than an error: a scanned as-built
 * drawing is a legitimate file that simply cannot be retrieved from until it is OCR'd,
 * and the engineer needs to see that distinction.
 */
export const IngestionStatus = z.enum([
  'pending',
  'indexing',
  'indexed',
  'superseded',
  'no_text_layer',
  'unsupported',
  'failed',
]);
export type IngestionStatus = z.infer<typeof IngestionStatus>;

export const DocumentSchema = z.object({
  id: z.string(),
  /** Null means the document belongs to the company-wide ("general") corpus. */
  projectId: z.string().nullable(),
  /** True surfaces a project-scoped document in the general corpus too, without a second copy. */
  alsoGeneral: z.boolean(),
  filename: z.string(),
  title: z.string(),
  format: DocumentFormat,
  /** Engineering revision as printed on the document, e.g. "rev D". Null when unversioned. */
  revision: z.string().nullable(),
  /** Revision this document replaced, when a newer version was ingested. */
  supersedes: z.string().nullable(),
  chunkCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: IngestionStatus,
  /** 0..1, present while `status` is `indexing`. */
  progress: z.number().min(0).max(1).nullable(),
  /** Page the ingestion checkpoint reached, so an interrupted run can resume. */
  resumeFromPage: z.number().int().nonnegative().nullable(),
  documentDate: isoDateTime.nullable(),
  indexedAt: isoDateTime.nullable(),
  /** True when the file changed on disk after it was last indexed. */
  stale: z.boolean(),
  /** Readability of the parsed text; null until ingestion has produced chunks. */
  complexityTier: ComplexityTier.nullable(),
  /** Approximate Flesch-Kincaid grade level backing `complexityTier`. */
  complexityScore: z.number().nullable(),
});
export type Document = z.infer<typeof DocumentSchema>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const ProjectIndexState = z.enum(['empty', 'indexing', 'ready', 'stale', 'failed']);
export type ProjectIndexState = z.infer<typeof ProjectIndexState>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  /** Absolute path on the engineer's machine that this project watches. */
  folderPath: z.string().nullable(),
  watched: z.boolean(),
  /** Free-text instructions applied to every chat in the project. */
  instructions: z.string(),
  documentCount: z.number().int().nonnegative(),
  chatCount: z.number().int().nonnegative(),
  indexState: ProjectIndexState,
  indexProgress: z.number().min(0).max(1).nullable(),
  /** Seconds remaining on the running ingestion job, when one is running. */
  indexEtaSeconds: z.number().int().nonnegative().nullable(),
  lastOpenedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type Project = z.infer<typeof ProjectSchema>;

export const IndexStatsSchema = z.object({
  projectId: z.string().nullable(),
  chunkCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  embeddingModel: z.string(),
  indexSizeBytes: z.number().int().nonnegative(),
  lastRebuiltAt: isoDateTime.nullable(),
  /** Documents whose file on disk is newer than the indexed copy. */
  staleDocumentCount: z.number().int().nonnegative(),
});
export type IndexStats = z.infer<typeof IndexStatsSchema>;

// ---------------------------------------------------------------------------
// Answers: citations, figures, tool calls
// ---------------------------------------------------------------------------

/**
 * A citation is the product's core promise. Every factual claim carries one, and it must
 * carry enough to find the passage on paper: document, section, page and revision.
 */
export const CitationSchema = z.object({
  /** 1-based marker as rendered in the answer body: [1], [2]... */
  marker: z.number().int().positive(),
  documentId: z.string(),
  documentTitle: z.string(),
  section: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  revision: z.string().nullable(),
  documentDate: isoDateTime.nullable(),
  /** Verbatim passage the answer drew on, for the "show me the source text" affordance. */
  excerpt: z.string().nullable(),
  /** Retriever score, surfaced only in developer/benchmark views. */
  score: z.number().nullable(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const FigureSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  /** Figure number as printed, e.g. "Fig. 3.4". */
  label: z.string().nullable(),
  caption: z.string(),
  /** Model-generated explanation of what the diagram shows, grounded in surrounding text. */
  description: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  /** Served by the local service; never a remote URL. */
  thumbnailUrl: z.string(),
});
export type Figure = z.infer<typeof FigureSchema>;

/**
 * Output of an approved MCP tool. Kept structurally separate from citations so the UI can
 * never present a tool value as if it were a document citation.
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  argumentsPreview: z.string(),
  result: z.string(),
  /** Set when the value is generic rather than project-specific. */
  caveat: z.string().nullable(),
  status: z.enum(['ok', 'failed', 'denied']),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const MessageRole = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRole>;

/**
 * Why an assistant turn produced no grounded answer. `null` means it did.
 * These are distinct because the recovery advice differs for each.
 */
export const NoEvidenceReason = z.enum(['nothing_retrieved', 'below_threshold', 'out_of_scope']);
export type NoEvidenceReason = z.infer<typeof NoEvidenceReason>;

/**
 * How long a turn took.
 *
 * `totalMs` is the round trip and is always measurable by the client, so it is required.
 * The split is not: the service reports neither a retrieval nor a generation time today,
 * and dividing a round trip into two plausible halves would put a fabricated number beside
 * a real one. When the service starts reporting them, these fill in and the same readout
 * shows the breakdown.
 */
export const AnswerTimingsSchema = z.object({
  totalMs: z.number().int().nonnegative(),
  retrievalMs: z.number().int().nonnegative().nullable(),
  generationMs: z.number().int().nonnegative().nullable(),
});
export type AnswerTimings = z.infer<typeof AnswerTimingsSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: MessageRole,
  /** Markdown-subset body. Citation markers appear inline as [1], [2]... */
  content: z.string(),
  createdAt: isoDateTime,
  citations: z.array(CitationSchema),
  figures: z.array(FigureSchema),
  toolCalls: z.array(ToolCallSchema),
  noEvidence: NoEvidenceReason.nullable(),
  /** Actions offered when no evidence was found, e.g. widen the scope. */
  suggestions: z.array(z.string()),
  timings: AnswerTimingsSchema.nullable(),
  /** Scope and model this turn actually ran under, so an old answer stays interpretable. */
  scope: RetrievalScope.nullable(),
  modelId: z.string().nullable(),
  /** How hard the user's question was judged to be; set on assistant turns only. */
  complexityTier: ComplexityTier.nullable(),
  complexityScore: z.number().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export const ChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  scope: RetrievalScope,
  /** Documents pinned to this chat only, over and above the project corpus. */
  attachmentIds: z.array(z.string()),
  messageCount: z.number().int().nonnegative(),
  /** First line of the latest assistant answer, for list previews. */
  preview: z.string(),
  sourceCount: z.number().int().nonnegative(),
  hadNoEvidence: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Chat = z.infer<typeof ChatSchema>;

// ---------------------------------------------------------------------------
// Models, hardware and settings
// ---------------------------------------------------------------------------

export const ComputeMode = z.enum(['cpu', 'gpu']);
export type ComputeMode = z.infer<typeof ComputeMode>;

/**
 * An embedding model the service can index and search with. Distinct from `ModelSchema`
 * (the answer-generation model): swapping this one does not just change what answers a
 * question, it changes the vector space every document's chunks are stored in.
 */
export const EmbeddingModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  dimension: z.number().int().positive(),
  description: z.string(),
});
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;

export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantization: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Null when the source cannot report it without loading the model. */
  contextTokens: z.number().int().positive().nullable(),
  /** One line on what this model is good for, shown next to the choice. */
  note: z.string(),
  /** Median end-to-end answer latency measured on this machine, in ms. Null if never run. */
  medianLatencyMs: z.number().int().nonnegative().nullable(),
  installed: z.boolean(),
});
export type Model = z.infer<typeof ModelSchema>;

export const HardwareSchema = z.object({
  cpuThreads: z.number().int().positive(),
  gpuName: z.string().nullable(),
  gpuMemoryBytes: z.number().int().nonnegative().nullable(),
  gpuMemoryUsedBytes: z.number().int().nonnegative().nullable(),
  gpuLayersOffloaded: z.number().int().nonnegative().nullable(),
  gpuLayersTotal: z.number().int().nonnegative().nullable(),
});
export type Hardware = z.infer<typeof HardwareSchema>;

export const RetrievalSettingsSchema = z.object({
  topK: z.number().int().positive().max(50),
  /** Conversational turns kept for follow-up questions. */
  historyTurns: z.number().int().nonnegative().max(20),
  /** Minimum retriever score below which the answer is refused as unsupported. */
  minScore: z.number().min(0).max(1),
});
export type RetrievalSettings = z.infer<typeof RetrievalSettingsSchema>;

export const SettingsSchema = z.object({
  activeModelId: z.string(),
  embeddingModel: z.string(),
  compute: ComputeMode,
  hardware: HardwareSchema,
  retrieval: RetrievalSettingsSchema,
  /** Blocks every outbound request, approved MCP tools included. */
  strictOffline: z.boolean(),
  outboundRequestsThisSession: z.number().int().nonnegative(),
  theme: z.enum(['dark', 'light', 'system']),
  launchOnStartup: z.boolean(),
  quickAskHotkey: z.string(),
  indexLocation: z.string(),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ---------------------------------------------------------------------------
// Model benchmark
// ---------------------------------------------------------------------------

/**
 * Comparing local models on this machine — NOT an evaluation of retrieval quality.
 *
 * The service loads each GGUF onto each device and times generation against one fixed
 * prompt with the context supplied inline; it never touches the index, the corpus or the
 * retriever. So these numbers answer "which model can this laptop actually run, and how
 * fast does it produce tokens", which is what decides the model we ship. They say nothing
 * about whether an answer was correct or whether the right passage was found.
 *
 * A retrieval evaluation — answers carrying a citation, whether the expected document was
 * retrieved, latency over a real question set — is a separate measurement over a fixed
 * question set, and nothing here should be read as a substitute for it.
 */

export const BenchmarkRowStatus = z.enum(['ok', 'failed', 'skipped']);
export type BenchmarkRowStatus = z.infer<typeof BenchmarkRowStatus>;

export const ModelBenchmarkRowSchema = z.object({
  /** GGUF filename, matching `Model.id`. */
  modelId: z.string(),
  modelName: z.string(),
  compute: ComputeMode,
  /** CPU or GPU as the machine names it, e.g. "Apple M2 Pro". */
  deviceName: z.string().nullable(),
  status: BenchmarkRowStatus,
  /** Why a row is not `ok` — no CUDA build, out of memory on load. */
  detail: z.string().nullable(),
  /** Every timing null when the run for this combination did not complete. */
  loadMs: z.number().nonnegative().nullable(),
  timeToFirstTokenMs: z.number().nonnegative().nullable(),
  generatedTokens: z.number().int().nonnegative().nullable(),
  tokensPerSecond: z.number().nonnegative().nullable(),
  totalMs: z.number().nonnegative().nullable(),
  peakMemoryBytes: z.number().nonnegative().nullable(),
  /** GPU rows only. */
  peakVramBytes: z.number().nonnegative().nullable(),
  ranAt: isoDateTime,
});
export type ModelBenchmarkRow = z.infer<typeof ModelBenchmarkRowSchema>;

export const BenchmarkJobStatus = z.enum(['running', 'completed', 'failed']);
export type BenchmarkJobStatus = z.infer<typeof BenchmarkJobStatus>;

export const ModelBenchmarkRunSchema = z.object({
  id: z.string(),
  status: BenchmarkJobStatus,
  /**
   * Progress as the service words it, e.g. "3 of 6" or "starting".
   *
   * Rendered verbatim rather than parsed: the service formats this string itself, and
   * splitting it apart to drive a progress bar would break silently the first time the
   * wording changed. Numeric counts would be a small ask on the service side.
   */
  progress: z.string().nullable(),
  /** Which model and device is loading right now, while the job runs. */
  current: z.string().nullable(),
  rows: z.array(ModelBenchmarkRowSchema),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type ModelBenchmarkRun = z.infer<typeof ModelBenchmarkRunSchema>;

// ---------------------------------------------------------------------------
// Embedding model switching and re-embedding
// ---------------------------------------------------------------------------

export const ReindexJobStatus = z.enum(['running', 'completed', 'failed']);
export type ReindexJobStatus = z.infer<typeof ReindexJobStatus>;

/**
 * Switching the embedding model is not a pure settings change: every document already
 * indexed under the previous model has vectors in a now-incompatible space, so a switch
 * always queues this job to re-embed the existing corpus with the newly active model before
 * search results can be trusted again.
 */
export const ReindexJobSchema = z.object({
  id: z.string(),
  status: ReindexJobStatus,
  /** The embedding model this job is re-embedding the corpus into. */
  model: z.string(),
  /** Progress as the service words it, e.g. "3 of 12" or "starting". */
  progress: z.string().nullable(),
  /** Title of the document currently being re-embedded, while the job runs. */
  currentDocument: z.string().nullable(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type ReindexJob = z.infer<typeof ReindexJobSchema>;

// ---------------------------------------------------------------------------
// Embedding model benchmark
// ---------------------------------------------------------------------------

/**
 * Measures embedding throughput, not retrieval quality — the same caveat as
 * `ModelBenchmarkRunSchema`, applied to the embedder instead of the answer model.
 */
export const EmbeddingBenchmarkRowSchema = z.object({
  model: z.string(),
  dimension: z.number().int().positive().nullable(),
  status: BenchmarkRowStatus,
  detail: z.string().nullable(),
  loadMs: z.number().nonnegative().nullable(),
  /** Which fixed sample tier this row measured: "short", "medium" or "long" text. */
  textLabel: z.string().nullable(),
  textCount: z.number().int().nonnegative().nullable(),
  embedMs: z.number().nonnegative().nullable(),
  textsPerSecond: z.number().nonnegative().nullable(),
  peakMemoryBytes: z.number().nonnegative().nullable(),
  ranAt: isoDateTime,
});
export type EmbeddingBenchmarkRow = z.infer<typeof EmbeddingBenchmarkRowSchema>;

export const EmbeddingBenchmarkRunSchema = z.object({
  id: z.string(),
  status: BenchmarkJobStatus,
  progress: z.string().nullable(),
  current: z.string().nullable(),
  rows: z.array(EmbeddingBenchmarkRowSchema),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type EmbeddingBenchmarkRun = z.infer<typeof EmbeddingBenchmarkRunSchema>;

// ---------------------------------------------------------------------------
// RAG evaluation - a labeled question set run end to end against real, ingested documents
// ---------------------------------------------------------------------------

/**
 * The difficulty a question was hand-labeled with when the question set was written -
 * distinct from `ComplexityTier`, which the service measures automatically from the
 * question text at answer time. The two often agree but are not the same signal.
 */
export const RagEvalDifficulty = z.enum(['easy', 'medium', 'hard']);
export type RagEvalDifficulty = z.infer<typeof RagEvalDifficulty>;

/**
 * `correct`/`partial`/`incorrect` come from an LLM-as-judge comparing the generated answer
 * against the reference answer - the same model that may have generated the answer being
 * judged, which is a real bias to keep in mind, not independent confirmation. `error` means
 * the judge's own output could not be parsed into a verdict. Null (not part of this enum)
 * means the question was never judged at all, because no answer was generated to grade.
 */
export const RagEvalJudgeVerdict = z.enum(['correct', 'partial', 'incorrect', 'error']);
export type RagEvalJudgeVerdict = z.infer<typeof RagEvalJudgeVerdict>;

export const RagEvalJobStatus = z.enum(['running', 'completed', 'failed']);
export type RagEvalJobStatus = z.infer<typeof RagEvalJobStatus>;

export const RagEvalCitationSchema = z.object({
  title: z.string(),
  section: z.string().nullable(),
  page: z.number().int().nullable(),
  score: z.number(),
});
export type RagEvalCitation = z.infer<typeof RagEvalCitationSchema>;

export const RagEvalRowSchema = z.object({
  source: z.string(),
  difficulty: RagEvalDifficulty,
  question: z.string(),
  expectedAnswer: z.string(),
  actualAnswer: z.string().nullable(),
  notFound: z.boolean(),
  /** Objective and mechanical: did the source document show up in the citations at all? */
  retrievalHit: z.boolean(),
  judgeVerdict: RagEvalJudgeVerdict.nullable(),
  judgeDetail: z.string().nullable(),
  complexityTier: ComplexityTier.nullable(),
  complexityScore: z.number().nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  citations: z.array(RagEvalCitationSchema).nullable(),
  ranAt: isoDateTime,
});
export type RagEvalRow = z.infer<typeof RagEvalRowSchema>;

export const RagEvalBucketSchema = z.object({
  total: z.number().int().nonnegative(),
  retrievalHitRate: z.number().min(0).max(1).nullable(),
  judgeCounts: z.record(z.string(), z.number().int().nonnegative()),
});
export type RagEvalBucket = z.infer<typeof RagEvalBucketSchema>;

export const RagEvalSummarySchema = RagEvalBucketSchema.extend({
  byDifficulty: z.record(z.string(), RagEvalBucketSchema),
});
export type RagEvalSummary = z.infer<typeof RagEvalSummarySchema>;

export const RagEvalRunSchema = z.object({
  id: z.string(),
  status: RagEvalJobStatus,
  /** Which file under data/eval/ this run answered questions from. */
  datasetId: z.string(),
  projectId: z.string().nullable(),
  /** Which answer model generated these answers - null for a run from before this was tracked. */
  answerModel: z.string().nullable(),
  /** Which embedding model retrieval ran against - null for a run from before this was tracked. */
  embeddingModel: z.string().nullable(),
  progress: z.string().nullable(),
  currentQuestion: z.string().nullable(),
  summary: RagEvalSummarySchema.nullable(),
  rows: z.array(RagEvalRowSchema),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type RagEvalRun = z.infer<typeof RagEvalRunSchema>;

/**
 * One row of `/rag-eval/runs` - enough to label a run in a picker (dataset, project, which
 * models were active, when it ran) without paying for its full row-by-row detail, which a
 * compare view only needs for the (at most two) runs actually selected.
 */
export const RagEvalRunSummarySchema = z.object({
  id: z.string(),
  status: RagEvalJobStatus,
  datasetId: z.string(),
  projectId: z.string().nullable(),
  answerModel: z.string().nullable(),
  embeddingModel: z.string().nullable(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type RagEvalRunSummary = z.infer<typeof RagEvalRunSummarySchema>;

export const RagEvalDatasetDocumentSchema = z.object({
  source: z.string(),
  titleHint: z.string(),
  questionCount: z.number().int().nonnegative(),
});
export type RagEvalDatasetDocument = z.infer<typeof RagEvalDatasetDocumentSchema>;

/**
 * One selectable question set - any file dropped under data/eval/ on the service side, kept
 * as its own file rather than a single hardcoded set so testing a different corpus never
 * means overwriting the one you already have.
 */
export const RagEvalDatasetInfoSchema = z.object({
  id: z.string(),
  documents: z.array(RagEvalDatasetDocumentSchema),
  totalQuestions: z.number().int().nonnegative(),
});
export type RagEvalDatasetInfo = z.infer<typeof RagEvalDatasetInfoSchema>;

// ---------------------------------------------------------------------------
// Approved tools
// ---------------------------------------------------------------------------

export const ApprovedToolSchema = z.object({
  id: z.string(),
  server: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  readOnly: z.boolean(),
});
export type ApprovedTool = z.infer<typeof ApprovedToolSchema>;
