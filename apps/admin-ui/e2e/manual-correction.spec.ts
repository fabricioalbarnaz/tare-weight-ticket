import { expect, test } from '@playwright/test';

/**
 * Smoke tests for the critical manual-fix flow (master plan §8): edit a
 * weight, see it land in the audit trail, then reprint. Runs against the
 * MSW mock fixtures (same as `npm run dev`'s default), not a real
 * backend — see `src/api/mocks/fixtures.ts` for the seeded tickets.
 */

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill('admin');
  await page.getByLabel('Senha').fill('admin123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Tickets de hoje' })).toBeVisible();
}

test('rejects invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill('admin');
  await page.getByLabel('Senha').fill('wrong-password');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByText('Usuário ou senha inválidos.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('edits the exit weight and reprints a closed ticket', async ({ page }) => {
  await login(page);

  // Seeded by src/api/mocks/fixtures.ts: a CLOSED, already-printed ticket.
  await page.getByPlaceholder('Buscar por placa…').fill('XYZ9876');
  await page.getByRole('row', { name: /XYZ9876/ }).getByRole('link').click();

  await expect(page.getByRole('heading', { name: /XYZ9876/ })).toBeVisible();

  const exitForm = page.getByRole('form', { name: 'Editar peso de saída' });
  await exitForm.getByLabel('Peso (kg)').fill('28900');
  await exitForm
    .getByLabel('Motivo desta correção')
    .fill('Corrigido apos conferencia manual do peso impresso no recibo.');
  await exitForm.getByRole('button', { name: 'Salvar correção' }).click();

  await expect(exitForm.getByText('Salvo. Veja a trilha de auditoria abaixo.')).toBeVisible();

  const auditLog = page.getByTestId('audit-log');
  await expect(auditLog).toContainText('Editado manualmente');

  await page.getByRole('button', { name: 'Reimprimir ticket' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();

  await expect(auditLog).toContainText('Reimpresso');
});
