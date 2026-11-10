import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../api/mocks/server';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

async function openTruckDetail(user: Awaited<ReturnType<typeof loginAsAdmin>>, plate: string) {
  await user.click(await screen.findByRole('link', { name: /internal trucks/i }));
  const row = (await screen.findByText(plate)).closest('tr')!;
  await user.click(within(row).getByRole('link', { name: /manage/i }));
}

describe('TruckDetailPage', () => {
  it('shows the conjuntos for a truck and lets the admin activate a different one', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'IZS7I76');

    await screen.findByRole('heading', { name: /truck izs7i76/i });
    const list = screen.getByTestId('truck-conjunto-list');
    expect(within(list).getByText('Vanderleia')).toBeInTheDocument();
    expect(within(list).getByText('Bitrem Bicaçamba')).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: /activate/i }));

    await waitFor(() => {
      const items = within(list).getAllByRole('listitem');
      const bicacamba = items.find((item) => item.textContent?.includes('Bitrem Bicaçamba'));
      expect(bicacamba).toHaveTextContent(/active/i);
    });
  });

  it('shows an error message when activating a conjunto fails', async () => {
    server.use(
      http.post('/api/admin/truck-conjuntos/:id/activate', () =>
        HttpResponse.text('Internal Server Error', { status: 500 }),
      ),
    );

    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'IZS7I76');
    await screen.findByRole('heading', { name: /truck izs7i76/i });
    const list = screen.getByTestId('truck-conjunto-list');

    await user.click(within(list).getByRole('button', { name: /activate/i }));

    await screen.findByText(/couldn't activate this conjunto/i);
  });

  it('shows the same shared conjunto with a different tare on another truck', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'TQT1I39');

    await screen.findByRole('heading', { name: /truck tqt1i39/i });
    const list = screen.getByTestId('truck-conjunto-list');
    expect(within(list).getByText('Vanderleia')).toBeInTheDocument();
    expect(within(list).getByText(/20340 kg/)).toBeInTheDocument();
  });

  it('assigns a new (inline-created) conjunto to the truck', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'IZS7I76');
    await screen.findByRole('heading', { name: /truck izs7i76/i });

    await user.selectOptions(screen.getByLabelText(/^conjunto$/i), '+ New conjunto…');
    await user.type(screen.getByLabelText(/new conjunto name/i), 'LS');
    await user.type(screen.getByLabelText(/tare weight/i), '18160');
    await user.click(screen.getByRole('button', { name: /assign conjunto/i }));

    await waitFor(() => {
      expect(within(screen.getByTestId('truck-conjunto-list')).getByText('LS')).toBeInTheDocument();
    });
  });

  it('edits the truck plate with a reason and records it in the audit trail', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'IZS7I76');
    await screen.findByRole('heading', { name: /truck izs7i76/i });

    const form = screen.getByRole('form', { name: /edit truck plate/i });
    const plateInput = within(form).getByLabelText(/^plate$/i);
    await user.clear(plateInput);
    await user.type(plateInput, 'ABC1D23');
    await user.type(within(form).getByLabelText(/reason/i), 'Plate was mistyped at registration');
    await user.click(within(form).getByRole('button', { name: /save plate/i }));

    await screen.findByRole('heading', { name: /truck abc1d23/i });
    expect(within(screen.getByTestId('truck-audit-log')).getByText(/plate edited/i)).toBeInTheDocument();
  });

  it('requires a reason before saving a plate edit', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'IZS7I76');
    await screen.findByRole('heading', { name: /truck izs7i76/i });

    const form = screen.getByRole('form', { name: /edit truck plate/i });
    await user.click(within(form).getByRole('button', { name: /save plate/i }));

    await within(form).findByText(/explain the change/i);
  });

  it('shows a clear error when the new plate already belongs to another truck', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'IZS7I76');
    await screen.findByRole('heading', { name: /truck izs7i76/i });

    const form = screen.getByRole('form', { name: /edit truck plate/i });
    const plateInput = within(form).getByLabelText(/^plate$/i);
    await user.clear(plateInput);
    await user.type(plateInput, 'TQT1I39');
    await user.type(within(form).getByLabelText(/reason/i), 'Testing a duplicate plate');
    await user.click(within(form).getByRole('button', { name: /save plate/i }));

    await within(form).findByText(/another internal truck already uses this plate/i);
  });

  it('offers an already-shared conjunto in the dropdown when assigning to another truck', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await openTruckDetail(user, 'TQT1I39');
    await screen.findByRole('heading', { name: /truck tqt1i39/i });

    await waitFor(() => {
      const select = screen.getByLabelText(/^conjunto$/i) as HTMLSelectElement;
      const optionLabels = Array.from(select.options).map((o) => o.textContent);
      expect(optionLabels).toContain('Bitrem Bicaçamba');
    });
  });
});
