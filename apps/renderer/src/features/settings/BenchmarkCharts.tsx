import { useMemo, useState } from 'react';
import type { ComputeMode, ModelBenchmarkRun } from '@localchat/contracts';
import { GroupedColumns } from '@/shared/ui/charts/GroupedColumns';
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
  applyFilter,
  buildComparison,
  buildHardwareComparison,
  buildSpeedup,
  buildTradeoff,
  devicesMeasured,
  hardwareMeasured,
  modelsMeasured,
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
 * Views of one run, in the order the questions get asked: what should we ship, how do the
 * models compare, does the GPU earn its place, and how does speed trade off against memory.
 * The table underneath keeps every figure — it is the detail view and the accessibility
 * relief for the light theme, where three of the six series hues sit below 3:1 against white.
 */
export function BenchmarkCharts({ latest, history }: BenchmarkChartsProps) {
  const [metricKey, setMetricKey] = useState(METRICS[0]!.key);
  const metric = METRICS.find((candidate) => candidate.key === metricKey) ?? METRICS[0]!;

  const allDevices = useMemo(() => devicesMeasured([latest, ...history]), [latest, history]);
  const allModels = useMemo(() => modelsMeasured([latest, ...history]), [latest, history]);
  const allHardware = useMemo(() => hardwareMeasured([latest, ...history]), [latest, history]);
  const cpuHardware = useMemo(
    () => allHardware.filter((option) => option.compute === 'cpu'),
    [allHardware],
  );
  const gpuHardware = useMemo(
    () => allHardware.filter((option) => option.compute === 'gpu'),
    [allHardware],
  );

  /*
   * There is no "all CPUs" reading once more than one machine's rows can share history: a
   * model run on three different CPUs medians into a number that belongs to none of them.
   * So the picker always names one specific device rather than offering an aggregate option
   * - which means it needs a real starting value, not an empty "everything" filter. Defaults
   * to whatever this machine's own newest run used, falling back to the first hardware known
   * for that device if the newest run never touched it (e.g. a CPU-only run, GPU picker still
   * needs a default).
   */
  const defaultHardwareKey = (compute: ComputeMode): string[] => {
    const name =
      latest.rows.find((row) => row.compute === compute && row.status === 'ok' && row.deviceName)
        ?.deviceName ?? allHardware.find((option) => option.compute === compute)?.deviceName;
    return name ? [`${compute}\u0000${name}`] : [];
  };

  const [filter, setFilter] = useState<RunFilter>(() => ({
    ...NO_FILTER,
    hardware: [...defaultHardwareKey('cpu'), ...defaultHardwareKey('gpu')],
  }));

  /*
   * Which model the "every CPU and GPU" chart below looks at - independent of the CPU/GPU
   * pickers above, which name one specific machine's hardware and would defeat the point of
   * a chart whose whole job is showing every machine's at once.
   */
  const [hardwareModel, setHardwareModel] = useState(() => allModels[0] ?? '');
  const hardwareComparison = useMemo(
    () => buildHardwareComparison([latest, ...history], metric, hardwareModel),
    [latest, history, metric, hardwareModel],
  );

  const filteredHistory = useMemo(
    () => history.map((run) => applyFilter(run, filter)),
    [history, filter],
  );
  const filteredLatest = useMemo(() => applyFilter(latest, filter), [latest, filter]);
  /*
   * The run the "this run" charts actually describe, once a hardware pick can disagree with
   * what the globally newest job happened to run on.
   *
   * `latest` is whichever BenchmarkJob has the highest id - full stop, regardless of what
   * device it ran on. Filtering IT to a chosen CPU/GPU pair answers "does the newest job
   * happen to match", not "show me that hardware's most recent run" - so picking an older
   * machine's CPU+GPU pair (a perfectly valid combination that has real rows in the database)
   * filtered a job that never touched that hardware down to nothing, and "this run" charts
   * went blank even though the pair was right there in history. Falling back to the most
   * recent entry in the (already-filtered, oldest-first) history that isn't empty finds the
   * run that pair actually belongs to instead.
   */
  const effectiveLatest = useMemo(() => {
    if (filteredLatest.rows.length > 0) return filteredLatest;
    return [...filteredHistory].reverse().find((run) => run.rows.length > 0) ?? filteredLatest;
  }, [filteredLatest, filteredHistory]);

  const [device, setDevice] = useState<ComputeMode>('cpu');

  /*
   * "This run" is one BenchmarkJob - one machine, benchmarked once - so once the CPU and GPU
   * pickers above can each point at a DIFFERENT machine's hardware, the run they resolve to
   * quite normally has rows for only one of the two (it can never have run on a CPU from one
   * laptop and a GPU from another). Falling back to whichever device this run actually has,
   * rather than insisting on whatever `device` was last clicked, is what keeps the CPU/GPU
   * tab from landing on a choice that renders nothing.
   */
  const latestDevices = useMemo(() => devicesMeasured([effectiveLatest]), [effectiveLatest]);
  const latestActive = latestDevices.includes(device) ? device : (latestDevices[0] ?? device);

  const prompts = useMemo(() => promptsMeasured([effectiveLatest]), [effectiveLatest]);
  const hardware = useMemo(() => hardwareNames([latest, ...history]), [latest, history]);

  const advice = useMemo(() => recommend(effectiveLatest), [effectiveLatest]);
  const complexity = useMemo(
    () => buildComplexityComparison(effectiveLatest, metric, latestActive),
    [effectiveLatest, metric, latestActive],
  );
  const comparison = useMemo(
    () => buildComparison(effectiveLatest, metric),
    [effectiveLatest, metric],
  );
  // CPU and GPU generation speed differ by an order of magnitude - sharing one linear axis
  // between both series draws CPU as a sliver a couple of pixels tall next to a GPU column
  // that fills the frame. One device at a time keeps every bar readable; SpeedupBars is
  // where CPU and GPU actually get compared, as a ratio rather than two mismatched scales.
  const comparisonSeries = useMemo(
    () => comparison.series.filter((entry) => entry.key === latestActive),
    [comparison, latestActive],
  );
  const speedup = useMemo(() => buildSpeedup(effectiveLatest, metric), [effectiveLatest, metric]);

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
      effectiveLatest.rows.some(
        (row) => row.compute === 'gpu' && row.status === 'ok' && row.peakVramBytes === null,
      ),
    [effectiveLatest],
  );
  const tradeoff = useMemo(() => buildTradeoff(effectiveLatest), [effectiveLatest]);

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

  /**
   * Which CPU and which GPU to look at, one of each rather than a checklist.
   *
   * A model run on three different CPUs medians into one meaningless "CPU" number the moment
   * more than one machine's history is in play - so this isn't a filter among several, it's
   * the choice every other chart on this screen depends on to mean anything. Picking a name
   * for one device replaces whatever was chosen for that device before, and leaves the other
   * device's choice alone.
   */
  const setHardware = (compute: ComputeMode, deviceName: string) =>
    setFilter((current) => ({
      ...current,
      hardware: [
        ...current.hardware.filter((key) => !key.startsWith(`${compute}\u0000`)),
        ...(deviceName ? [`${compute}\u0000${deviceName}`] : []),
      ],
    }));

  const hardwareChoice = (compute: ComputeMode): string =>
    filter.hardware.find((key) => key.startsWith(`${compute}\u0000`))?.slice(compute.length + 1) ??
    '';

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

        {cpuHardware.length > 1 && (
          <label className={styles.benchPicker}>
            <span className={styles.benchPickerLabel}>CPU</span>
            <select
              className={styles.benchSelect}
              value={hardwareChoice('cpu')}
              onChange={(event) => setHardware('cpu', event.target.value)}
            >
              {cpuHardware.map((option) => (
                <option key={option.deviceName} value={option.deviceName}>
                  {option.deviceName}
                </option>
              ))}
            </select>
          </label>
        )}

        {gpuHardware.length > 1 && (
          <label className={styles.benchPicker}>
            <span className={styles.benchPickerLabel}>GPU</span>
            <select
              className={styles.benchSelect}
              value={hardwareChoice('gpu')}
              onChange={(event) => setHardware('gpu', event.target.value)}
            >
              {gpuHardware.map((option) => (
                <option key={option.deviceName} value={option.deviceName}>
                  {option.deviceName}
                </option>
              ))}
            </select>
          </label>
        )}

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
          <span className={styles.chartTitleActions}>
            {prompts.length > 1 && (
              <span className={styles.chartHint}>
                {metric.reduce === 'max' ? 'worst' : 'median'} of {prompts.length} questions
              </span>
            )}
            {latestDevices.length > 1 && (
              <span className={styles.chartTabs} role="group" aria-label="Device">
                {latestDevices.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={candidate === latestActive ? styles.chartTabOn : styles.chartTab}
                    aria-pressed={candidate === latestActive}
                    onClick={() => setDevice(candidate)}
                  >
                    {candidate.toUpperCase()}
                  </button>
                ))}
              </span>
            )}
          </span>
        </figcaption>
        {comparisonSeries.length > 0 && comparison.categories.length > 0 ? (
          <GroupedColumns
            categories={comparison.categories}
            series={comparisonSeries}
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
        Only worth offering once more than one model has been measured - with a single model
        this would just repeat the chart above under a different name.
      */}
      {allModels.length > 1 && (
        <figure className={styles.chartFigure}>
          <figcaption className={styles.chartTitle}>
            <span>
              Every CPU and GPU on {hardwareModel} — {metric.label.toLowerCase()}
            </span>
            <select
              className={styles.benchSelect}
              value={hardwareModel}
              onChange={(event) => setHardwareModel(event.target.value)}
            >
              {allModels.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </figcaption>
          {hardwareComparison.categories.length > 0 ? (
            <GroupedColumns
              categories={hardwareComparison.categories}
              series={hardwareComparison.series}
              format={metric.format}
              caption={metric.label}
            />
          ) : (
            <p className={styles.chartEmpty}>
              No hardware has measured {metric.label.toLowerCase()} for {hardwareModel}.
            </p>
          )}
          <p className={styles.chartFootnote}>
            Every machine in history that has run this model, CPU and GPU side by side - not scoped
            to the CPU/GPU picked above, so a machine you are not currently looking at still shows
            up here if it measured this model too.
          </p>
        </figure>
      )}

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
            {latestDevices.length > 1 && (
              <span className={styles.chartTabs} role="group" aria-label="Device">
                {latestDevices.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={candidate === latestActive ? styles.chartTabOn : styles.chartTab}
                    aria-pressed={candidate === latestActive}
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
