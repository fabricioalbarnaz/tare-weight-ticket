import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('HistoryPage', () => {
  it('finds a historical ticket by plate search', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /history/i }));
    await screen.findByRole('heading', { name: /ticket history/i });

    await user.type(screen.getByPlaceholderText(/search all history/i), 'LMN0011');

    await waitFor(() => {
      expect(screen.getByText('LMN0011')).toBeInTheDocument();
      expect(screen.queryByText('ABC1234')).not.toBeInTheDocument();
    });
  });
});
