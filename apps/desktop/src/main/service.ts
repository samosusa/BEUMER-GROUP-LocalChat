import { net } from 'electron';
import { HealthResponse } from '@localchat/contracts';
import { SERVICE_ORIGIN } from './security';

/**
 * Health watch for the local RAG service.
 *
 * The service is a separate process (FastAPI + llama.cpp). The desktop shell does not own
 * its lifecycle yet — it observes it, so the tray can tell the truth about whether the model
 * is loaded rather than showing "ready" while a 5 GB file is still being read from disk.
 *
 * When process supervision lands, it belongs here and nowhere else.
 */

type HealthListener = (health: HealthResponse) => void;

const POLL_READY_MS = 30_000;
const POLL_STARTING_MS = 2_000;

let timer: NodeJS.Timeout | null = null;

export function startServiceWatch(onHealth: HealthListener): void {
  stopServiceWatch();

  const poll = async () => {
    const health = await fetchHealth();
    if (health) onHealth(health);
    // Poll hard while the service is coming up, then back off once it is answering.
    timer = setTimeout(() => void poll(), health?.modelLoaded ? POLL_READY_MS : POLL_STARTING_MS);
  };

  void poll();
}

export function stopServiceWatch(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const response = await net.fetch(`${SERVICE_ORIGIN}/health`);
    if (!response.ok) return null;
    const parsed = HealthResponse.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // The service not being up yet is the normal case at launch, not an error worth logging
    // on every poll.
    return null;
  }
}
