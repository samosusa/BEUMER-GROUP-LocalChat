import { useMemo, useState } from 'react';
import type { EmbeddingBenchmarkRun } from '@localchat/contracts';
import { GroupedColumns } from '@/shared/ui/charts/GroupedColumns';
import { TimeSeries } from '@/shared/ui/charts/TimeSeries';
import { RUN_RANGES } from './benchmarkSeries';
import {
  EMBEDDING_METRICS,
  buildEmbeddingTrend,
  buildTierComparison,
  recommendEmbedding,
  tiersMeasured,
} from './embeddingSeries';
import styles from './Settings.module.css';

interface EmbeddingBenchmarkChartsProps {
  latest: EmbeddingBenchmarkRun;
  history: EmbeddingBenchmarkRun[];
}

/**
 * The vector-storage benchmark, drawn.
 *
 * Deliberately not the same chart set as the answer model. There is no device axis here —
 * the service embeds on CPU only — so offering a CPU/GPU filter would be a control that
 * does nothing. What this benchmark has instead is text length, and the question worth
 * asking of it is whether a model holds up as documents get longer, which is the case this
 * product spends its life in.
 */
export function EmbeddingBenchmarkCharts({ latest, history }: EmbeddingBenchmarkChartsProps) {
  const [metricKey, setMetricKey] = useState(EMBEDDING_METRICS[0]!.key);
  const metric =
    EMBEDDING_METRICS.find((candidate) => candidate.key === metricKey) ?? EMBEDDING_METRICS[0]!;

  const [rangeKey, setRangeKey] = useState(RUN_RANGES[RUN_RANGES.length - 1]!.key);
  const range = RUN_RANGES.find((candidate) => candidate.key === rangeKey) ?? RUN_RANGES[0]!;
  const shown = useMemo(
    () =>
      Number.isFinite(range.count)
        ? [...history]
            .sort(
              (a, b) =>
                Date.parse(a.finishedAt ?? a.startedAt) - Date.parse(b.finishedAt ?? b.startedAt),
            )
            .slice(-range.count)
        : history,
    [history, range],
  );

  const tiers = useMemo(() => tiersMeasured(shown), [shown]);
  const [tier, setTier] = useState('');
  const activeTier = tiers.includes(tier) ? tier : (tiers.at(-1) ?? '');

  /*
   * Long-text bars are a few pixels tall beside short-text ones - 12 txt/s against 147 - so
   * the comparison this chart exists for is invisible at true scale. Normalising each model
   * against its own short-text figure turns "how fast" into "how much did it keep", which
   * is the question, and makes the drop comparable across models of different speeds.
   */
  const [normalise, setNormalise] = useState(false);

  const advice = useMemo(() => recommendEmbedding(latest), [latest]);
  const comparison = useMemo(
    () => buildTierComparison(latest, metric, normalise),
    [latest, metric, normalise],
  );
  const trend = useMemo(
    () => buildEmbeddingTrend(shown, metric, activeTier),
    [shown, metric, activeTier],
  );
  /*
   * A line needs two runs to trend. When only one run has results for the active tier, every
   * line collapses to a single dot in the middle of the plot with its value label floating
   * beside it - not a trend, just clutter standing in for one. Same empty treatment as zero
   * lines, so the reader gets a reason instead of a chart with nothing to show them.
   */
  const trendRuns = useMemo(
    () => new Set(trend.lines.flatMap((line) => line.points.map((point) => point.at))).size,
    [trend],
  );

  return (
    <div className={styles.charts}>
      {advice.fastest && (
        <p className={styles.advice}>
          Fastest here: <strong>{advice.fastest.model}</strong>
          {advice.fastest.textsPerSecond !== null && (
            <>
              {' '}
              ({advice.fastest.textsPerSecond.toFixed(0)} txt/s on {advice.fastest.textLabel} text)
            </>
          )}
          {advice.steadiest &&
            (advice.allCollapse ? (
              /*
               * Every model loses most of its speed on long text, so naming a "winner"
               * dresses a bad result up as a good one. Say what happened instead.
               */
              <>
                {'. '}Every model loses most of its speed on long documents —{' '}
                <strong>{advice.steadiest.model}</strong> loses least, keeping{' '}
                {Math.round(advice.steadiest.retained * 100)}% of its short-text speed.
              </>
            ) : advice.sameModel ? (
              <>
                {', and it holds up best on long documents too, keeping '}
                {Math.round(advice.steadiest.retained * 100)}% of that speed.
              </>
            ) : (
              <>
                {'. Holds up best on long documents: '}
                <strong>{advice.steadiest.model}</strong>, keeping{' '}
                {Math.round(advice.steadiest.retained * 100)}% of its short-text speed — the one to
                pick for a long manual.
              </>
            ))}
        </p>
      )}

      <div className={styles.chartControls}>
        <label className={styles.benchPicker}>
          <span className={styles.benchPickerLabel}>Measure</span>
          <select
            className={styles.benchSelect}
            value={metricKey}
            onChange={(event) => setMetricKey(event.target.value)}
          >
            {EMBEDDING_METRICS.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.benchPicker}>
          <span className={styles.benchPickerLabel}>History</span>
          <select
            className={styles.benchSelect}
            value={rangeKey}
            disabled={history.length < 2}
            onChange={(event) => setRangeKey(event.target.value)}
          >
            {RUN_RANGES.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>

        <p className={styles.chartHint}>
          {metric.higherIsBetter ? 'Higher is better.' : 'Lower is better.'}
        </p>
      </div>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>{metric.label} by model and text length, this run</span>
          <span className={styles.chartTabs} role="group" aria-label="Scale">
            <button
              type="button"
              className={normalise ? styles.chartTab : styles.chartTabOn}
              aria-pressed={!normalise}
              onClick={() => setNormalise(false)}
            >
              measured
            </button>
            <button
              type="button"
              className={normalise ? styles.chartTabOn : styles.chartTab}
              aria-pressed={normalise}
              onClick={() => setNormalise(true)}
            >
              vs short text
            </button>
          </span>
        </figcaption>
        {comparison.categories.length > 0 ? (
          <>
            <GroupedColumns
              categories={comparison.categories}
              series={comparison.series}
              format={normalise ? (value) => `${value.toFixed(0)}%` : metric.format}
              caption={metric.label}
            />
            <p className={styles.chartFootnote}>
              {normalise
                ? 'Each model against its own short-text speed, so the drop is comparable across models rather than hidden by how fast they start.'
                : 'A model that leads on short text and falls behind on long is the wrong choice for a manual. Long-text bars can be a few pixels tall beside short-text ones — switch to “vs short text” to see the drop.'}
            </p>
          </>
        ) : (
          <p className={styles.chartEmpty}>
            Nothing in this run reported {metric.label.toLowerCase()}.
          </p>
        )}
      </figure>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>
            {metric.label} over {shown.length} run{shown.length === 1 ? '' : 's'}
          </span>
          {tiers.length > 1 && (
            <span className={styles.chartTabs} role="group" aria-label="Text length">
              {tiers.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={candidate === activeTier ? styles.chartTabOn : styles.chartTab}
                  aria-pressed={candidate === activeTier}
                  onClick={() => setTier(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </span>
          )}
        </figcaption>
        {trend.lines.length > 0 && trendRuns > 1 ? (
          <>
            <TimeSeries
              lines={trend.lines}
              format={metric.format}
              formatTime={formatRunDate}
              caption={metric.label}
            />
            {trend.omitted > 0 && (
              <p className={styles.chartHint}>
                {trend.omitted} more model{trend.omitted === 1 ? '' : 's'} in the table below.
              </p>
            )}
          </>
        ) : (
          <p className={styles.chartEmpty}>
            {trend.lines.length === 0
              ? shown.length < 2
                ? 'Run the benchmark again to compare against this one.'
                : `No ${activeTier} results in these runs.`
              : `Only one ${activeTier} run has results so far — run the benchmark again to see a trend.`}
          </p>
        )}
      </figure>
    </div>
  );
}

function formatRunDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
