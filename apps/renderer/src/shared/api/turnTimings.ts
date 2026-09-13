import type { AnswerTimings, Message } from '@localchat/contracts';

/**
 * Wall-clock timings the client measured, kept alive across the refetch that follows a turn.
 *
 * A turn is answered by a stream whose last frame carries how long it took. The transcript is
 * then refetched from the service so there is one source of truth for the content — and the
 * service does not report timings, so `timings` comes back null and the measurement is lost
 * between the answer appearing and the list settling.
 *
 * Refetching is right for content and wrong for this: how long the request took is something
 * only the client was in a position to observe. So it is remembered here, by message id, and
 * merged back on read.
 *
 * Deliberately not persisted. The number describes one request on one machine at one moment;
 * showing it again next week, beside a model that has since been swapped, would be a
 * measurement pretending to be a property of the document.
 */
const measured = new Map<string, AnswerTimings>();

/** Caps the map so a long session cannot grow it without bound. */
const LIMIT = 200;

export function rememberTimings(messageId: string, timings: AnswerTimings | null): void {
  if (!timings) return;
  if (measured.size >= LIMIT) {
    const oldest = measured.keys().next();
    if (!oldest.done) measured.delete(oldest.value);
  }
  measured.set(messageId, timings);
}

/**
 * Restores measured timings onto a refetched transcript.
 *
 * The service wins wherever it has an opinion: a message that arrives carrying timings keeps
 * them, so this never overwrites real backend numbers once `retrieval_ms` lands.
 */
export function withMeasuredTimings(messages: Message[]): Message[] {
  if (measured.size === 0) return messages;
  return messages.map((message) =>
    message.timings === null && measured.has(message.id)
      ? { ...message, timings: measured.get(message.id) as AnswerTimings }
      : message,
  );
}

/** Test seam. */
export function forgetAllTimings(): void {
  measured.clear();
}
