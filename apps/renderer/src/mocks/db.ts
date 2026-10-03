import type {
  AnswerEvent,
  Chat,
  Document,
  Message,
  Project,
  ReindexJob,
  Settings,
} from '@localchat/contracts';
import {
  APPROVED_TOOLS,
  BENCHMARK,
  CHATS,
  DOCUMENTS,
  EMBEDDING_BENCHMARK,
  EMBEDDING_MODELS,
  MESSAGES,
  MODELS,
  PROJECTS,
  RAG_EVAL,
  RAG_EVAL_DATASETS,
  SETTINGS,
  VECTOR_CAPACITY,
} from './fixtures';

/**
 * In-memory stand-in for the local service.
 *
 * It is deliberately stateful: creating a chat, flipping the scope and asking a question all
 * mutate this store, so the UI is exercised through real state transitions rather than
 * against frozen fixtures. When the FastAPI service lands, this file is the only thing that
 * goes away — nothing above the transport layer knows it exists.
 */

interface Store {
  projects: Project[];
  documents: Document[];
  chats: Chat[];
  messages: Map<string, Message[]>;
  settings: Settings;
  /** The current or most recent re-embed job, or null before any switch has ever run. */
  reindexJob: ReindexJob | null;
}

export const store: Store = {
  projects: structuredClone(PROJECTS),
  documents: structuredClone(DOCUMENTS),
  chats: structuredClone(CHATS),
  messages: new Map(Object.entries(structuredClone(MESSAGES))),
  settings: structuredClone(SETTINGS),
  reindexJob: null,
};

export const catalogue = {
  models: MODELS,
  benchmark: BENCHMARK,
  tools: APPROVED_TOOLS,
  embeddingModels: EMBEDDING_MODELS,
  embeddingBenchmark: EMBEDDING_BENCHMARK,
  vectorCapacity: VECTOR_CAPACITY,
  ragEval: RAG_EVAL,
  ragEvalDatasets: RAG_EVAL_DATASETS,
};

let sequence = 0;
export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

export function documentsFor(projectId: string | null): Document[] {
  if (projectId === null) {
    return store.documents.filter((doc) => doc.projectId === null || doc.alsoGeneral);
  }
  return store.documents.filter((doc) => doc.projectId === projectId);
}

/**
 * Counts are derived from the store rather than stored on the project.
 *
 * A hand-maintained `documentCount` is exactly the kind of number that drifts from the list
 * beside it and makes the whole screen untrustworthy — which is the one thing this product
 * cannot afford.
 */
export function projectsWithCounts(): Project[] {
  return store.projects.map((project) => ({
    ...project,
    documentCount: documentsFor(project.id).length,
    chatCount: store.chats.filter((chat) => chat.projectId === project.id).length,
  }));
}

export function indexStatsFor(projectId: string | null) {
  const docs = projectId === null ? store.documents : documentsFor(projectId);
  return {
    projectId,
    chunkCount: docs.reduce((total, doc) => total + doc.chunkCount, 0),
    documentCount: docs.length,
    embeddingModel: store.settings.embeddingModel,
    // ~30 KB per chunk covers the vector plus the stored passage text.
    indexSizeBytes: docs.reduce((total, doc) => total + doc.chunkCount, 0) * 31_500,
    lastRebuiltAt: docs.find((doc) => doc.indexedAt)?.indexedAt ?? null,
    staleDocumentCount: docs.filter((doc) => doc.stale).length,
  };
}

// ---------------------------------------------------------------------------
// Answer generation
// ---------------------------------------------------------------------------

interface Canned {
  match: RegExp;
  build: (chat: Chat) => Omit<Message, 'id' | 'chatId' | 'createdAt'>;
}

/** Defaults every canned answer starts from. Not `as const`: these arrays get spread into
 *  mutable message fields, and a readonly tuple there is a type error, not a safety win. */
const base: Pick<Message, 'figures' | 'toolCalls' | 'noEvidence' | 'suggestions'> = {
  figures: [],
  toolCalls: [],
  noEvidence: null,
  suggestions: [],
};

/**
 * Canned answers keyed on the question. Three of them exist to cover the states that are
 * genuinely hard to design for: a good grounded answer, a refusal, and a refusal that is
 * partially rescued by an approved tool.
 */
