/**
 * Pieces shared by every benchmark trend chart (model and embedding alike): how far back a
 * chart looks, and which theme hue each line gets.
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

interface TimedRun {
  startedAt: string;
  finishedAt: string | null;
}

/**
 * The newest `count` runs, still oldest-first.
 *
 * Ordered by when each run finished rather than by id: a run that was started earlier can
 * finish later, and "the last five" means the last five to produce numbers.
 */
export function recentRuns<T extends TimedRun>(history: T[], count: number): T[] {
  if (!Number.isFinite(count)) return history;
  return [...history]
    .sort(
      (a, b) => Date.parse(a.finishedAt ?? a.startedAt) - Date.parse(b.finishedAt ?? b.startedAt),
    )
    .slice(-Math.max(1, count));
}

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
