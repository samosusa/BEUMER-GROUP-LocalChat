import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/mocks/server';
import { useUiStore } from '@/shared/store/uiStore';
import { SettingsPage } from './SettingsPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // The collapse preference is a persisted zustand store (module-level, outlives each
  // test), so a test that collapses the nav and doesn't explicitly expand it again would
  // otherwise leak that into every test after it in this file.
  useUiStore.setState({ settingsNavCollapsed: false });
});
afterAll(() => server.close());

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>,
    ),
  };
}

describe('RagEvalCard compare mode', () => {
  it('compares two independently picked historical runs side by side', async () => {
    const { user } = renderSettingsPage();

    await user.click(screen.getByRole('button', { name: /Benchmarks/ }));

    // Wait for the card to finish loading BEFORE touching its toggle. RagEvalCard returns a
    // different subtree once the run arrives, so a button captured while it was still
    // loading is detached by the time userEvent clicks it: the click lands on nothing and
    // the mode never changes. A fast machine resolves the query before the query selector
    // runs and never sees the gap; a two-core CI runner lands squarely in it.
    await screen.findByRole('button', { name: 'Run evaluation again' });
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    const runASelect = await screen.findByRole('combobox', { name: 'Run A' });
    const runBSelect = screen.getByRole('combobox', { name: 'Run B' });
    await waitFor(() => expect(runASelect.querySelectorAll('option').length).toBeGreaterThan(1));

    // rag-eval-1 is the current finished run, unmodified; rag-eval-3 is an older synthetic
    // variant against the Danish dataset with one more retrieval miss - distinct enough on
    // both dataset id and hit rate to prove the two columns are genuinely independent.
    await user.selectOptions(runASelect, 'rag-eval-1');
    await user.selectOptions(runBSelect, 'rag-eval-3');

    await waitFor(() => expect(screen.getByText('rag_qa_pairs_da')).toBeInTheDocument());
    expect(screen.getByText('rag_qa_pairs')).toBeInTheDocument();

    const hitRates = screen.getAllByText('Retrieval hit rate');
    expect(hitRates).toHaveLength(2);
    const columnA = hitRates[0]!.closest('div')!.parentElement as HTMLElement;
    const columnB = hitRates[1]!.closest('div')!.parentElement as HTMLElement;
    expect(within(columnA).getByText('83%')).toBeInTheDocument();
    expect(within(columnB).getByText('67%')).toBeInTheDocument();
  });

  it('returns to the single-run trigger UI when switching back', async () => {
    const { user } = renderSettingsPage();

    await user.click(screen.getByRole('button', { name: /Benchmarks/ }));
    await screen.findByRole('button', { name: 'Run evaluation again' });
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    await screen.findByRole('combobox', { name: 'Run A' });

    await user.click(screen.getByRole('button', { name: 'Single run' }));

    expect(await screen.findByRole('button', { name: /Run evaluation/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Run A' })).not.toBeInTheDocument();
  });
});

describe('Settings navigation', () => {
  it('collapses to an icon-only rail and expands back, keeping the active tab reachable', async () => {
    const { user } = renderSettingsPage();

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse settings navigation' }));

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Benchmarks' }));
    expect(screen.getByRole('heading', { name: 'Benchmarks' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand settings navigation' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    // The tab selected while collapsed must still be the active one once expanded again.
    expect(screen.getByRole('button', { name: /Benchmarks/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
