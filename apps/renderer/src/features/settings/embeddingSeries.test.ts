import { describe, expect, it } from 'vitest';
import type { EmbeddingBenchmarkRow, EmbeddingBenchmarkRun } from '@localchat/contracts';
import {
  EMBEDDING_METRICS,
  buildEmbeddingTrend,
  buildTierComparison,
  recommendEmbedding,
  tiersMeasured,
} from './embeddingSeries';

const THROUGHPUT = EMBEDDING_METRICS[0]!;

function row(over: Partial<EmbeddingBenchmarkRow> = {}): EmbeddingBenchmarkRow {
  return {
    model: 'bge-small',
    dimension: 384,
    status: 'ok',
    detail: null,
    loadMs: 900,
    textLabel: 'short',
    textCount: 5,
    embedMs: 40,
    textsPerSecond: 125,
    peakMemoryBytes: 350_000_000,
    ranAt: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

function run(at: string, rows: EmbeddingBenchmarkRow[]): EmbeddingBenchmarkRun {
  return {
    id: at,
    status: 'completed',
    progress: null,
    current: null,
    rows,
    startedAt: at,
    finishedAt: at,
  };
}

describe('tiersMeasured', () => {
  /**
   * Alphabetical order gives "long, medium, short", which makes a chart about degradation
   * read backwards. The order is fixed on purpose.
   */
  it('orders short before medium before long, whatever order they arrive in', () => {
    const runs = [
      run('2026-09-01T10:00:00.000Z', [
        row({ textLabel: 'long' }),
        row({ textLabel: 'short' }),
        row({ textLabel: 'medium' }),
      ]),
    ];
    expect(tiersMeasured(runs)).toEqual(['short', 'medium', 'long']);
  });

  it('ignores tiers whose only rows failed', () => {
    const runs = [
      run('2026-09-01T10:00:00.000Z', [
        row({ textLabel: 'short' }),
        row({ textLabel: 'long', status: 'failed', textsPerSecond: null }),
      ]),
    ];
    expect(tiersMeasured(runs)).toEqual(['short']);
  });
});

describe('buildTierComparison', () => {
  const both = run('2026-09-01T10:00:00.000Z', [
    row({ model: 'bge', textLabel: 'short', textsPerSecond: 120 }),
    row({ model: 'bge', textLabel: 'long', textsPerSecond: 10 }),
    row({ model: 'minilm', textLabel: 'short', textsPerSecond: 90 }),
    row({ model: 'minilm', textLabel: 'long', textsPerSecond: 60 }),
  ]);

  /**
   * Tier is the series, not the category: the comparison worth seeing is one model's short
   * bar against its own long bar, which only works if they sit in the same slot.
   */
  it('puts one slot per model and one column per text tier', () => {
    const built = buildTierComparison(both, THROUGHPUT);
    expect(built.categories).toEqual(['bge', 'minilm']);
    expect(built.series.map((entry) => entry.label)).toEqual(['short', 'long']);
    expect(built.series[0]!.values).toEqual([120, 90]);
    expect(built.series[1]!.values).toEqual([10, 60]);
  });

  it('leaves a hole where a model was not measured on a tier', () => {
    const partial = run('2026-09-01T10:00:00.000Z', [
      row({ model: 'bge', textLabel: 'short' }),
      row({ model: 'bge', textLabel: 'long' }),
      row({ model: 'minilm', textLabel: 'short' }),
    ]);
    const built = buildTierComparison(partial, THROUGHPUT);
    const long = built.series.find((entry) => entry.label === 'long')!;
    expect(long.values[built.categories.indexOf('minilm')]).toBeNull();
  });
});

describe('buildEmbeddingTrend', () => {
  const history = [
    run('2026-08-01T10:00:00.000Z', [
      row({ model: 'bge', textLabel: 'short', textsPerSecond: 100 }),
      row({ model: 'bge', textLabel: 'long', textsPerSecond: 9 }),
    ]),
    run('2026-08-08T10:00:00.000Z', [
      row({ model: 'bge', textLabel: 'short', textsPerSecond: 120 }),
      row({ model: 'bge', textLabel: 'long', textsPerSecond: 10 }),
    ]),
  ];

  it('follows one tier at a time, oldest point first', () => {
    const { lines } = buildEmbeddingTrend(history, THROUGHPUT, 'short');
    expect(lines[0]!.points.map((point) => point.value)).toEqual([100, 120]);
  });

  /** Short and long differ by an order of magnitude; one axis would flatten long to zero. */
  it('never mixes tiers onto one axis', () => {
    const values = buildEmbeddingTrend(history, THROUGHPUT, 'long').lines.flatMap((line) =>
      line.points.map((point) => point.value),
    );
    expect(values).toEqual([9, 10]);
  });

  it('is empty rather than broken for a tier nothing measured', () => {
    expect(buildEmbeddingTrend(history, THROUGHPUT, 'medium').lines).toEqual([]);
  });
});

describe('recommendEmbedding', () => {
  const run1 = run('2026-09-01T10:00:00.000Z', [
    row({ model: 'fast-but-fragile', textLabel: 'short', textsPerSecond: 200 }),
    row({ model: 'fast-but-fragile', textLabel: 'long', textsPerSecond: 20 }),
    row({ model: 'steady', textLabel: 'short', textsPerSecond: 100 }),
    row({ model: 'steady', textLabel: 'long', textsPerSecond: 70 }),
  ]);

  it('names the fastest by raw throughput', () => {
    expect(recommendEmbedding(run1).fastest?.model).toBe('fast-but-fragile');
  });

  /**
   * The finding this benchmark exists for: the model that wins on short text is not the one
   * to point at a 200-page manual.
   */
  it('names the model that holds up best on long text, which is a different one', () => {
    const advice = recommendEmbedding(run1);
    expect(advice.steadiest?.model).toBe('steady');
    expect(advice.steadiest?.retained).toBeCloseTo(0.7);
  });

  it('reports no retention figure when only one tier ran', () => {
    const single = run('2026-09-01T10:00:00.000Z', [row({ model: 'bge', textLabel: 'short' })]);
    expect(recommendEmbedding(single).steadiest).toBeNull();
  });
});
