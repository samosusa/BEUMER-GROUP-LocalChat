import type { ComputeMode, ModelBenchmarkRow, ModelBenchmarkRun } from '@localchat/contracts';
import { formatBytes, formatDuration } from '@/shared/lib/format';
import { MAX_LINES, RUN_RANGES, SERIES_COLORS, recentRuns } from './runRanges';

/**
 * Turning benchmark rows into chart series. Pure, and kept out of the component so the
 * decisions below can be tested without a DOM.
 */

export { MAX_LINES, RUN_RANGES, SERIES_COLORS, recentRuns };
export type { RunRange } from './runRanges';

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

export interface ComparisonSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

/**
 * The latest run as columns: one slot per model, one series per device.
 *
 * Series are device, not model, so this returns every device measured - but BenchmarkCharts
 * renders only the active one at a time (device tabs), because CPU and GPU generation speed
 * differ by an order of magnitude: sharing one axis draws CPU as a sliver next to a GPU
 * column that fills the frame. Absolute side-by-side comparison across devices happens in
 * SpeedupBars instead, as a ratio, which is the honest way to show it.
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
 * Every CPU and GPU that has measured one chosen model, side by side.
 *
 * The mirror image of `buildComparison` above: that fixes the run and varies the model per
 * device; this fixes the model and varies the hardware. Once benchmark history spans more
 * than one machine, "how does my CPU compare with my GPU" is only half the question - the
 * other half is "which of every machine's CPUs and GPUs should actually run this model", and
 * that answer lives across runs, not inside a single one. So this reads the whole history
 * rather than one run, and reduces multiple measurements of the same hardware the same way
 * every other chart here does (median for rates, worst case for memory) rather than just
 * taking whichever one happened to run last.
 */
export function buildHardwareComparison(
  history: ModelBenchmarkRun[],
  metric: Metric,
  modelName: string,
): { categories: string[]; series: ComparisonSeries[] } {
  const ok = history
    .flatMap((run) => run.rows)
    .filter(
      (row) =>
        row.status === 'ok' &&
        row.modelName === modelName &&
        row.deviceName !== null &&
        metric.of(row) !== null,
    );
  const categories = [...new Set(ok.map((row) => row.deviceName as string))].sort();
  const devices: ComputeMode[] = ['cpu', 'gpu'];

  const series = devices.flatMap((device) => {
    const onDevice = ok.filter((row) => row.compute === device);
    if (onDevice.length === 0) return [];
    return [
      {
        key: device,
        label: device.toUpperCase(),
        color: SERIES_COLORS[device === 'cpu' ? 0 : 1] as string,
        values: categories.map((name) => {
          const values = onDevice
            .filter((row) => row.deviceName === name)
            .map((row) => metric.of(row) as number);
          return values.length > 0 ? reduceValues(values, metric.reduce) : null;
        }),
      },
    ];
  });

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

/** Shared with `embeddingSeries.ts`'s own trend builder - same shape, different axis. */
export interface TrendLine {
  key: string;
  label: string;
  color: string;
  points: Array<{ at: number; value: number }>;
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

/**
 * The hardware a run actually ran on, e.g. "Intel Core Ultra 7 165H" or "NVIDIA RTX 4070" -
 * one name per device, for the CPU/GPU tab label.
 *
 * Only set when every row for that compute mode agrees on a single name. History seeded or
 * merged from more than one machine can have two different GPUs both reporting as "gpu" -
 * picking whichever name happened to be seen first would label the tab with an arbitrary
 * one of the two and silently misname the other machine's rows. `hardwareMeasured` below is
 * the filter that lets a reader pick a specific machine's hardware once there's more than one.
 */
export function hardwareNames(runs: ModelBenchmarkRun[]): Map<ComputeMode, string> {
  const seen = new Map<ComputeMode, Set<string>>();
  for (const run of runs) {
    for (const row of run.rows) {
      if (!row.deviceName) continue;
      const names = seen.get(row.compute) ?? new Set<string>();
      names.add(row.deviceName);
      seen.set(row.compute, names);
    }
  }

  const names = new Map<ComputeMode, string>();
  for (const [compute, distinct] of seen) {
    if (distinct.size === 1) names.set(compute, [...distinct][0] as string);
  }
  return names;
}

export interface HardwareOption {
  compute: ComputeMode;
  deviceName: string;
}

/**
 * Every distinct (device, hardware) pair with a completed row, for the hardware filter chips.
 *
 * `BenchmarkCharts` only renders that filter when this has more than one entry: most readers
 * have a single machine's CPU and GPU, where it would just repeat what the CPU/GPU tabs
 * already say. It earns its place once two machines' rows share a compute mode and
 * `hardwareNames` above can no longer pick one name for the tab.
 */
export function hardwareMeasured(history: ModelBenchmarkRun[]): HardwareOption[] {
  const seen = new Map<string, HardwareOption>();
  for (const run of history) {
    for (const row of run.rows) {
      if (row.status !== 'ok' || !row.deviceName) continue;
      const key = `${row.compute}\u0000${row.deviceName}`;
      if (!seen.has(key)) seen.set(key, { compute: row.compute, deviceName: row.deviceName });
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.compute.localeCompare(b.compute) || a.deviceName.localeCompare(b.deviceName),
  );
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
 *
 * Colored by device, not model, and sorted the same way `buildComparison` sorts its series -
 * alphabetically, so CPU always lands on `--series-1` (blue) and GPU on `--series-2` (orange),
 * matching the bar chart above this one. A scatter that colored by model instead would teach
 * the reader a second, contradicting color language two charts apart.
 */
export function buildTradeoff(run: ModelBenchmarkRun): TradeoffPoint[] {
  const ok = run.rows.filter((row) => row.status === 'ok');
  const speed = METRICS.find((metric) => metric.key === 'tokensPerSecond') as Metric;
  const memory = METRICS.find((metric) => metric.key === 'peakMemory') as Metric;
  const devices = [...new Set(ok.map((row) => row.compute))].sort();

  // One point per model AND device - not per row, which would stack three dots for three
  // prompts on top of each other and label them all as the model.
  const pairs = [...new Set(ok.map((row) => `${row.modelName}\u0000${row.compute}`))].map(
    (key) => key.split('\u0000') as [string, ComputeMode],
  );

  return pairs.flatMap(([modelName, device]) => {
    const x = valueFor(ok, modelName, device, memory);
    const y = valueFor(ok, modelName, device, speed);
    if (x === null || y === null) return [];

    return [
      {
        key: `${modelName}-${device}`,
        label: `${modelName} · ${device.toUpperCase()}`,
        x,
        y,
        color: SERIES_COLORS[devices.indexOf(device) % SERIES_COLORS.length] as string,
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
  /**
   * Empty means every machine's hardware. Entries are `${compute}\u0000${deviceName}`, the
   * same composite key `buildComparison` and `buildTradeoff` use - a plain device name would
   * conflate a CPU and a GPU that happen to report the same name (this dataset has "Apple M3
   * Max" as both).
   */
  hardware: string[];
  /** Rows that could not run - kept out of the charts by default, never out of the table. */
  includeUnmeasured: boolean;
}

export const NO_FILTER: RunFilter = {
  devices: [],
  models: [],
  hardware: [],
  includeUnmeasured: false,
};

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
      if (
        filter.hardware.length > 0 &&
        !filter.hardware.includes(`${row.compute}\u0000${row.deviceName}`)
      )
        return false;
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
