import { describe, expect, it } from 'vitest';
import type { ModelBenchmarkRow, ModelBenchmarkRun } from '@localchat/contracts';
import {
  METRICS,
  buildComplexityComparison,
  hardwareNames,
  promptsMeasured,
  reduceValues,
  valueFor,
  NO_FILTER,
  applyFilter,
  buildSpeedup,
  buildTradeoff,
  modelsMeasured,
  recommend,
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
    promptLabel: 'simple',
    question: 'How often should pull-cords be inspected?',
    complexityTier: 'simple',
    complexityScore: 4.2,
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
   * The sawtooth. A run measures every prompt, so a model has three rows in it; pushing each
   * as its own point put three values on one x and the line zig-zagged between them. Every
   * segment a reader traced was question difficulty drawn in the shape of a time trend.
   */
  it('gives one point per run, not one per question', () => {
    const history = [
      run('2026-08-01T10:00:00.000Z', [
        row({ modelName: 'qwen', promptLabel: 'simple', tokensPerSecond: 19 }),
        row({ modelName: 'qwen', promptLabel: 'moderate', tokensPerSecond: 13 }),
        row({ modelName: 'qwen', promptLabel: 'complex', tokensPerSecond: 9 }),
      ]),
    ];

    const qwen = buildTrend(history, SPEED, 'cpu').lines.find((line) => line.key === 'qwen')!;

    expect(qwen.points).toHaveLength(1);
    expect(qwen.points[0]!.value).toBe(13);
  });

  /** A point on this chart and a column on the bar chart must be the same number. */
  it('reduces each run the way the metric asks - peak memory takes the worst case', () => {
    const history = [
      run('2026-08-01T10:00:00.000Z', [
        row({ modelName: 'qwen', promptLabel: 'simple', peakMemoryBytes: 4_000_000_000 }),
        row({ modelName: 'qwen', promptLabel: 'moderate', peakMemoryBytes: 4_800_000_000 }),
        row({ modelName: 'qwen', promptLabel: 'complex', peakMemoryBytes: 4_400_000_000 }),
      ]),
    ];

    const qwen = buildTrend(history, MEMORY, 'cpu').lines.find((line) => line.key === 'qwen')!;

    expect(qwen.points[0]!.value).toBe(4_800_000_000);
  });

  /** Ranking is by runs measured, so three rows in one run must not count as three runs. */
  it('ranks models by how many runs they appear in, not how many rows', () => {
    const history = [
      run('2026-08-01T10:00:00.000Z', [
        row({ modelName: 'noisy', promptLabel: 'simple' }),
        row({ modelName: 'noisy', promptLabel: 'moderate' }),
        row({ modelName: 'noisy', promptLabel: 'complex' }),
      ]),
      run('2026-08-08T10:00:00.000Z', [row({ modelName: 'steady', promptLabel: 'simple' })]),
      run('2026-08-15T10:00:00.000Z', [row({ modelName: 'steady', promptLabel: 'simple' })]),
    ];

    const { lines } = buildTrend(history, SPEED, 'cpu');

    expect(lines[0]!.key).toBe('steady');
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

describe('recommend', () => {
  const run3 = run('2026-09-01T10:00:00.000Z', [
    row({ modelName: 'big', tokensPerSecond: 12, peakMemoryBytes: 8_000 }),
    row({ modelName: 'small', tokensPerSecond: 5, peakMemoryBytes: 1_000 }),
  ]);

  it('names the fastest and the smallest separately when they differ', () => {
    const advice = recommend(run3);
    expect(advice.fastest?.modelName).toBe('big');
    expect(advice.leanest?.modelName).toBe('small');
    expect(advice.sameModel).toBe(false);
  });

  /** When one model wins both, the screen should say it once rather than twice. */
  it('flags the case where one model is both', () => {
    const advice = recommend(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'best', tokensPerSecond: 20, peakMemoryBytes: 900 }),
        row({ modelName: 'other', tokensPerSecond: 4, peakMemoryBytes: 5_000 }),
      ]),
    );
    expect(advice.sameModel).toBe(true);
  });

  it('measures a GPU row by its VRAM, not its host memory', () => {
    const advice = recommend(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'cpu-one', compute: 'cpu', peakMemoryBytes: 2_000, peakVramBytes: null }),
        row({ modelName: 'gpu-one', compute: 'gpu', peakMemoryBytes: 500, peakVramBytes: 9_000 }),
      ]),
    );
    expect(advice.leanest?.modelName).toBe('cpu-one');
  });

  it('says nothing rather than guessing when no row completed', () => {
    const advice = recommend(
      run('2026-09-01T10:00:00.000Z', [row({ status: 'failed', tokensPerSecond: null })]),
    );
    expect(advice.fastest).toBeNull();
    expect(advice.leanest).toBeNull();
  });
});

