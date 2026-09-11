import { http, HttpResponse, delay } from 'msw';
import type { ModelBenchmarkRun } from '@localchat/contracts';
import {
  AskRequest,
  CreateChatRequest,
  CreateProjectRequest,
  IngestDocumentsRequest,
  RunBenchmarkRequest,
  ReindexRequest,
  UpdateChatContextRequest,
  UpdateSettingsRequest,
  routes,
} from '@localchat/contracts';
import {
  answerEvents,
  buildAnswer,
  catalogue,
  documentsFor,
  indexStatsFor,
  nextId,
  projectsWithCounts,
  store,
} from './db';

/**
 * Mock implementation of the local RAG service.
 *
 * Handlers are matched with a `*` origin so the same set works against the loopback URL the
 * desktop shell injects and against the dev server in a browser.
 */

const ORIGIN = '*';
const route = (path: string) => `${ORIGIN}${path}`;

/** Latency the real service will have. Without it, every loading state goes untested. */
const LATENCY = { fast: 60, normal: 180, ingest: 500 } as const;

function notFound(message: string) {
  return HttpResponse.json({ code: 'not_found', message }, { status: 404 });
}

function badRequest(message: string, details?: Record<string, unknown>) {
  return HttpResponse.json({ code: 'invalid_request', message, details }, { status: 400 });
}

/**
 * `/health` is the one route the mock and the real service both answer on the same origin
 * and path. Registering it while the app is pointed at the live service would mean the
 * status strip reports a healthy mock while the Python process is not even running — the
 * single most misleading thing this mock could do. So it is left out in live mode, and the
 * request falls through to 127.0.0.1:8000.
 *
 * Every other mocked route is under `/api`, which the service does not serve, so the two
 * namespaces cannot otherwise collide.
 */
const healthHandlers = __LIVE_SERVICE__
  ? []
  : [
      http.get(route(routes.health()), async () => {
        await delay(LATENCY.fast);
        return HttpResponse.json({
          status: 'ok',
          version: '0.4.1',
          modelLoaded: true,
          offline: store.settings.strictOffline,
        });
      }),
    ];

