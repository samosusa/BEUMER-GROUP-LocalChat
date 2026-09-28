import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@localchat/contracts';
import { forgetAllTimings, rememberTimings, withMeasuredTimings } from './turnTimings';

afterEach(forgetAllTimings);

function assistant(id: string, timings: Message['timings'] = null): Message {
  return {
    id,
    chatId: 'chat-1',
    scope: 'general',
    modelId: null,
    role: 'assistant',
    content: 'Rated throughput is 10,800 items per hour.',
    citations: [],
    figures: [],
    toolCalls: [],
    noEvidence: null,
    suggestions: [],
    timings,
    complexityTier: null,
    complexityScore: null,
    searchQuery: null,
    searchRewritten: null,
    createdAt: '2026-09-07T18:00:00.000Z',
  };
}

describe('turnTimings', () => {
  /**
   * The bug this exists for: the stream reports how long the turn took, the transcript is
   * then refetched for one source of truth, and the service does not report timings — so the
   * measurement vanished a moment after the answer appeared.
   */
  it('restores a measurement the refetch dropped', () => {
    rememberTimings('m1', { totalMs: 2_140, retrievalMs: null, generationMs: null });

    const restored = withMeasuredTimings([assistant('m1')]);

    expect(restored[0]?.timings).toEqual({ totalMs: 2_140, retrievalMs: null, generationMs: null });
  });

  /**
   * When the service starts reporting retrieval_ms and generation_ms, its numbers are better
   * than the client's — they can see the split. This must not overwrite them.
   */
  it('leaves timings the service reported alone', () => {
    rememberTimings('m1', { totalMs: 2_140, retrievalMs: null, generationMs: null });

    const fromService = { totalMs: 2_000, retrievalMs: 300, generationMs: 1_700 };
    const kept = withMeasuredTimings([assistant('m1', fromService)]);

    expect(kept[0]?.timings).toEqual(fromService);
  });

  it('leaves a message it never measured untouched', () => {
    const untouched = withMeasuredTimings([assistant('never-asked')]);
    expect(untouched[0]?.timings).toBeNull();
  });

  it('ignores a null measurement rather than storing an empty entry', () => {
    rememberTimings('m1', null);
    expect(withMeasuredTimings([assistant('m1')])[0]?.timings).toBeNull();
  });

  /** A long session must not grow the map without bound. */
  it('evicts the oldest measurement past the cap', () => {
    for (let i = 0; i < 205; i += 1) {
      rememberTimings(`m${i}`, { totalMs: i, retrievalMs: null, generationMs: null });
    }

    expect(withMeasuredTimings([assistant('m0')])[0]?.timings).toBeNull();
    expect(withMeasuredTimings([assistant('m204')])[0]?.timings).toEqual({
      totalMs: 204,
      retrievalMs: null,
      generationMs: null,
    });
  });
});
