import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { store } from '@/mocks/db';
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

  it('changes retrieval scope from inside the chat in one click', async () => {
    const { user } = renderChat('chat-throughput');

    // The scope control is always on screen — no popover to open first.
    const scope = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    const general = within(scope).getByRole('radio', { name: 'General' });
    await user.click(general);

    await waitFor(() => expect(general).toHaveAttribute('aria-checked', 'true'));
    expect(
      await screen.findByText('Searching company-wide documentation only.'),
    ).toBeInTheDocument();
  });

  /**
   * Regression test: the chat this creates does not exist yet when the effect that fires its
   * first message runs — `useChat` for the brand-new id hasn't resolved — so if that effect
   * ever again falls back to reading `chat.data.scope` instead of the scope the engineer
   * actually picked before sending, it silently asks in 'general' no matter what was chosen.
   */
  it('asks the first message in the scope chosen before the chat existed, not general', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createMemoryRouter(
      [
        { path: '/chat', element: <ChatPage /> },
        { path: '/chat/:chatId', element: <ChatPage /> },
      ],
      { initialEntries: ['/chat'] },
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const scope = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    await user.click(within(scope).getByRole('radio', { name: 'Project' }));

    // The project list loads asynchronously; the dropdown starts with only its placeholder.
    await screen.findByRole('option', { name: 'CPH T3 — LS-4000E' });
    await user.selectOptions(screen.getByLabelText('Project to search'), 'CPH T3 — LS-4000E');

    const composer = await screen.findByLabelText(/Ask a question/);
    await user.type(composer, 'What blocks a restart after an e-stop?');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/chat'));
    const newChatId = router.state.location.pathname.replace('/chat/', '');

    await waitFor(() => {
      const chat = store.chats.find((entry) => entry.id === newChatId);
      expect(chat?.scope).toBe('project');
    });
  });

  it('hides the project picker after switching back to General', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createMemoryRouter([{ path: '/chat', element: <ChatPage /> }], {
      initialEntries: ['/chat'],
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const scopeGroup = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    await user.click(within(scopeGroup).getByRole('radio', { name: 'Project' }));
    await screen.findByRole('option', { name: 'CPH T3 — LS-4000E' });
    await user.selectOptions(screen.getByLabelText('Project to search'), 'CPH T3 — LS-4000E');
    expect(screen.getByLabelText('Project to search')).toBeInTheDocument();

    await user.click(within(scopeGroup).getByRole('radio', { name: 'General' }));

    // General never draws on the project, so the picker has no business still showing here
    // even though a project was picked a moment ago.
    expect(screen.queryByLabelText('Project to search')).not.toBeInTheDocument();

    // Switching back to Project remembers the earlier pick rather than forcing it again.
    await user.click(within(scopeGroup).getByRole('radio', { name: 'Project' }));
    expect(screen.getByLabelText('Project to search')).toHaveValue('prj-cph-t3');
  });

  it('marks Project as the active scope the instant it is clicked, before any project is picked', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createMemoryRouter([{ path: '/chat', element: <ChatPage /> }], {
      initialEntries: ['/chat'],
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const scopeGroup = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    const project = within(scopeGroup).getByRole('radio', { name: 'Project' });
    await user.click(project);

    // The picker is showing (nothing chosen yet) but the click itself must already register.
    await screen.findByLabelText('Project to search');
    expect(project).toHaveAttribute('aria-checked', 'true');
  });

  it('sends a message as general if Project was clicked but nothing was ever picked', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const router = createMemoryRouter(
      [
        { path: '/chat', element: <ChatPage /> },
        { path: '/chat/:chatId', element: <ChatPage /> },
      ],
      { initialEntries: ['/chat'] },
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const scopeGroup = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    await user.click(within(scopeGroup).getByRole('radio', { name: 'Project' }));
    await screen.findByLabelText('Project to search');

    const composer = await screen.findByLabelText(/Ask a question/);
    await user.type(composer, 'What blocks a restart after an e-stop?');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/chat'));
    const newChatId = router.state.location.pathname.replace('/chat/', '');

    await waitFor(() => {
      const chat = store.chats.find((entry) => entry.id === newChatId);
      expect(chat).toMatchObject({ scope: 'general', projectId: null });
    });
  });

  /**
   * Regression test: `scope` has no persistent representation on the live service — it's
   * re-derived from `projectId` alone on every fetch (always 'project' for a project-linked
   * chat, never 'both'). `commit()` in `useAsk` invalidates `['chats']` once a turn finishes,
   * which refetches the currently-open chat too — so without `useChat` preserving the scope
   * already in its own cache over whatever a fresh fetch says, finishing a turn on a 'both'
   * chat would silently drop it back to 'project'. The mock genuinely persists scope, so to
   * prove the protection actually does something this makes it briefly lie the way the live
   * service would, starting only after the real ('both') value has already loaded once.
   */
  it('keeps the chosen scope across the refetch that follows a completed turn', async () => {
    const { user } = renderChat('chat-throughput');

    const scope = await screen.findByRole('radiogroup', { name: /retrieval scope/i });
    const both = within(scope).getByRole('radio', { name: 'Both' });
    // Forced explicitly rather than trusted from the fixture default: the mock store is a
    // module-level singleton shared across every test in this file, and an earlier test
    // here already flips this same chat to 'general' — this only needs a known starting
    // point, not that specific one.
    await user.click(both);
    await waitFor(() => expect(both).toHaveAttribute('aria-checked', 'true'));

    let refetchedAsLiveServiceWould = false;
    server.use(
      http.get('*/api/chats/:id', ({ params }) => {
        const chat = store.chats.find((entry) => entry.id === params.id);
        if (!chat) return HttpResponse.json({}, { status: 404 });
        refetchedAsLiveServiceWould = true;
        return HttpResponse.json({ chat: { ...chat, scope: 'project' } });
      }),
    );

    const composer = await screen.findByLabelText(/Ask a question/);
    await user.type(composer, 'What blocks a restart after an e-stop?');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/dual-channel/)).toBeInTheDocument(), {
      timeout: 15_000,
    });
    // `both`'s checked state would still read "true" as a stale snapshot from before the
    // post-turn refetch lands — wait for that refetch to have actually happened before
    // trusting the assertion below, or this would pass by accident rather than by the fix.
    await waitFor(() => expect(refetchedAsLiveServiceWould).toBe(true), { timeout: 5000 });

    expect(both).toHaveAttribute('aria-checked', 'true');
  }, 20_000);

  /**
   * The timing used to live in the sources header, which only renders when an answer HAS
   * sources — so a refusal, the case where "why did that take so long?" is most likely to
   * be asked, showed nothing at all.
   */
  it('shows how long a refused answer took, not only a successful one', async () => {
    renderChat('chat-anchor-bolt');
    expect(await screen.findByText(/answered in 2\.7 s/i)).toBeInTheDocument();
  });

  it('reports a round trip alone when the source gives no retrieval/generation split', async () => {
    // Halving a total into two plausible-looking numbers would put a fabricated figure
    // beside a measured one.
    renderChat('chat-anchor-bolt');
    expect(await screen.findByText(/answered in 2\.7 s/i)).toBeInTheDocument();
    expect(screen.queryByText(/retrieved in/i)).not.toBeInTheDocument();
  });

  it('shows the breakdown when the source does report it', async () => {
    renderChat('chat-throughput');
    expect(
      await screen.findByText(/retrieved in 820 ms · answered in 6\.4 s/i),
    ).toBeInTheDocument();
  });

  /**
   * A rejected document used to be indistinguishable from an accepted one: the contract
   * returned `rejected: [{ path, reason }]` and nothing rendered it, so the screen simply
   * did not change. The reason the backend gives is the actionable part.
   *
   * Driven through the drop handler rather than the file picker: the browser picker
   * resolves on a real dialog, which jsdom has none of.
   */
  it('says why a document was rejected instead of silently doing nothing', async () => {
    server.use(
      http.post('*/api/documents/ingest', () =>
        HttpResponse.json({
          accepted: [],
          rejected: [
            {
              path: '/site/notes.zip',
              reason: 'LocalChat reads PDF, DOCX, Markdown and plain text.',
            },
          ],
        }),
      ),
    );

    const { container } = renderChat('chat-throughput');
    await screen.findByLabelText(/Ask a question/);

    const page = container.firstElementChild as HTMLElement;
    fireEvent.drop(page, {
      dataTransfer: { files: [new File(['x'], 'notes.zip')], types: ['Files'] },
    });

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('notes.zip');
    expect(note).toHaveTextContent(/reads PDF, DOCX, Markdown and plain text/i);
  });
});
