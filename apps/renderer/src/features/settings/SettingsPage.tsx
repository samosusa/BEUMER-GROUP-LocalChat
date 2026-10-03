import { useState } from 'react';
import type {
  ComputeMode,
  EmbeddingBenchmarkRow,
  EmbeddingModel,
  Model,
  ModelBenchmarkRow,
} from '@localchat/contracts';
import {
  useActiveEmbeddingModel,
  useActiveModel,
  useBenchmark,
  useEmbeddingBenchmark,
  useEmbeddingBenchmarkHistory,
  useEmbeddingModels,
  useModels,
  useBenchmarkHistory,
  useProjects,
  useRagEval,
  useRagEvalDatasets,
  useReindexJob,
  useRunBenchmark,
  useRunEmbeddingBenchmark,
  useRunRagEval,
  useRunVectorCapacityBenchmark,
  useSetActiveEmbeddingModel,
  useSetActiveModel,
  useSettings,
  useUpdateSettings,
  useVectorCapacityBenchmark,
  useVectorCapacityBenchmarkHistory,
} from '@/shared/api/queries';
import { describeError } from '@/shared/api/http';
import { BenchmarkCharts } from './BenchmarkCharts';
import { EmbeddingBenchmarkCharts } from './EmbeddingBenchmarkCharts';
import { RagEvalCompare, RagEvalResultBody } from './RagEvalCompare';
import { VectorCapacityCharts } from './VectorCapacityCharts';
import { Button, IconButton } from '@/shared/ui/Button';
import { Toggle } from '@/shared/ui/Controls';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Mono, ProgressBar, SectionLabel } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { formatBytes, formatCount, formatDuration, formatRelative } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { useUiStore } from '@/shared/store/uiStore';
import styles from './Settings.module.css';

