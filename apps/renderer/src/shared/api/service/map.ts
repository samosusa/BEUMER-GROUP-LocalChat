import type {
  BenchmarkJobStatus,
  BenchmarkRowStatus,
  Chat,
  Citation,
  Document,
  DocumentFormat,
  EmbeddingBenchmarkRow,
  EmbeddingBenchmarkRun,
  EmbeddingModel,
  IngestionStatus,
  Message,
  Model,
  ModelBenchmarkRow,
  ModelBenchmarkRun,
  NoEvidenceReason,
  Project,
  ReindexJob,
  ReindexJobStatus,
} from '@localchat/contracts';
import type {
  ServiceAnswer,
  ServiceBenchmarkResults,
  ServiceBenchmarkRow,
  ServiceBenchmarkStatus,
  ServiceCitation,
  ServiceConversation,
  ServiceConversationDetail,
  ServiceDocument,
  ServiceEmbeddingBenchmarkResults,
  ServiceEmbeddingBenchmarkRow,
  ServiceEmbeddingBenchmarkStatus,
  ServiceEmbeddingModel,
  ServiceIngestStatus,
  ServiceMessage,
  ServiceModel,
  ServiceProject,
  ServiceReindexStatus,
} from './dto';

/**
 * Pure translation between the RAG service's wire shapes and the domain contract.
 *
 * Every function here is total and side-effect free, which is the point: this is where the
 * two designs disagree, so this is the file worth testing exhaustively and the file to read
 * when a value looks wrong on screen.
 *
 * Where the service cannot supply a field, these functions produce the honest empty value
 * rather than a plausible-looking guess. A fabricated page number in a citation is worse
 * than a missing one — the whole product promise is that a number on screen can be checked
 * against paper.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * The service stores naive UTC and FastAPI serialises it without a designator, so
 * `2026-09-01T12:30:00` would be read by `new Date()` as *local* time — shifting every
 * timestamp by the engineer's offset and putting this morning's chat under "yesterday"
 * in Copenhagen. Append the Z unless one is already there.
 */
export function toIso(naive: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(naive) ? naive : `${naive}Z`;
}

export function toIsoOrNull(naive: string | null): string | null {
  return naive === null ? null : toIso(naive);
}

/** SQLAlchemy integer primary keys; the domain treats ids as opaque strings. */
export const toId = (id: number): string => String(id);

