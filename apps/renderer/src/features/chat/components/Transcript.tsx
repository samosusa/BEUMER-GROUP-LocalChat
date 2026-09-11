import { useEffect, useRef } from 'react';
import type { Message } from '@localchat/contracts';
import { Icon } from '@/shared/ui/Icon';
import { AssistantMessage } from './AssistantMessage';
import type { AskState } from '../hooks/useAsk';
import styles from './Chat.module.css';

interface TranscriptProps {
  messages: Message[];
  ask: AskState;
  onSuggestion: (suggestion: string) => void;
}

export function Transcript({ messages, ask, onSuggestion }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  /**
   * Follow the stream only while the engineer is already at the bottom. Yanking the view
   * back down while they are re-reading a citation is the single most irritating thing a
   * chat UI can do.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      pinnedRef.current = distance < 120;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, ask.draft, ask.phase]);

  return (
    <div className={styles.transcript} ref={containerRef}>
      <div className={styles.column}>
        {messages.map((message) =>
          message.role === 'user' ? (
            <UserMessage key={message.id} content={message.content} />
          ) : (
            <AssistantMessage key={message.id} message={message} onSuggestion={onSuggestion} />
          ),
        )}

        {ask.pendingQuestion && <UserMessage content={ask.pendingQuestion} />}

        {ask.phase === 'retrieving' && <RetrievingIndicator />}

        {ask.phase === 'generating' && (
          <AssistantMessage
            streaming
            message={{
              content: ask.draft,
              citations: ask.citations,
              figures: ask.figures,
              toolCalls: ask.toolCalls,
              noEvidence: null,
              suggestions: [],
              timings: null,
              complexityTier: null,
              complexityScore: null,
            }}
          />
        )}

        {ask.phase === 'error' && ask.error && (
          <p className={styles.pending} role="alert">
            <Icon name="warning" size={16} />
            {ask.error}
          </p>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className={styles.userTurn}>
      <p className={styles.userBubble} data-selectable>
        {content}
      </p>
    </div>
  );
}

function RetrievingIndicator() {
  return (
    <div className={styles.turn}>
      <span className={styles.avatar} aria-hidden="true">
        <Icon name="chat" size={15} strokeWidth={2.4} />
      </span>
      <p className={styles.pending} role="status">
        <span className={styles.pendingDots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Searching the documents in this context…
      </p>
    </div>
  );
}
