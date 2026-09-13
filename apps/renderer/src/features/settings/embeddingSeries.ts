import type { EmbeddingBenchmarkRow, EmbeddingBenchmarkRun } from '@localchat/contracts';
import { formatBytes, formatDuration } from '@/shared/lib/format';
import { MAX_LINES, SERIES_COLORS, type ComparisonSeries, type TrendLine } from './benchmarkSeries';

/**
 * Turning embedding-benchmark rows into chart series.
 *
 * Deliberately separate from `benchmarkSeries.ts` rather than generalised over both. The two
 * benchmarks share a shape but not a meaning: the answer-model benchmark varies by DEVICE
 * and the embedding benchmark varies by TEXT LENGTH, and a single abstraction over "the
 * second dimension" would name neither honestly. They are also free to diverge - the
 * embedding service is CPU-only today and may not stay that way.
 */

export interface EmbeddingMetric {
  key: string;
  label: string;
  higherIsBetter: boolean;
  of: (row: EmbeddingBenchmarkRow) => number | null;
  format: (value: number) => string;
}

export const EMBEDDING_METRICS: EmbeddingMetric[] = [
  {
    key: 'textsPerSecond',
    label: 'Encoding throughput',
    higherIsBetter: true,
    of: (row) => row.textsPerSecond,
    format: (value) => `${value.toFixed(value < 10 ? 1 : 0)} txt/s`,
  },
  {
    key: 'embedMs',
    label: 'Time to encode',
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

/**
 * Short before medium before long.
 *
 * Sorted explicitly rather than alphabetically, which would give "long, medium, short" and
 * make a chart about degradation read backwards.
 */
const TIER_ORDER = ['short', 'medium', 'long'];

export function tiersMeasured(runs: EmbeddingBenchmarkRun[]): string[] {
  const seen = new Set<string>();
  for (const run of runs) {
    for (const row of run.rows) {
      if (row.status === 'ok' && row.textLabel !== null) seen.add(row.textLabel);
    }
  }
  return [...seen].sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a);
    const bi = TIER_ORDER.indexOf(b);
    return (ai === -1 ? TIER_ORDER.length : ai) - (bi === -1 ? TIER_ORDER.length : bi);
  });
}

/**
 * One slot per embedding model, one column per text tier.
 *
 * Tier is the series rather than the category on purpose. The question worth asking of this
 * benchmark is not "which model is fastest" - it is "which model holds up as documents get
 * longer", and that comparison has to sit inside one slot to be seen at all. A model that
 * wins on short text and collapses on long is the wrong choice for a 200-page manual, and
 * grouping the other way round would bury it.
 */
export function buildTierComparison(
  run: EmbeddingBenchmarkRun,
  metric: EmbeddingMetric,
): { categories: string[]; series: ComparisonSeries[] } {
  const ok = run.rows.filter((row) => row.status === 'ok' && metric.of(row) !== null);
  const categories = [...new Set(ok.map((row) => row.model))];
  const tiers = tiersMeasured([run]);

  const series = tiers.map((tier, index) => ({
    key: tier,
    label: tier,
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
    values: categories.map((model) => {
      const row = ok.find((candidate) => candidate.model === model && candidate.textLabel === tier);
      return row ? metric.of(row) : null;
    }),
  }));

  return { categories, series };
}

/**
 * One line per embedding model across runs, for a single text tier.
 *
 * Filtered to one tier for the same reason the model chart filters to one device: short and
 * long text differ by an order of magnitude, and sharing an axis flattens the long-text
 * lines into a smear along the bottom where the interesting differences are.
 */
export function buildEmbeddingTrend(
  history: EmbeddingBenchmarkRun[],
  metric: EmbeddingMetric,
  tier: string,
): { lines: TrendLine[]; omitted: number } {
  const byModel = new Map<string, Array<{ at: number; value: number }>>();

  for (const run of history) {
    const at = Date.parse(run.finishedAt ?? run.startedAt);
    if (Number.isNaN(at)) continue;
    for (const row of run.rows) {
      if (row.status !== 'ok' || row.textLabel !== tier) continue;
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

export interface EmbeddingRecommendation {
  fastest: EmbeddingBenchmarkRow | null;
  /** The model whose throughput falls off least between the shortest and longest tier. */
  steadiest: { model: string; retained: number } | null;
}

/**
 * What to pick, in words.
 *
 * "Steadiest" is the one this benchmark can say and the model benchmark cannot: retention
 * is long-text throughput as a fraction of short-text throughput, so 0.4 means a model
 * loses 60% of its speed on the documents this product is actually pointed at. A model can
 * lead on short text and still be the wrong answer.
 */
export function recommendEmbedding(run: EmbeddingBenchmarkRun): EmbeddingRecommendation {
  const ok = run.rows.filter((row) => row.status === 'ok');

  const fastest = ok.reduce<EmbeddingBenchmarkRow | null>(
    (best, row) =>
      row.textsPerSecond !== null && row.textsPerSecond > (best?.textsPerSecond ?? -1) ? row : best,
    null,
  );

  const tiers = tiersMeasured([run]);
  const shortest = tiers[0];
  const longest = tiers.at(-1);

  let steadiest: { model: string; retained: number } | null = null;
  if (shortest !== undefined && longest !== undefined && shortest !== longest) {
    for (const model of new Set(ok.map((row) => row.model))) {
      const first = ok.find((row) => row.model === model && row.textLabel === shortest);
      const last = ok.find((row) => row.model === model && row.textLabel === longest);
      if (!first?.textsPerSecond || !last?.textsPerSecond) continue;
      const retained = last.textsPerSecond / first.textsPerSecond;
      if (steadiest === null || retained > steadiest.retained) steadiest = { model, retained };
    }
  }

  return { fastest, steadiest };
}
