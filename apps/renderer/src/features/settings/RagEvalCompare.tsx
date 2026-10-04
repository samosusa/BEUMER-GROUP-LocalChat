import { useState } from 'react';
import type { Project, RagEvalRun, RagEvalRunSummary } from '@localchat/contracts';
import { useProjects, useRagEvalRun, useRagEvalRuns } from '@/shared/api/queries';
import { describeError } from '@/shared/api/http';
import { formatDuration, formatRelative } from '@/shared/lib/format';
import { Mono } from '@/shared/ui/Indicators';
import styles from './Settings.module.css';

export const RAG_EVAL_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export function formatHitRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * "5 of 6" under a percentage.
 *
 * A bare 83% invites the reader to supply their own denominator, and the footnote below the
 * card says the question set holds 45 - so the obvious reading of the headline figure was
 * "83% of 45", when it described six questions. A rate without its denominator is a claim
 * about a sample size it does not disclose. It matters twice over in the compare view,
 * where two rates sit side by side and may not be over the same number of questions.
 */
function formatHitCount(bucket: { total: number; retrievalHitRate: number | null }): string | null {
  if (bucket.retrievalHitRate === null || bucket.total === 0) return null;
  return `${Math.round(bucket.retrievalHitRate * bucket.total)} of ${bucket.total}`;
}

function projectLabel(projectId: string | null, projects: Project[] | undefined): string {
  if (projectId === null) return 'General (no project)';
  return projects?.find((project) => project.id === projectId)?.name ?? projectId;
}

function runLabel(run: RagEvalRunSummary, projects: Project[] | undefined): string {
  const when = formatRelative(run.finishedAt ?? run.startedAt);
  return `${run.datasetId} · ${projectLabel(run.projectId, projects)} · ${run.answerModel ?? 'unknown model'} · ${when}`;
}

/**
 * Summary stats and the full row-by-row transcript for one run - shared between the normal
 * single-run view and each column of the compare view below, so the two never drift apart.
 */
export function RagEvalResultBody({ result }: { result: RagEvalRun }) {
  const summary = result.summary;

  return (
    <>
      {summary && (
        <div className={styles.evalSummaryRow}>
          <div className={`${styles.evalStat} ${styles.evalStatHero}`}>
            <span className={styles.evalStatLabel}>Retrieval hit rate</span>
            <span className={styles.evalStatValue}>{formatHitRate(summary.retrievalHitRate)}</span>
            <span className={styles.evalStatDetail}>
              {formatHitCount(summary) ?? 'no questions'}
            </span>
          </div>

          <div className={styles.evalStatGroup}>
            {RAG_EVAL_DIFFICULTIES.map((difficulty) => {
              const bucket = summary.byDifficulty[difficulty];
              return (
                <div className={styles.evalStat} key={difficulty}>
                  <span className={styles.evalStatLabel}>{difficulty}</span>
                  <span className={styles.evalStatValue}>
                    {formatHitRate(bucket?.retrievalHitRate ?? null)}
                  </span>
                  <span className={styles.evalStatDetail}>
                    {(bucket && formatHitCount(bucket)) ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.evalRows}>
        {result.rows.map((row, index) => (
          <div className={styles.evalRow} key={`${row.source}-${index}`}>
            <div className={styles.evalRowHead}>
              <span>{row.difficulty}</span>
              <span>{row.source}</span>
              <span className={row.retrievalHit ? styles.evalHit : styles.evalMiss}>
                {row.retrievalHit ? 'Retrieval hit' : 'Retrieval miss'}
              </span>
              {row.judgeVerdict && <span>Judge: {row.judgeVerdict}</span>}
              {row.latencyMs !== null && <span>{formatDuration(row.latencyMs)}</span>}
            </div>
            <div className={styles.evalQuestion}>{row.question}</div>
            <div className={styles.evalAnswers}>
              <div>
                <div className={styles.evalAnswerLabel}>Expected</div>
                <div className={styles.evalAnswerText}>{row.expectedAnswer}</div>
              </div>
              <div>
                <div className={styles.evalAnswerLabel}>Got</div>
                <div className={styles.evalAnswerText}>
                  {row.notFound ? 'Not found in the indexed documentation.' : row.actualAnswer}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

interface RagEvalRunColumnProps {
  label: string;
  runs: RagEvalRunSummary[];
  projects: Project[] | undefined;
  selectedId: string;
  onSelect: (id: string) => void;
}

function RagEvalRunPicker({ label, runs, projects, selectedId, onSelect }: RagEvalRunColumnProps) {
  return (
    <label className={styles.benchPicker}>
      <span className={styles.benchPickerLabel}>{label}</span>
      <select
        className={styles.benchSelect}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        {runs.map((run) => (
          <option key={run.id} value={run.id}>
            {runLabel(run, projects)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RagEvalRunColumn({ result }: { result: RagEvalRun | null | undefined }) {
  if (!result) {
    return <p className={styles.chartEmpty}>This run no longer exists.</p>;
  }

  return (
    <div className={styles.evalCompareColumn}>
      <div className={styles.evalCompareMeta}>
        <span className={styles.evalCompareMetaTitle}>{result.datasetId}</span>
        <span>{result.answerModel ?? 'Answer model not recorded'}</span>
        <span>{result.embeddingModel ?? 'Embedding model not recorded'}</span>
        <Mono>{formatRelative(result.finishedAt ?? result.startedAt)}</Mono>
      </div>
      <RagEvalResultBody result={result} />
    </div>
  );
}

/**
 * Two independent pickers over every run the service has on record, each driving its own
 * detail fetch - so a project's current model can be checked against an older run on a
 * different dataset or a different answer model, not just against itself over time.
 */
export function RagEvalCompare() {
  const runs = useRagEvalRuns();
  const projects = useProjects();

  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  const available = runs.data ?? [];
  const selectedLeftId = leftId || available[0]?.id || '';
  const selectedRightId = rightId || available[1]?.id || available[0]?.id || '';

  const left = useRagEvalRun(selectedLeftId || null);
  const right = useRagEvalRun(selectedRightId || null);

  if (runs.isError) {
    return <p className={styles.benchWarning}>{describeError(runs.error)}</p>;
  }

  if (!runs.isLoading && available.length === 0) {
    return (
      <p className={styles.chartEmpty}>
        Run the evaluation at least once to have something to compare.
      </p>
    );
  }

  if (!runs.isLoading && available.length === 1) {
    return (
      <p className={styles.chartEmpty}>
        Only one run on record so far. Run the evaluation again to compare.
      </p>
    );
  }

  return (
    <>
      <div className={styles.benchPickerRow}>
        <RagEvalRunPicker
          label="Run A"
          runs={available}
          projects={projects.data}
          selectedId={selectedLeftId}
          onSelect={setLeftId}
        />
        <RagEvalRunPicker
          label="Run B"
          runs={available}
          projects={projects.data}
          selectedId={selectedRightId}
          onSelect={setRightId}
        />
      </div>

      <div className={styles.evalCompareColumns}>
        <RagEvalRunColumn result={left.data} />
        <RagEvalRunColumn result={right.data} />
      </div>
    </>
  );
}
