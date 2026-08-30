import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@localchat/tokens/tokens.css';
import '@localchat/tokens/reset.css';

import { Providers } from './app/Providers';
import { router } from './app/router';

/**
 * Fonts are bundled, not fetched: the app has to look right on a customer site with no
 * internet, and a fallback-font flash on every launch is the first thing anyone notices.
 */
async function bootstrap() {
  if (__USE_MOCKS__) {
    const { startMockService } = await import('./mocks/browser');
    await startMockService();
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  );
}

void bootstrap();
