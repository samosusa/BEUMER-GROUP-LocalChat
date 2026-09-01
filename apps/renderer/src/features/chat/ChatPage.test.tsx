import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { server } from '@/mocks/server';
import { useUiStore } from '@/shared/store/uiStore';
import { ChatPage } from './ChatPage';

/**
 * Integration tests for the chat screen, driven through the mock service.
 *
 * These cover the behaviour the product is judged on: that an answer arrives with its
 * sources, that a refusal is unmistakably a refusal, and that a tool result can never be
 * mistaken for a document citation.
 */

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * The UI store is a module-level singleton, so an open context panel survives from one test
 * into the next and quietly changes what is on screen. Reset it explicitly rather than
 * letting test order decide.
 */
beforeEach(() => {
  useUiStore.setState({ contextPanelOpen: false, lastRemovedAttachment: null });
});

function renderChat(chatId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter([{ path: '/chat/:chatId', element: <ChatPage /> }], {
    initialEntries: [`/chat/${chatId}`],
  });

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

describe('ChatPage', () => {
  it('shows the answer with every citation resolved', async () => {
    renderChat('chat-throughput');

    expect(await screen.findByText(/Rated throughput is/)).toBeInTheDocument();

    const sources = await screen.findByRole('region', { name: /3 sources/i });
    expect(within(sources).getByText('LS-4000E Commissioning Manual')).toBeInTheDocument();
    expect(within(sources).getByText('§ 3.2 Performance data')).toBeInTheDocument();
    expect(within(sources).getByText(/p\. 41 · rev D · 2026-03-11/)).toBeInTheDocument();

    // Every inline marker must have a row to land on — a dangling [n] is a broken promise.
    const markers = document.querySelectorAll('sup[data-citation-marker]');
    const markerNumbers = new Set([...markers].map((node) => node.textContent));
    for (const marker of markerNumbers) {
      expect(within(sources).getByText(marker ?? '')).toBeInTheDocument();
    }
  });

  it('states plainly when nothing was found, and keeps the tool result separate', async () => {
    renderChat('chat-anchor-bolt');

    expect(await screen.findByText('Not found in the indexed documentation.')).toBeInTheDocument();

    const tool = await screen.findByRole('region', { name: /tool result/i });
    expect(within(tool).getByText(/not a document citation/i)).toBeInTheDocument();
    expect(within(tool).getByText(/385 Nm/)).toBeInTheDocument();
    expect(within(tool).getByText(/not a CPH T3 project specification/i)).toBeInTheDocument();

    // A refusal must not be dressed up with a sources block.
    expect(screen.queryByRole('region', { name: /sources/i })).not.toBeInTheDocument();
  });

  it('shows retrieval before generation when a question is asked', async () => {
    const { user } = renderChat('chat-throughput');

    const composer = await screen.findByLabelText(/Ask a question/);
    await user.type(composer, 'What blocks a restart after an e-stop?');
    await user.keyboard('{Enter}');

    // The engineer is told what the app is doing while the model is still silent.
    expect(await screen.findByText(/Searching the documents in this context/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/dual-channel/)).toBeInTheDocument(), {
      timeout: 15_000,
    });
  }, 20_000);

  it('changes retrieval scope from inside the chat in two clicks', async () => {
    const { user } = renderChat('chat-throughput');

    // Click one: open the widget.
    const trigger = await screen.findByRole('button', { name: /Context/ });
    await user.click(trigger);

    // Click two: pick the scope.
    const scope = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    await user.click(within(scope).getByRole('radio', { name: 'General' }));

    await waitFor(() => expect(screen.getByText('General only')).toBeInTheDocument());
  });

  it('offers undo after a document is removed from context', async () => {
    const { user } = renderChat('chat-throughput');

    const remove = await screen.findByRole('button', {
      name: /Remove LS-4000E Commissioning Manual from context/i,
    });
    await user.click(remove);

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Removed');
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  /**
   * Deleting a document is the only action in the panel that cannot be undone: the vectors
   * are dropped and the original file was never kept. So it asks first, and one stray click
   * must not be enough to lose an index.
   *
   * A named document rather than "the first row": the corpus list fills in as the general
   * and project queries resolve, so an early match can be replaced before it is clicked.
   */
  const TARGET = 'LS-4000E Commissioning Manual.pdf';
  const removeLabel = `Remove ${TARGET} from the index`;

  it('asks before removing a document from the index, and cancelling changes nothing', async () => {
    const { user } = renderChat('chat-throughput');

    await user.click(await screen.findByRole('button', { name: /Context/ }));
    await user.click(await screen.findByRole('button', { name: removeLabel }));

    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: removeLabel })).toBeInTheDocument();
  });

  it('removes the document from the corpus once the removal is confirmed', async () => {
    const { user } = renderChat('chat-throughput');

    await user.click(await screen.findByRole('button', { name: /Context/ }));
    await user.click(await screen.findByRole('button', { name: removeLabel }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: removeLabel })).not.toBeInTheDocument(),
    );
  });
});
