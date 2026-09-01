import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/Button';
import { Mono } from '@/shared/ui/Indicators';
import styles from './Composer.module.css';

interface ComposerProps {
  placeholder: string;
  busy: boolean;
  topK: number;
  historyTurns: number;
  disabled?: boolean;
  onSubmit: (question: string) => void;
  onCancel: () => void;
  onAttach: () => void;
  /** Set from outside when a suggestion chip or the quick-ask window supplies a question. */
  seed?: string | null;
}

const MAX_ROWS = 8;

export function Composer({
  placeholder,
  busy,
  topK,
  historyTurns,
  disabled = false,
  onSubmit,
  onCancel,
  onAttach,
  seed,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [appliedSeed, setAppliedSeed] = useState<string | null | undefined>(seed);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * A seed arrives when a suggestion chip or the quick-ask window supplies a question.
   * Adjusted during render rather than in an effect: React re-renders immediately with the
   * new value instead of painting the stale one first, and there is no cascading update.
   */
  if (seed !== appliedSeed) {
    setAppliedSeed(seed);
    if (seed) setValue(seed);
  }

  // Focus is an external system, so it stays in an effect.
  useLayoutEffect(() => {
    if (seed) textareaRef.current?.focus();
  }, [seed]);

  // Grow with the question up to a cap, then scroll. Measured before paint so it never jumps.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 22;
    textarea.style.height = `${Math.min(textarea.scrollHeight, lineHeight * MAX_ROWS)}px`;
  }, [value]);

  function submit() {
    const question = value.trim();
    if (!question || busy || disabled) return;
    onSubmit(question);
    setValue('');
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.inner}>
        <div className={styles.box}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={value}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Ask a question about the documents in this context"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline. Engineers paste multi-line specs in here.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />

          <div className={styles.toolbar}>
            <IconButton icon="paperclip" label="Attach documents to this chat" onClick={onAttach} />
            <IconButton icon="image" label="Attach a drawing or screenshot" onClick={onAttach} />
            <span className={styles.divider} aria-hidden="true" />
            <Mono className={styles.retrievalHint}>
              top-k {topK} · last {historyTurns} turns kept
            </Mono>
            <span className={styles.spacer} />
            {busy ? (
              <button
                type="button"
                className={styles.stop}
                onClick={onCancel}
                aria-label="Stop generating"
              >
                <Icon name="pause" size={15} strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.send}
                onClick={submit}
                disabled={value.trim() === '' || disabled}
                aria-label="Send question"
              >
                <Icon name="send" size={17} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>

        <p className={styles.disclaimer}>
          <Icon name="lock" size={12} />
          Answers are generated locally from your indexed documents. Verify against the cited source
          before acting.
        </p>
      </div>
    </div>
  );
}
