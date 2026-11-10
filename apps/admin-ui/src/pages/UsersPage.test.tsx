import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('UsersPage', () => {
  it('lists users with their profile and status', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));

    const operatorRow = (await screen.findByText('Operador da Balança')).closest('tr')!;
    expect(within(operatorRow).getByText('operador')).toBeInTheDocument();
    expect(within(operatorRow).getByText('Operator')).toBeInTheDocument();

    const pendingRow = screen.getByText('Usuário Novo').closest('tr')!;
    expect(within(pendingRow).getByText(/must change password/i)).toBeInTheDocument();
  });

  it('creates a user, showing the password rule under the password field', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    await user.click(await screen.findByRole('button', { name: /new user/i }));

    expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^name$/i), 'Maria Souza');
    await user.type(screen.getByLabelText(/username \(login\)/i), 'maria');
    await user.type(screen.getByLabelText(/initial password/i), 'senha1');
    await user.click(screen.getByRole('button', { name: /create user/i }));

    const row = (await screen.findByText('Maria Souza')).closest('tr')!;
    expect(within(row).getByText('maria')).toBeInTheDocument();
    expect(within(row).getByText(/must change password/i)).toBeInTheDocument();
  });

  it('rejects a password shorter than 6 characters before calling the API', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    await user.click(await screen.findByRole('button', { name: /new user/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Maria Souza');
    await user.type(screen.getByLabelText(/username \(login\)/i), 'maria');
    await user.type(screen.getByLabelText(/initial password/i), '12345');
    await user.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 6 characters/i)).toHaveClass('text-red-600');
    });
    expect(screen.queryByText('Maria Souza')).not.toBeInTheDocument();
  });

  it('shows a clear message for a username that is already taken', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    await user.click(await screen.findByRole('button', { name: /new user/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Outro');
    await user.type(screen.getByLabelText(/username \(login\)/i), 'operador');
    await user.type(screen.getByLabelText(/initial password/i), 'senha1');
    await user.click(screen.getByRole('button', { name: /create user/i }));

    expect(await screen.findByText(/username is already in use/i)).toBeInTheDocument();
  });
});

describe('UserDetailPage', () => {
  it("edits another user's name and profile", async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    const row = (await screen.findByText('Operador da Balança')).closest('tr')!;
    await user.click(within(row).getByRole('link', { name: /manage/i }));

    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Operador Chefe');
    await user.selectOptions(screen.getByLabelText(/^profile$/i), 'admin');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/^saved\.$/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Operador Chefe' })).toBeInTheDocument();
    expect(screen.getByText(/operador · administrator · active/i)).toBeInTheDocument();
  });

  it('deactivates and reactivates another user', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    const row = (await screen.findByText('Operador da Balança')).closest('tr')!;
    await user.click(within(row).getByRole('link', { name: /manage/i }));

    await user.click(await screen.findByRole('button', { name: /deactivate user/i }));
    expect(await screen.findByText(/operador · operator · inactive/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reactivate user/i }));
    expect(await screen.findByText(/operador · operator · active/i)).toBeInTheDocument();
  });

  it("resets another user's password", async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    const row = (await screen.findByText('Operador da Balança')).closest('tr')!;
    await user.click(within(row).getByRole('link', { name: /manage/i }));

    await user.type(await screen.findByLabelText(/^new password$/i), 'nova123');
    await user.click(screen.getByRole('button', { name: /^reset password$/i }));

    expect(
      await screen.findByText(/password reset\. the user must change it/i),
    ).toBeInTheDocument();
  });

  it("doesn't offer deactivation, profile change or password reset on the admin's own user", async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /^users$/i }));
    // "Administrador" is also the logged-in user's name in the header — look inside the table only.
    const row = within(await screen.findByRole('table'))
      .getByText('Administrador')
      .closest('tr')!;
    await user.click(within(row).getByRole('link', { name: /manage/i }));

    expect(await screen.findByLabelText(/^profile$/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /deactivate user/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/to change your own password, use/i)).toBeInTheDocument();
  });
});
