import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('DashboardPage', () => {
  it("lists today's tickets and filters by status", async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await waitFor(() => {
      expect(screen.getByText('ABC1234')).toBeInTheDocument();
      expect(screen.getByText('XYZ9876')).toBeInTheDocument();
      expect(screen.getByText('QWE4455')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Anomaly' }));

    await waitFor(() => {
      expect(screen.getByText('QWE4455')).toBeInTheDocument();
      expect(screen.queryByText('ABC1234')).not.toBeInTheDocument();
    });
  });
});
