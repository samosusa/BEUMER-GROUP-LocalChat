import type { VectorCapacityRun } from '@localchat/contracts';
import { TimeSeries } from '@/shared/ui/charts/TimeSeries';
import { formatBytes, formatCount, formatDuration } from '@/shared/lib/format';
import {
  buildDiskTrend,
  buildLatencyTrend,
  buildMemoryTrend,
  buildThroughputTrend,
  summarize,
} from './vectorCapacitySeries';
import styles from './Settings.module.css';

interface VectorCapacityChartsProps {
  run: VectorCapacityRun;
}

/**
 * How retrieval, insertion, disk and memory move as document count grows within one sweep -
 * the four axes src/vector_capacity_benchmark.py measures at each checkpoint.
 *
 * Unlike the other two benchmark cards, there is no device or model axis to compare: the
 * subject under test is the FAISS vector store itself, swept over document count instead. So
 * each chart below is one line (or, for latency, a min/mean/max trio) across this run's
 * checkpoints rather than a bar per model - the comparison that matters here is a step
 * against the step before it.
 */
export function VectorCapacityCharts({ run }: VectorCapacityChartsProps) {
  const { steps } = run;
  const headline = summarize(run);

  return (
    <div className={styles.charts}>
      {headline && (
        <p className={styles.advice}>
          From {formatCount(headline.firstDocCount)} to {formatCount(headline.lastDocCount)}{' '}
          documents ({headline.docCountFactor.toFixed(0)}&times; more): mean retrieval latency grew{' '}
          <strong>{headline.latencyFactor.toFixed(0)}&times;</strong>
          {headline.latencyFactor > headline.docCountFactor
            ? ' — worse than linear with document count.'
            : ' — roughly in line with document count.'}
        </p>
      )}

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>Retrieval latency by document count</span>
        </figcaption>
        {steps.length > 0 ? (
          <TimeSeries
            lines={buildLatencyTrend(steps)}
            format={formatDuration}
            formatTime={formatCount}
            caption="Retrieval latency"
          />
        ) : (
          <p className={styles.chartEmpty}>No checkpoints measured yet.</p>
        )}
      </figure>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>Insertion throughput by document count</span>
        </figcaption>
        {steps.length > 0 ? (
          <TimeSeries
            lines={buildThroughputTrend(steps)}
            format={(value) => `${value.toFixed(1)} docs/s`}
            formatTime={formatCount}
            caption="Insertion throughput"
          />
        ) : (
          <p className={styles.chartEmpty}>No checkpoints measured yet.</p>
        )}
      </figure>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>Disk usage by document count</span>
        </figcaption>
        {steps.length > 0 ? (
          <TimeSeries
            lines={buildDiskTrend(steps)}
            format={(value) => formatBytes(value, 1)}
            formatTime={formatCount}
            caption="Disk usage"
          />
        ) : (
          <p className={styles.chartEmpty}>No checkpoints measured yet.</p>
        )}
      </figure>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>Process memory by document count</span>
        </figcaption>
        {steps.length > 0 ? (
          <TimeSeries
            lines={buildMemoryTrend(steps)}
            format={(value) => formatBytes(value, 1)}
            formatTime={formatCount}
            caption="Process memory"
          />
        ) : (
          <p className={styles.chartEmpty}>No checkpoints measured yet.</p>
        )}
      </figure>
    </div>
  );
}
