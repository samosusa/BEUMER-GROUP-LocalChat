import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Citation, Figure, Message, RetrievalScope, ToolCall } from '@localchat/contracts';
import { api } from '@/shared/api/client';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/queries';

/**
 * Phases of a turn, in the order they actually happen. The UI names the phase rather than
 * showing an undifferentiated spinner: on CPU-only hardware an answer can take fifteen
 * seconds, and "reading 3 documents" is the difference between waiting and giving up.
 */
export type AskPhase = 'idle' | 'retrieving' | 'generating' | 'error';

export interface AskState {
  phase: AskPhase;
  /** The question, echoed immediately so the transcript never lags the keystroke. */
  pendingQuestion: string | null;
  /** Answer text accumulated so far. */
  draft: string;
  citations: Citation[];
  figures: Figure[];
  toolCalls: ToolCall[];
  retrievalMs: number | null;
  error: string | null;
}

const INITIAL: AskState = {
  phase: 'idle',
  pendingQuestion: null,
  draft: '',
  citations: [],
  figures: [],
  toolCalls: [],
  retrievalMs: null,
  error: null,
};

export function useAsk(chatId: string | undefined) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AskState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  // A turn belongs to one chat. Switching chats mid-answer must not paint the new one.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, [chatId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const ask = useCallback(
    async (question: string, scope: RetrievalScope, attachmentIds: string[]) => {
      if (!chatId || question.trim() === '') return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL, phase: 'retrieving', pendingQuestion: question });

      try {
        for await (const event of api.ask(
          chatId,
          { question, scope, attachmentIds },
          controller.signal,
        )) {
          switch (event.type) {
            case 'accepted':
              break;
            case 'retrieval':
              setState((current) => ({
                ...current,
                phase: 'generating',
                citations: event.citations,
                retrievalMs: event.elapsedMs,
              }));
              break;
            case 'token':
              setState((current) => ({ ...current, draft: current.draft + event.text }));
              break;
            case 'figure':
              setState((current) => ({ ...current, figures: [...current.figures, event.figure] }));
              break;
            case 'tool':
              setState((current) => ({
                ...current,
                toolCalls: [...current.toolCalls, event.toolCall],
              }));
              break;
            case 'done':
              commit(event.message);
              return;
            case 'error':
              setState((current) => ({ ...current, phase: 'error', error: event.message }));
              return;
          }
        }
        // Stream ended without a `done` frame: refetch rather than trust a partial answer.
        await queryClient.invalidateQueries({ queryKey: keys.chats.messages(chatId) });
        setState(INITIAL);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, phase: 'error', error: describeError(error) }));
      }

      function commit(_message: Message) {
        // The mock and the service both persist the turn; refetching keeps one source of truth.
        void queryClient.invalidateQueries({ queryKey: keys.chats.messages(chatId as string) });
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
        setState(INITIAL);
      }
    },
    [chatId, queryClient],
  );

  return {
    ...state,
    ask,
    cancel,
    busy: state.phase === 'retrieving' || state.phase === 'generating',
  };
}
