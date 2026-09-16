import type { ComputeMode, ModelBenchmarkRow, ModelBenchmarkRun } from '@localchat/contracts';
import { formatBytes, formatDuration } from '@/shared/lib/format';

/**
 * Turning benchmark rows into chart series. Pure, and kept out of the component so the
 * decisions below can be tested without a DOM.
 */

/**
 * How several rows for the same model and device collapse into one number.
 *
 * A run measures every model on every device against EVERY prompt, so one model on one
 * device has three rows, not one. Reading the first of them - which `.find()` did, and the
 * prompt set is ordered simple-first - reported the easiest question's timing as the
 * model's headline figure, with nothing on screen to say so.
 *
 * `median` for rates and durations: three samples, and the middle one is not dragged around
 * by the complex prompt the way a mean is. `max` for memory, because a peak is a peak - the
 * machine has to survive the worst case, not the typical one.
 */
export type Reducer = 'median' | 'max';

export function reduceValues(values: number[], how: Reducer): number | null {
  if (values.length === 0) return null;
  if (how === 'max') return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export interface Metric {
  key: string;
  label: string;
  /** How to collapse this measure's several prompt rows into one figure. */
  reduce: Reducer;
  /**
   * Not decoration. "3.1 s" and "9.4 tok/s" look like the same kind of improvement, and on
   * a load-time chart the best model has the SHORTEST bar. The screen says which way is
   * good, in words, because the chart cannot.
   */
  higherIsBetter: boolean;
  of: (row: ModelBenchmarkRow) => number | null;
  format: (value: number) => string;
}

export const METRICS: Metric[] = [
  {
    key: 'tokensPerSecond',
    label: 'Generation speed',
    reduce: 'median',
    higherIsBetter: true,
    of: (row) => row.tokensPerSecond,
    format: (value) => `${value.toFixed(value < 10 ? 1 : 0)} tok/s`,
  },
  {
    key: 'timeToFirstToken',
    label: 'Time to first token',
    reduce: 'median',
    higherIsBetter: false,
    of: (row) => row.timeToFirstTokenMs,
    format: formatDuration,
  },
  {
    key: 'loadMs',
    label: 'Model load time',
    reduce: 'median',
    higherIsBetter: false,
    of: (row) => row.loadMs,
    format: formatDuration,
  },
  {
    key: 'peakMemory',
    label: 'Peak memory',
    reduce: 'max',
    higherIsBetter: false,
    /** A GPU row's cost is its VRAM; falling back to host memory keeps CPU rows comparable. */
    of: (row) => row.peakVramBytes ?? row.peakMemoryBytes,
    format: (value) => formatBytes(value, 1),
  },
];

export const SERIES_COLORS = [
  '--series-1',
  '--series-2',
  '--series-3',
  '--series-4',
  '--series-5',
  '--series-6',
] as const;

/** Past this, hue stops being a reliable channel; the rest stay in the table. */
export const MAX_LINES = SERIES_COLORS.length;

export interface ComparisonSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

/**
 * The latest run as columns: one slot per model, one column per device.
 *
 * Series are device, not model, so the two columns a reader compares side by side are the
 * same model on CPU and on GPU - which is the decision this screen exists to support.
 *
 * A model that ran on one device and not the other keeps its slot with a null in it. The
 * gap is information ("we never got this on the GPU"); dropping the model would hide it.
 */
export function buildComparison(
  run: ModelBenchmarkRun,
  metric: Metric,
  tier?: string | null,
): { categories: string[]; series: ComparisonSeries[] } {
  const ok = run.rows.filter((row) => row.status === 'ok' && metric.of(row) !== null);
  const categories = [...new Set(ok.map((row) => row.modelName))];
  const devices = [...new Set(ok.map((row) => row.compute))].sort();

  const series = devices.map((device, index) => ({
    key: device,
    label: device.toUpperCase(),
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
    // Across every prompt, not the first one that matched.
    values: categories.map((model) => valueFor(run.rows, model, device, metric, tier)),
  }));

  return { categories, series };
}

/**
 * One slot per model, one column per prompt difficulty, for a single device.
 *
 * The same shape as the embedding card's text tiers, and for the same reason: the run
 * already measures three questions of rising difficulty, and how much a model slows down
 * between the easy one and the hard one is a finding the averaged view hides. A model that
 * is quick on "how often should pull-cords be inspected?" and slow on the two-clause
 * question is the wrong model for an engineer who asks real questions.
 */
export function buildComplexityComparison(
  run: ModelBenchmarkRun,
  metric: Metric,
  device: ComputeMode,
): { categories: string[]; series: ComparisonSeries[] } {
  const ok = run.rows.filter((row) => row.status === 'ok' && row.compute === device);
  const categories = [...new Set(ok.map((row) => row.modelName))];
  const prompts = promptsMeasured([run]);

  const series = prompts.map((prompt, index) => ({
    key: prompt,
    label: prompt,
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
    values: categories.map((model) => valueFor(run.rows, model, device, metric, prompt)),
  }));

  return { categories, series };
}

export interface TrendLine {
  key: string;
  label: string;
  color: string;
  points: Array<{ at: number; value: number }>;
}

/**
 * One line per model across runs, for a single device.
 *
 * Filtered to one device rather than drawing both: the same model on CPU and on GPU differs
 * by an order of magnitude, and sharing one axis flattens every CPU line into a smear along
 * the bottom. Two devices means two looks at the chart, which is the honest version - the
 * alternative is a second y-axis, which misstates every comparison it appears to invite.
 *
 * One run contributes ONE point per model. Since a run started measuring every prompt, a
 * model has three rows in it, and pushing each row as its own point put three values on the
 * same x: the line then zig-zagged between them and every segment a reader traced was the
 * cost of question difficulty wearing the shape of a trend over time. Same reduction as the
 * bar charts use, so a point here and a column there are the same number.
 */
export function buildTrend(
  history: ModelBenchmarkRun[],
  metric: Metric,
  device: ComputeMode,
): { lines: TrendLine[]; omitted: number } {
  const byModel = new Map<string, Array<{ at: number; value: number }>>();

  for (const run of history) {
    const at = Date.parse(run.finishedAt ?? run.startedAt);
    if (Number.isNaN(at)) continue;

    const samples = new Map<string, number[]>();
    for (const row of run.rows) {
      if (row.status !== 'ok' || row.compute !== device) continue;
      const value = metric.of(row);
      if (value === null) continue;
      const values = samples.get(row.modelName) ?? [];
      values.push(value);
      samples.set(row.modelName, values);
    }

    for (const [modelName, values] of samples) {
      const value = reduceValues(values, metric.reduce);
      if (value === null) continue;
      const points = byModel.get(modelName) ?? [];
      points.push({ at, value });
      byModel.set(modelName, points);
    }
  }

  // Most-measured models first: a model with six runs has a trend worth a reliable hue; one
  // with a single point does not.
  const ranked = [...byModel.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const lines = ranked.slice(0, MAX_LINES).map(([modelName, points], index) => ({
    key: modelName,
    label: modelName,
    color: SERIES_COLORS[index] as string,
    points: [...points].sort((a, b) => a.at - b.at),
  }));

  return { lines, omitted: Math.max(0, ranked.length - MAX_LINES) };
}

/**
 * How far back the trend chart looks, in runs rather than in hours.
 *
 * A benchmark is an event, not a sampled metric: it exists because somebody started it, and
 * a project accumulates tens of them, not thousands. A time window ("last 24 hours") would
 * be empty most of the time and identical to "all" the rest of it, so the axis the reader
 * actually wants to move along is the run count.
 */
export interface RunRange {
  key: string;
  label: string;
  /** Runs to keep, counting back from the newest. */
  count: number;
}

export const RUN_RANGES: RunRange[] = [
  { key: 'last5', label: 'Last 5 runs', count: 5 },
  { key: 'last10', label: 'Last 10 runs', count: 10 },
  { key: 'all', label: 'All runs', count: Number.POSITIVE_INFINITY },
];

/**
 * The newest `count` runs, still oldest-first.
 *
 * Ordered by when each run finished rather than by id: a run that was started earlier can
 * finish later, and "the last five" means the last five to produce numbers.
 */
export function recentRuns(history: ModelBenchmarkRun[], count: number): ModelBenchmarkRun[] {
  if (!Number.isFinite(count)) return history;
  return [...history]
    .sort(
      (a, b) => Date.parse(a.finishedAt ?? a.startedAt) - Date.parse(b.finishedAt ?? b.startedAt),
    )
    .slice(-Math.max(1, count));
}

/** Every device that produced a usable row, so the chart only offers tabs that have data. */
export function devicesMeasured(history: ModelBenchmarkRun[]): ComputeMode[] {
  const seen = new Set<ComputeMode>();
  for (const run of history) {
    for (const row of run.rows) if (row.status === 'ok') seen.add(row.compute);
  }
  return [...seen].sort();
}

/**
 * The single figure for one model on one device, across every prompt measured.
 *
 * Everything that draws a per-model number goes through here. Nothing should reach for a
 * row directly: a row is one question, and a chart of one question labelled as the model is
 * the bug this exists to prevent.
 */
export function valueFor(
  rows: ModelBenchmarkRow[],
  modelName: string,
  device: ComputeMode,
  metric: Metric,
  tier?: string | null,
): number | null {
  const measured = rows.filter(
    (row) =>
      row.status === 'ok' &&
      row.modelName === modelName &&
      row.compute === device &&
      (tier == null || row.promptLabel === tier),
  );
  const values = measured
    .map((row) => metric.of(row))
    .filter((value): value is number => value !== null);
  return reduceValues(values, metric.reduce);
}

/** Every prompt a run measured, in the order src/benchmark.py asks them. */
const PROMPT_ORDER = ['simple', 'moderate', 'complex'];

export function promptsMeasured(runs: ModelBenchmarkRun[]): string[] {
  const seen = new Set<string>();
  for (const run of runs) {
    for (const row of run.rows) {
      if (row.status === 'ok' && row.promptLabel !== null) seen.add(row.promptLabel);
    }
  }
  return [...seen].sort((a, b) => {
    const ai = PROMPT_ORDER.indexOf(a);
    const bi = PROMPT_ORDER.indexOf(b);
    return (ai === -1 ? PROMPT_ORDER.length : ai) - (bi === -1 ? PROMPT_ORDER.length : bi);
  });
}

/** The hardware a run actually ran on, e.g. "Intel Core Ultra 7 165H" or "NVIDIA RTX 4070". */
export function hardwareNames(runs: ModelBenchmarkRun[]): Map<ComputeMode, string> {
  const names = new Map<ComputeMode, string>();
  for (const run of runs) {
    for (const row of run.rows) {
      if (row.deviceName && !names.has(row.compute)) names.set(row.compute, row.deviceName);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Reading a recommendation out of the numbers
// ---------------------------------------------------------------------------

export interface Recommendation {
  /** Highest generation speed of any completed row. */
  fastest: ModelBenchmarkRow | null;
  /** Lowest peak memory of any completed row - what runs on the weakest machine. */
  leanest: ModelBenchmarkRow | null;
  /** True when one model is both, so the screen says it once rather than twice. */
  sameModel: boolean;
}

/**
 * The answer the benchmark screen exists to give, stated rather than left to be read off
 * a chart.
 *
 * Two models are named, not one, because "best" is not a single axis here: the fastest
 * model may not fit on the hardware BEUMER actually issues, and the leanest may be too slow
 * to use. Naming both makes the trade-off visible in words; the scatter shows its shape.
 */
export function recommend(run: ModelBenchmarkRun): Recommendation {
  const ok = run.rows.filter((row) => row.status === 'ok');
  const speed = METRICS.find((metric) => metric.key === 'tokensPerSecond') as Metric;
  const memory = METRICS.find((metric) => metric.key === 'peakMemory') as Metric;

  /*
   * Ranked on the same aggregate the charts draw, not on whichever single row happened to
   * sort first. Naming a model "fastest" on the strength of its easiest question, while the
   * chart beside it shows the median, is the kind of quiet disagreement nobody catches.
   */
  const pairs = [...new Set(ok.map((row) => `${row.modelName}\u0000${row.compute}`))].map(
    (key) => key.split('\u0000') as [string, ComputeMode],
  );

  let fastest: ModelBenchmarkRow | null = null;
  let fastestValue = -1;
  let leanest: ModelBenchmarkRow | null = null;
  let leanestValue = Number.POSITIVE_INFINITY;

  for (const [modelName, device] of pairs) {
    const sample = ok.find((row) => row.modelName === modelName && row.compute === device) ?? null;
    if (sample === null) continue;

    const speedValue = valueFor(ok, modelName, device, speed);
    if (speedValue !== null && speedValue > fastestValue) {
      fastestValue = speedValue;
      fastest = { ...sample, tokensPerSecond: speedValue };
    }

    const memoryValue = valueFor(ok, modelName, device, memory);
    if (memoryValue !== null && memoryValue < leanestValue) {
      leanestValue = memoryValue;
      leanest = { ...sample, peakMemoryBytes: memoryValue, peakVramBytes: null };
    }
  }

  return {
    fastest,
    leanest,
    sameModel: fastest !== null && leanest !== null && fastest.modelName === leanest.modelName,
  };
}

// ---------------------------------------------------------------------------
// GPU against CPU
// ---------------------------------------------------------------------------

export interface Speedup {
  key: string;
  label: string;
  ratio: number;
  baselineText: string;
  comparedText: string;
}

/**
 * How much the GPU changes each model, as a ratio against the same model on CPU.
 *
 * Only models measured on BOTH devices appear: a ratio needs two numbers, and showing a
 * model that only ran on one of them would invite the reader to compare it with the others
 * anyway.
 *
 * For a metric where lower is better - load time, time to first token - the ratio is
 * inverted so that "greater than 1" always means "the GPU helped". Without that, the same
 * chart would mean opposite things depending on which measure was selected, which is the
 * kind of quiet inconsistency nobody notices until they have drawn the wrong conclusion.
 */
export function buildSpeedup(run: ModelBenchmarkRun, metric: Metric): Speedup[] {
  const ok = run.rows.filter((row) => row.status === 'ok');
  const models = [...new Set(ok.map((row) => row.modelName))];

  return models.flatMap((modelName) => {
    const cpuValue = valueFor(run.rows, modelName, 'cpu', metric);
    const gpuValue = valueFor(run.rows, modelName, 'gpu', metric);
    if (cpuValue === null || gpuValue === null || cpuValue === 0 || gpuValue === 0) return [];

    const ratio = metric.higherIsBetter ? gpuValue / cpuValue : cpuValue / gpuValue;

    return [
      {
        key: modelName,
        label: modelName,
        ratio,
        baselineText: metric.format(cpuValue),
        comparedText: metric.format(gpuValue),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Speed against memory
// ---------------------------------------------------------------------------

export interface TradeoffPoint {
  key: string;
  label: string;
  /** Peak memory, bytes. */
  x: number;
  /** Generation speed, tokens per second. */
  y: number;
  color: string;
}

/**
 * Every completed row as a point: memory on x, speed on y.
 *
 * Rows are per model AND device, so a model benchmarked on both appears twice - correctly,
 * because the GPU run has a different memory cost and a different speed. The device is part
 * of the label for that reason.
 */
export function buildTradeoff(run: ModelBenchmarkRun): TradeoffPoint[] {
  const ok = run.rows.filter((row) => row.status === 'ok');
  const models = [...new Set(ok.map((row) => row.modelName))];
  const speed = METRICS.find((metric) => metric.key === 'tokensPerSecond') as Metric;
  const memory = METRICS.find((metric) => metric.key === 'peakMemory') as Metric;

  // One point per model AND device - not per row, which would stack three dots for three
  // prompts on top of each other and label them all as the model.
  const pairs = [...new Set(ok.map((row) => `${row.modelName}\u0000${row.compute}`))].map(
    (key) => key.split('\u0000') as [string, ComputeMode],
  );

  return pairs.flatMap(([modelName, device]) => {
    const x = valueFor(ok, modelName, device, memory);
    const y = valueFor(ok, modelName, device, speed);
    if (x === null || y === null) return [];

    const hue = models.indexOf(modelName) % SERIES_COLORS.length;
    return [
      {
        key: `${modelName}-${device}`,
        label: `${modelName} · ${device.toUpperCase()}`,
        x,
        y,
        color: SERIES_COLORS[hue] as string,
      },
    ];
  });
}

/** Memory ceilings worth marking, in bytes - the machines an engineer is likely to be given. */
export const MEMORY_BANDS = [
  { at: 4 * 1024 ** 3, label: '4 GB' },
  { at: 8 * 1024 ** 3, label: '8 GB' },
  { at: 16 * 1024 ** 3, label: '16 GB' },
];

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface RunFilter {
  /** Empty means every device. */
  devices: ComputeMode[];
  /** Empty means every model. */
  models: string[];
  /** Rows that could not run - kept out of the charts by default, never out of the table. */
  includeUnmeasured: boolean;
}

export const NO_FILTER: RunFilter = { devices: [], models: [], includeUnmeasured: false };

/**
 * Narrows a run to what the filter admits.
 *
 * An empty list means "everything" rather than "nothing" - the alternative is a screen that
 * goes blank the moment the last checkbox is cleared, which reads as a bug.
 */
export function applyFilter(run: ModelBenchmarkRun, filter: RunFilter): ModelBenchmarkRun {
  return {
    ...run,
    rows: run.rows.filter((row) => {
      if (!filter.includeUnmeasured && row.status !== 'ok') return false;
      if (filter.devices.length > 0 && !filter.devices.includes(row.compute)) return false;
      if (filter.models.length > 0 && !filter.models.includes(row.modelName)) return false;
      return true;
    }),
  };
}

/**
 * Every model name that appears in the history, for the model filter's option list.
 *
 * Newest run first, then first appearance - NOT alphabetical. The chips sit directly above
 * charts whose slots follow the latest run's order, and sorting them by name put the chips
 * in one order and the columns under them in another, so picking a chip meant hunting for
 * the column it belonged to. A filter should be read against the thing it filters.
 */
export function modelsMeasured(history: ModelBenchmarkRun[]): string[] {
  const seen = new Set<string>();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    for (const row of (history[index] as ModelBenchmarkRun).rows) seen.add(row.modelName);
  }
  return [...seen];
}
