import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';

describe('LanguageSwitcher', () => {
  it('switches the whole UI to Portuguese and back to English', async () => {
    renderApp({ route: '/login' });
    const user = await loginAsAdmin();

    await screen.findByRole('heading', { name: /today's tickets/i });

    const select = screen.getByRole('combobox', { name: /language/i });
    await user.selectOptions(select, 'pt-BR');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /tickets de hoje/i })).toBeInTheDocument();
    });

    await user.selectOptions(select, 'en');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /today's tickets/i })).toBeInTheDocument();
    });
  });
});
