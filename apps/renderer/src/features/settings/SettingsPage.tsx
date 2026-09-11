import { useState } from 'react';
import type { ComputeMode, Model, ModelBenchmarkRow } from '@localchat/contracts';
import {
  useActiveModel,
  useBenchmark,
  useModels,
  useBenchmarkHistory,
  useRunBenchmark,
  useSetActiveModel,
  useSettings,
  useUpdateSettings,
} from '@/shared/api/queries';
import { describeError } from '@/shared/api/http';
import { BenchmarkCharts } from './BenchmarkCharts';
import { Button } from '@/shared/ui/Button';
import { Toggle } from '@/shared/ui/Controls';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Mono, ProgressBar, SectionLabel } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { formatBytes, formatCount, formatDuration, formatRelative } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import styles from './Settings.module.css';

export function SettingsPage() {
  const settings = useSettings();
  const activeModelState = useActiveModel();
  const models = useModels();
  const update = useUpdateSettings();
  const setActiveModel = useSetActiveModel();

  // Applying a model or switching device is one blocking call that can take tens of
  // seconds on a multi-gigabyte GGUF — the row picked has to say so, or a second click
  // during the wait reads as the first one having failed.
  const pendingModelId =
    setActiveModel.isPending && setActiveModel.variables?.modelId !== undefined
      ? setActiveModel.variables.modelId
      : null;

  const hardware = settings.data?.hardware;
  const vramFraction =
    hardware?.gpuMemoryBytes && hardware.gpuMemoryUsedBytes
      ? hardware.gpuMemoryUsedBytes / hardware.gpuMemoryBytes
      : 0;

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Settings sections">
        <h1 className={styles.navTitle}>Settings</h1>
        <span className={cn(styles.navItem, styles.navItemActive)}>
          <Icon name="cpu" size={16} />
          Model &amp; hardware
        </span>
        <span className={styles.navSpacer} />
        <Mono className={styles.navVersion}>LocalChat 0.4.1</Mono>
      </nav>

      <div className={styles.content}>
        <PageHeader
          title="Model & hardware"
          description="The model, the index and every question stay on this machine."
        />

        <div className={styles.columns}>
          <div className={styles.column}>
            <section className={styles.card}>
              <header className={styles.cardHeader}>
                <SectionLabel
                  action={
                    <Mono className={styles.cardHeaderMeta}>
                      {models.data?.length ?? 0} installed ·{' '}
                      {formatBytes(
                        (models.data ?? []).reduce((total, m) => total + m.sizeBytes, 0),
                      )}{' '}
                      on disk
                    </Mono>
                  }
                >
                  Answer model
                </SectionLabel>
              </header>
              <div className={styles.modelList} role="radiogroup" aria-label="Answer model">
                {models.data?.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    selected={model.id === activeModelState.data?.activeModelId}
                    pending={model.id === pendingModelId}
                    disabled={pendingModelId !== null && model.id !== pendingModelId}
                    onSelect={() => setActiveModel.mutate({ modelId: model.id })}
                  />
                ))}
              </div>
            </section>

            <section className={styles.card}>
              <SectionLabel>Compute</SectionLabel>
              <div className={styles.computeRow}>
                <ComputeCard
                  mode="cpu"
                  icon="cpu"
                  title="CPU only"
                  detail={
                    hardware
                      ? `Works on any machine. ${hardware.cpuThreads} threads available.`
                      : 'Works on any machine.'
                  }
                  selected={activeModelState.data?.compute === 'cpu'}
                  disabled={setActiveModel.isPending}
                  onSelect={() => setActiveModel.mutate({ compute: 'cpu' })}
                />
                <ComputeCard
                  mode="gpu"
                  icon="gpu"
                  title="GPU acceleration"
                  detail={
                    activeModelState.data?.gpuAvailable === false
                      ? 'No CUDA-enabled build of llama-cpp-python installed — GPU offload is unavailable on this machine.'
                      : hardware?.gpuName
                        ? `${hardware.gpuName} · ${formatBytes(hardware.gpuMemoryBytes ?? 0)} · ${hardware.gpuLayersOffloaded} of ${hardware.gpuLayersTotal} layers offloaded`
                        : 'GPU acceleration, if the installed build supports it.'
                  }
                  selected={activeModelState.data?.compute === 'gpu'}
                  disabled={
                    setActiveModel.isPending || activeModelState.data?.gpuAvailable === false
                  }
                  onSelect={() => setActiveModel.mutate({ compute: 'gpu' })}
                />
              </div>

              {setActiveModel.isError && (
                <p className={styles.benchWarning}>{describeError(setActiveModel.error)}</p>
              )}

              {hardware?.gpuMemoryBytes && (
                <div className={styles.vram}>
                  <div className={styles.vramRow}>
                    <span>VRAM in use</span>
                    <Mono>
                      {formatBytes(hardware.gpuMemoryUsedBytes ?? 0)} /{' '}
                      {formatBytes(hardware.gpuMemoryBytes)}
                    </Mono>
                  </div>
                  <ProgressBar
                    value={vramFraction}
                    thickness={5}
                    tone={vramFraction > 0.85 ? 'warning' : 'accent'}
                    label="VRAM in use"
                  />
                  <p className={styles.hint}>
                    A model with a larger context window would exceed this card — LocalChat falls
                    back to partial offload rather than failing.
                  </p>
                </div>
              )}
            </section>

            {/*
              The benchmark sits under the model list on purpose. It measures exactly
              the thing the list asks you to choose between, and on its own page the
              choice was made on one screen and the evidence for it lived on another.
              Full width because six numeric columns were unreadable in the rail.
            */}
            <BenchmarkCard />
          </div>

          <div className={styles.rail}>
            {settings.data && (
              <section className={styles.card}>
                <SectionLabel>Network</SectionLabel>
                <Toggle
                  checked={settings.data.strictOffline}
                  onChange={(strictOffline) => update.mutate({ strictOffline })}
                  label="Strict offline mode"
                  description="Blocks every outbound request, including approved tools."
                />
                <Mono className={styles.outbound}>
                  outbound requests this session:{' '}
                  {formatCount(settings.data.outboundRequestsThisSession)}
                </Mono>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  pending,
  disabled,
  onSelect,
}: {
  model: Model;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-busy={pending || undefined}
      disabled={disabled}
      className={cn(styles.modelRow, selected && styles.modelRowSelected)}
      onClick={onSelect}
    >
      {pending ? (
        <Icon name="refresh" size={16} className={styles.modelSpinner} />
      ) : (
        <span className={cn(styles.radio, selected && styles.radioSelected)} aria-hidden="true" />
      )}
      <span className={styles.modelText}>
        <span className={styles.modelName}>
          {[model.name, model.quantization].filter(Boolean).join(' · ')}
        </span>
        {/*
          Context length and the descriptive note are only known when the catalogue knows
          them. The live service lists GGUF files off disk and reads neither, so these are
          joined rather than concatenated: a missing value drops out instead of rendering
          "NaNk context" beside a real file size.
        */}
        <Mono className={styles.modelMeta}>
          {pending
            ? 'Loading onto device — this can take a minute for a large model…'
            : [
                formatBytes(model.sizeBytes),
                model.contextTokens === null
                  ? null
                  : `${formatCount(model.contextTokens / 1024)}k context`,
                model.note || null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </Mono>
      </span>
      {!pending && model.medianLatencyMs !== null && (
        <Mono className={styles.modelLatency}>{formatDuration(model.medianLatencyMs)} median</Mono>
      )}
    </button>
  );
}

function ComputeCard({
  icon,
  title,
  detail,
  selected,
  disabled = false,
  onSelect,
}: {
  mode: ComputeMode;
  icon: IconName;
  title: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className={cn(styles.compute, selected && styles.computeSelected)}
      onClick={onSelect}
    >
      <span className={styles.computeHead}>
        <Icon name={icon} size={15} />
        <span className={styles.computeTitle}>{title}</span>
        {selected && (
          <Icon name="check" size={15} strokeWidth={2.6} className={styles.computeCheck} />
        )}
      </span>
      <span className={styles.computeDetail}>{detail}</span>
    </button>
  );
}

/**
 * The model benchmark.
 *
 * This measures models, not retrieval. The service loads each GGUF onto each device and
 * times generation against one fixed prompt whose context is supplied inline — the index
 * is never touched. So the table answers "which model can this machine run, and how fast",
 * which is what decides the model we ship. The header says so, because a table of
 * millisecond figures on a screen inside a RAG product will otherwise be read as a
 * measurement of the RAG.
 */
function BenchmarkCard() {
  const benchmark = useBenchmark();
  const models = useModels();
  const activeModel = useActiveModel();
  const run = useRunBenchmark();
  const history = useBenchmarkHistory();
  const result = benchmark.data;
  const running = result?.status === 'running' || run.isPending;

  /** Empty means every installed model, which is what the service does with `models: null`. */
  const [only, setOnly] = useState('');

  // Which devices to run this pass, engineer-chosen rather than always-both: a run loads
  // every installed model on every checked device in sequence, so narrowing to one device is
  // the difference between checking a single change and waiting out the whole matrix.
  const [useCpu, setUseCpu] = useState(true);
  const [useGpu, setUseGpu] = useState(true);

  /**
   * GPU stays off the request entirely when this build cannot honour it. Requesting `gpu`
   * where llama-cpp-python was installed without a CUDA build is refused with
   * ERR_GPU_UNAVAILABLE, and the service refuses the WHOLE request — not just the GPU rows —
   * so nothing runs at all.
   */
  const gpuAvailable = activeModel.data?.gpuAvailable ?? false;
  const devices: ComputeMode[] = [
    ...(useCpu ? (['cpu'] as const) : []),
    ...(gpuAvailable && useGpu ? (['gpu'] as const) : []),
  ];
  const start = () =>
    run.mutate({
      devices,
      models: only ? [only] : null,
    });

  const picker = (
    <div className={styles.benchPickerRow}>
      <label className={styles.benchPicker}>
        <span className={styles.benchPickerLabel}>Benchmark</span>
        <select
          className={styles.benchSelect}
          value={only}
          disabled={running}
          onChange={(event) => setOnly(event.target.value)}
        >
          <option value="">all installed models</option>
          {(models.data ?? []).map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.benchDevices}>
        <span className={styles.benchPickerLabel}>Devices</span>
        <label className={styles.benchDeviceOption}>
          <input
            type="checkbox"
            checked={useCpu}
            disabled={running}
            onChange={(event) => setUseCpu(event.target.checked)}
          />
          CPU
        </label>
        <label
          className={cn(
            styles.benchDeviceOption,
            !gpuAvailable && styles.benchDeviceOptionDisabled,
          )}
        >
          <input
            type="checkbox"
            checked={gpuAvailable && useGpu}
            disabled={running || !gpuAvailable}
            onChange={(event) => setUseGpu(event.target.checked)}
          />
          GPU
        </label>
        {!gpuAvailable && <span className={styles.benchPickerNote}>No CUDA build installed</span>}
      </span>
    </div>
  );

  if (!result) {
    return (
      <section className={styles.card}>
        <SectionLabel>Model benchmark</SectionLabel>
        <p className={styles.hint}>
          Compares the installed models on this machine — load time, time to first token and
          generation speed. It does not measure retrieval quality.
        </p>
        {picker}
        {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}
        <Button
          variant="outline"
          size="sm"
          loading={running}
          disabled={devices.length === 0}
          onClick={start}
        >
          Run benchmark
        </Button>
      </section>
    );
  }

  const measured = result.rows.filter((row) => row.status === 'ok');
  const fastest = measured.reduce<ModelBenchmarkRow | undefined>(
    (best, row) => ((row.tokensPerSecond ?? 0) > (best?.tokensPerSecond ?? 0) ? row : best),
    undefined,
  );

  return (
    <section className={styles.card}>
      <SectionLabel
        action={
          <Mono className={styles.cardHeaderMeta}>
            {result.status === 'running'
              ? (result.progress ?? 'running')
              : formatRelative(result.finishedAt ?? result.startedAt)}
          </Mono>
        }
      >
        Model benchmark
      </SectionLabel>

      <p className={styles.hint}>
        Generation speed per model and device, against one fixed prompt. This is not a measure of
        retrieval quality — no document is searched.
      </p>

      {result.status === 'running' && (
        <p className={styles.benchWarning}>
          Running{result.current ? ` — ${result.current}` : ''}. Answering is unavailable until it
          finishes: the service unloads the active model to benchmark.
        </p>
      )}

      {result.status === 'failed' && (
        <p className={styles.benchWarning}>The run did not finish. Start it again below.</p>
      )}

      {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}

      {measured.length > 0 && (
        <BenchmarkCharts latest={result} history={history.data ?? [result]} />
      )}

      <div className={styles.benchScroll}>
        <table className={styles.benchTable}>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Device</th>
              <th scope="col">Load</th>
              <th scope="col">First token</th>
              <th scope="col">Tokens/s</th>
              <th scope="col">Peak memory</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={`${row.modelId}-${row.compute}`}>
                <th scope="row" className={styles.benchModel}>
                  {row.modelName}
                </th>
                <td>
                  <Mono>{row.compute.toUpperCase()}</Mono>
                </td>
                {row.status === 'ok' ? (
                  <>
                    <td>
                      <Mono>{row.loadMs === null ? '—' : formatDuration(row.loadMs)}</Mono>
                    </td>
                    <td>
                      <Mono>
                        {row.timeToFirstTokenMs === null
                          ? '—'
                          : formatDuration(row.timeToFirstTokenMs)}
                      </Mono>
                    </td>
                    <td className={cn(row === fastest && styles.benchAccent)}>
                      <Mono>
                        {row.tokensPerSecond === null ? '—' : row.tokensPerSecond.toFixed(1)}
                      </Mono>
                    </td>
                    <td>
                      <Mono>{formatPeakMemory(row.peakMemoryBytes, row.peakVramBytes)}</Mono>
                    </td>
                  </>
                ) : (
                  /*
                    A skipped or failed combination gets the reason across the row rather
                    than four em dashes. "No CUDA build installed" is actionable; a row of
                    blanks reads as a bug in the benchmark.
                  */
                  <td colSpan={4} className={styles.benchSkipped}>
                    {row.detail ?? (row.status === 'skipped' ? 'Skipped' : 'Failed')}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {picker}

      <Button
        variant="outline"
        size="sm"
        loading={running}
        disabled={devices.length === 0}
        onClick={start}
      >
        Run benchmark again
      </Button>
    </section>
  );
}

/**
 * VRAM is reported for GPU rows and system memory for CPU rows; showing both columns would
 * leave one permanently empty.
 */
function formatPeakMemory(memoryBytes: number | null, vramBytes: number | null): string {
  if (vramBytes !== null) return `${formatBytes(vramBytes)} VRAM`;
  if (memoryBytes !== null) return formatBytes(memoryBytes);
  return '—';
}
