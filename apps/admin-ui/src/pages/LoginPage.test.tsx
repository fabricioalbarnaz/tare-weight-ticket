import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MOCK_CREDENTIALS } from '../api/mocks/fixtures';
import { renderApp } from '../test-utils';

describe('LoginPage', () => {
  it('rejects invalid credentials', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/login' });

    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument();
  });

  it('signs in and reaches the dashboard', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/login' });

    await user.type(screen.getByLabelText(/username/i), MOCK_CREDENTIALS.username);
    await user.type(screen.getByLabelText(/password/i), MOCK_CREDENTIALS.password);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /today's tickets/i })).toBeInTheDocument();
    });
  });
});
