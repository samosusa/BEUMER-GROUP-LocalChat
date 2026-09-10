import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Document } from '@localchat/contracts';
import { DocumentTable } from './DocumentTable';

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    projectId: null,
    filename: 'commissioning-manual.pdf',
    title: 'Commissioning Manual',
    format: 'pdf',
    revision: 'rev D',
    supersedes: null,
    chunkCount: 42,
    pageCount: 80,
    sizeBytes: 1_200_000,
    status: 'indexed',
    progress: null,
    resumeFromPage: null,
    documentDate: null,
    indexedAt: '2026-03-11T00:00:00.000Z',
    stale: false,
    ...overrides,
  };
}

describe('DocumentTable', () => {
  it('shows the empty label when there are no documents', () => {
    render(<DocumentTable documents={[]} emptyLabel="Nothing here yet." onDelete={vi.fn()} />);
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('asks before removing a document, and cancelling changes nothing', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const document = makeDocument();
    render(<DocumentTable documents={[document]} emptyLabel="empty" onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: /remove .* from the index/i }));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /remove .* from the index/i })).toBeInTheDocument();
  });

  it('deletes the document once removal is confirmed', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const document = makeDocument();
    render(<DocumentTable documents={[document]} emptyLabel="empty" onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: /remove .* from the index/i }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onDelete).toHaveBeenCalledWith(document);
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });
});
