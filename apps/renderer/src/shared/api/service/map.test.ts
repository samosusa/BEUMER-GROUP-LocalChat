import { describe, expect, it } from 'vitest';
import type { ServiceBenchmarkRow, ServiceDocument, ServiceMessage, ServiceProject } from './dto';
import {
  benchmarkRowFromService,
  benchmarkRunFromService,
  chatFromService,
  citationsFromService,
  createDocumentIndex,
  documentFromService,
  formatFromPath,
  ingestionProgressFromService,
  ingestionStatusFromService,
  messageFromService,
  modelFromService,
  noEvidenceFromService,
  projectFromService,
  toIso,
  toServiceId,
} from './map';

const document = (over: Partial<ServiceDocument> = {}): ServiceDocument => ({
  id: 7,
  title: 'Conveyor commissioning guide',
  path: '/Users/pk/docs/conveyor-guide.pdf',
  checksum: 'abc123',
  version: 1,
  project_id: null,
  uploaded_at: '2026-08-30T09:15:00',
  indexed_at: '2026-08-30T09:17:30',
  complexity_tier: null,
  complexity_score: null,
  ...over,
});

const message = (over: Partial<ServiceMessage> = {}): ServiceMessage => ({
  id: 12,
  conversation_id: 3,
  role: 'assistant',
  text: 'The belt runs at 2.2 m/s.',
  citations: null,
  not_found: false,
  complexity_tier: null,
  complexity_score: null,
  created_at: '2026-08-30T09:20:00',
  ...over,
});

describe('timestamps', () => {
  it('marks naive service timestamps as UTC', () => {
    // FastAPI serialises the naive UTC datetimes the service stores. Without the Z these
    // are read as local time, which shifts every chat in the history by the user's offset.
    expect(toIso('2026-08-30T09:15:00')).toBe('2026-08-30T09:15:00Z');
  });

  it('leaves an explicit designator alone', () => {
    expect(toIso('2026-08-30T09:15:00Z')).toBe('2026-08-30T09:15:00Z');
    expect(toIso('2026-08-30T11:15:00+02:00')).toBe('2026-08-30T11:15:00+02:00');
  });
});

describe('ids', () => {
  it('refuses a non-numeric id rather than putting NaN in a URL', () => {
    expect(() => toServiceId('abc', 'conversation')).toThrow(/conversation/);
    expect(toServiceId('42', 'conversation')).toBe(42);
  });
});

describe('documents', () => {
  it('derives the format from the path, since the service reports no type', () => {
    expect(formatFromPath('C:\\docs\\spec.DOCX')).toBe('docx');
    expect(formatFromPath('/tmp/notes.md')).toBe('markdown');
    expect(formatFromPath('/tmp/readme')).toBe('text');
  });

  it('takes the filename from the path on either platform', () => {
    expect(documentFromService(document({ path: 'C:\\a\\b\\plan.pdf' })).filename).toBe('plan.pdf');
    expect(documentFromService(document()).filename).toBe('conveyor-guide.pdf');
  });

  it('treats a document with no indexed_at as still pending', () => {
    expect(documentFromService(document({ indexed_at: null })).status).toBe('pending');
    expect(documentFromService(document()).status).toBe('indexed');
  });

  it('shows no revision at version 1, so an unversioned file does not look versioned', () => {
    const first = documentFromService(document({ version: 1 }));
    expect(first.revision).toBeNull();
    expect(first.supersedes).toBeNull();

    const third = documentFromService(document({ version: 3 }));
    expect(third.revision).toBe('v3');
    expect(third.supersedes).toBe('v2');
  });

  it('reports counts it does not know as zero rather than guessing', () => {
    const mapped = documentFromService(document());
    expect(mapped.chunkCount).toBe(0);
    expect(mapped.pageCount).toBeNull();
  });

  it('carries the project id, or null for the general corpus', () => {
    expect(documentFromService(document({ project_id: null })).projectId).toBeNull();
    expect(documentFromService(document({ project_id: 5 })).projectId).toBe('5');
  });
});