type SettingsTab = 'model' | 'benchmarks';

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('model');
  const navCollapsed = useUiStore((state) => state.settingsNavCollapsed);
  const toggleNav = useUiStore((state) => state.toggleSettingsNav);
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
      <nav
        className={cn(styles.nav, navCollapsed && styles.navCollapsed)}
        aria-label="Settings sections"
      >
        <div className={styles.navHeader}>
          {!navCollapsed && <h1 className={styles.navTitle}>Settings</h1>}
          <IconButton
            icon={navCollapsed ? 'chevronRight' : 'chevronLeft'}
            label={navCollapsed ? 'Expand settings navigation' : 'Collapse settings navigation'}
            className={styles.navToggle}
            onClick={toggleNav}
          />
        </div>
        <button
          type="button"
          className={cn(styles.navItem, tab === 'model' && styles.navItemActive)}
          aria-current={tab === 'model' ? 'page' : undefined}
          aria-label={navCollapsed ? 'Model & hardware' : undefined}
          title={navCollapsed ? 'Model & hardware' : undefined}
          onClick={() => setTab('model')}
        >
          <Icon name="cpu" size={16} />
          {!navCollapsed && 'Model & hardware'}
        </button>
        <button
          type="button"
          className={cn(styles.navItem, tab === 'benchmarks' && styles.navItemActive)}
          aria-current={tab === 'benchmarks' ? 'page' : undefined}
          aria-label={navCollapsed ? 'Benchmarks' : undefined}
          title={navCollapsed ? 'Benchmarks' : undefined}
          onClick={() => setTab('benchmarks')}
        >
          <Icon name="chart" size={16} />
          {!navCollapsed && 'Benchmarks'}
        </button>
        <span className={styles.navSpacer} />
        {!navCollapsed && <Mono className={styles.navVersion}>LocalChat 0.4.1</Mono>}
      </nav>

      {tab === 'model' ? (
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

              <EmbeddingModelCard />
            </div>

            {settings.data && (
              <div className={styles.rail}>
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
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.content}>
          <PageHeader
            title="Benchmarks"
            description="Speed for the answer model and the embedder, and whether retrieval finds the right document — evidence for the choices made on the other tab, not settings of their own."
          />

          <div className={styles.columns}>
            <div className={styles.column}>
              <BenchmarkCard />
              <EmbeddingBenchmarkCard />
              <VectorCapacityBenchmarkCard />
              <RagEvalCard />
            </div>
          </div>
        </div>
      )}
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

/** Rows per page of the benchmark detail table below - enough to see a full machine's worth
 *  of models at a glance without the page itself growing into one long scroll. */
const BENCH_PAGE_SIZE = 20;

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

  // The detail table below used to be one long page-scroll - fine for a handful of models,
  // unreadable once several machines' worth of history is seeded in (each model/device pair
  // is its own row). Paged instead, at a size that comfortably fits without the page itself
  // scrolling.
  const [page, setPage] = useState(0);
  // Resets to page 1 when a new run replaces `result`, rather than leaving the reader on
  // whatever page number they'd scrolled to for the previous one. Adjusting state during
  // render (React's documented pattern for this) instead of in an effect, which would commit
  // the stale page first and only correct it a render later.
  const [pagedResultId, setPagedResultId] = useState(result?.id);
  if (result?.id !== pagedResultId) {
    setPagedResultId(result?.id);
    setPage(0);
  }

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

  /*
   * The detail table (and the "fastest" highlight in it) covers every run in history, not
   * just the newest one - seeding or merging in another machine's benchmark adds a whole
   * separate BenchmarkJob, and a table that only showed the latest job would silently drop
   * every other machine's rows the moment a newer run of your own came in. `history.data`
   * already includes the latest completed job's own rows (see the query key in
   * `useBenchmarkHistory`), so this is not double-counting it alongside `result`.
   */
  const allRows = (history.data ?? [result]).flatMap((run) => run.rows);
  const measured = allRows.filter((row) => row.status === 'ok');
  const fastest = measured.reduce<ModelBenchmarkRow | undefined>(
    (best, row) => ((row.tokensPerSecond ?? 0) > (best?.tokensPerSecond ?? 0) ? row : best),
    undefined,
  );

  const collapsed = collapseUnmeasured(allRows);
  const totalPages = Math.max(1, Math.ceil(collapsed.length / BENCH_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = collapsed.slice(
    safePage * BENCH_PAGE_SIZE,
    safePage * BENCH_PAGE_SIZE + BENCH_PAGE_SIZE,
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
              {/*
                A run measures every model against three questions of rising difficulty, so
                there are three rows per model and device. Without this column they read as
                duplicated rows with inexplicably different numbers.
              */}
              <th scope="col">Question</th>
              <th scope="col">Load</th>
              <th scope="col">First token</th>
              <th scope="col">Tokens/s</th>
              <th scope="col">Peak memory</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ row, questions }) => (
              // The prompt label belongs in the key: three rows now share a model and a
              // device, and React was being handed the same key three times.
              <tr key={`${row.modelId}-${row.compute}-${row.promptLabel ?? 'only'}`}>
                <th scope="row" className={styles.benchModel}>
                  {row.modelName}
                </th>
                <td title={row.deviceName ?? undefined}>
                  <Mono>
                    {row.compute.toUpperCase()}
                    {row.deviceName ? ` · ${row.deviceName}` : ''}
                  </Mono>
                </td>
                {/* The question itself on hover - a label alone is not checkable. */}
                <td title={questions === 1 ? (row.question ?? undefined) : undefined}>
                  <Mono>{questions > 1 ? `all ${questions}` : (row.promptLabel ?? '—')}</Mono>
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

      {totalPages > 1 && (
        <BenchPagination page={safePage} totalPages={totalPages} onChange={setPage} />
      )}

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

/**
 * Page numbers for a benchmark detail table, reusing the same segmented-control look as the
 * chart device tabs elsewhere on this screen rather than inventing a second button style.
 *
 * Every page gets its own button rather than windowing down to "1 … 4 5 6 … 12": a benchmark
 * run is models × devices, which tops out at a couple of hundred rows and a handful of pages
 * even with several machines seeded in - nowhere near the count windowing exists for.
 */
function BenchPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className={styles.benchPagination} role="group" aria-label="Page">
      <IconButton
        icon="chevronLeft"
        label="Previous page"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      />
      <span className={styles.chartTabs}>
        {Array.from({ length: totalPages }, (_, index) => (
          <button
            key={index}
            type="button"
            className={index === page ? styles.chartTabOn : styles.chartTab}
            aria-current={index === page || undefined}
            onClick={() => onChange(index)}
          >
            {index + 1}
          </button>
        ))}
      </span>
      <IconButton
        icon="chevronRight"
        label="Next page"
        disabled={page === totalPages - 1}
        onClick={() => onChange(page + 1)}
      />
    </div>
  );
}

/**
 * Unlike the answer model, switching this one is not a pure toggle: it changes the vector
 * space every already-indexed document's chunks live in, so a switch always queues a
 * re-embed of the whole corpus (see `useReindexJob`) before search results can be trusted
 * again. The row list stays disabled for the duration so a second click mid-reindex cannot
 * queue a third, conflicting switch.
 */
function EmbeddingModelCard() {
  const models = useEmbeddingModels();
  const active = useActiveEmbeddingModel();
  const reindexJob = useReindexJob();
  const setActive = useSetActiveEmbeddingModel();

  const pendingModel = setActive.isPending ? (setActive.variables ?? null) : null;
  const job = reindexJob.data;
  const reindexing = job?.status === 'running';

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <SectionLabel
          action={
            active.data && (
              <Mono className={styles.cardHeaderMeta}>{active.data.dimension}-dim vectors</Mono>
            )
          }
        >
          Embedding model
        </SectionLabel>
      </header>
      <p className={styles.hint}>
        Switching this re-embeds every indexed document before search results can be trusted again —
        it changes the vector space documents are stored in, not just which model answers.
      </p>
      {models.isError && <p className={styles.benchWarning}>{describeError(models.error)}</p>}
      <div className={styles.modelList} role="radiogroup" aria-label="Embedding model">
        {models.data?.map((model) => (
          <EmbeddingModelRow
            key={model.id}
            model={model}
            selected={model.id === active.data?.model}
            pending={model.id === pendingModel}
            disabled={(pendingModel !== null && model.id !== pendingModel) || reindexing}
            onSelect={() => setActive.mutate(model.id)}
          />
        ))}
      </div>
      {setActive.isError && <p className={styles.benchWarning}>{describeError(setActive.error)}</p>}
      {job && (
        <p className={reindexing ? styles.benchWarning : styles.hint}>
          {reindexing
            ? `Re-embedding into ${job.model} — ${job.progress ?? 'starting'}${
                job.currentDocument ? ` (${job.currentDocument})` : ''
              }. Search results may be incomplete until this finishes.`
            : job.status === 'failed'
              ? `The last re-embed into ${job.model} did not finish. Switch models again to retry.`
              : `Every indexed document is embedded with ${job.model}.`}
        </p>
      )}
    </section>
  );
}