describe('buildSpeedup', () => {
  const both = run('2026-09-01T10:00:00.000Z', [
    row({ modelName: 'qwen', compute: 'cpu', tokensPerSecond: 5, timeToFirstTokenMs: 2_000 }),
    row({ modelName: 'qwen', compute: 'gpu', tokensPerSecond: 10, timeToFirstTokenMs: 1_000 }),
  ]);

  it('reports the GPU as a ratio of the CPU', () => {
    const [entry] = buildSpeedup(both, SPEED);
    expect(entry?.ratio).toBeCloseTo(2);
  });

  /**
   * The whole point of the chart is that "above 1x" always means the GPU helped. For a
   * lower-is-better measure the ratio has to invert, or the same bar would mean the
   * opposite thing depending on the dropdown.
   */
  it('inverts the ratio for a measure where lower is better', () => {
    const ttft = METRICS.find((metric) => metric.key === 'timeToFirstToken')!;
    const [entry] = buildSpeedup(both, ttft);
    expect(entry?.ratio).toBeCloseTo(2);
  });

  it('leaves out a model that only ran on one device', () => {
    const onlyCpu = run('2026-09-01T10:00:00.000Z', [row({ modelName: 'qwen', compute: 'cpu' })]);
    expect(buildSpeedup(onlyCpu, SPEED)).toEqual([]);
  });

  it('does not divide by zero', () => {
    const zeroed = run('2026-09-01T10:00:00.000Z', [
      row({ modelName: 'qwen', compute: 'cpu', tokensPerSecond: 0 }),
      row({ modelName: 'qwen', compute: 'gpu', tokensPerSecond: 4 }),
    ]);
    expect(buildSpeedup(zeroed, SPEED)).toEqual([]);
  });
});

describe('buildTradeoff', () => {
  it('gives one point per model and device, labelled with both', () => {
    const points = buildTradeoff(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen', compute: 'cpu' }),
        row({ modelName: 'qwen', compute: 'gpu', peakVramBytes: 6_000 }),
      ]),
    );
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.label)).toContain('qwen · GPU');
  });

  it('colors by device, not model, matching the bar chart above it', () => {
    const points = buildTradeoff(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen', compute: 'cpu' }),
        row({ modelName: 'qwen', compute: 'gpu', peakVramBytes: 6_000 }),
        row({ modelName: 'llama', compute: 'cpu' }),
      ]),
    );
    const byLabel = (label: string) => points.find((point) => point.label === label);
    expect(byLabel('qwen · CPU')?.color).toBe('--series-1');
    expect(byLabel('qwen · GPU')?.color).toBe('--series-2');
    expect(byLabel('llama · CPU')?.color).toBe(byLabel('qwen · CPU')?.color);
  });
});

