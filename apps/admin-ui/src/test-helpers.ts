import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import { MOCK_CREDENTIALS } from './api/mocks/fixtures';

export async function loginAs(
  credentials: { username: string; password: string },
  user: UserEvent = userEvent.setup(),
): Promise<UserEvent> {
  await user.type(await screen.findByLabelText(/username/i), credentials.username);
  await user.type(screen.getByLabelText(/password/i), credentials.password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => {
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  return user;
}

export async function loginAsAdmin(user: UserEvent = userEvent.setup()): Promise<UserEvent> {
  return loginAs(MOCK_CREDENTIALS, user);
}
