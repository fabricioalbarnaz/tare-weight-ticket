import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('TicketDetailPage', () => {
  it('deep-links through login straight to the requested ticket', async () => {
    renderApp({ route: '/tickets/2' });
    await loginAsAdmin();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ticket #1002/i })).toBeInTheDocument();
    });
  });

  it('editing the exit weight with a reason records an audit log entry', async () => {
    renderApp({ route: '/tickets/2' });
    const user = await loginAsAdmin();

    await screen.findByRole('heading', { name: /ticket #1002/i });

    const exitForm = screen.getByRole('form', { name: /edit exit weight/i });
    const weightInput = within(exitForm).getByLabelText(/weight \(kg\)/i);
    await user.clear(weightInput);
    await user.type(weightInput, '29000');
    await user.type(within(exitForm).getByLabelText(/reason/i), 'Re-weighed after scale drift');
    await user.click(within(exitForm).getByRole('button', { name: /save correction/i }));

    await waitFor(() => {
      const auditLog = screen.getByTestId('audit-log');
      expect(within(auditLog).getByText(/manually edited/i)).toBeInTheDocument();
      expect(within(auditLog).getByText(/re-weighed after scale drift/i)).toBeInTheDocument();
    });
  });

  it('reprints a closed ticket after confirmation', async () => {
    renderApp({ route: '/tickets/2' });
    const user = await loginAsAdmin();

    await screen.findByRole('heading', { name: /ticket #1002/i });

    await user.click(screen.getByRole('button', { name: /reprint ticket/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      const auditLog = screen.getByTestId('audit-log');
      expect(within(auditLog).getByText(/reprinted/i)).toBeInTheDocument();
    });
  });
});