function EmbeddingModelRow({
  model,
  selected,
  pending,
  disabled,
  onSelect,
}: {
  model: EmbeddingModel;
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
        <span className={styles.modelName}>{model.name}</span>
        <Mono className={styles.modelMeta}>
          {pending ? 'Loading model onto CPU…' : `${model.dimension}-dim · ${model.description}`}
        </Mono>
      </span>
    </button>
  );
}

/**
 * Measures embedding throughput, not retrieval quality — the same caveat `BenchmarkCard`
 * carries for the answer model, applied to the embedder instead. Every embedding model runs
 * CPU-only, so there is no device picker here the way there is above.
 */
function EmbeddingBenchmarkCard() {
  const benchmark = useEmbeddingBenchmark();
  const history = useEmbeddingBenchmarkHistory();
  const models = useEmbeddingModels();
  const run = useRunEmbeddingBenchmark();
  const result = benchmark.data;
  const running = result?.status === 'running' || run.isPending;

  /** Empty means every registered model, which is what the service does with `models: null`. */
  const [only, setOnly] = useState('');
  const start = () => run.mutate({ models: only ? [only] : null });

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
          <option value="">every embedding model</option>
          {(models.data ?? []).map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (!result) {
    return (
      <section className={styles.card}>
        <SectionLabel>Embedding benchmark</SectionLabel>
        <p className={styles.hint}>
          Compares embedding models on this machine — model load time and encoding throughput across
          short, medium and long text. It does not measure retrieval quality.
        </p>
        {picker}
        {benchmark.isError && (
          <p className={styles.benchWarning}>{describeError(benchmark.error)}</p>
        )}
        {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}
        <Button variant="outline" size="sm" loading={running} onClick={start}>
          Run benchmark
        </Button>
      </section>
    );
  }

  const measured = result.rows.filter((row) => row.status === 'ok');
  const fastest = measured.reduce<EmbeddingBenchmarkRow | undefined>(
    (best, row) => ((row.textsPerSecond ?? 0) > (best?.textsPerSecond ?? 0) ? row : best),
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
        Embedding benchmark
      </SectionLabel>

      <p className={styles.hint}>
        Encoding throughput per model and text size. This is not a measure of retrieval quality — no
        document is searched.
      </p>

      {result.status === 'running' && (
        <p className={styles.benchWarning}>
          Running{result.current ? ` — ${result.current}` : ''}.
        </p>
      )}

      {result.status === 'failed' && (
        <p className={styles.benchWarning}>The run did not finish. Start it again below.</p>
      )}

      {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}

      {measured.length > 0 && (
        <EmbeddingBenchmarkCharts latest={result} history={history.data ?? [result]} />
      )}

      <div className={styles.benchScroll}>
        <table className={styles.benchTable}>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Text size</th>
              <th scope="col">Load</th>
              <th scope="col">Encode</th>
              <th scope="col">Texts/s</th>
              <th scope="col">Peak memory</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={`${row.model}-${row.textLabel}`}>
                <th scope="row" className={styles.benchModel}>
                  {row.model}
                </th>
                <td>
                  <Mono>{row.textLabel ?? '—'}</Mono>
                </td>
                {row.status === 'ok' ? (
                  <>
                    <td>
                      <Mono>{row.loadMs === null ? '—' : formatDuration(row.loadMs)}</Mono>
                    </td>
                    <td>
                      <Mono>{row.embedMs === null ? '—' : formatDuration(row.embedMs)}</Mono>
                    </td>
                    <td className={cn(row === fastest && styles.benchAccent)}>
                      <Mono>
                        {row.textsPerSecond === null ? '—' : row.textsPerSecond.toFixed(1)}
                      </Mono>
                    </td>
                    <td>
                      <Mono>
                        {row.peakMemoryBytes === null ? '—' : formatBytes(row.peakMemoryBytes)}
                      </Mono>
                    </td>
                  </>
                ) : (
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

      <Button variant="outline" size="sm" loading={running} onClick={start}>
        Run benchmark again
      </Button>
    </section>
  );
}

/**
 * How many documents the vector store can hold before retrieval and insertion slow down -
 * swept over a fixed set of document-count checkpoints rather than a model or device choice,
 * since the subject under test is the FAISS vector store itself (see
 * src/vector_capacity_benchmark.py). No picker: there is nothing to choose.
 */
function VectorCapacityBenchmarkCard() {
  const benchmark = useVectorCapacityBenchmark();
  const history = useVectorCapacityBenchmarkHistory();
  const run = useRunVectorCapacityBenchmark();
  const result = benchmark.data;
  const running = result?.status === 'running' || run.isPending;

  if (!result) {
    return (
      <section className={styles.card}>
        <SectionLabel>Vector DB capacity</SectionLabel>
        <p className={styles.hint}>
          Inserts synthetic documents with fake embeddings through the real ingestion pipeline,
          sweeping document count from 100 to 5,000, and measures insertion throughput, disk
          usage and retrieval latency at each step. Documents are throwaway and never touch your
          real corpus.
        </p>
        {benchmark.isError && (
          <p className={styles.benchWarning}>{describeError(benchmark.error)}</p>
        )}
        {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}
        <Button variant="outline" size="sm" loading={running} onClick={() => run.mutate()}>
          Run benchmark
        </Button>
      </section>
    );
  }

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
        Vector DB capacity
      </SectionLabel>

      <p className={styles.hint}>
        Insertion throughput, disk usage and retrieval latency as document count grows. Fake,
        correctly-dimensioned embeddings stand in for sentence-transformers, so this measures the
        vector store and retriever, not the embedding model.
      </p>

      {result.status === 'running' && (
        <p className={styles.benchWarning}>
          Running{result.current ? ` — ${result.current}` : ''}. A full sweep inserts 5,000
          documents one at a time and can take several minutes.
        </p>
      )}

      {result.status === 'failed' && (
        <p className={styles.benchWarning}>The run did not finish. Start it again below.</p>
      )}

      {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}

      {result.steps.length > 0 && (
        <VectorCapacityCharts run={history.data?.at(-1) ?? result} />
      )}

      <div className={styles.benchScroll}>
        <table className={styles.benchTable}>
          <thead>
            <tr>
              <th scope="col">Documents</th>
              <th scope="col">Chunks</th>
              <th scope="col">Step time</th>
              <th scope="col">Docs/s</th>
              <th scope="col">Query latency (mean)</th>
              <th scope="col">Disk (vectors + db)</th>
              <th scope="col">RSS</th>
            </tr>
          </thead>
          <tbody>
            {result.steps.map((step) => (
              <tr key={step.docCount}>
                <th scope="row" className={styles.benchModel}>
                  <Mono>{formatCount(step.docCount)}</Mono>
                </th>
                <td>
                  <Mono>{formatCount(step.chunkCount)}</Mono>
                </td>
                <td>
                  <Mono>{formatDuration(step.stepMs)}</Mono>
                </td>
                <td>
                  <Mono>{step.docsPerSecond === null ? '—' : step.docsPerSecond.toFixed(1)}</Mono>
                </td>
                <td>
                  <Mono>
                    {step.queryLatencyMsMean === null ? '—' : formatDuration(step.queryLatencyMsMean)}
                  </Mono>
                </td>
                <td>
                  <Mono>{formatBytes(step.vectorDirBytes + step.dbSizeBytes, 1)}</Mono>
                </td>
                <td>
                  <Mono>{formatBytes(step.rssBytes, 1)}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" loading={running} onClick={() => run.mutate()}>
        Run benchmark again
      </Button>
    </section>
  );
}

/**
 * Collapses a model+device's identical unmeasured rows into one.
 *
 * A run asks three questions, so a combination that could not run at all produced three
 * rows carrying the same sentence - "needs about 6.4 GB of VRAM..." printed three times
 * under each other, which reads as three separate problems. Nothing was measured, so the
 * question axis has no meaning for these rows; one row saying so, with the count, is the
 * whole fact. Measured rows are never collapsed: their numbers differ by question, and
 * that difference is the point of the column.
 */
function collapseUnmeasured(
  rows: ModelBenchmarkRow[],
): Array<{ row: ModelBenchmarkRow; questions: number }> {
  const out: Array<{ row: ModelBenchmarkRow; questions: number }> = [];
  const firstAt = new Map<string, number>();

  for (const row of rows) {
    if (row.status === 'ok') {
      out.push({ row, questions: 1 });
      continue;
    }
    const key = `${row.modelId}\u0000${row.compute}\u0000${row.status}\u0000${row.detail ?? ''}`;
    const at = firstAt.get(key);
    if (at === undefined) {
      firstAt.set(key, out.length);
      out.push({ row, questions: 1 });
    } else {
      (out[at] as { questions: number }).questions += 1;
    }
  }

  return out;
}

/**
 * Unlike the two benchmarks above, this measures whether the system gets the *right answer*,
 * not how fast it runs. It replays a hand-labeled question set — any file dropped under
 * data/eval/ on the service, so testing a different corpus never means overwriting the one
 * you already have — against whichever project's documents are currently ingested.
 * Retrieval-hit is an objective check (did the right source show up in the citations), while
 * the judge verdict comes from the same model that may have generated the answer being
 * judged, so both the expected and actual answer are always shown for a human to read too.
 */
function RagEvalCard() {
  const datasets = useRagEvalDatasets();
  const projects = useProjects();
  const evalRun = useRagEval();
  const run = useRunRagEval();

  const [projectId, setProjectId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const result = evalRun.data;
  const running = result?.status === 'running' || run.isPending;

  // Derived, not synced: defaults to the first dataset the service reports once that list
  // has loaded, without needing an effect to keep it in step as that list arrives.
  const selectedDatasetId = datasetId || (datasets.data ?? [])[0]?.id || '';
  const selectedDataset = datasets.data?.find((dataset) => dataset.id === selectedDatasetId);

  const start = () => {
    if (!selectedDatasetId) return;
    run.mutate({ projectId: projectId || null, datasetId: selectedDatasetId });
  };

  const picker = (
    <div className={styles.benchPickerRow}>
      <label className={styles.benchPicker}>
        <span className={styles.benchPickerLabel}>Question set</span>
        <select
          className={styles.benchSelect}
          value={selectedDatasetId}
          disabled={running}
          onChange={(event) => setDatasetId(event.target.value)}
        >
          {(datasets.data ?? []).map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.id} ({dataset.totalQuestions} questions)
            </option>
          ))}
        </select>
      </label>
      <label className={styles.benchPicker}>
        <span className={styles.benchPickerLabel}>Project</span>
        <select
          className={styles.benchSelect}
          value={projectId}
          disabled={running}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">General (no project)</option>
          {(projects.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const datasetHint = selectedDataset && (
    <p className={styles.hint}>
      {selectedDataset.totalQuestions} questions across {selectedDataset.documents.length} documents
      ({selectedDataset.documents.map((doc) => doc.titleHint).join(', ')}). Ingest documents whose
      titles contain those names into the chosen project before running, or the questions about them
      will correctly come back as retrieval misses.
    </p>
  );

  const modeToggle = (
    <span className={styles.chartTabs} role="group" aria-label="View">
      <button
        type="button"
        className={mode === 'single' ? styles.chartTabOn : styles.chartTab}
        aria-pressed={mode === 'single'}
        onClick={() => setMode('single')}
      >
        Single run
      </button>
      <button
        type="button"
        className={mode === 'compare' ? styles.chartTabOn : styles.chartTab}
        aria-pressed={mode === 'compare'}
        onClick={() => setMode('compare')}
      >
        Compare
      </button>
    </span>
  );

  if (mode === 'compare') {
    return (
      <section className={styles.card}>
        <SectionLabel action={modeToggle}>RAG evaluation</SectionLabel>
        <p className={styles.hint}>
          Pick any two past runs to compare side by side — different question sets, projects, or
          models, whichever was active when each one ran.
        </p>
        <RagEvalCompare />
      </section>
    );
  }

  if (!result) {
    return (
      <section className={styles.card}>
        <SectionLabel action={modeToggle}>RAG evaluation</SectionLabel>
        <p className={styles.hint}>
          Runs a labeled question set end to end — real retrieval and real generation — and scores
          whether the right document was retrieved and whether the generated answer matches a
          written reference answer.
        </p>
        {datasetHint}
        {picker}
        {datasets.isError && <p className={styles.benchWarning}>{describeError(datasets.error)}</p>}
        {evalRun.isError && <p className={styles.benchWarning}>{describeError(evalRun.error)}</p>}
        {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}
        <Button
          variant="outline"
          size="sm"
          loading={running}
          disabled={!selectedDatasetId}
          onClick={start}
        >
          Run evaluation
        </Button>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <SectionLabel
        action={
          <>
            <Mono className={styles.cardHeaderMeta}>
              {result.datasetId} ·{' '}
              {result.status === 'running'
                ? (result.progress ?? 'running')
                : formatRelative(result.finishedAt ?? result.startedAt)}
            </Mono>
            {modeToggle}
          </>
        }
      >
        RAG evaluation
      </SectionLabel>

      <p className={styles.hint}>
        Retrieval-hit rate is objective: did the right document show up in the citations. The judge
        verdict is the active model grading its own family&apos;s answers, so treat it as a second
        signal, not ground truth — read the question and both answers yourself below.
      </p>

      {result.status === 'running' && (
        <p className={styles.benchWarning}>
          Running{result.currentQuestion ? ` — ${result.currentQuestion}` : ''}.
        </p>
      )}
      {result.status === 'failed' && (
        <p className={styles.benchWarning}>The run did not finish. Start it again below.</p>
      )}
      {run.isError && <p className={styles.benchWarning}>{describeError(run.error)}</p>}

      {datasetHint}
      {picker}

      <Button
        variant="outline"
        size="sm"
        loading={running}
        disabled={!selectedDatasetId}
        onClick={start}
      >
        Run evaluation again
      </Button>

      <RagEvalResultBody result={result} />
    </section>
  );
}
