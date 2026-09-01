import { useState } from 'react';
import type { ComputeMode, Model, ModelBenchmarkRow } from '@localchat/contracts';
import {
  useBenchmark,
  useModels,
  useRunBenchmark,
  useSettings,
  useUpdateSettings,
} from '@/shared/api/queries';
import { Button } from '@/shared/ui/Button';
import { Toggle } from '@/shared/ui/Controls';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Mono, ProgressBar, SectionLabel } from '@/shared/ui/Indicators';
import { PageHeader } from '@/shared/ui/PageHeader';
import { formatBytes, formatCount, formatDuration, formatRelative } from '@/shared/lib/format';
import { useUiStore } from '@/shared/store/uiStore';
import { cn } from '@/shared/lib/cn';
import styles from './Settings.module.css';

type Section = 'model' | 'retrieval' | 'storage' | 'tools' | 'startup' | 'benchmark';

const SECTIONS: Array<{ id: Section; label: string; icon: IconName }> = [
  { id: 'model', label: 'Model & hardware', icon: 'cpu' },
  { id: 'retrieval', label: 'Retrieval', icon: 'search' },
  { id: 'storage', label: 'Storage & privacy', icon: 'database' },
  { id: 'tools', label: 'Approved tools', icon: 'plug' },
  { id: 'startup', label: 'Startup & window', icon: 'settings' },
  { id: 'benchmark', label: 'Benchmark', icon: 'chart' },
];

export function SettingsPage() {
  const [section, setSection] = useState<Section>('model');
  const settings = useSettings();
  const models = useModels();
  const update = useUpdateSettings();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  if (!settings.data) {
    return <div className={styles.page} />;
  }

  const { hardware, retrieval } = settings.data;
  const vramFraction =
    hardware.gpuMemoryBytes && hardware.gpuMemoryUsedBytes
      ? hardware.gpuMemoryUsedBytes / hardware.gpuMemoryBytes
      : 0;

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Settings sections">
        <h1 className={styles.navTitle}>Settings</h1>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={cn(styles.navItem, section === entry.id && styles.navItemActive)}
            onClick={() => setSection(entry.id)}
          >
            <Icon name={entry.icon} size={16} />
            {entry.label}
          </button>
        ))}
        <span className={styles.navSpacer} />
        <Mono className={styles.navVersion}>LocalChat 0.4.1</Mono>
      </nav>

      <div className={styles.content}>
        {section === 'model' && (
          <>
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
                        selected={model.id === settings.data.activeModelId}
                        onSelect={() => update.mutate({ activeModelId: model.id })}
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
                      detail={`Works on any machine. ${hardware.cpuThreads} threads available.`}
                      selected={settings.data.compute === 'cpu'}
                      onSelect={() => update.mutate({ compute: 'cpu' })}
                    />
                    <ComputeCard
                      mode="gpu"
                      icon="gpu"
                      title="GPU acceleration"
                      detail={
                        hardware.gpuName
                          ? `${hardware.gpuName} · ${formatBytes(hardware.gpuMemoryBytes ?? 0)} · ${hardware.gpuLayersOffloaded} of ${hardware.gpuLayersTotal} layers offloaded`
                          : 'No compatible GPU detected.'
                      }
                      selected={settings.data.compute === 'gpu'}
                      disabled={!hardware.gpuName}
                      onSelect={() => update.mutate({ compute: 'gpu' })}
                    />
                  </div>

                  {hardware.gpuMemoryBytes && (
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
                        A model with a larger context window would exceed this card — LocalChat
                        falls back to partial offload rather than failing.
                      </p>
                    </div>
                  )}
                </section>

                <section className={cn(styles.card, styles.cardRow)}>
                  <div className={styles.cardRowText}>
                    <span className={styles.cardRowTitle}>
                      Embedding model — {settings.data.embeddingModel}
                    </span>
                    <span className={styles.hint}>
                      Changing this rebuilds every index from scratch.
                    </span>
                  </div>
                  <Button variant="outline" size="sm">
                    Change
                  </Button>
                </section>
              </div>

              <div className={styles.rail}>
                <BenchmarkCard />
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
            </div>
          </>
        )}

        {section === 'retrieval' && (
          <>
            <PageHeader
              title="Retrieval"
              description="How much of the corpus each answer is allowed to draw on."
            />
            <section className={styles.card}>
              <dl className={styles.definitions}>
                <Definition label="Passages per answer (top-k)" value={String(retrieval.topK)} />
                <Definition
                  label="Conversation turns kept"
                  value={String(retrieval.historyTurns)}
                />
                <Definition
                  label="Minimum relevance score"
                  value={retrieval.minScore.toFixed(2)}
                  hint="Below this, LocalChat refuses to answer rather than guessing."
                />
              </dl>
            </section>
          </>
        )}

        {section === 'storage' && (
          <>
            <PageHeader
              title="Storage & privacy"
              description="Everything LocalChat writes stays inside your user profile."
            />
            <section className={styles.card}>
              <dl className={styles.definitions}>
                <Definition label="Index location" value={settings.data.indexLocation} mono />
                <Definition label="Embedding model" value={settings.data.embeddingModel} mono />
              </dl>
            </section>
          </>
        )}

        {section === 'startup' && (
          <>
            <PageHeader
              title="Startup & window"
              description="LocalChat runs in the tray so the model is already loaded when you need it."
            />
            <section className={styles.card}>
              <Toggle
                checked={settings.data.launchOnStartup}
                onChange={(launchOnStartup) => update.mutate({ launchOnStartup })}
                label="Start with Windows"
                description="Loads the model in the background at sign-in."
              />
              <dl className={styles.definitions}>
                <Definition label="Quick-ask hotkey" value={settings.data.quickAskHotkey} mono />
              </dl>
              <div className={styles.themeRow}>
                <span className={styles.cardRowTitle}>Theme</span>
                <div className={styles.themeButtons}>
                  {(['dark', 'light', 'system'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={cn(styles.themeButton, theme === option && styles.themeActive)}
                      onClick={() => {
                        setTheme(option);
                        update.mutate({ theme: option });
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {section === 'tools' && (
          <>
            <PageHeader
              title="Approved tools"
              description="Tool results are always labelled separately from document citations."
            />
            <section className={styles.card}>
              <p className={styles.hint}>Enable a tool per project on the project screen.</p>
            </section>
          </>
        )}

        {section === 'benchmark' && (
          <>
            <PageHeader
              title="Benchmark"
              description="The same evaluation questions run against a fixed corpus snapshot, so results are comparable across hardware."
            />
            <div className={styles.rail}>
              <BenchmarkCard />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: Model;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(styles.modelRow, selected && styles.modelRowSelected)}
      onClick={onSelect}
    >
      <span className={cn(styles.radio, selected && styles.radioSelected)} aria-hidden="true" />
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
          {[
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
      {model.medianLatencyMs !== null && (
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
  const run = useRunBenchmark();
  const result = benchmark.data;
  const running = result?.status === 'running' || run.isPending;

  const start = () => run.mutate({ devices: ['cpu', 'gpu'], models: null });

  if (!result) {
    return (
      <section className={styles.card}>
        <SectionLabel>Model benchmark</SectionLabel>
        <p className={styles.hint}>
          Compares the installed models on this machine — load time, time to first token and
          generation speed. It does not measure retrieval quality.
        </p>
        <Button variant="outline" size="sm" loading={running} onClick={start}>
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

      <Button variant="outline" size="sm" loading={running} onClick={start}>
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

function Definition({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className={styles.definition}>
      <dt>{label}</dt>
      <dd>{mono ? <Mono>{value}</Mono> : value}</dd>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
