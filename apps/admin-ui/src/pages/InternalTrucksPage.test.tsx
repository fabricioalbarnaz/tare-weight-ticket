import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('InternalTrucksPage', () => {
  it('lists registered internal trucks with their active conjunto tare', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /internal trucks/i }));

    await waitFor(() => {
      expect(screen.getByText('IZS7I76')).toBeInTheDocument();
      expect(screen.getByText(/vanderleia — 20120 kg/i)).toBeInTheDocument();
    });
  });

  it('shows the same shared conjunto with a different tare for a different truck', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /internal trucks/i }));

    await waitFor(() => {
      expect(screen.getByText('TQT1I39')).toBeInTheDocument();
      expect(screen.getByText(/vanderleia — 20340 kg/i)).toBeInTheDocument();
    });
  });

  it('registers a new internal truck and navigates to its detail page', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await user.click(await screen.findByRole('link', { name: /internal trucks/i }));
    await user.click(await screen.findByRole('button', { name: /new truck/i }));

    await user.type(screen.getByLabelText(/^plate$/i), 'NEW9999');
    await user.click(screen.getByRole('button', { name: /register truck/i }));

    await waitFor(() => {
      expect(screen.getByText(/truck new9999/i)).toBeInTheDocument();
    });
  });
});
