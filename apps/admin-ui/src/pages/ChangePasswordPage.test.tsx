import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_OPERATOR_CREDENTIALS, MOCK_PENDING_CREDENTIALS } from '../api/mocks/fixtures';
import { renderApp } from '../test-utils';
import { loginAs, loginAsAdmin } from '../test-helpers';

/** Operators land on the Operação screen, which opens an SSE stream jsdom doesn't implement. */
class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource as typeof EventSource;
});

describe('operator profile', () => {
  it('lands on the Operation screen and only sees that link', async () => {
    renderApp({ route: '/login' });
    await loginAs(MOCK_OPERATOR_CREDENTIALS);

    expect(await screen.findByRole('link', { name: /^operation$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^dashboard$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^users$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /internal trucks/i })).not.toBeInTheDocument();
    expect(screen.getByText('Operador da Balança')).toBeInTheDocument();
  });

  it('is redirected to the Operation screen when opening an admin-only URL', async () => {
    renderApp({ route: '/users' });
    await loginAs(MOCK_OPERATOR_CREDENTIALS);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /^users$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^operation$/i })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  });
});

describe('ChangePasswordPage', () => {
  it('forces a user with an admin-set password to change it before anything else', async () => {
    renderApp({ route: '/login' });
    const user = await loginAs(MOCK_PENDING_CREDENTIALS);

    expect(
      await screen.findByText(/your password was set by an administrator/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^operation$/i })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/current password/i), MOCK_PENDING_CREDENTIALS.password);
    await user.type(screen.getByLabelText(/^new password$/i), 'minha-senha');
    await user.type(screen.getByLabelText(/confirm new password/i), 'minha-senha');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    // An operator, so the app lands on the Operation screen afterwards.
    expect(await screen.findByRole('link', { name: /^operation$/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/your password was set by an administrator/i),
    ).not.toBeInTheDocument();
  });

  it('rejects a confirmation that does not match', async () => {
    renderApp({ route: '/login' });
    const user = await loginAs(MOCK_PENDING_CREDENTIALS);

    await user.type(
      await screen.findByLabelText(/current password/i),
      MOCK_PENDING_CREDENTIALS.password,
    );
    await user.type(screen.getByLabelText(/^new password$/i), 'minha-senha');
    await user.type(screen.getByLabelText(/confirm new password/i), 'outra-senha');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText(/the two new passwords do not match/i)).toBeInTheDocument();
  });

  it('lets any user change their own password from the header, reporting a wrong current password', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: 'Administrador' }));

    expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument();
    await user.type(await screen.findByLabelText(/current password/i), 'not-the-password');
    await user.type(screen.getByLabelText(/^new password$/i), 'nova-senha');
    await user.type(screen.getByLabelText(/confirm new password/i), 'nova-senha');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText(/the current password is incorrect/i)).toBeInTheDocument();
  });
});
