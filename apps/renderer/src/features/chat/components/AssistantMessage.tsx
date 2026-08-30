import { useCallback, useRef, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { Citation, Figure, Message, ToolCall } from '@localchat/contracts';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/Button';
import { Callout, Mono } from '@/shared/ui/Indicators';
import { formatCitationRef, formatDuration } from '@/shared/lib/format';
import { parseAnswer, type AnswerBlock } from '../lib/answerMarkup';
import styles from './Chat.module.css';

interface AssistantMessageProps {
  message: Pick<
    Message,
    'content' | 'citations' | 'figures' | 'toolCalls' | 'noEvidence' | 'suggestions' | 'timings'
  >;
  /** True while tokens are still arriving; suppresses the reaction row and the caret. */
  streaming?: boolean;
  onSuggestion?: (suggestion: string) => void;
}

export function AssistantMessage({
  message,
  streaming = false,
  onSuggestion,
}: AssistantMessageProps) {
  const sourcesRef = useRef<HTMLDivElement>(null);

  /**
   * Clicking [2] in the prose scrolls its source row into view and flashes it. Delegated
   * from the container, so the parser never has to carry a callback.
   */
  const focusCitation = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-citation-marker]');
    const marker = target?.dataset.citationMarker;
    if (!marker) return;

    const row = sourcesRef.current?.querySelector<HTMLElement>(`[data-marker="${marker}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.add(styles.sourceFlash ?? '');
    window.setTimeout(() => row.classList.remove(styles.sourceFlash ?? ''), 1200);
  }, []);

  const blocks = parseAnswer(message.content);
  return (
    <article className={styles.turn}>
      <span className={styles.avatar} aria-hidden="true">
        <Icon name="chat" size={15} strokeWidth={2.4} />
      </span>

      <div className={styles.turnBody} data-selectable>
        {message.noEvidence ? (
          <NoEvidencePanel suggestions={message.suggestions} onSuggestion={onSuggestion}>
            {message.content}
          </NoEvidencePanel>
        ) : (
          <div className={styles.prose} onClick={focusCitation}>
            {renderBlocks(blocks, streaming)}
          </div>
        )}

        {message.citations.length > 0 && (
          <SourcesPanel ref={sourcesRef} citations={message.citations} timings={message.timings} />
        )}

        {message.figures.map((figure) => (
          <FigureCard key={figure.id} figure={figure} />
        ))}

        {message.toolCalls.map((toolCall) => (
          <ToolCallCard key={toolCall.id} toolCall={toolCall} />
        ))}

        {!streaming && (
          <div className={styles.reactions}>
            <IconButton icon="copy" label="Copy answer with citations" size={16} />
            <IconButton icon="thumbsUp" label="Answer was useful" size={16} />
            <IconButton icon="thumbsDown" label="Answer was not useful" size={16} />
            <IconButton icon="refresh" label="Ask again" size={16} />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Consecutive bullets are collected into one list so the markup stays semantic.
 *
 * While streaming, the caret is appended inside the final block rather than after the whole
 * answer: a cursor sitting alone on the next line reads as a rendering fault, not as writing
 * in progress.
 */
function renderBlocks(blocks: AnswerBlock[], streaming = false): ReactNode[] {
  const output: ReactNode[] = [];
  let run: AnswerBlock[] = [];
  const caret = <span className={styles.caret} aria-hidden="true" />;

  const flush = (last: boolean) => {
    if (run.length === 0) return;
    const items = run;
    run = [];
    output.push(
      <ul className={styles.bullets} key={`list-${output.length}`}>
        {items.map((block, index) => (
          <li key={index}>
            {block.content}
            {last && streaming && index === items.length - 1 ? caret : null}
          </li>
        ))}
      </ul>,
    );
  };

  blocks.forEach((block, index) => {
    const last = index === blocks.length - 1;
    if (block.kind === 'bullet') {
      run.push(block);
      if (last) flush(true);
      return;
    }
    flush(false);
    output.push(
      <p key={`p-${output.length}`}>
        {block.content}
        {last && streaming ? caret : null}
      </p>,
    );
  });
  flush(true);

  // Nothing has arrived yet: the caret still needs somewhere to live.
  if (output.length === 0 && streaming) output.push(<p key="caret">{caret}</p>);
  return output;
}

// ---------------------------------------------------------------------------

interface SourcesPanelProps {
  citations: Citation[];
  timings: Message['timings'];
  ref?: Ref<HTMLDivElement>;
}

/**
 * The sources block. Every answer that claims a fact has one; it is the product's whole
 * argument for being trusted with a commissioning decision.
 */
function SourcesPanel({ citations, timings, ref }: SourcesPanelProps) {
  return (
    <section className={styles.sources} aria-label={`${citations.length} sources`}>
      <header className={styles.sourcesHeader}>
        <Icon name="link" size={13} strokeWidth={2} />
        <span className={styles.sourcesTitle}>
          {citations.length} {citations.length === 1 ? 'source' : 'sources'}
        </span>
        {timings && (
          <Mono className={styles.sourcesTimings}>
            retrieved in {formatDuration(timings.retrievalMs)} · answered in{' '}
            {formatDuration(timings.generationMs)}
          </Mono>
        )}
      </header>

      <div ref={ref}>
        {citations.map((citation) => (
          <div className={styles.sourceRow} key={citation.marker} data-marker={citation.marker}>
            <Mono className={styles.sourceMarker}>[{citation.marker}]</Mono>
            <Icon name="document" size={14} className={styles.sourceIcon} />
            <span className={styles.sourceTitle}>{citation.documentTitle}</span>
            {citation.section && <span className={styles.sourceSection}>{citation.section}</span>}
            <Mono className={styles.sourceRef}>
              {formatCitationRef({
                page: citation.page,
                revision: citation.revision,
                documentDate: citation.documentDate,
              })}
            </Mono>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function FigureCard({ figure }: { figure: Figure }) {
  return (
    <figure className={styles.figure}>
      <img
        className={styles.figureThumb}
        src={figure.thumbnailUrl}
        alt={figure.description ?? figure.caption}
        width={150}
        height={96}
      />
      <figcaption className={styles.figureBody}>
        <span className={styles.figureHeading}>
          <Mono className={styles.figureTag}>FIGURE</Mono>
          <span className={styles.figureCaption}>
            {figure.label ? `${figure.label} — ` : ''}
            {figure.caption}
          </span>
        </span>
        {figure.description && <p className={styles.figureText}>{figure.description}</p>}
        <Mono className={styles.figureRef}>
          {figure.documentTitle}
          {figure.page ? ` · p. ${figure.page}` : ''}
        </Mono>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------

/**
 * A tool result is drawn with a dashed border, its own heading and no citation markers, so
 * it can never be misread as something that came out of a document.
 */
function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  return (
    <section className={styles.tool} aria-label="Tool result">
      <header className={styles.toolHeader}>
        <Icon name="plug" size={14} strokeWidth={1.9} />
        <span className={styles.toolTitle}>Tool result — not a document citation</span>
        <Mono className={styles.toolServer}>approved MCP server</Mono>
      </header>
      <div className={styles.toolBody}>
        <div className={styles.toolCall}>
          <Mono className={styles.toolName}>
            {toolCall.server}.{toolCall.tool}
          </Mono>
          <Mono className={styles.toolArgs}>{toolCall.argumentsPreview}</Mono>
        </div>
        <p className={styles.toolResult}>{toolCall.result}</p>
        {toolCall.caveat && <p className={styles.toolCaveat}>{toolCall.caveat}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function NoEvidencePanel({
  children,
  suggestions,
  onSuggestion,
}: {
  children: string;
  suggestions: string[];
  onSuggestion?: (suggestion: string) => void;
}) {
  return (
    <Callout
      icon="searchOff"
      title="Not found in the indexed documentation."
      actions={suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className={styles.suggestion}
          onClick={() => onSuggestion?.(suggestion)}
        >
          <Icon name="plus" size={12} strokeWidth={2.2} />
          {suggestion}
        </button>
      ))}
    >
      {children}
    </Callout>
  );
}
