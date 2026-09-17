import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { server } from '@/mocks/server';
import { useUiStore } from '@/shared/store/uiStore';
import { Sidebar } from './Sidebar';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // The collapse preference is a persisted zustand store (module-level, outlives each
  // test), so a test that collapses the sidebar and doesn't explicitly expand it again
  // would otherwise leak that into every test after it in this file.
  useUiStore.setState({ sidebarCollapsed: false });
});
afterAll(() => server.close());

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter([{ path: '*', element: <Sidebar /> }], {
    initialEntries: ['/chat'],
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

describe('Sidebar', () => {
  // Order matters: the mock store is a module-level singleton that outlives each test, so
  // the destructive "delete everything" case has to run last or it starves every test after
  // it of the fixture chats they expect to find.

  it('collapses to an icon-only rail and expands back', async () => {
    const { user } = renderSidebar();

    await screen.findByLabelText('Search chats');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.queryByLabelText('Search chats')).not.toBeInTheDocument();
    // The rail keeps quick actions one click away instead of hiding navigation entirely -
    // "New chat" survives collapse as an icon-only button with the same accessible name.
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(await screen.findByLabelText('Search chats')).toBeInTheDocument();
  });

  it('disables deleting all chats while a search is narrowing the list', async () => {
    const { user } = renderSidebar();

    const deleteAll = await screen.findByRole('button', { name: 'Delete all chats' });
    await waitFor(() => expect(deleteAll).not.toBeDisabled());

    await user.type(screen.getByLabelText('Search chats'), 'throughput');

    await waitFor(() => expect(deleteAll).toBeDisabled());
  });

  it('deletes every chat once confirmed', async () => {
    const { user } = renderSidebar();

    const deleteAll = await screen.findByRole('button', { name: 'Delete all chats' });
    await waitFor(() => expect(deleteAll).not.toBeDisabled());

    await user.click(deleteAll);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('No chats yet.')).toBeInTheDocument();
  });
});
