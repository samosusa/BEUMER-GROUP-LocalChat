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
  it('deletes every project once confirmed', async () => {
    const { user } = renderProjectsPage();

    const deleteAllProjects = await screen.findByRole('button', { name: 'Delete all projects' });
    await waitFor(() => expect(deleteAllProjects).not.toBeDisabled());

    await user.click(deleteAllProjects);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('0 projects')).toBeInTheDocument());
  });
});
