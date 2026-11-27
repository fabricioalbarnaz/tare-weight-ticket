import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('UnresolvedEventsPage', () => {
  it('lists unresolved camera events with a create-ticket action', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /unresolved events/i }));

    await waitFor(() => {
      // Two unresolved entrance-camera rows in the fixtures: an unreadable
      // plate and a discarded duplicate-plate read (neither gets a linked
      // ticket, so both surface here, same as the real backend).
      expect(screen.getAllByText(/entrance camera/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/exit camera/i)).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: /create ticket/i })).toHaveLength(3);
  });
});
