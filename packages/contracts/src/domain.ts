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

export const AnswerTimingsSchema = z.object({
  retrievalMs: z.number().int().nonnegative(),
  generationMs: z.number().int().nonnegative(),
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

export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantization: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  contextTokens: z.number().int().positive(),
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
// Benchmark
// ---------------------------------------------------------------------------

export const BenchmarkMetricsSchema = z.object({
  compute: ComputeMode,
  medianAnswerMs: z.number().int().nonnegative(),
  p95AnswerMs: z.number().int().nonnegative(),
  medianRetrievalMs: z.number().int().nonnegative(),
  answersWithCitation: z.number().int().nonnegative(),
  questionCount: z.number().int().positive(),
});
export type BenchmarkMetrics = z.infer<typeof BenchmarkMetricsSchema>;

export const BenchmarkRunSchema = z.object({
  id: z.string(),
  ranAt: isoDateTime,
  modelId: z.string(),
  corpusSnapshot: z.string(),
  topK: z.number().int().positive(),
  results: z.array(BenchmarkMetricsSchema),
  /** Latency target from the non-functional requirements, in ms. */
  targetAnswerMs: z.number().int().positive(),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;

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