describe('applyFilter', () => {
  const mixed = run('2026-09-01T10:00:00.000Z', [
    row({ modelName: 'qwen', compute: 'cpu' }),
    row({ modelName: 'llama', compute: 'gpu' }),
    row({ modelName: 'broken', status: 'failed', tokensPerSecond: null }),
  ]);

  /** Clearing the last checkbox should not blank the screen. */
  it('treats an empty selection as everything', () => {
    expect(applyFilter(mixed, NO_FILTER).rows).toHaveLength(2);
  });

  it('narrows by device', () => {
    const only = applyFilter(mixed, { ...NO_FILTER, devices: ['cpu'] });
    expect(only.rows.map((r) => r.modelName)).toEqual(['qwen']);
  });

  it('narrows by model', () => {
    const only = applyFilter(mixed, { ...NO_FILTER, models: ['llama'] });
    expect(only.rows.map((r) => r.modelName)).toEqual(['llama']);
  });

  it('hides rows that did not complete unless asked', () => {
    expect(applyFilter(mixed, NO_FILTER).rows.some((r) => r.status === 'failed')).toBe(false);
    expect(
      applyFilter(mixed, { ...NO_FILTER, includeUnmeasured: true }).rows.some(
        (r) => r.status === 'failed',
      ),
    ).toBe(true);
  });
});

describe('modelsMeasured', () => {
  it('lists every model across the history, including ones that failed', () => {
    expect(
      modelsMeasured([
        run('2026-08-01T10:00:00.000Z', [row({ modelName: 'b' })]),
        run('2026-08-08T10:00:00.000Z', [row({ modelName: 'a', status: 'failed' })]),
      ]).toSorted(),
    ).toEqual(['a', 'b']);
  });

  /** The chips sit above charts ordered by the latest run. Alphabetical put them out of step. */
  it('follows the newest run\u2019s order, not the alphabet', () => {
    expect(
      modelsMeasured([
        run('2026-08-01T10:00:00.000Z', [row({ modelName: 'zeta' })]),
        run('2026-08-08T10:00:00.000Z', [row({ modelName: 'qwen' }), row({ modelName: 'alpha' })]),
      ]),
    ).toEqual(['qwen', 'alpha', 'zeta']);
  });
});

/**
 * A run is models x devices x PROMPTS. One model on one device produces three rows, one per
 * question, and the prompt set is ordered simple-first — so anything that reads a single row
 * reports the EASIEST question's timing as the model's headline number, silently.
 */
describe('several rows per model and device', () => {
  const threePrompts = (over: Partial<ModelBenchmarkRow>) => [
    row({ ...over, promptLabel: 'simple', tokensPerSecond: 12, timeToFirstTokenMs: 900 }),
    row({ ...over, promptLabel: 'moderate', tokensPerSecond: 8, timeToFirstTokenMs: 1_400 }),
    row({ ...over, promptLabel: 'complex', tokensPerSecond: 4, timeToFirstTokenMs: 2_600 }),
  ];

  const run3 = run('2026-09-01T10:00:00.000Z', threePrompts({ modelName: 'qwen' }));

  it('reports the median across the prompts, not the first row', () => {
    const built = buildComparison(run3, SPEED);
    // 12 would be the simple prompt alone; 8 is the median of the three.
    expect(built.series[0]!.values).toEqual([8]);
  });

  it('takes the worst case for peak memory, because a peak is a peak', () => {
    const memory = METRICS.find((metric) => metric.key === 'peakMemory')!;
    const varied = run('2026-09-01T10:00:00.000Z', [
      row({ modelName: 'qwen', promptLabel: 'simple', peakMemoryBytes: 1_000 }),
      row({ modelName: 'qwen', promptLabel: 'complex', peakMemoryBytes: 4_000 }),
    ]);
    expect(buildComparison(varied, memory).series[0]!.values).toEqual([4_000]);
  });

  it('ranks the recommendation on the same aggregate the chart draws', () => {
    const advice = recommend(run3);
    expect(advice.fastest?.tokensPerSecond).toBe(8);
  });

  it('builds the GPU ratio from aggregates, not from one prompt each side', () => {
    const both = run('2026-09-01T10:00:00.000Z', [
      ...threePrompts({ modelName: 'qwen', compute: 'cpu' }),
      row({ modelName: 'qwen', compute: 'gpu', promptLabel: 'simple', tokensPerSecond: 24 }),
      row({ modelName: 'qwen', compute: 'gpu', promptLabel: 'moderate', tokensPerSecond: 16 }),
      row({ modelName: 'qwen', compute: 'gpu', promptLabel: 'complex', tokensPerSecond: 8 }),
    ]);
    // medians are 8 and 16, so 2x - not 24/12 which would also be 2x by luck, nor 24/8.
    expect(buildSpeedup(both, SPEED)[0]?.ratio).toBeCloseTo(2);
  });

  it('draws one scatter point per model and device, not one per prompt', () => {
    expect(buildTradeoff(run3)).toHaveLength(1);
  });
});

