import { describe, expect, it } from 'vitest';
import type { EmbeddingBenchmarkRow, EmbeddingBenchmarkRun } from '@localchat/contracts';
import {
  MAX_LINES,
  METRICS,
  buildComparison,
  buildTrend,
  recentRuns,
  textSizesMeasured,
} from './embeddingBenchmarkSeries';

const SPEED = METRICS[0]!;
const MEMORY = METRICS.find((metric) => metric.key === 'peakMemory')!;

function row(over: Partial<EmbeddingBenchmarkRow> = {}): EmbeddingBenchmarkRow {
  return {
    model: 'bge-small-en',
    dimension: 384,
    status: 'ok',
    detail: null,
    loadMs: 900,
    textLabel: 'short',
    textCount: 5,
    embedMs: 40,
    textsPerSecond: 125,
    peakMemoryBytes: 400_000_000,
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

describe('buildComparison', () => {
  it('puts one slot per model and one column per text size', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ model: 'bge-small', textLabel: 'short', textsPerSecond: 125 }),
        row({ model: 'bge-small', textLabel: 'long', textsPerSecond: 10 }),
        row({ model: 'e5-base', textLabel: 'short', textsPerSecond: 80 }),
      ]),
      SPEED,
    );

    expect(built.categories).toEqual(['bge-small', 'e5-base']);
    expect(built.series.map((series) => series.label)).toEqual(['Short', 'Long']);
    expect(built.series[0]!.values).toEqual([125, 80]);
  });

  it('orders text-size series short, medium, long regardless of row order', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ model: 'bge-small', textLabel: 'long' }),
        row({ model: 'bge-small', textLabel: 'short' }),
        row({ model: 'bge-small', textLabel: 'medium' }),
      ]),
      SPEED,
    );

    expect(built.series.map((series) => series.key)).toEqual(['short', 'medium', 'long']);
  });

  /**
   * A model measured at one text size but not another keeps its slot with a null in it, the
   * same rule the model benchmark uses for a device that never ran.
   */
  it('keeps a hole where a text size was never measured, rather than dropping the model', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ model: 'bge-small', textLabel: 'short' }),
        row({ model: 'bge-small', textLabel: 'long' }),
        row({ model: 'e5-base', textLabel: 'short' }),
      ]),
      SPEED,
    );

    const long = built.series.find((series) => series.key === 'long')!;
    expect(long.values[built.categories.indexOf('e5-base')]).toBeNull();
  });

  it('leaves out rows that did not complete', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ model: 'bge-small' }),
        row({ model: 'broken', status: 'failed', textsPerSecond: null }),
        row({ model: 'skipped', status: 'skipped', textsPerSecond: null }),
      ]),
      SPEED,
    );

    expect(built.categories).toEqual(['bge-small']);
  });

  it('reads peak memory per row', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ model: 'bge-small', textLabel: 'short', peakMemoryBytes: 400_000_000 }),
        row({ model: 'bge-small', textLabel: 'long', peakMemoryBytes: 420_000_000 }),
      ]),
      MEMORY,
    );

    expect(built.series.find((series) => series.key === 'short')!.values).toEqual([400_000_000]);
    expect(built.series.find((series) => series.key === 'long')!.values).toEqual([420_000_000]);
  });
});

describe('buildTrend', () => {
  const history = [
    run('2026-08-01T10:00:00.000Z', [
      row({ model: 'bge-small', textLabel: 'short', textsPerSecond: 100 }),
      row({ model: 'e5-base', textLabel: 'short', textsPerSecond: 60 }),
    ]),
    run('2026-08-08T10:00:00.000Z', [
      row({ model: 'bge-small', textLabel: 'short', textsPerSecond: 125 }),
      row({ model: 'bge-small', textLabel: 'long', textsPerSecond: 10 }),
    ]),
  ];

  it('gives one line per model, oldest point first', () => {
    const { lines } = buildTrend(history, SPEED, 'short');
    const bge = lines.find((line) => line.key === 'bge-small')!;

    expect(bge.points.map((point) => point.value)).toEqual([100, 125]);
    expect(bge.points[0]!.at).toBeLessThan(bge.points[1]!.at);
  });

  /**
   * A short passage and a long one differ by an order of magnitude in throughput; sharing one
   * axis would flatten the short-text line into a smear along the bottom.
   */
  it('never mixes text sizes onto one axis', () => {
    const short = buildTrend(history, SPEED, 'short');
    const long = buildTrend(history, SPEED, 'long');

    expect(
      short.lines.flatMap((line) => line.points.map((point) => point.value)),
    ).not.toContain(10);
    expect(long.lines).toHaveLength(1);
    expect(long.lines[0]!.points).toHaveLength(1);
  });

  it('ranks the most-measured models into the reliable hues', () => {
    const { lines } = buildTrend(history, SPEED, 'short');
    expect(lines[0]!.key).toBe('bge-small');
    expect(lines[0]!.color).toBe('--series-1');
  });

  it('caps the series and reports how many it left out', () => {
    const many = run(
      '2026-08-01T10:00:00.000Z',
      Array.from({ length: MAX_LINES + 3 }, (_, index) =>
        row({ model: `model-${index}`, textLabel: 'short' }),
      ),
    );

    const { lines, omitted } = buildTrend([many], SPEED, 'short');
    expect(lines).toHaveLength(MAX_LINES);
    expect(omitted).toBe(3);
  });

  it('is empty rather than broken when nothing ran at that text size', () => {
    expect(buildTrend(history, SPEED, 'long').lines.length).toBeGreaterThan(0);
    expect(buildTrend([], SPEED, 'short').lines).toEqual([]);
  });
});

describe('textSizesMeasured', () => {
  it('offers only text sizes that produced a usable row, in reading order', () => {
    const runs = [
      run('2026-08-01T10:00:00.000Z', [
        row({ textLabel: 'long' }),
        row({ textLabel: 'short' }),
        row({ textLabel: 'medium', status: 'skipped', textsPerSecond: null }),
      ]),
    ];
    expect(textSizesMeasured(runs)).toEqual(['short', 'long']);
  });
});

describe('recentRuns', () => {
  const history = [
    run('2026-08-01T10:00:00.000Z', [row()]),
    run('2026-08-08T10:00:00.000Z', [row()]),
    run('2026-08-15T10:00:00.000Z', [row()]),
  ];

  it('keeps the newest runs and leaves them oldest-first', () => {
    const kept = recentRuns(history, 2);
    expect(kept.map((entry) => entry.id)).toEqual([
      '2026-08-08T10:00:00.000Z',
      '2026-08-15T10:00:00.000Z',
    ]);
  });

  it('returns everything for an unbounded range', () => {
    expect(recentRuns(history, Number.POSITIVE_INFINITY)).toHaveLength(3);
  });
});