describe('ingestion progress', () => {
  const status = (over: Partial<Parameters<typeof ingestionProgressFromService>[0]> = {}) => ({
    status: 'running',
    offset: 0,
    total_chunks: 0,
    last_checkpoint: null,
    ...over,
  });

  it('returns null before the chunker knows the total, instead of NaN', () => {
    expect(ingestionProgressFromService(status({ total_chunks: 0, offset: 0 }))).toBeNull();
  });

  it('never exceeds 1, so a progress bar cannot overrun', () => {
    expect(ingestionProgressFromService(status({ offset: 12, total_chunks: 10 }))).toBe(1);
    expect(ingestionProgressFromService(status({ offset: 5, total_chunks: 10 }))).toBe(0.5);
  });

  it('maps only terminal states, treating anything else as still working', () => {
    expect(ingestionStatusFromService(status({ status: 'complete' }))).toBe('indexed');
    expect(ingestionStatusFromService(status({ status: 'failed' }))).toBe('failed');
    expect(ingestionStatusFromService(status({ status: 'queued' }))).toBe('indexing');
    expect(ingestionStatusFromService(status({ status: 'running' }))).toBe('indexing');
  });
});

describe('citations', () => {
  const citation = (title: string) => ({ title, section: 'Ch. 4', page: 41, score: 0.82 });

  it('numbers markers from one, matching the [n] markers in the answer body', () => {
    const mapped = citationsFromService([citation('A'), citation('B')]);
    expect(mapped.map((c) => c.marker)).toEqual([1, 2]);
  });

  it('leaves the document id empty when the service gives no way to resolve it', () => {
    expect(citationsFromService([citation('A')])[0]?.documentId).toBe('');
  });

  it('resolves a unique title back to its document', () => {
    const index = createDocumentIndex();
    index.remember([{ id: '7', title: 'Conveyor commissioning guide' }]);
    const [mapped] = citationsFromService(
      [citation('Conveyor commissioning guide')],
      index.resolve,
    );
    expect(mapped?.documentId).toBe('7');
  });

  it('refuses to resolve an ambiguous title rather than picking one', () => {
    // Attaching a claim to the wrong drawing is worse than attaching it to none.
    const index = createDocumentIndex();
    index.remember([
      { id: '7', title: 'Site guide' },
      { id: '9', title: 'Site guide' },
    ]);
    const [mapped] = citationsFromService([citation('Site guide')], index.resolve);
    expect(mapped?.documentId).toBe('');
  });

  it('never invents a revision, date or excerpt the service did not send', () => {
    const [mapped] = citationsFromService([citation('A')]);
    expect(mapped?.revision).toBeNull();
    expect(mapped?.documentDate).toBeNull();
    expect(mapped?.excerpt).toBeNull();
  });
});

describe('refusals', () => {
  it('reports the weaker claim, because the service collapses two cases into one flag', () => {
    // rag_service returns not_found both when nothing was retrieved and when the best
    // score fell below MIN_SIMILARITY. "nothing_retrieved" is true either way; asserting
    // "below_threshold" would be false on an empty corpus.
    expect(noEvidenceFromService(true)).toBe('nothing_retrieved');
    expect(noEvidenceFromService(false)).toBeNull();
    expect(noEvidenceFromService(null)).toBeNull();
  });
});

describe('messages', () => {
  it('carries a null citation list through as an empty one', () => {
    expect(messageFromService(message({ citations: null })).citations).toEqual([]);
  });

  it('leaves timings null rather than reporting a made-up split', () => {
    expect(messageFromService(message()).timings).toBeNull();
  });

  it('treats any role that is not "user" as an assistant turn', () => {
    expect(messageFromService(message({ role: 'user' })).role).toBe('user');
    expect(messageFromService(message({ role: 'assistant' })).role).toBe('assistant');
  });
});

