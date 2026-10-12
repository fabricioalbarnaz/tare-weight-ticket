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
      expect(screen.getByText(/entrance camera/i)).toBeInTheDocument();
      expect(screen.getByText(/exit camera/i)).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: /create ticket/i })).toHaveLength(2);
  });
});