describe('reduceValues', () => {
  it('takes the middle of an odd sample', () => {
    expect(reduceValues([4, 12, 8], 'median')).toBe(8);
  });

  it('averages the middle pair of an even sample', () => {
    expect(reduceValues([4, 8, 12, 16], 'median')).toBe(10);
  });

  it('takes the largest for a peak', () => {
    expect(reduceValues([1_000, 4_000, 2_000], 'max')).toBe(4_000);
  });

  it('is null rather than NaN for nothing measured', () => {
    expect(reduceValues([], 'median')).toBeNull();
  });
});

describe('valueFor', () => {
  const rows = [
    row({ modelName: 'qwen', compute: 'cpu', promptLabel: 'simple', tokensPerSecond: 12 }),
    row({ modelName: 'qwen', compute: 'cpu', promptLabel: 'complex', tokensPerSecond: 4 }),
    row({ modelName: 'qwen', compute: 'cpu', promptLabel: 'moderate', tokensPerSecond: 8 }),
  ];

  it('narrows to one prompt when asked', () => {
    expect(valueFor(rows, 'qwen', 'cpu', SPEED, 'complex')).toBe(4);
  });

  it('aggregates every prompt when not', () => {
    expect(valueFor(rows, 'qwen', 'cpu', SPEED)).toBe(8);
  });

  it('ignores rows that did not complete', () => {
    const withFailure = [
      ...rows,
      row({ modelName: 'qwen', status: 'failed', tokensPerSecond: 999 }),
    ];
    expect(valueFor(withFailure, 'qwen', 'cpu', SPEED)).toBe(8);
  });
});

describe('promptsMeasured', () => {
  /** Alphabetical would give complex, moderate, simple - a difficulty axis read backwards. */
  it('orders simple before moderate before complex', () => {
    const mixed = run('2026-09-01T10:00:00.000Z', [
      row({ promptLabel: 'complex' }),
      row({ promptLabel: 'simple' }),
      row({ promptLabel: 'moderate' }),
    ]);
    expect(promptsMeasured([mixed])).toEqual(['simple', 'moderate', 'complex']);
  });
});

describe('buildComplexityComparison', () => {
  it('puts one slot per model and one column per question difficulty', () => {
    const built = buildComplexityComparison(
      run('2026-09-01T10:00:00.000Z', [
        row({ modelName: 'qwen', promptLabel: 'simple', tokensPerSecond: 12 }),
        row({ modelName: 'qwen', promptLabel: 'complex', tokensPerSecond: 4 }),
      ]),
      SPEED,
      'cpu',
    );
    expect(built.categories).toEqual(['qwen']);
    expect(built.series.map((entry) => entry.label)).toEqual(['simple', 'complex']);
    expect(built.series[0]!.values).toEqual([12]);
    expect(built.series[1]!.values).toEqual([4]);
  });
});

describe('hardwareNames', () => {
  /** Samo's actual ask: tests across different CPUs and GPUs, named rather than "CPU"/"GPU". */
  it('reports the hardware each device ran on', () => {
    const named = run('2026-09-01T10:00:00.000Z', [
      row({ compute: 'cpu', deviceName: 'Intel Core Ultra 7 165H' }),
      row({ compute: 'gpu', deviceName: 'NVIDIA GeForce RTX 4070' }),
    ]);
    const names = hardwareNames([named]);
    expect(names.get('cpu')).toBe('Intel Core Ultra 7 165H');
    expect(names.get('gpu')).toBe('NVIDIA GeForce RTX 4070');
  });

  it('has no entry for a device that never reported a name', () => {
    const anonymous = run('2026-09-01T10:00:00.000Z', [row({ compute: 'gpu', deviceName: null })]);
    expect(hardwareNames([anonymous]).has('gpu')).toBe(false);
  });
});
