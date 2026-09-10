import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { server } from '@/mocks/server';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { NotificationStack } from '@/app/layout/NotificationStack';
import { GeneralDocumentsPage } from './GeneralDocumentsPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useNotificationStore.setState({ notifications: [] });
});
afterAll(() => server.close());

function renderPage(extra?: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [{ path: '/documents', element: <GeneralDocumentsPage /> }],
    { initialEntries: ['/documents'] },
  );

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {extra}
      </QueryClientProvider>,
    ),
  };
}

/**
 * `chooseDocuments()` opens a real `<input type="file">` that is deliberately never attached
 * to the DOM (see localFiles.ts), so there is nothing a query can find to attach a file to
 * the normal way. Standing in for the browser's own file-selection here is the only way to
 * drive this path from a test — real files never reach `.click()` in jsdom either.
 */
function stubFilePicker(...files: File[]) {
  return vi.spyOn(window.HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    if (this.type !== 'file') return;
    Object.defineProperty(this, 'files', { value: files, configurable: true });
    this.dispatchEvent(new Event('change'));
  });
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

  it('reports a rejected file inline and through the app-wide notification stack', async () => {
    const clickSpy = stubFilePicker(
      new File(['bogus'], 'bad-drawing.zip', { type: 'application/zip' }),
    );

    // NotificationStack normally lives in AppLayout, above the router — rendered as a
    // sibling here for the same reason: it must still show the outcome of a mutation that
    // has nothing to do with which page happens to be mounted.
    const { user } = renderPage(<NotificationStack />);

    await user.click(screen.getByRole('button', { name: 'Add files' }));

    expect(
      await screen.findByText('1 file could not be indexed', undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/bad-drawing\.zip/).length).toBeGreaterThan(0);

    // Both surfaces read the same mutation result, so the toast/dismiss action from the
    // notification stack is present alongside the page's own inline callout.
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();

    clickSpy.mockRestore();
  });
});
