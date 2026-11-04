import { screen, waitFor, within } from '@testing-library/react';
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

  it('shows a suspect-weight badge for tickets whose scale read needed a retry', async () => {
    renderApp({ route: '/login' });
    await loginAsAdmin();

    await waitFor(() => {
      expect(screen.getByText('SUS5566')).toBeInTheDocument();
    });

    const row = screen.getByText('SUS5566').closest('tr')!;
    expect(within(row).getByTitle(/double-check it wasn't crossed with another truck/i)).toBeInTheDocument();

    const normalRow = screen.getByText('ABC1234').closest('tr')!;
    expect(within(normalRow).queryByTitle(/double-check it wasn't crossed with another truck/i)).not.toBeInTheDocument();
  });
});
