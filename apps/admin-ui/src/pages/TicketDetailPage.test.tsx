import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin, loginAsOperator } from '../test-helpers';

describe('TicketDetailPage', () => {
  it('deep-links through login straight to the requested ticket', async () => {
    renderApp({ route: '/tickets/2' });
    await loginAsAdmin();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ticket #1002/i })).toBeInTheDocument();
    });
  });

  // 2026-11-14: an operator can now reach this page too — see
  // docs/plans/2026-11-14-operator-ticket-edit-plan.md.
  it('lets an operator reach the page directly (instead of redirecting to /operation) and edit a leg', async () => {
    renderApp({ route: '/tickets/2' });
    const user = await loginAsOperator();

    await screen.findByRole('heading', { name: /ticket #1002/i });

    const exitForm = screen.getByRole('form', { name: /edit exit weight/i });
    await user.clear(within(exitForm).getByLabelText(/weight \(kg\)/i));
    await user.type(within(exitForm).getByLabelText(/weight \(kg\)/i), '29000');
    await user.type(within(exitForm).getByLabelText(/reason/i), 'Operator re-weighed after scale drift');
    await user.click(within(exitForm).getByRole('button', { name: /save correction/i }));

    await waitFor(() => {
      const auditLog = screen.getByTestId('audit-log');
      expect(within(auditLog).getByText(/manually edited/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /back to operation/i })).toHaveAttribute('href', '/operation');
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

  // See docs/plans/2026-11-12-exit-reweigh-plan.md and master plan §5/§11.
  // Fixture ids 7/8 (ticketNumber #1007/#1008) are the re-weigh pair.
  it('shows a link to the re-weigh ticket on the original, and back on the re-weigh', async () => {
    renderApp({ route: '/tickets/7' });
    const user = await loginAsAdmin();

    await screen.findByRole('heading', { name: /ticket #1007/i });
    await waitFor(() => {
      expect(screen.getByText(/superseded by re-weigh ticket #1008/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('link', { name: /view/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ticket #1008/i })).toBeInTheDocument();
      expect(screen.getByText(/re-weigh of ticket #1007/i)).toBeInTheDocument();
    });
  });

  // See docs/plans/2026-11-18-plate-misread-deduction-plan.md and master
  // plan §5/§11. Fixture id 9 (ticketNumber #1009) is the deduction-closed
  // ticket.
  it('shows a plate-misread deduction banner naming the misread plate', async () => {
    renderApp({ route: '/tickets/9' });
    await loginAsAdmin();

    await screen.findByRole('heading', { name: /ticket #1009/i });
    // Matched against the banner's own text, not getByText("RK76F83") on the
    // whole page — the audit log below also dumps the raw payload JSON
    // containing "RK76F83", which would otherwise make that query ambiguous.
    const banner = await screen.findByText(/closed automatically by plate-misread deduction/i);
    expect(banner.textContent).toContain('RK76F83');
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
