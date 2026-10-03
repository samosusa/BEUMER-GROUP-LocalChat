import type { VectorCapacityRun, VectorCapacityStep } from '@localchat/contracts';
import { SERIES_COLORS, type TrendLine } from './benchmarkSeries';

/**
 * Turning vector-capacity-sweep steps into chart series.
 *
 * Deliberately separate from benchmarkSeries.ts/embeddingSeries.ts rather than generalised
 * over all three. Those two vary by model (and device, or text length) across repeated runs;
 * this one has a single fixed subject - the FAISS vector store itself - and varies by
 * document count WITHIN one run. A `TrendLine`'s `at` is reused as document count instead of
 * a run timestamp, which `TimeSeries` never assumes is actually time, but the two axes mean
 * different things and sharing one abstraction over "the x value" would blur that.
 */

function toLine(
  key: string,
  label: string,
  steps: VectorCapacityStep[],
  of: (step: VectorCapacityStep) => number | null,
  colorIndex: number,
): TrendLine {
  return {
    key,
    label,
    color: SERIES_COLORS[colorIndex % SERIES_COLORS.length] as string,
    points: steps
      .map((step) => {
        const value = of(step);
        return value === null ? null : { at: step.docCount, value };
      })
      .filter((point): point is { at: number; value: number } => point !== null),
  };
}

export const buildLatencyTrend = (steps: VectorCapacityStep[]): TrendLine[] => [
  toLine('min', 'min', steps, (step) => step.queryLatencyMsMin, 0),
  toLine('mean', 'mean', steps, (step) => step.queryLatencyMsMean, 1),
  toLine('max', 'max', steps, (step) => step.queryLatencyMsMax, 2),
];

export const buildThroughputTrend = (steps: VectorCapacityStep[]): TrendLine[] => [
  toLine('docsPerSecond', 'documents inserted / second', steps, (step) => step.docsPerSecond, 0),
];

export const buildDiskTrend = (steps: VectorCapacityStep[]): TrendLine[] => [
  toLine('vectorDirBytes', 'vector index files', steps, (step) => step.vectorDirBytes, 0),
  toLine('dbSizeBytes', 'SQLite database', steps, (step) => step.dbSizeBytes, 1),
];

export const buildMemoryTrend = (steps: VectorCapacityStep[]): TrendLine[] => [
  toLine('rssBytes', 'resident set size', steps, (step) => step.rssBytes, 0),
];

export interface VectorCapacityHeadline {
  firstDocCount: number;
  lastDocCount: number;
  docCountFactor: number;
  latencyFactor: number;
}

/**
 * How much slower retrieval got, from the first to the last measured step, against how much
 * more it inserted - the headline a reader of this benchmark actually wants, computed rather
 * than eyeballed off the chart. `null` when there is not enough measured data to say.
 */
export function summarize(run: VectorCapacityRun): VectorCapacityHeadline | null {
  const measured = run.steps.filter((step) => step.queryLatencyMsMean !== null);
  if (measured.length < 2) return null;
  const first = measured[0]!;
  const last = measured[measured.length - 1]!;
  if (first.docCount === 0 || !first.queryLatencyMsMean) return null;

  return {
    firstDocCount: first.docCount,
    lastDocCount: last.docCount,
    docCountFactor: last.docCount / first.docCount,
    latencyFactor: last.queryLatencyMsMean! / first.queryLatencyMsMean,
  };
}