/** Reverse, for path parameters. Throws rather than sending `NaN` down a URL. */
export function toServiceId(id: string, what: string): number {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a numeric ${what} id from the service, got "${id}"`);
  }
  return parsed;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

const FORMAT_BY_SUFFIX: Record<string, DocumentFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'docx',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
};

/** The service records a path, not a MIME type, so the suffix is all there is to go on. */
export function formatFromPath(path: string): DocumentFormat {
  const suffix = basename(path).split('.').pop()?.toLowerCase() ?? '';
  return FORMAT_BY_SUFFIX[suffix] ?? 'text';
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * `GET /docs` returns no chunk count, page count or file size, so those are zero rather
 * than invented. The document table renders a zero chunk count as "0", which is honest:
 * the service genuinely is not telling us.
 *
 * `version` is a re-upload counter, not the engineering revision printed on a drawing.
 * Surfacing it as "v2" is truthful about what the service knows; leaving it blank at
 * version 1 avoids implying every document carries a revision.
 */
export function documentFromService(dto: ServiceDocument): Document {
  return {
    id: toId(dto.id),
    projectId: dto.project_id === null ? null : toId(dto.project_id),
    filename: basename(dto.path),
    title: dto.title,
    format: formatFromPath(dto.path),
    revision: dto.version > 1 ? `v${dto.version}` : null,
    supersedes: dto.version > 1 ? `v${dto.version - 1}` : null,
    chunkCount: 0,
    pageCount: null,
    sizeBytes: 0,
    status: dto.indexed_at === null ? 'pending' : 'indexed',
    progress: null,
    resumeFromPage: null,
    documentDate: null,
    indexedAt: toIsoOrNull(dto.indexed_at),
    stale: false,
    complexityTier: dto.complexity_tier,
    complexityScore: dto.complexity_score,
  };
}

const TERMINAL_INGESTION: Record<string, IngestionStatus> = {
  complete: 'indexed',
  completed: 'indexed',
  done: 'indexed',
  failed: 'failed',
  error: 'failed',
};

export function ingestionStatusFromService(dto: ServiceIngestStatus): IngestionStatus {
  return TERMINAL_INGESTION[dto.status.toLowerCase()] ?? 'indexing';
}

/**
 * `offset` is the chunk the pipeline has reached out of `total_chunks`. Total is 0 until
 * the chunker has finished splitting, so guard the division rather than emitting NaN into
 * a progress bar.
 */
export function ingestionProgressFromService(dto: ServiceIngestStatus): number | null {
  if (dto.total_chunks <= 0) return null;
  return Math.min(1, dto.offset / dto.total_chunks);
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/**
 * Title -> document id, the only route from a citation back to its document.
 *
 * A title that occurs more than once maps to nothing rather than to whichever document was
 * seen first. Guessing would attach a claim to the wrong drawing, which on a customer site
 * is worse than a citation that cannot be opened: one is visibly incomplete, the other is
 * confidently wrong.
 */
export function createDocumentIndex() {
  const byTitle = new Map<string, string | null>();
  return {
    remember(documents: Array<{ id: string; title: string }>): void {
      byTitle.clear();
      for (const document of documents) {
        byTitle.set(document.title, byTitle.has(document.title) ? null : document.id);
      }
    },
    resolve(title: string): string | undefined {
      return byTitle.get(title) ?? undefined;
    },
  };
}

/**
 * The service's citations carry no document id and no excerpt — `rag_service.answer()`
 * keeps only title, section, page and score from the retrieved chunk.
 *
 * Titles are resolved back to ids against the document list where one matches exactly.
 * That is a workaround, not a design: two documents may share a title, and the resolution
 * silently fails for a document ingested since the list was last fetched. An id on the
 * citation itself is the fix, and it is a two-line change in `rag_service.py`.
 */
export function citationsFromService(
  citations: ServiceCitation[],
  resolveDocumentId: (title: string) => string | undefined = () => undefined,
): Citation[] {
  return citations.map((citation, index) => ({
    marker: index + 1,
    documentId: resolveDocumentId(citation.title) ?? '',
    documentTitle: citation.title,
    section: citation.section,
    page: citation.page,
    revision: null,
    documentDate: null,
    excerpt: null,
    score: citation.score,
  }));
}

/**
 * `rag_service` collapses two distinct refusals into one boolean: nothing was retrieved at
 * all, and something was retrieved but scored below MIN_SIMILARITY. We cannot tell them
 * apart from the wire, and both arrive with an empty citation list.
 *
 * `nothing_retrieved` is the weaker claim and is true in both cases. `below_threshold`
 * would assert that a passage was found and rejected, which may be false — most obviously
 * on an empty corpus, where nothing has been ingested yet.
 */
export function noEvidenceFromService(notFound: boolean | null): NoEvidenceReason | null {
  return notFound === true ? 'nothing_retrieved' : null;
}

// ---------------------------------------------------------------------------
// Messages and chats
// ---------------------------------------------------------------------------

export function messageFromService(
  dto: ServiceMessage,
  resolveDocumentId?: (title: string) => string | undefined,
): Message {
  return {
    id: toId(dto.id),
    chatId: toId(dto.conversation_id),
    role: dto.role === 'user' ? 'user' : 'assistant',
    content: dto.text,
    createdAt: toIso(dto.created_at),
    citations: citationsFromService(dto.citations ?? [], resolveDocumentId),
    // The service has no figure extraction and no tool calls. Empty, not omitted, so the
    // transcript renders the same way regardless of which backend answered.
    figures: [],
    toolCalls: [],
    noEvidence: noEvidenceFromService(dto.not_found),
    suggestions: [],
    // No retrieval/generation split is reported, and inventing one would put a fabricated
    // number next to a real one in the timings row.
    timings: null,
    scope: null,
    modelId: null,
    complexityTier: dto.complexity_tier,
    complexityScore: dto.complexity_score,
  };
}

/** The answer body returned by POST /query, which has no message row behind it. */
export function messageFromAnswer(
  answer: ServiceAnswer,
  ids: { id: string; chatId: string; createdAt: string },
  resolveDocumentId?: (title: string) => string | undefined,
): Message {
  return {
    id: ids.id,
    chatId: ids.chatId,
    role: 'assistant',
    content: answer.answer ?? '',
    createdAt: ids.createdAt,
    citations: citationsFromService(answer.citations, resolveDocumentId),
    figures: [],
    toolCalls: [],
    noEvidence: noEvidenceFromService(answer.not_found),
    suggestions: answer.suggestion ? [answer.suggestion] : [],
    timings: null,
    scope: null,
    modelId: null,
    complexityTier: answer.complexity?.tier ?? null,
    complexityScore: answer.complexity?.score ?? null,
  };
}

const UNTITLED = 'New chat';

/** First line of the newest assistant turn, for the sidebar preview. */
function previewOf(messages: ServiceMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.text.trim()) {
      return message.text.trim().split('\n')[0] ?? '';
    }
  }
  return '';
}

/**
 * The conversation list endpoint returns no messages, so counts and previews are unknown
 * there. `messages` is optional for that reason: the list renders with zeroes and the
 * detail view fills them in, rather than the list issuing N requests to look complete.
 */
export function chatFromService(dto: ServiceConversation, messages?: ServiceMessage[]): Chat {
  const assistantTurns = messages?.filter((message) => message.role === 'assistant') ?? [];
  return {
    id: toId(dto.id),
    title: dto.title?.trim() || UNTITLED,
    projectId: dto.project_id === null ? null : toId(dto.project_id),
    // The service persists no scope on the conversation itself, only its project_id, so the
    // default shown here is always the binary derived from that: project-linked conversations
    // default to 'project', project-less ones to 'general'. `both` is available (and reaches
    // the retriever) as a per-turn override once the engineer picks it in the widget - see
    // `postMessage`'s `scope` param - but there is no persisted "this chat defaults to both"
    // state. Per-chat attachments remain UI-only; `/messages` has no field for them.
    scope: dto.project_id === null ? 'general' : 'project',
    attachmentIds: [],
    messageCount: messages?.length ?? 0,
    preview: messages ? previewOf(messages) : '',
    sourceCount: assistantTurns.reduce((total, m) => total + (m.citations?.length ?? 0), 0),
    hadNoEvidence: assistantTurns.some((message) => message.not_found === true),
    createdAt: toIso(dto.created_at),
    updatedAt: toIso(dto.updated_at),
  };
}

export function chatDetailFromService(dto: ServiceConversationDetail): Chat {
  return chatFromService(dto, dto.messages);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * The service's `Project` row is just a name and timestamps — description, folder
 * watching, per-project instructions and index state have no server-side column. Those
 * come back as the honest empty value (`''`, `null`, `false`) rather than a guess.
 *
 * `documentCount` and `chatCount` are real, though: the service has no scoped endpoint
 * for either, so callers fetch the whole corpus once and pass in this project's slice
 * rather than the service inventing a number it was never asked to filter.
 */
export function projectFromService(
  dto: ServiceProject,
  documents: Document[],
  chatCount: number,
): Project {
  const indexing = documents.some((doc) => doc.status === 'pending' || doc.status === 'indexing');
  return {
    id: toId(dto.id),
    name: dto.name,
    description: '',
    folderPath: null,
    watched: false,
    instructions: '',
    documentCount: documents.length,
    chatCount,
    indexState: documents.length === 0 ? 'empty' : indexing ? 'indexing' : 'ready',
    indexProgress: null,
    indexEtaSeconds: null,
    lastOpenedAt: null,
    createdAt: toIso(dto.created_at),
  };
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const QUANTIZATION = /[-_.](Q\d+(?:_[A-Z0-9]+)*|IQ\d+[A-Z0-9_]*|F16|F32|BF16)(?=\.gguf$|$)/i;

/**
 * The service identifies a model by its GGUF filename, so that is the id. Name and
 * quantization are read off the filename because there is nowhere else to get them
 * without loading several gigabytes to ask.
 */
export function modelFromService(dto: ServiceModel): Model {
  const stem = dto.name.replace(/\.gguf$/i, '');
  const match = QUANTIZATION.exec(dto.name);
  const quantization = match?.[1];
  return {
    id: dto.name,
    name: match ? stem.slice(0, match.index) : stem,
    quantization: quantization ? quantization.toUpperCase() : '',
    sizeBytes: dto.size_bytes,
    // Context length lives in the GGUF header, which the service does not read.
    contextTokens: null,
    note: dto.family,
    // Requires a benchmark run; the service reports none per model.
    medianLatencyMs: null,
    // Every entry is a file already on disk in data/models.
    installed: true,
  };
}

// ---------------------------------------------------------------------------
// Model benchmark
// ---------------------------------------------------------------------------

/** The service reports seconds as floats; the interface formats milliseconds. */
const toMs = (seconds: number | null): number | null => (seconds === null ? null : seconds * 1000);

/** And megabytes as floats, where the formatter wants bytes. */
const toBytes = (mb: number | null): number | null => (mb === null ? null : mb * 1024 * 1024);

const ROW_STATUS: Record<string, BenchmarkRowStatus> = {
  ok: 'ok',
  success: 'ok',
  completed: 'ok',
  failed: 'failed',
  error: 'failed',
  skipped: 'skipped',
};

const JOB_STATUS: Record<string, BenchmarkJobStatus> = {
  running: 'running',
  queued: 'running',
  completed: 'completed',
  failed: 'failed',
};

export function benchmarkRowFromService(dto: ServiceBenchmarkRow): ModelBenchmarkRow {
  return {
    modelId: dto.model,
    // The same filename-derived name the model picker shows, so a row in this table and an
    // entry in the model list are recognisably the same thing.
    modelName: modelFromService({ name: dto.model, size_bytes: 0, family: '' }).name,
    compute: dto.device === 'gpu' ? 'gpu' : 'cpu',
    deviceName: dto.device_name,
    // An unknown status is treated as a failure rather than as success: a row that did not
    // clearly succeed must not be read as a measurement.
    status: ROW_STATUS[dto.status.toLowerCase()] ?? 'failed',
    detail: dto.detail,
    loadMs: toMs(dto.load_s),
    timeToFirstTokenMs: toMs(dto.ttft_s),
    generatedTokens: dto.gen_tokens,
    tokensPerSecond: dto.tok_s,
    totalMs: toMs(dto.total_s),
    peakMemoryBytes: toBytes(dto.peak_mem_mb),
    peakVramBytes: toBytes(dto.peak_vram_mb),
    ranAt: toIso(dto.run_at),
  };
}

export function benchmarkRunFromService(
  results: ServiceBenchmarkResults,
  meta: { startedAt: string; finishedAt: string | null; status?: ServiceBenchmarkStatus },
): ModelBenchmarkRun {
  const rows = results.results.map(benchmarkRowFromService);
  return {
    id: toId(results.benchmark_job_id),
    status: JOB_STATUS[(meta.status?.status ?? results.status).toLowerCase()] ?? 'running',
    progress: meta.status?.progress ?? null,
    current: meta.status?.current ?? null,
    rows,
    startedAt: toIso(meta.startedAt),
    finishedAt: toIsoOrNull(meta.finishedAt),
  };
}

// ---------------------------------------------------------------------------
// Embedding models
// ---------------------------------------------------------------------------

export function embeddingModelFromService(dto: ServiceEmbeddingModel): EmbeddingModel {
  return {
    id: dto.name,
    name: dto.name,
    dimension: dto.dimension,
    description: dto.description,
  };
}

// ---------------------------------------------------------------------------
// Re-embedding
// ---------------------------------------------------------------------------

const REINDEX_JOB_STATUS: Record<string, ReindexJobStatus> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
};

export function reindexJobFromService(
  status: ServiceReindexStatus,
  meta: { id: string; startedAt: string; finishedAt: string | null },
): ReindexJob {
  return {
    id: meta.id,
    status: REINDEX_JOB_STATUS[status.status.toLowerCase()] ?? 'running',
    model: status.model,
    progress: status.progress,
    currentDocument: status.current_document,
    startedAt: toIso(meta.startedAt),
    finishedAt: toIsoOrNull(meta.finishedAt),
  };
}

// ---------------------------------------------------------------------------
// Embedding benchmark
// ---------------------------------------------------------------------------

export function embeddingBenchmarkRowFromService(
  dto: ServiceEmbeddingBenchmarkRow,
): EmbeddingBenchmarkRow {
  return {
    model: dto.model,
    dimension: dto.dimension,
    status: ROW_STATUS[dto.status.toLowerCase()] ?? 'failed',
    detail: dto.detail,
    loadMs: toMs(dto.load_s),
    textLabel: dto.text_label,
    textCount: dto.text_count,
    embedMs: toMs(dto.embed_s),
    textsPerSecond: dto.texts_per_s,
    peakMemoryBytes: toBytes(dto.peak_mem_mb),
    ranAt: toIso(dto.run_at),
  };
}

export function embeddingBenchmarkRunFromService(
  results: ServiceEmbeddingBenchmarkResults,
  meta: { startedAt: string; finishedAt: string | null; status?: ServiceEmbeddingBenchmarkStatus },
): EmbeddingBenchmarkRun {
  const rows = results.results.map(embeddingBenchmarkRowFromService);
  return {
    id: toId(results.embedding_benchmark_job_id),
    status: JOB_STATUS[(meta.status?.status ?? results.status).toLowerCase()] ?? 'running',
    progress: meta.status?.progress ?? null,
    current: meta.status?.current ?? null,
    rows,
    startedAt: toIso(meta.startedAt),
    finishedAt: toIsoOrNull(meta.finishedAt),
  };
}