describe('chats', () => {
  const conversation = {
    id: 3,
    title: null,
    project_id: null,
    created_at: '2026-08-30T09:00:00',
    updated_at: '2026-08-30T09:20:00',
  };

  it('falls back to a placeholder title, since the service allows null until the first question', () => {
    expect(chatFromService(conversation).title).toBe('New chat');
    expect(chatFromService({ ...conversation, title: '  ' }).title).toBe('New chat');
  });

  it('previews the newest assistant turn, not the user question', () => {
    const chat = chatFromService(conversation, [
      message({ id: 1, role: 'user', text: 'What is the belt speed?' }),
      message({ id: 2, role: 'assistant', text: 'The belt runs at 2.2 m/s.\nSee section 4.' }),
    ]);
    expect(chat.preview).toBe('The belt runs at 2.2 m/s.');
    expect(chat.messageCount).toBe(2);
  });

  it('reports zero counts when the list endpoint returned no messages', () => {
    // The conversation list has no messages, and issuing one detail request per row to
    // fill the counts in would be a request storm for a sidebar.
    const chat = chatFromService(conversation);
    expect(chat.messageCount).toBe(0);
    expect(chat.preview).toBe('');
  });

  it('flags a chat that ever failed to find evidence', () => {
    const chat = chatFromService(conversation, [message({ not_found: true })]);
    expect(chat.hadNoEvidence).toBe(true);
  });

  it('scopes to the project the conversation was created in, general otherwise', () => {
    const general = chatFromService(conversation);
    expect(general.projectId).toBeNull();
    expect(general.scope).toBe('general');

    const scoped = chatFromService({ ...conversation, project_id: 9 });
    expect(scoped.projectId).toBe('9');
    expect(scoped.scope).toBe('project');
  });
});

describe('projects', () => {
  const project = (over: Partial<ServiceProject> = {}): ServiceProject => ({
    id: 2,
    name: 'CPH T3 — LS-4000E',
    created_at: '2026-08-30T09:00:00',
    updated_at: '2026-08-30T09:00:00',
    ...over,
  });

  it('reports fields the service has no column for as the honest empty value', () => {
    const mapped = projectFromService(project(), [], 0);
    expect(mapped.description).toBe('');
    expect(mapped.folderPath).toBeNull();
    expect(mapped.watched).toBe(false);
    expect(mapped.instructions).toBe('');
    expect(mapped.indexProgress).toBeNull();
    expect(mapped.indexEtaSeconds).toBeNull();
    expect(mapped.lastOpenedAt).toBeNull();
  });

  it('counts documents and chats from the caller-supplied slices, not a guess', () => {
    const documents = [
      documentFromService(document({ id: 1 })),
      documentFromService(document({ id: 2 })),
    ];
    const mapped = projectFromService(project(), documents, 4);
    expect(mapped.documentCount).toBe(2);
    expect(mapped.chatCount).toBe(4);
  });

  it('derives index state from real document status rather than inventing one', () => {
    expect(projectFromService(project(), [], 0).indexState).toBe('empty');

    const indexed = [documentFromService(document({ indexed_at: '2026-08-30T09:17:30' }))];
    expect(projectFromService(project(), indexed, 0).indexState).toBe('ready');

    const pending = [documentFromService(document({ indexed_at: null }))];
    expect(projectFromService(project(), pending, 0).indexState).toBe('indexing');
  });
});

describe('models', () => {
  it('reads the quantization off the filename, which is the only place it appears', () => {
    const mapped = modelFromService({
      name: 'Llama-3.2-3B-Instruct-Q5_K_M.gguf',
      size_bytes: 2_483_000_000,
      family: 'llama',
    });
    expect(mapped.id).toBe('Llama-3.2-3B-Instruct-Q5_K_M.gguf');
    expect(mapped.name).toBe('Llama-3.2-3B-Instruct');
    expect(mapped.quantization).toBe('Q5_K_M');
  });

  it('keeps the whole stem when the filename carries no quantization', () => {
    const mapped = modelFromService({
      name: 'custom-model.gguf',
      size_bytes: 1,
      family: 'unknown',
    });
    expect(mapped.name).toBe('custom-model');
    expect(mapped.quantization).toBe('');
  });

  it('leaves context length null, because the service never opens the GGUF header', () => {
    const mapped = modelFromService({ name: 'a-Q4_0.gguf', size_bytes: 1, family: 'llama' });
    expect(mapped.contextTokens).toBeNull();
  });
});

