import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { server } from '@/mocks/server';
import { GeneralDocumentsPage } from './GeneralDocumentsPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter([{ path: '/documents', element: <GeneralDocumentsPage /> }], {
    initialEntries: ['/documents'],
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

describe('GeneralDocumentsPage', () => {
  it('deletes every general document once confirmed', async () => {
    const { user } = renderPage();

    const deleteAllDocuments = await screen.findByRole('button', {
      name: 'Delete all general documents',
    });
    await waitFor(() => expect(deleteAllDocuments).not.toBeDisabled());

    await user.click(deleteAllDocuments);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText(
        'No general documents yet. Add files or a folder to the company-wide corpus.',
      ),
    ).toBeInTheDocument();
  });
});
