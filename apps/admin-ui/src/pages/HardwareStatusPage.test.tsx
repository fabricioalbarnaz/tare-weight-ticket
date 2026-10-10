import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('HardwareStatusPage', () => {
  it('shows reachability for every hardware component', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /hardware status/i }));

    await waitFor(() => {
      expect(screen.getByText(/digi-tron isis new/i)).toBeInTheDocument();
      expect(screen.getByText('Unreachable')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Reachable').length).toBeGreaterThan(0);
  });
});
