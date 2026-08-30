import { useState } from 'react';
import type { BenchmarkMetrics, ComputeMode, Model } from '@localchat/contracts';
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
          {model.name} · {model.quantization}
        </span>
        <Mono className={styles.modelMeta}>
          {formatBytes(model.sizeBytes)} · {formatCount(model.contextTokens / 1024)}k context ·{' '}
          {model.note}
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

function BenchmarkCard() {
  const benchmark = useBenchmark();
  const run = useRunBenchmark();
  const result = benchmark.data;

  if (!result) {
    return (
      <section className={styles.card}>
        <SectionLabel>Benchmark</SectionLabel>
        <p className={styles.hint}>No benchmark has been run on this machine yet.</p>
        <Button variant="outline" size="sm" loading={run.isPending} onClick={() => run.mutate()}>
          Run benchmark
        </Button>
      </section>
    );
  }

  const cpu = result.results.find((entry) => entry.compute === 'cpu');
  const gpu = result.results.find((entry) => entry.compute === 'gpu');
  const overTarget = cpu && cpu.p95AnswerMs > result.targetAnswerMs;

  return (
    <section className={styles.card}>
      <SectionLabel
        action={<Mono className={styles.cardHeaderMeta}>{formatRelative(result.ranAt)}</Mono>}
      >
        Last benchmark run
      </SectionLabel>
      <p className={styles.hint}>
        {result.results[0]?.questionCount ?? 0} evaluation questions, same corpus snapshot, top-k{' '}
        {result.topK}.
      </p>

      <table className={styles.benchTable}>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">CPU</th>
            <th scope="col" className={styles.benchAccent}>
              GPU
            </th>
          </tr>
        </thead>
        <tbody>
          <BenchRow
            label="Median answer"
            cpu={cpu}
            gpu={gpu}
            pick={(m) => formatDuration(m.medianAnswerMs)}
          />
          <BenchRow
            label="95th percentile"
            cpu={cpu}
            gpu={gpu}
            pick={(m) => formatDuration(m.p95AnswerMs)}
            warnCpu={overTarget}
          />
          <BenchRow
            label="Retrieval"
            cpu={cpu}
            gpu={gpu}
            pick={(m) => formatDuration(m.medianRetrievalMs)}
          />
          <BenchRow
            label="Answers with a citation"
            cpu={cpu}
            gpu={gpu}
            pick={(m) => `${m.answersWithCitation}/${m.questionCount}`}
          />
        </tbody>
      </table>

      {overTarget && (
        <p className={styles.benchWarning}>
          CPU 95th percentile is above the {formatDuration(result.targetAnswerMs)} target.
        </p>
      )}

      <Button variant="outline" size="sm" loading={run.isPending} onClick={() => run.mutate()}>
        Run benchmark again
      </Button>
    </section>
  );
}

function BenchRow({
  label,
  cpu,
  gpu,
  pick,
  warnCpu = false,
}: {
  label: string;
  cpu: BenchmarkMetrics | undefined;
  gpu: BenchmarkMetrics | undefined;
  pick: (metrics: BenchmarkMetrics) => string;
  warnCpu?: boolean;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={cn(warnCpu && styles.benchOverTarget)}>
        <Mono>{cpu ? pick(cpu) : '—'}</Mono>
      </td>
      <td className={styles.benchAccent}>
        <Mono>{gpu ? pick(gpu) : '—'}</Mono>
      </td>
    </tr>
  );
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
