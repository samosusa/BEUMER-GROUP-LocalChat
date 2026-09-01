import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/**
 * Boots the mock service. Called only when `__USE_MOCKS__` is true, so the production
 * bundle tree-shakes the whole mock layer away rather than shipping a fake backend.
 */
export async function startMockService(): Promise<void> {
  await worker.start({
    quiet: true,
    // Anything we did not model should fail loudly rather than escape to the network.
    onUnhandledRequest: (request, print) => {
      if (new URL(request.url).pathname.startsWith('/api')) print.error();
    },
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