export const handlers = [
  ...healthHandlers,

  // --- projects -----------------------------------------------------------
  http.get(route(routes.projects()), async () => {
    await delay(LATENCY.normal);
    return HttpResponse.json({ projects: projectsWithCounts() });
  }),

  http.post(route(routes.projects()), async ({ request }) => {
    const parsed = CreateProjectRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('A project needs a name.');

    await delay(LATENCY.normal);
    const project = {
      id: nextId('prj'),
      name: parsed.data.name,
      description: parsed.data.description,
      folderPath: parsed.data.folderPath,
      watched: parsed.data.folderPath !== null,
      instructions: parsed.data.instructions,
      documentCount: 0,
      chatCount: 0,
      indexState: 'empty' as const,
      indexProgress: null,
      indexEtaSeconds: null,
      lastOpenedAt: null,
      createdAt: new Date().toISOString(),
    };
    store.projects.unshift(project);
    return HttpResponse.json({ project }, { status: 201 });
  }),

  http.get(route('/api/projects/:id'), async ({ params }) => {
    await delay(LATENCY.fast);
    const project = projectsWithCounts().find((entry) => entry.id === params.id);
    return project ? HttpResponse.json({ project }) : notFound('That project no longer exists.');
  }),

  /**
   * Cascades to the project's own documents and chats, mirroring the real service's
   * `ON DELETE CASCADE` — a project without its documents left orphaned in the general
   * corpus would be a worse bug than the deletion itself.
   */
  http.delete(route('/api/projects/:id'), async ({ params }) => {
    const id = String(params.id);
    const index = store.projects.findIndex((entry) => entry.id === id);
    if (index === -1) return notFound('That project no longer exists.');

    store.projects.splice(index, 1);
    store.documents = store.documents.filter((document) => document.projectId !== id);
    for (const chat of store.chats.filter((entry) => entry.projectId === id)) {
      store.messages.delete(chat.id);
    }
    store.chats = store.chats.filter((entry) => entry.projectId !== id);
    await delay(LATENCY.fast);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(route('/api/projects/:id/documents'), async ({ params }) => {
    await delay(LATENCY.normal);
    const id = String(params.id);
    if (!store.projects.some((entry) => entry.id === id)) return notFound('Unknown project.');
    return HttpResponse.json({ documents: documentsFor(id), stats: indexStatsFor(id) });
  }),

  http.get(route('/api/projects/:id/tools'), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json({ tools: catalogue.tools });
  }),

  /** Same cascade as deleting one project at a time, applied to every project at once. */
  http.delete(route(routes.projects()), async () => {
    const inADeletedProject = (projectId: string | null) => projectId !== null;
    store.projects = [];
    store.documents = store.documents.filter((document) => !inADeletedProject(document.projectId));
    for (const chat of store.chats.filter((entry) => inADeletedProject(entry.projectId))) {
      store.messages.delete(chat.id);
    }
    store.chats = store.chats.filter((entry) => !inADeletedProject(entry.projectId));
    await delay(LATENCY.fast);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- documents ----------------------------------------------------------
  http.get(route(routes.documents()), async ({ request }) => {
    await delay(LATENCY.normal);
    const projectId = new URL(request.url).searchParams.get('projectId');
    return HttpResponse.json({
      documents: documentsFor(projectId),
      stats: indexStatsFor(projectId),
    });
  }),

  /**
   * Bulk delete. No `projectId` removes every document; `projectId=null` removes only the
   * general corpus; any other value removes just that project's documents — mirrors the real
   * service's `DELETE /docs` exactly (see src/api/docs.py).
   */
  http.delete(route(routes.documents()), async ({ request }) => {
    const projectId = new URL(request.url).searchParams.get('projectId');
    const removed = new Set(
      store.documents
        .filter((document) => {
          if (projectId === null) return true;
          if (projectId === 'null') return document.projectId === null;
          return document.projectId === projectId;
        })
        .map((document) => document.id),
    );

    store.documents = store.documents.filter((document) => !removed.has(document.id));
    for (const chat of store.chats) {
      chat.attachmentIds = chat.attachmentIds.filter((id) => !removed.has(id));
    }
    await delay(LATENCY.fast);
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * Removing a document drops it from the index and from every chat that pinned it.
   * Leaving a dangling attachment id behind would render a chat as having context it
   * cannot search.
   */
  http.delete(route('/api/documents/:id'), async ({ params }) => {
    const id = String(params.id);
    const index = store.documents.findIndex((document) => document.id === id);
    if (index === -1) return notFound('No such document.');

    store.documents.splice(index, 1);
    for (const chat of store.chats) {
      chat.attachmentIds = chat.attachmentIds.filter((attachment) => attachment !== id);
    }
    await delay(LATENCY.fast);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(route(routes.ingest()), async ({ request }) => {
    const parsed = IngestDocumentsRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('No files were supplied.');

    await delay(LATENCY.ingest);
    const accepted: typeof store.documents = [];
    const rejected: Array<{ path: string; reason: string }> = [];

    for (const path of parsed.data.paths) {
      const filename = path.split(/[\\/]/).pop() ?? path;
      const extension = filename.split('.').pop()?.toLowerCase() ?? '';
      const format = FORMAT_BY_EXTENSION[extension];

      if (!format) {
        rejected.push({
          path,
          reason: `LocalChat reads PDF, DOCX, Markdown and plain text. Export ${filename} to PDF and add it again — figures inside a PDF are indexed and can be cited.`,
        });
        continue;
      }

      const document = {
        id: nextId('doc'),
        projectId: parsed.data.projectId,
        filename,
        title: filename.replace(/\.[^.]+$/, ''),
        format,
        revision: null,
        supersedes: null,
        chunkCount: 0,
        pageCount: null,
        sizeBytes: 1_048_576,
        status: 'indexing' as const,
        progress: 0,
        resumeFromPage: null,
        documentDate: null,
        indexedAt: null,
        stale: false,
      };
      store.documents.push(document);
      accepted.push(document);
      scheduleIngestion(document.id);
    }

    return HttpResponse.json({ accepted, rejected });
  }),

  http.post(route(routes.reindex()), async ({ request }) => {
    const parsed = ReindexRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('Malformed reindex request.');

    await delay(LATENCY.ingest);
    for (const document of documentsFor(parsed.data.projectId)) {
      if (document.stale || parsed.data.full) {
        document.stale = false;
        document.indexedAt = new Date().toISOString();
      }
    }
    return HttpResponse.json({
      documents: documentsFor(parsed.data.projectId),
      stats: indexStatsFor(parsed.data.projectId),
    });
  }),

  http.get(route(routes.indexStats()), async ({ request }) => {
    await delay(LATENCY.fast);
    const projectId = new URL(request.url).searchParams.get('projectId');
    return HttpResponse.json(indexStatsFor(projectId));
  }),

  // --- chats --------------------------------------------------------------
  http.get(route(routes.chats()), async ({ request }) => {
    await delay(LATENCY.normal);
    const params = new URL(request.url).searchParams;
    const projectId = params.get('projectId');
    const query = params.get('query')?.toLowerCase() ?? '';

    let chats = [...store.chats];
    if (projectId) chats = chats.filter((chat) => chat.projectId === projectId);
    if (query) {
      chats = chats.filter(
        (chat) =>
          chat.title.toLowerCase().includes(query) || chat.preview.toLowerCase().includes(query),
      );
    }
    chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return HttpResponse.json({ chats });
  }),

  http.post(route(routes.chats()), async ({ request }) => {
    const parsed = CreateChatRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('A chat needs a scope.');

    await delay(LATENCY.fast);
    const timestamp = new Date().toISOString();
    const chat = {
      id: nextId('chat'),
      title: 'New chat',
      projectId: parsed.data.projectId,
      scope: parsed.data.scope,
      attachmentIds: parsed.data.attachmentIds,
      messageCount: 0,
      preview: '',
      sourceCount: 0,
      hadNoEvidence: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.chats.unshift(chat);
    store.messages.set(chat.id, []);
    return HttpResponse.json({ chat }, { status: 201 });
  }),

  http.get(route('/api/chats/:id'), async ({ params }) => {
    await delay(LATENCY.fast);
    const chat = store.chats.find((entry) => entry.id === params.id);
    return chat ? HttpResponse.json({ chat }) : notFound('That chat no longer exists.');
  }),

  http.delete(route('/api/chats/:id'), async ({ params }) => {
    const id = String(params.id);
    const index = store.chats.findIndex((entry) => entry.id === id);
    if (index === -1) return notFound('That chat no longer exists.');

    store.chats.splice(index, 1);
    store.messages.delete(id);
    await delay(LATENCY.fast);
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete(route(routes.chats()), async () => {
    store.chats = [];
    store.messages.clear();
    await delay(LATENCY.fast);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(route('/api/chats/:id/messages'), async ({ params }) => {
    await delay(LATENCY.normal);
    const id = String(params.id);
    if (!store.chats.some((entry) => entry.id === id)) return notFound('Unknown chat.');
    return HttpResponse.json({ messages: store.messages.get(id) ?? [] });
  }),

  http.patch(route('/api/chats/:id/context'), async ({ params, request }) => {
    const parsed = UpdateChatContextRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('Malformed context update.');

    const chat = store.chats.find((entry) => entry.id === params.id);
    if (!chat) return notFound('Unknown chat.');

    await delay(LATENCY.fast);
    if (parsed.data.scope) chat.scope = parsed.data.scope;
    if (parsed.data.attachmentIds) chat.attachmentIds = parsed.data.attachmentIds;
    return HttpResponse.json({ chat });
  }),

  // --- ask (server-sent events) -------------------------------------------
  http.post(route('/api/chats/:id/ask'), async ({ params, request }) => {
    const parsed = AskRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('A question is required.');

    const chat = store.chats.find((entry) => entry.id === params.id);
    if (!chat) return notFound('Unknown chat.');

    const question = parsed.data.question;
    const messages = store.messages.get(chat.id) ?? [];

    const userMessage = {
      id: nextId('msg'),
      chatId: chat.id,
      role: 'user' as const,
      content: question,
      createdAt: new Date().toISOString(),
      citations: [],
      figures: [],
      toolCalls: [],
      noEvidence: null,
      suggestions: [],
      timings: null,
      scope: null,
      modelId: null,
    };
    messages.push(userMessage);

    chat.scope = parsed.data.scope;
    chat.attachmentIds = parsed.data.attachmentIds;
    if (chat.messageCount === 0) chat.title = deriveTitle(question);

    const answer = buildAnswer(chat, question);
    const events = answerEvents(chat, answer);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        for (const event of events) {
          // Retrieval genuinely takes most of a second; tokens then arrive quickly.
          await delay(event.type === 'retrieval' ? 700 : event.type === 'token' ? 24 : 90);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    });

    messages.push(answer);
    store.messages.set(chat.id, messages);
    chat.messageCount = messages.length;
    chat.preview = answer.content.replace(/[*`#]/g, '').split('\n')[0] ?? '';
    chat.sourceCount = answer.citations.length;
    chat.hadNoEvidence = answer.noEvidence !== null;
    chat.updatedAt = new Date().toISOString();

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),

  // --- settings, models, benchmark ----------------------------------------
  http.get(route(routes.settings()), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json({ settings: store.settings });
  }),

  http.patch(route(routes.settings()), async ({ request }) => {
    const parsed = UpdateSettingsRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('Unrecognised setting.');

    await delay(LATENCY.fast);
    store.settings = { ...store.settings, ...parsed.data };
    return HttpResponse.json({ settings: store.settings });
  }),

  http.get(route(routes.models()), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json({ models: catalogue.models });
  }),

  http.get(route(routes.benchmark()), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json({ run: catalogue.benchmark });
  }),

  http.get(route(routes.benchmarkHistory()), async () => {
    await delay(LATENCY.fast);
    return HttpResponse.json({ runs: benchmarkHistory() });
  }),

  http.post(route(routes.benchmark()), async ({ request }) => {
    const parsed = RunBenchmarkRequest.safeParse(await request.json());
    if (!parsed.success) return badRequest('Choose at least one device to benchmark.');

    // A real run loads several multi-gigabyte models in sequence and takes minutes; two
    // seconds is enough to exercise the pending state without making the mock tedious.
    await delay(2_000);
    const finishedAt = new Date().toISOString();
    const rows = catalogue.benchmark.rows.filter((row) =>
      parsed.data.devices.includes(row.compute),
    );
    return HttpResponse.json({
      run: { ...catalogue.benchmark, rows, startedAt: finishedAt, finishedAt },
    });
  }),
];

/**
 * Six past runs derived from the finished one, a week apart.
 *
 * The drift is deterministic rather than random: a mock that produces different numbers on
 * every reload makes it impossible to tell a rendering bug from noise. The shape is the
 * thing worth mocking - one model improving as it is quantised differently, another flat,
 * and a device that only appears partway through the history because the machine did not
 * have a working CUDA build until then.
 */
function benchmarkHistory(): ModelBenchmarkRun[] {
  const RUNS = 6;
  const DAY = 86_400_000;
  const finished = Date.parse(catalogue.benchmark.finishedAt ?? catalogue.benchmark.startedAt);

  return Array.from({ length: RUNS }, (_, index) => {
    const age = RUNS - 1 - index;
    const at = new Date(finished - age * 7 * DAY).toISOString();
    // Older runs were slower: 4% per week back, so the newest run is the fastest.
    const factor = 1 - age * 0.04;

    return {
      ...catalogue.benchmark,
      id: `history-${index}`,
      startedAt: at,
      finishedAt: at,
      rows: catalogue.benchmark.rows
        // The GPU only became usable three runs ago; before that there was no CUDA build.
        .filter((row) => row.compute === 'cpu' || age < 3)
        .map((row) => ({
          ...row,
          ranAt: at,
          tokensPerSecond: scale(row.tokensPerSecond, factor),
          timeToFirstTokenMs: scale(row.timeToFirstTokenMs, 1 / factor),
          loadMs: scale(row.loadMs, 1 / factor),
          totalMs: scale(row.totalMs, 1 / factor),
        })),
    };
  });
}

function scale(value: number | null, factor: number): number | null {
  return value === null ? null : Math.round(value * factor * 100) / 100;
}

const FORMAT_BY_EXTENSION: Record<string, 'pdf' | 'docx' | 'markdown' | 'text' | 'image'> = {
  pdf: 'pdf',
  docx: 'docx',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
};

/** Ingestion runs in the background and the UI polls; step the progress on a timer. */
function scheduleIngestion(documentId: string): void {
  let progress = 0;
  const timer = setInterval(() => {
    const document = store.documents.find((entry) => entry.id === documentId);
    if (!document) {
      clearInterval(timer);
      return;
    }
    progress = Math.min(1, progress + 0.17);
    document.progress = progress;
    document.chunkCount = Math.round(progress * 240);
    if (progress >= 1) {
      document.status = 'indexed';
      document.progress = null;
      document.indexedAt = new Date().toISOString();
      clearInterval(timer);
    }
  }, 900);
}

/** First clause of the question, capped — the same heuristic the service will use. */
function deriveTitle(question: string): string {
  const cleaned = question
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.]+$/, '');
  return cleaned.length <= 48 ? cleaned : `${cleaned.slice(0, 45).trimEnd()}…`;
}
