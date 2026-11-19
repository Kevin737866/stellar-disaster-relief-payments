/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../components/ConfirmDialog';

describe('ConfirmDialog accessibility', () => {
  it('exposes a labelled modal dialog', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Delete fund?"
        message="This action cannot be undone."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-dialog-message');
    expect(screen.getByText('Delete fund?')).toHaveAttribute('id', 'confirm-dialog-title');
    expect(screen.getByText('This action cannot be undone.')).toHaveAttribute(
      'id',
      'confirm-dialog-message'
    );
  });

  it('closes on Escape', () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete fund?"
        message="This action cannot be undone."
        onConfirm={() => undefined}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cycles focus within the dialog', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Delete fund?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    const cancel = screen.getByRole('button', { name: 'Keep' });
    const confirm = screen.getByRole('button', { name: 'Delete' });

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('restores focus to the trigger when closed', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ConfirmDialog
        isOpen
        title="Delete fund?"
        message="This action cannot be undone."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
