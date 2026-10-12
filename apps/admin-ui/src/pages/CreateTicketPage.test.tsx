import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

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
});
