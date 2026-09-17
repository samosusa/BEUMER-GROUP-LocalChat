import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { server } from '@/mocks/server';
import { ProjectsPage } from './ProjectsPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderProjectsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter([{ path: '/projects', element: <ProjectsPage /> }], {
    initialEntries: ['/projects'],
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

describe('ProjectsPage', () => {
  // Order matters: the mock store (src/mocks/db.ts) is a module-level singleton with no
  // reset between tests in this file, so each test below is ordered to not need data an
  // earlier one already deleted - the cancel case first (mutates nothing), then the single
  // delete, then the fully-destructive "delete every project" case last.

  it('cancelling a single-project delete leaves the project in place', async () => {
    const { user } = renderProjectsPage();

    await screen.findByText('CPH T3 — LS-4000E');

    await user.click(screen.getByRole('button', { name: 'Delete "CPH T3 — LS-4000E"' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('CPH T3 — LS-4000E')).toBeInTheDocument();
  });

  it('deletes a single project once confirmed, leaving the others', async () => {
    const { user } = renderProjectsPage();

    await screen.findByText('CPH T3 — LS-4000E');
    const countLabel = await screen.findByText(/\d+ projects/);
    const countBefore = Number(countLabel.textContent?.match(/\d+/)?.[0]);

    await user.click(screen.getByRole('button', { name: 'Delete "CPH T3 — LS-4000E"' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByText('CPH T3 — LS-4000E')).not.toBeInTheDocument();
    });
    expect(screen.getByText(`${countBefore - 1} projects`)).toBeInTheDocument();
    // The other seeded projects must survive a single-card delete.
    expect(screen.getByText('paletpac Retrofit — Aalborg')).toBeInTheDocument();
  });

  it('deletes every project once confirmed', async () => {
    const { user } = renderProjectsPage();

    const deleteAllProjects = await screen.findByRole('button', { name: 'Delete all projects' });
    await waitFor(() => expect(deleteAllProjects).not.toBeDisabled());

    await user.click(deleteAllProjects);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('0 projects')).toBeInTheDocument());
  });
});
