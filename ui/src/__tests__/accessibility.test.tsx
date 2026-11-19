/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NotificationProvider, useNotifications } from '../components/NotificationSystem';

function DialogHarness({
  onCancel = jest.fn(),
  onConfirm = jest.fn(),
}: {
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Delete emergency fund
      </button>
      <ConfirmDialog
        isOpen={isOpen}
        title="Delete emergency fund?"
        message="This permanently removes the fund and cannot be undone."
        confirmLabel="Delete fund"
        onCancel={() => {
          onCancel();
          setIsOpen(false);
        }}
        onConfirm={() => {
          onConfirm();
          setIsOpen(false);
        }}
      />
    </div>
  );
}

function NotificationHarness() {
  const { notify } = useNotifications();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          notify({
            type: 'error',
            title: 'Payment failed',
            message: 'The transfer was rejected by the network.',
            duration: 0,
          })
        }
      >
        Show error
      </button>
      <button
        type="button"
        onClick={() =>
          notify({ type: 'success', title: 'Payment sent', duration: 0 })
        }
      >
        Show success
      </button>
    </div>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(<DialogHarness />);
  const trigger = screen.getByRole('button', { name: 'Delete emergency fund' });
  await user.click(trigger);
  return { user, trigger, dialog: screen.getByRole('dialog') };
}

describe('ConfirmDialog accessibility', () => {
  it('exposes modal dialog semantics and a description', async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Delete emergency fund?');
    expect(dialog).toHaveAccessibleDescription(
      'This permanently removes the fund and cannot be undone.'
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('cycles focus with Tab and Shift+Tab', async () => {
    const { user } = await openDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete fund' });

    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const onCancel = jest.fn();
    const user = userEvent.setup();
    render(<DialogHarness onCancel={onCancel} />);

    const trigger = screen.getByRole('button', { name: 'Delete emergency fund' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('confirms destructive actions with a normal button', async () => {
    const onConfirm = jest.fn();
    const user = userEvent.setup();
    render(<DialogHarness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Delete emergency fund' }));
    const confirm = screen.getByRole('button', { name: 'Delete fund' });
    expect(confirm).toHaveAttribute('type', 'button');

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('NotificationSystem accessibility', () => {
  it('announces errors assertively with clear dismiss labels', async () => {
    const user = userEvent.setup();
    render(
      <NotificationProvider>
        <NotificationHarness />
      </NotificationProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Show error' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-notification-type', 'error');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('error: Payment failed');
    expect(alert).toHaveTextContent('The transfer was rejected by the network.');

    const dismiss = screen.getByRole('button', {
      name: 'Dismiss error notification: Payment failed',
    });
    await user.click(dismiss);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces successful confirmations politely', async () => {
    const user = userEvent.setup();
    render(
      <NotificationProvider>
        <NotificationHarness />
      </NotificationProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Show success' }));

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-notification-type', 'success');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('success: Payment sent');
    expect(
      screen.getByRole('button', { name: 'Dismiss success notification: Payment sent' })
    ).toBeInTheDocument();
  });
});