describe('model benchmark', () => {
  const row = (over: Partial<ServiceBenchmarkRow> = {}): ServiceBenchmarkRow => ({
    model: 'Qwen2.5-0.5B-Instruct-Q5_K_M.gguf',
    device: 'cpu',
    device_name: 'Apple M2 Pro',
    status: 'ok',
    detail: null,
    load_s: 1.25,
    ttft_s: 0.4,
    gen_tokens: 128,
    tok_s: 31.4,
    total_s: 5.3,
    peak_mem_mb: 1024,
    peak_vram_mb: null,
    run_at: '2026-08-30T09:20:00',
    ...over,
  });

  it('converts seconds to milliseconds and megabytes to bytes', () => {
    // The service reports seconds and MB; the formatters take ms and bytes. Getting this
    // wrong yields "1 ms" beside a model that took a second and a quarter to load.
    const mapped = benchmarkRowFromService(row());
    expect(mapped.loadMs).toBe(1250);
    expect(mapped.timeToFirstTokenMs).toBe(400);
    expect(mapped.peakMemoryBytes).toBe(1_048_576 * 1024);
  });

  it('keeps a missing timing null rather than reporting zero', () => {
    // Zero would render as "0 ms", which reads as an instant load rather than no data.
    const mapped = benchmarkRowFromService(row({ load_s: null, peak_mem_mb: null }));
    expect(mapped.loadMs).toBeNull();
    expect(mapped.peakMemoryBytes).toBeNull();
  });

  it('names the model the way the model picker does', () => {
    expect(benchmarkRowFromService(row()).modelName).toBe('Qwen2.5-0.5B-Instruct');
  });

  it('treats an unrecognised row status as a failure, never as a measurement', () => {
    expect(benchmarkRowFromService(row({ status: 'weird' })).status).toBe('failed');
    expect(benchmarkRowFromService(row({ status: 'skipped' })).status).toBe('skipped');
  });

  it('carries the reason a combination could not run', () => {
    const mapped = benchmarkRowFromService(
      row({ device: 'gpu', status: 'skipped', detail: 'No CUDA build installed.' }),
    );
    expect(mapped.compute).toBe('gpu');
    expect(mapped.detail).toBe('No CUDA build installed.');
  });

  it('joins the three endpoints into one run, preferring live status over the stored one', () => {
    // /benchmark/results/{id} keeps reporting the stored status; while a job is running,
    // /benchmark/status/{id} is the fresher of the two.
    const run = benchmarkRunFromService(
      { benchmark_job_id: 4, status: 'completed', results: [row()] },
      {
        startedAt: '2026-08-30T09:00:00',
        finishedAt: null,
        status: { status: 'running', progress: '3 of 6', current: 'Qwen on cpu' },
      },
    );
    expect(run.id).toBe('4');
    expect(run.status).toBe('running');
    expect(run.progress).toBe('3 of 6');
    expect(run.current).toBe('Qwen on cpu');
    expect(run.startedAt).toBe('2026-08-30T09:00:00Z');
    expect(run.finishedAt).toBeNull();
    expect(run.rows).toHaveLength(1);
  });

  it('falls back to the stored status when no live status was fetched', () => {
    const run = benchmarkRunFromService(
      { benchmark_job_id: 4, status: 'completed', results: [] },
      { startedAt: '2026-08-30T09:00:00', finishedAt: '2026-08-30T09:06:00' },
    );
    expect(run.status).toBe('completed');
    expect(run.progress).toBeNull();
    expect(run.finishedAt).toBe('2026-08-30T09:06:00Z');
  });
});
