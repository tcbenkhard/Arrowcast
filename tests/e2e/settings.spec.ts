import { expect, test } from '@playwright/test';

test('settings starts an import, disables duplicate clicks and shows the result', async ({ page }) => {
  let started = false;
  let completed = false;
  let posts = 0;
  await page.route('**/api/v1/admin/participants/import', async (route) => {
    if (route.request().method() === 'POST') {
      posts++; started = true;
      await route.fulfill({ status: 202, json: { status: 'running' } });
      return;
    }
    await route.fulfill({ json: {
      status: completed ? 'completed' : started ? 'running' : 'idle',
      progress: started ? 'Regio 101 verwerkt' : null,
      result: completed ? { season: '2026-2027', participants: 2590, clubs: 208 } : null,
      error: null,
    } });
  });
  await page.goto('/admin/settings');
  await page.getByLabel('Gebruikersnaam').fill('admin');
  await page.getByLabel('Wachtwoord').fill('admin');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ranges', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Collapse Deelnemers importeren', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const rangesToggle = page.getByRole('button', { name: 'Expand Ranges', exact: true });
  await expect(rangesToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Expand Target types', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeHidden();
  await rangesToggle.click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Ranges', exact: true }).click();
  const button = page.getByRole('button', { name: 'Importeer deelnemers uit handboogsport', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Deelnemers importeren', exact: true }).getByRole('status')).toContainText('Regio 101 verwerkt');
  await page.reload();
  await expect(button).toBeDisabled();
  completed = true;
  await expect(page.getByRole('region', { name: 'Deelnemers importeren', exact: true }).getByRole('status')).toContainText('2590 deelnemers en 208 verenigingen opgeslagen');
  await expect(button).toBeEnabled();
  expect(posts).toBe(1);
});

test('settings shows failed imports and lets the administrator retry', async ({ page }) => {
  await page.route('**/api/v1/admin/participants/import', (route) => route.fulfill({ json: {
    status: 'failed', progress: null, result: null, error: 'Importeren is mislukt. Er zijn geen gegevens opgeslagen.',
  } }));
  await page.goto('/admin/settings');
  await page.getByLabel('Gebruikersnaam').fill('admin');
  await page.getByLabel('Wachtwoord').fill('admin');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Importeren is mislukt');
  await expect(page.getByRole('button', { name: 'Importeer deelnemers uit handboogsport', exact: true })).toBeEnabled();
});
