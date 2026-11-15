import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin, loginAsOperator } from '../test-helpers';

// Navigating through /operation (below) mounts the live ticket-stream
// hooks, which need a global EventSource — jsdom doesn't provide one.
class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource as typeof EventSource;
});

describe('CreateTicketPage', () => {
  it('creates a ticket manually and navigates to its detail page', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /new ticket/i }));
    await screen.findByRole('heading', { name: /create ticket manually/i });

    await user.type(screen.getByLabelText(/plate/i), 'NEW1234');
    await user.type(screen.getByLabelText(/entry date & time/i), '2026-10-10T08:00');
    await user.type(screen.getByLabelText(/entry weight/i), '15000');
    await user.type(
      screen.getByLabelText(/reason/i),
      'Entrance camera failed to read the plate, recorded manually',
    );
    await user.click(screen.getByRole('button', { name: /create ticket/i }));

    await waitFor(() => {
      expect(screen.getByText('NEW1234')).toBeInTheDocument();
      expect(screen.getByText(/manually created/i)).toBeInTheDocument();
    });
  });

  // 2026-11-15: operators can now create a ticket too, from the Operação screen.
  it('lets an operator create a ticket from the Operação screen, with a back link to it', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsOperator();
    await user.click(await screen.findByRole('link', { name: /operation/i }));

    await user.click(await screen.findByRole('link', { name: /new ticket/i }));
    await screen.findByRole('heading', { name: /create ticket manually/i });
    expect(screen.getByRole('link', { name: /back to operation/i })).toHaveAttribute('href', '/operation');

    await user.type(screen.getByLabelText(/plate/i), 'OPNEW01');
    await user.type(screen.getByLabelText(/entry date & time/i), '2026-10-10T08:00');
    await user.type(screen.getByLabelText(/entry weight/i), '15000');
    await user.type(screen.getByLabelText(/reason/i), 'Operator recorded this one by hand');
    await user.click(screen.getByRole('button', { name: /create ticket/i }));

    await waitFor(() => {
      expect(screen.getByText('OPNEW01')).toBeInTheDocument();
    });
  });
});
