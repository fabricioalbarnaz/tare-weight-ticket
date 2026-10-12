import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import { MOCK_CREDENTIALS } from './api/mocks/fixtures';

export async function loginAsAdmin(user: UserEvent = userEvent.setup()): Promise<UserEvent> {
  await user.type(await screen.findByLabelText(/username/i), MOCK_CREDENTIALS.username);
  await user.type(screen.getByLabelText(/password/i), MOCK_CREDENTIALS.password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => {
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  return user;
}
