import { useMemo, useState } from 'react';
import type { ComputeMode, ModelBenchmarkRun } from '@localchat/contracts';
import { GroupedColumns } from '@/shared/ui/charts/GroupedColumns';
import { TimeSeries } from '@/shared/ui/charts/TimeSeries';
import { SpeedupBars } from '@/shared/ui/charts/SpeedupBars';
import { Scatter } from '@/shared/ui/charts/Scatter';
import { formatBytes } from '@/shared/lib/format';
import {
  MEMORY_BANDS,
  METRICS,
  buildComplexityComparison,
  hardwareNames,
  promptsMeasured,
  NO_FILTER,
  RUN_RANGES,
  applyFilter,
  buildComparison,
  buildSpeedup,
  buildTradeoff,
  buildTrend,
  devicesMeasured,
  modelsMeasured,
  recentRuns,
  recommend,
  type RunFilter,
} from './benchmarkSeries';
import styles from './Settings.module.css';

interface BenchmarkChartsProps {
  latest: ModelBenchmarkRun;
  history: ModelBenchmarkRun[];
}

/**
 * The benchmark, drawn.
 *
 * Four views of one run, in the order the questions get asked: what should we ship, how do
 * the models compare, does the GPU earn its place, and is any of this moving. The table
 * underneath keeps every figure — it is the detail view and the accessibility relief for
 * the light theme, where three of the six series hues sit below 3:1 against white.
 */
