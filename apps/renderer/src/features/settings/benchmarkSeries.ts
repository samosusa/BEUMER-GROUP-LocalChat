import type { ComputeMode, ModelBenchmarkRow, ModelBenchmarkRun } from '@localchat/contracts';
import { formatBytes, formatDuration } from '@/shared/lib/format';
import { MAX_LINES, RUN_RANGES, SERIES_COLORS, recentRuns } from './runRanges';

/**
 * Turning benchmark rows into chart series. Pure, and kept out of the component so the
 * decisions below can be tested without a DOM.
 */

export { MAX_LINES, RUN_RANGES, SERIES_COLORS, recentRuns };
export type { RunRange } from './runRanges';

export interface Metric {
  key: string;
  label: string;
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
    higherIsBetter: true,
    of: (row) => row.tokensPerSecond,
    format: (value) => `${value.toFixed(value < 10 ? 1 : 0)} tok/s`,
  },
  {
    key: 'timeToFirstToken',
    label: 'Time to first token',
    higherIsBetter: false,
    of: (row) => row.timeToFirstTokenMs,
    format: formatDuration,
  },
  {
    key: 'loadMs',
    label: 'Model load time',
    higherIsBetter: false,
    of: (row) => row.loadMs,
    format: formatDuration,
  },
  {
    key: 'peakMemory',
    label: 'Peak memory',
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
): { categories: string[]; series: ComparisonSeries[] } {
  const ok = run.rows.filter((row) => row.status === 'ok' && metric.of(row) !== null);
  const categories = [...new Set(ok.map((row) => row.modelName))];
  const devices = [...new Set(ok.map((row) => row.compute))].sort();

  const series = devices.map((device, index) => ({
    key: device,
    label: device.toUpperCase(),
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
    values: categories.map((model) => {
      const row = ok.find(
        (candidate) => candidate.modelName === model && candidate.compute === device,
      );
      return row ? metric.of(row) : null;
    }),
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
    for (const row of run.rows) {
      if (row.status !== 'ok' || row.compute !== device) continue;
      const value = metric.of(row);
      if (value === null) continue;
      const points = byModel.get(row.modelName) ?? [];
      points.push({ at, value });
      byModel.set(row.modelName, points);
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

/** Every device that produced a usable row, so the chart only offers tabs that have data. */
export function devicesMeasured(history: ModelBenchmarkRun[]): ComputeMode[] {
  const seen = new Set<ComputeMode>();
  for (const run of history) {
    for (const row of run.rows) if (row.status === 'ok') seen.add(row.compute);
  }
  return [...seen].sort();
}
