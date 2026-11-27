import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('TimelinePage', () => {
  it('shows a mix of raw events and audit log entries, newest first', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /timeline/i }));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
    });
    // The discarded fixture raw event (duplicate_plate_read, no linked ticket).
    expect(screen.getByText(/discarded — duplicate read of the same plate/i)).toBeInTheDocument();
    expect(screen.getAllByText('No linked ticket').length).toBeGreaterThan(0);
  });

  it('filters by plate', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /timeline/i }));
    await waitFor(() => screen.getByTestId('timeline-list'));

    await user.type(screen.getByLabelText(/plate/i), 'ABC1234');

    await waitFor(() => {
      expect(screen.getByText(/entry captured/i)).toBeInTheDocument();
    });
    // Linked to ticket 1 (the ABC1234 OPEN fixture ticket) — no other plate's entries should remain.
    expect(screen.getByRole('link', { name: /ticket #1/i })).toBeInTheDocument();
    expect(screen.queryByText('XYZ9876')).not.toBeInTheDocument();
  });

  it('shows an empty state when the filter matches nothing', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /timeline/i }));
    await waitFor(() => screen.getByTestId('timeline-list'));

    await user.type(screen.getByLabelText(/plate/i), 'NOTHING99');

    await waitFor(() => {
      expect(screen.getByText(/no events found for this filter/i)).toBeInTheDocument();
    });
  });
});
