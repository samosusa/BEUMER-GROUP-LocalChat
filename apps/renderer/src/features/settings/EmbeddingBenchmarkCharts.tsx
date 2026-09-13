import { useMemo, useState } from 'react';
import type { EmbeddingBenchmarkRun } from '@localchat/contracts';
import { GroupedColumns } from '@/shared/ui/charts/GroupedColumns';
import { TimeSeries } from '@/shared/ui/charts/TimeSeries';
import {
  METRICS,
  RUN_RANGES,
  buildComparison,
  buildTrend,
  recentRuns,
  textSizesMeasured,
} from './embeddingBenchmarkSeries';
import styles from './Settings.module.css';

interface EmbeddingBenchmarkChartsProps {
  latest: EmbeddingBenchmarkRun;
  history: EmbeddingBenchmarkRun[];
}

/**
 * The embedding benchmark, drawn — the same two-chart layout as `BenchmarkCharts`, with text
 * size standing in for device: which embedding model is fastest on this machine right now,
 * and whether that has been moving. The table underneath keeps every figure.
 */
export function EmbeddingBenchmarkCharts({ latest, history }: EmbeddingBenchmarkChartsProps) {
  const [metricKey, setMetricKey] = useState(METRICS[0]!.key);
  const metric = METRICS.find((candidate) => candidate.key === metricKey) ?? METRICS[0]!;

  const [rangeKey, setRangeKey] = useState(RUN_RANGES[RUN_RANGES.length - 1]!.key);
  const range = RUN_RANGES.find((candidate) => candidate.key === rangeKey) ?? RUN_RANGES[0]!;
  const shown = useMemo(() => recentRuns(history, range.count), [history, range]);

  const textSizes = useMemo(() => textSizesMeasured(shown), [shown]);
  const [textLabel, setTextLabel] = useState('short');
  const active = textSizes.includes(textLabel) ? textLabel : (textSizes[0] ?? 'short');

  const comparison = useMemo(() => buildComparison(latest, metric), [latest, metric]);
  const trend = useMemo(() => buildTrend(shown, metric, active), [shown, metric, active]);

  return (
    <div className={styles.charts}>
      <div className={styles.chartControls}>
        <label className={styles.benchPicker}>
          <span className={styles.benchPickerLabel}>Measure</span>
          <select
            className={styles.benchSelect}
            value={metricKey}
            onChange={(event) => setMetricKey(event.target.value)}
          >
            {METRICS.map((candidate) => (
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
        <figcaption className={styles.chartTitle}>{metric.label} by model, this run</figcaption>
        {comparison.categories.length > 0 ? (
          <GroupedColumns
            categories={comparison.categories}
            series={comparison.series}
            format={metric.format}
            caption={metric.label}
          />
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
          {textSizes.length > 1 && (
            <span className={styles.chartTabs} role="group" aria-label="Text size">
              {textSizes.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={candidate === active ? styles.chartTabOn : styles.chartTab}
                  aria-pressed={candidate === active}
                  onClick={() => setTextLabel(candidate)}
                >
                  {candidate.toUpperCase()}
                </button>
              ))}
            </span>
          )}
        </figcaption>
        {trend.lines.length > 0 ? (
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
            {shown.length < 2
              ? 'Run the benchmark again to compare against this one.'
              : `No ${active} text results in these runs.`}
          </p>
        )}
      </figure>
    </div>
  );
}

function formatRunDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