const CANNED: Canned[] = [
  {
    match: /torque|bolt|fasten/i,
    build: (chat) => ({
      ...base,
      role: 'assistant',
      content:
        'Nothing in the documents currently in context specifies a torque value for that fastener. The Mechanical Installation Guide covers frame alignment and levelling but stops before the fastening table.',
      citations: [],
      toolCalls: [
        {
          id: nextId('tool'),
          server: 'beumer-parts-db',
          tool: 'lookup_fastener',
          argumentsPreview: '{ size: "M20", grade: "8.8" }',
          result: 'The local parts database returns 385 Nm for an M20 grade 8.8 bolt, dry thread.',
          caveat:
            'This is a generic fastener value, not a project specification — confirm against the steel structure drawings before torquing.',
          status: 'ok',
        },
      ],
      noEvidence: 'nothing_retrieved',
      suggestions: ['Add the Steel Structure Spec to context', 'Search General documentation too'],
      timings: { totalMs: 2_740, retrievalMs: 640, generationMs: 2_100 },
      scope: chat.scope,
      modelId: store.settings.activeModelId,
      complexityTier: 'simple',
      complexityScore: 0.1,
      searchQuery: null,
      searchRewritten: null,
    }),
  },
  {
    match: /e-?stop|emergency stop|safety relay/i,
    build: (chat) => ({
      ...base,
      role: 'assistant',
      content: [
        'The emergency stop loop is a **dual-channel** circuit routed through the safety relay in cabinet A2. Each pull cord and each mushroom head is monitored on both channels, and a discrepancy between them for longer than 500 ms latches a fault.[1]',
        '',
        'A restart after an e-stop needs three conditions cleared:',
        '',
        '- Every actuated device physically reset — the relay will not accept a reset while any channel is still open.[1]',
        '- The `SAFETY_OK` bit set for a continuous 2 s, which is the relay’s own settling time.[2]',
        '- No active drive fault on the carrier line; a tripped drive keeps the sorter in stop even once the loop is healthy.[2]',
      ].join('\n'),
      citations: [
        {
          marker: 1,
          documentId: 'doc-estop-standard',
          documentTitle: 'Emergency Stop Circuits — Group Standard',
          section: '§ 4.2 Dual-channel monitoring',
          page: 22,
          revision: 'rev G',
          documentDate: '2025-06-04T00:00:00.000Z',
          excerpt:
            'Both channels shall be monitored independently. A channel discrepancy exceeding 500 ms shall latch a fault requiring manual reset.',
          score: 0.89,
        },
        {
          marker: 2,
          documentId: 'doc-sortation',
          documentTitle: 'Induction & Sortation Control Logic',
          section: '§ 9.1 Restart interlocks',
          page: 141,
          revision: 'rev B',
          documentDate: '2025-11-02T00:00:00.000Z',
          excerpt:
            'Restart is inhibited until SAFETY_OK has been continuously true for 2 s and no drive fault is present.',
          score: 0.84,
        },
      ],
      timings: { totalMs: 8_110, retrievalMs: 910, generationMs: 7_200 },
      scope: chat.scope,
      modelId: store.settings.activeModelId,
      complexityTier: 'complex',
      complexityScore: 0.55,
      searchQuery: null,
      searchRewritten: null,
    }),
  },
  {
    match: /.*/,
    build: (chat) => ({
      ...base,
      role: 'assistant',
      content: [
        'Rated throughput is **13,200 items/hour** at a 600 mm tray pitch and a nominal carrier speed of 2.2 m/s.[1]',
        '',
        'Two conditions reduce that figure in practice:',
        '',
        '- **Oversized items.** Anything longer than 800 mm occupies two trays; the induction controller blanks the following tray, so each oversized item costs one slot.[2]',
        '- **Chute back-pressure.** A destination reporting `CHUTE_FULL` forces recirculation; effective throughput drops by the recirculated share.[2]',
      ].join('\n'),
      citations: [
        {
          marker: 1,
          documentId: 'doc-commissioning',
          documentTitle: 'LS-4000E Commissioning Manual',
          section: '§ 3.2 Performance data',
          page: 41,
          revision: 'rev D',
          documentDate: '2026-03-11T00:00:00.000Z',
          excerpt:
            'Nominal sorter capacity is 13,200 items per hour at a tray pitch of 600 mm and a carrier speed of 2.2 m/s.',
          score: 0.9,
        },
        {
          marker: 2,
          documentId: 'doc-sortation',
          documentTitle: 'Induction & Sortation Control Logic',
          section: '§ 7.4 Recirculation',
          page: 112,
          revision: 'rev B',
          documentDate: '2025-11-02T00:00:00.000Z',
          excerpt:
            'Items exceeding 800 mm are allocated two consecutive trays. On CHUTE_FULL the allocator recirculates the item for one further pass.',
          score: 0.86,
        },
      ],
      figures: [
        {
          id: nextId('fig'),
          documentId: 'doc-commissioning',
          documentTitle: 'LS-4000E Commissioning Manual',
          label: 'Fig. 3.4',
          caption: 'Discharge sequence at nominal speed',
          description:
            'Shows the two-tray blanking pattern referenced in the first bullet. Extracted from page 43 of the commissioning manual.',
          page: 43,
          thumbnailUrl: '/figures/fig-discharge.svg',
        },
      ],
      timings: { totalMs: 7_220, retrievalMs: 820, generationMs: 6_400 },
      scope: chat.scope,
      modelId: store.settings.activeModelId,
      complexityTier: 'moderate',
      complexityScore: 0.3,
      searchQuery: null,
      searchRewritten: null,
    }),
  },
];

export function buildAnswer(chat: Chat, question: string): Message {
  const canned = CANNED.find((entry) => entry.match.test(question)) ?? CANNED[CANNED.length - 1]!;
  return {
    id: nextId('msg'),
    chatId: chat.id,
    createdAt: new Date().toISOString(),
    ...canned.build(chat),
  };
}

/**
 * Replays an answer as the event sequence the real service will emit: retrieval first, then
 * tokens, then the attachments, then the completed message. Token pacing is deliberately
 * uneven so the UI is tested against a stream that stutters, like a local model on CPU does.
 */
export function* answerEvents(chat: Chat, message: Message): Generator<AnswerEvent> {
  yield { type: 'accepted', messageId: message.id, chatId: chat.id };
  yield {
    type: 'retrieval',
    citations: message.citations,
    elapsedMs: message.timings?.retrievalMs ?? 800,
  };

  for (const chunk of chunkText(message.content)) {
    yield { type: 'token', text: chunk };
  }

  for (const figure of message.figures) yield { type: 'figure', figure };
  for (const toolCall of message.toolCalls) yield { type: 'tool', toolCall };

  yield { type: 'done', message };
}

/** Split on word boundaries into 1–4 word groups, the way a token stream actually arrives. */
function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  let target = 3;

  for (const word of words) {
    current += word;
    if (current.split(/\s+/).length >= target) {
      chunks.push(current);
      current = '';
      target = 1 + ((target + 1) % 4);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
