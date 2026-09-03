import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DangerAction } from './DangerAction';

describe('DangerAction', () => {
  it('asks before confirming, and cancelling changes nothing', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DangerAction label="Delete all chats" confirmText="Delete all 3 chats?" onConfirm={onConfirm} />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete all chats' }));
    expect(screen.getByText('Delete all 3 chats?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete all 3 chats?')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete all chats' })).toBeInTheDocument();
  });

  it('confirms once Delete is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DangerAction label="Delete all chats" confirmText="Delete all 3 chats?" onConfirm={onConfirm} />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete all chats' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Delete all 3 chats?')).not.toBeInTheDocument();
  });

  it('is disabled when there is nothing to delete', () => {
    render(
      <DangerAction label="Delete all chats" confirmText="Delete all 0 chats?" disabled onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Delete all chats' })).toBeDisabled();
  });
});