export function BenchmarkCharts({ latest, history }: BenchmarkChartsProps) {
  const [metricKey, setMetricKey] = useState(METRICS[0]!.key);
  const metric = METRICS.find((candidate) => candidate.key === metricKey) ?? METRICS[0]!;

  const [rangeKey, setRangeKey] = useState(RUN_RANGES[RUN_RANGES.length - 1]!.key);
  const range = RUN_RANGES.find((candidate) => candidate.key === rangeKey) ?? RUN_RANGES[0]!;

  const [filter, setFilter] = useState<RunFilter>(NO_FILTER);

  const shown = useMemo(() => recentRuns(history, range.count), [history, range]);
  const filteredHistory = useMemo(
    () => shown.map((run) => applyFilter(run, filter)),
    [shown, filter],
  );
  const filteredLatest = useMemo(() => applyFilter(latest, filter), [latest, filter]);

  const allDevices = useMemo(() => devicesMeasured([latest, ...history]), [latest, history]);
  const allModels = useMemo(() => modelsMeasured([latest, ...history]), [latest, history]);

  const devices = useMemo(() => devicesMeasured(filteredHistory), [filteredHistory]);
  const [device, setDevice] = useState<ComputeMode>('cpu');
  const active = devices.includes(device) ? device : (devices[0] ?? 'cpu');

  const prompts = useMemo(() => promptsMeasured([filteredLatest]), [filteredLatest]);
  const hardware = useMemo(() => hardwareNames([latest, ...history]), [latest, history]);

  const advice = useMemo(() => recommend(filteredLatest), [filteredLatest]);
  const complexity = useMemo(
    () => buildComplexityComparison(filteredLatest, metric, active),
    [filteredLatest, metric, active],
  );
  const comparison = useMemo(
    () => buildComparison(filteredLatest, metric),
    [filteredLatest, metric],
  );
  const speedup = useMemo(() => buildSpeedup(filteredLatest, metric), [filteredLatest, metric]);

  /*
   * Whether this machine's GPU has memory of its own.
   *
   * The footnote under the speedup chart used to state, unconditionally, that a GPU gains
   * almost nothing on generation speed because it shares the CPU's memory. That is true of
   * integrated graphics and false of a discrete card, and it was printed directly beneath a
   * chart reading 4.2x - the caption arguing with the figure it was captioning. A GPU row
   * that reports no VRAM figure IS the unified-memory case: `peak_vram_mb` comes back null
   * on Apple Silicon and on integrated graphics precisely because there is no separate pool
   * to measure.
   */
  const sharedMemory = useMemo(
    () =>
      filteredLatest.rows.some(
        (row) => row.compute === 'gpu' && row.status === 'ok' && row.peakVramBytes === null,
      ),
    [filteredLatest],
  );
  const tradeoff = useMemo(() => buildTradeoff(filteredLatest), [filteredLatest]);
  const trend = useMemo(
    () => buildTrend(filteredHistory, metric, active),
    [filteredHistory, metric, active],
  );

  const toggleModel = (name: string) =>
    setFilter((current) => ({
      ...current,
      models: current.models.includes(name)
        ? current.models.filter((entry) => entry !== name)
        : [...current.models, name],
    }));

  const toggleDevice = (candidate: ComputeMode) =>
    setFilter((current) => ({
      ...current,
      devices: current.devices.includes(candidate)
        ? current.devices.filter((entry) => entry !== candidate)
        : [...current.devices, candidate],
    }));

  return (
    <div className={styles.charts}>
      {(advice.fastest || advice.leanest) && (
        <p className={styles.advice}>
          {advice.sameModel && advice.fastest ? (
            <>
              <strong>{advice.fastest.modelName}</strong> is both the fastest and the leanest here —{' '}
              {metricValue(advice.fastest.tokensPerSecond, (value) => `${value} tok/s`)} on{' '}
              {advice.fastest.deviceName ?? advice.fastest.compute.toUpperCase()},{' '}
              {formatBytes(memoryOf(advice.fastest), 1)} peak.
            </>
          ) : (
            <>
              Fastest here:{' '}
              <strong>{advice.fastest ? advice.fastest.modelName : 'nothing measured'}</strong>
              {advice.fastest && (
                <>
                  {' '}
                  ({metricValue(
                    advice.fastest.tokensPerSecond,
                    (value) => `${value} tok/s`,
                  )} on {advice.fastest.compute.toUpperCase()})
                </>
              )}
              {advice.leanest && (
                <>
                  {' · '}Smallest footprint: <strong>{advice.leanest.modelName}</strong> (
                  {formatBytes(memoryOf(advice.leanest), 1)})
                </>
              )}
            </>
          )}
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

      {/*
        Filters sit in one row above every chart, so it is never ambiguous which of them a
        filter applies to. An empty selection means "all" rather than "none": clearing the
        last checkbox should not blank the screen.
      */}
      <div className={styles.filterRow}>
        {allDevices.length > 1 && (
          <span className={styles.filterGroup} role="group" aria-label="Devices">
            <span className={styles.benchPickerLabel}>Device</span>
            {allDevices.map((candidate) => (
              <FilterChip
                key={candidate}
                label={
                  hardware.get(candidate)
                    ? `${candidate.toUpperCase()} · ${hardware.get(candidate)}`
                    : candidate.toUpperCase()
                }
                on={filter.devices.length === 0 || filter.devices.includes(candidate)}
                onClick={() => toggleDevice(candidate)}
              />
            ))}
          </span>
        )}

        {allModels.length > 1 && (
          <span className={styles.filterGroup} role="group" aria-label="Models">
            <span className={styles.benchPickerLabel}>Models</span>
            {allModels.map((name) => (
              <FilterChip
                key={name}
                label={name}
                on={filter.models.length === 0 || filter.models.includes(name)}
                onClick={() => toggleModel(name)}
              />
            ))}
          </span>
        )}

        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={filter.includeUnmeasured}
            onChange={(event) =>
              setFilter((current) => ({ ...current, includeUnmeasured: event.target.checked }))
            }
          />
          Include runs that did not complete
        </label>
      </div>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>{metric.label} by model, this run</span>
          {prompts.length > 1 && (
            <span className={styles.chartHint}>
              {metric.reduce === 'max' ? 'worst' : 'median'} of {prompts.length} questions
            </span>
          )}
        </figcaption>
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

      {/*
        Only worth drawing when both devices ran. On a machine with no GPU build this whole
        figure disappears rather than showing an empty frame captioned "GPU against CPU".
      */}
      {speedup.length > 0 && (
        <figure className={styles.chartFigure}>
          <figcaption className={styles.chartTitle}>
            <span>What the GPU changes — {metric.label.toLowerCase()}</span>
          </figcaption>
          <SpeedupBars rows={speedup} baselineLabel="CPU" caption={metric.label} />
          <p className={styles.chartFootnote}>
            Above 1× means the GPU helped, whichever direction the underlying measure runs in.
            {sharedMemory
              ? ' This machine\u2019s GPU reports no memory of its own, so it is sharing the ' +
                'CPU\u2019s. Expect a real gain on time to first token, which is compute bound, ' +
                'and far less on generation speed, which is bound by memory bandwidth there is ' +
                'no more of.'
              : ' A card with its own memory gains on both: time to first token because prompt ' +
                'processing is compute bound, generation speed because VRAM has more bandwidth ' +
                'than system memory.'}
          </p>
        </figure>
      )}

      {/*
        Only worth drawing when the run measured more than one question. A single-prompt run
        would show one column per model and say nothing the chart above has not.
      */}
      {prompts.length > 1 && complexity.categories.length > 0 && (
        <figure className={styles.chartFigure}>
          <figcaption className={styles.chartTitle}>
            <span>What a harder question costs — {metric.label.toLowerCase()}</span>
            {devices.length > 1 && (
              <span className={styles.chartTabs} role="group" aria-label="Device">
                {devices.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={candidate === active ? styles.chartTabOn : styles.chartTab}
                    aria-pressed={candidate === active}
                    onClick={() => setDevice(candidate)}
                  >
                    {candidate.toUpperCase()}
                  </button>
                ))}
              </span>
            )}
          </figcaption>
          <GroupedColumns
            categories={complexity.categories}
            series={complexity.series}
            format={metric.format}
            caption={metric.label}
          />
          <p className={styles.chartFootnote}>
            The run asks the same three questions of every model, rising in difficulty. The gap
            between a model's columns is what an engineer's real question costs over the easiest
            possible one — a model that is quick only on the simple question is not quick in use.
          </p>
        </figure>
      )}

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>Speed against memory</figcaption>
        {tradeoff.length > 0 ? (
          <Scatter
            points={tradeoff}
            xLabel="Peak memory"
            yLabel="Generation speed"
            formatX={(value) => formatBytes(value, 0)}
            formatY={(value) => `${value.toFixed(0)} tok/s`}
            bands={MEMORY_BANDS}
            bestCornerNote="Top-left is the corner worth being in: fast, and small enough to run on a laptop."
          />
        ) : (
          <p className={styles.chartEmpty}>No completed rows report both speed and memory.</p>
        )}
      </figure>

      <figure className={styles.chartFigure}>
        <figcaption className={styles.chartTitle}>
          <span>
            {metric.label} over {filteredHistory.length} run
            {filteredHistory.length === 1 ? '' : 's'}
          </span>
          {devices.length > 1 && (
            <span className={styles.chartTabs} role="group" aria-label="Device">
              {devices.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={candidate === active ? styles.chartTabOn : styles.chartTab}
                  aria-pressed={candidate === active}
                  onClick={() => setDevice(candidate)}
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
            {filteredHistory.length < 2
              ? 'Run the benchmark again to compare against this one.'
              : `No ${active.toUpperCase()} results in these runs.`}
          </p>
        )}
      </figure>
    </div>
  );
}

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={on ? styles.filterChipOn : styles.filterChip}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function memoryOf(row: { peakVramBytes: number | null; peakMemoryBytes: number | null }): number {
  return row.peakVramBytes ?? row.peakMemoryBytes ?? 0;
}

function metricValue(value: number | null, format: (value: string) => string): string {
  return value === null ? 'not measured' : format(value.toFixed(value < 10 ? 1 : 0));
}

function formatRunDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
