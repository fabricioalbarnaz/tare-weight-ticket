import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
