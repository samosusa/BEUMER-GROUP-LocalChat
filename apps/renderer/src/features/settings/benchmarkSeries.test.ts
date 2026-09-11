import { describe, expect, it } from 'vitest';
import type { ModelBenchmarkRow, ModelBenchmarkRun } from '@localchat/contracts';
import {
  METRICS,
  MAX_LINES,
  buildComparison,
  buildTrend,
  devicesMeasured,
  recentRuns,
} from './benchmarkSeries';

const SPEED = METRICS[0]!;
const MEMORY = METRICS.find((metric) => metric.key === 'peakMemory')!;

function row(over: Partial<ModelBenchmarkRow> = {}): ModelBenchmarkRow {
  return {
    modelId: 'qwen.gguf',
    modelName: 'qwen2.5-7b',
    compute: 'cpu',
    deviceName: 'Intel Core Ultra 7',
    status: 'ok',
    detail: null,
    loadMs: 4_000,
    timeToFirstTokenMs: 1_900,
    generatedTokens: 128,
    tokensPerSecond: 7.4,
    totalMs: 21_000,
    peakMemoryBytes: 5_000_000_000,
    peakVramBytes: null,
    ranAt: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

function run(at: string, rows: ModelBenchmarkRow[]): ModelBenchmarkRun {
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
  it('puts one slot per model and one column per device', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen', compute: 'cpu', tokensPerSecond: 7 }),
        row({ modelName: 'qwen', compute: 'gpu', tokensPerSecond: 41 }),
        row({ modelName: 'llama', compute: 'cpu', tokensPerSecond: 5 }),
      ]),
      SPEED,
    );

    expect(built.categories).toEqual(['qwen', 'llama']);
    expect(built.series.map((series) => series.label)).toEqual(['CPU', 'GPU']);
    expect(built.series[0]!.values).toEqual([7, 5]);
  });

  /**
   * A model that ran on CPU but not GPU keeps its slot with a null in it. The gap is the
   * information - "we never got this one onto the GPU" - and dropping the model would hide
   * exactly the thing worth seeing.
   */
  it('keeps a hole where a device never ran, rather than dropping the model', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen', compute: 'cpu' }),
        row({ modelName: 'qwen', compute: 'gpu' }),
        row({ modelName: 'llama', compute: 'cpu' }),
      ]),
      SPEED,
    );

    const gpu = built.series.find((series) => series.label === 'GPU')!;
    expect(gpu.values[built.categories.indexOf('llama')]).toBeNull();
  });

  it('leaves out rows that did not complete', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen' }),
        row({ modelName: 'broken', status: 'failed', tokensPerSecond: null }),
        row({ modelName: 'skipped', status: 'skipped', tokensPerSecond: null }),
      ]),
      SPEED,
    );

    expect(built.categories).toEqual(['qwen']);
  });

  it('reads VRAM for a GPU row and host memory for a CPU one', () => {
    const built = buildComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen', compute: 'cpu', peakMemoryBytes: 5_000, peakVramBytes: null }),
        row({ modelName: 'qwen', compute: 'gpu', peakMemoryBytes: 900, peakVramBytes: 6_000 }),
      ]),
      MEMORY,
    );

    expect(built.series.find((series) => series.label === 'CPU')!.values).toEqual([5_000]);
    expect(built.series.find((series) => series.label === 'GPU')!.values).toEqual([6_000]);
  });
});

describe('buildTrend', () => {
  const history = [
    run('2026-08-01T10:00:00.000Z', [
      row({ modelName: 'qwen', compute: 'cpu', tokensPerSecond: 6 }),
      row({ modelName: 'llama', compute: 'cpu', tokensPerSecond: 4 }),
    ]),
    run('2026-08-08T10:00:00.000Z', [
      row({ modelName: 'qwen', compute: 'cpu', tokensPerSecond: 7 }),
      row({ modelName: 'qwen', compute: 'gpu', tokensPerSecond: 40 }),
    ]),
  ];

  it('gives one line per model, oldest point first', () => {
    const { lines } = buildTrend(history, SPEED, 'cpu');
    const qwen = lines.find((line) => line.key === 'qwen')!;

    expect(qwen.points.map((point) => point.value)).toEqual([6, 7]);
    expect(qwen.points[0]!.at).toBeLessThan(qwen.points[1]!.at);
  });

  /**
   * The same model on CPU and on GPU differs by an order of magnitude. Sharing one axis
   * flattens every CPU line into a smear along the bottom, and the alternative - a second
   * y-axis - misstates every comparison it invites. So one device at a time.
   */
  it('never mixes devices onto one axis', () => {
    const cpu = buildTrend(history, SPEED, 'cpu');
    const gpu = buildTrend(history, SPEED, 'gpu');

    expect(cpu.lines.flatMap((line) => line.points.map((point) => point.value))).not.toContain(40);
    expect(gpu.lines).toHaveLength(1);
    expect(gpu.lines[0]!.points).toHaveLength(1);
  });

  it('ranks the most-measured models into the reliable hues', () => {
    const { lines } = buildTrend(history, SPEED, 'cpu');
    expect(lines[0]!.key).toBe('qwen');
    expect(lines[0]!.color).toBe('--series-1');
  });

  it('caps the series and reports how many it left out', () => {
    const many = run(
      '2026-08-01T10:00:00.000Z',
      Array.from({ length: MAX_LINES + 3 }, (_, index) =>
        row({ modelName: `model-${index}`, compute: 'cpu' }),
      ),
    );

    const { lines, omitted } = buildTrend([many], SPEED, 'cpu');
    expect(lines).toHaveLength(MAX_LINES);
    expect(omitted).toBe(3);
  });

  it('is empty rather than broken when nothing ran on that device', () => {
    expect(buildTrend(history, SPEED, 'gpu').lines.length).toBeGreaterThan(0);
    expect(buildTrend([], SPEED, 'cpu').lines).toEqual([]);
  });
});

describe('devicesMeasured', () => {
  it('offers only devices that produced a usable row', () => {
    const runs = [
      run('2026-08-01T10:00:00.000Z', [
        row({ compute: 'cpu' }),
        row({ compute: 'gpu', status: 'skipped', tokensPerSecond: null }),
      ]),
    ];
    expect(devicesMeasured(runs)).toEqual(['cpu']);
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

  /**
   * Ordered by when each run finished, not by id: a run started earlier can finish later,
   * and "the last five" means the last five to produce numbers.
   */
  it('orders by finish time rather than by the order it was handed', () => {
    const outOfOrder = [history[2]!, history[0]!, history[1]!];
    expect(recentRuns(outOfOrder, 2).map((entry) => entry.id)).toEqual([
      '2026-08-08T10:00:00.000Z',
      '2026-08-15T10:00:00.000Z',
    ]);
  });

  it('returns everything for an unbounded range', () => {
    expect(recentRuns(history, Number.POSITIVE_INFINITY)).toHaveLength(3);
  });

  it('does not blow up when asked for more runs than exist', () => {
    expect(recentRuns(history, 99)).toHaveLength(3);
  });
});
