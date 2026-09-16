import type { EmbeddingBenchmarkRow, EmbeddingBenchmarkRun } from '@localchat/contracts';
import { formatBytes, formatDuration } from '@/shared/lib/format';
import { MAX_LINES, RUN_RANGES, SERIES_COLORS, recentRuns } from './runRanges';

/**
 * Turning embedding-benchmark rows into chart series — the embedding-model counterpart of
 * `benchmarkSeries.ts`. Text size ("short"/"medium"/"long") stands in for the device axis
 * over there: embedding models run CPU-only, so there is no device to compare, but throughput
 * still varies by an order of magnitude between a short and a long passage.
 */

export { MAX_LINES, RUN_RANGES, SERIES_COLORS, recentRuns };
export type { RunRange } from './runRanges';

export interface Metric {
  key: string;
  label: string;
  /** Same reasoning as the model-benchmark `Metric`: the chart cannot say which way is good. */
  higherIsBetter: boolean;
  of: (row: EmbeddingBenchmarkRow) => number | null;
  format: (value: number) => string;
}

export const METRICS: Metric[] = [
  {
    key: 'textsPerSecond',
    label: 'Encoding speed',
    higherIsBetter: true,
    of: (row) => row.textsPerSecond,
    format: (value) => `${value.toFixed(value < 10 ? 1 : 0)} texts/s`,
  },
  {
    key: 'embedMs',
    label: 'Encode time',
    higherIsBetter: false,
    of: (row) => row.embedMs,
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
    of: (row) => row.peakMemoryBytes,
    format: (value) => formatBytes(value, 1),
  },
];

export interface ComparisonSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

/** Short/medium/long in reading order rather than alphabetical ("long" < "medium" < "short"). */
const TEXT_LABEL_ORDER = ['short', 'medium', 'long'];

function byTextLabelOrder(a: string, b: string): number {
  return TEXT_LABEL_ORDER.indexOf(a) - TEXT_LABEL_ORDER.indexOf(b);
}

/**
 * The latest run as columns: one slot per model, one column per text size.
 *
 * Series are text size, not model, so the columns a reader compares side by side are the same
 * model against short and long text — whether throughput holds up as input grows, which is
 * the decision this screen exists to support.
 *
 * A model missing one text size keeps its slot with a null in it, the same rule the model
 * benchmark uses for a device that never ran.
 */
export function buildComparison(
  run: EmbeddingBenchmarkRun,
  metric: Metric,
): { categories: string[]; series: ComparisonSeries[] } {
  const ok = run.rows.filter((row) => row.status === 'ok' && metric.of(row) !== null);
  const categories = [...new Set(ok.map((row) => row.model))];
  const labels = [
    ...new Set(ok.map((row) => row.textLabel).filter((label) => label !== null)),
  ].sort(byTextLabelOrder);

  const series = labels.map((label, index) => ({
    key: label,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
    values: categories.map((model) => {
      const row = ok.find(
        (candidate) => candidate.model === model && candidate.textLabel === label,
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
 * One line per model across runs, for a single text size.
 *
 * Filtered to one text size rather than drawing all three: short and long text differ by an
 * order of magnitude in encode time, so sharing one axis would flatten the short-text lines
 * into a smear along the bottom — the same tradeoff `buildTrend` makes for device, over in
 * `benchmarkSeries.ts`.
 */
export function buildTrend(
  history: EmbeddingBenchmarkRun[],
  metric: Metric,
  textLabel: string,
): { lines: TrendLine[]; omitted: number } {
  const byModel = new Map<string, Array<{ at: number; value: number }>>();

  for (const run of history) {
    const at = Date.parse(run.finishedAt ?? run.startedAt);
    if (Number.isNaN(at)) continue;
    for (const row of run.rows) {
      if (row.status !== 'ok' || row.textLabel !== textLabel) continue;
      const value = metric.of(row);
      if (value === null) continue;
      const points = byModel.get(row.model) ?? [];
      points.push({ at, value });
      byModel.set(row.model, points);
    }
  }

  const ranked = [...byModel.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const lines = ranked.slice(0, MAX_LINES).map(([model, points], index) => ({
    key: model,
    label: model,
    color: SERIES_COLORS[index] as string,
    points: [...points].sort((a, b) => a.at - b.at),
  }));

  return { lines, omitted: Math.max(0, ranked.length - MAX_LINES) };
}

/** Every text size that produced a usable row, so the chart only offers tabs that have data. */
export function textSizesMeasured(history: EmbeddingBenchmarkRun[]): string[] {
  const seen = new Set<string>();
  for (const run of history) {
    for (const row of run.rows) {
      if (row.status === 'ok' && row.textLabel !== null) seen.add(row.textLabel);
    }
  }
  return [...seen].sort(byTextLabelOrder);
}
