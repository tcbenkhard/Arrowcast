import { expect, test } from '@playwright/test';
import { testAdminToken } from './admin';

test('participant import is disabled without internet and becomes available after reconnection', async ({ page }) => {
  let online = false;
  let posts = 0;
  await page.route('**/api/v1/admin/participants/import', async (route) => {
    if (route.request().method() === 'POST') posts++;
    await route.fulfill({ json: { status: 'idle', progress: null, result: null, error: null,
      available: online, message: online ? null : 'Arrowcast moet verbonden zijn met het internet om deelnemers te importeren.',
    } });
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand Deelnemers importeren', exact: true }).click();
  const section = page.getByRole('region', { name: 'Deelnemers importeren', exact: true });
  const button = section.getByRole('button', { name: 'Importeer deelnemers uit handboogsport', exact: true });
  await expect(button).toBeDisabled();
  await expect(section.getByRole('status')).toContainText('internet');
  await expect(section.getByRole('alert')).toHaveCount(0);
  online = true;
  await expect(button).toBeEnabled();
  await expect(section.getByText(/moet verbonden zijn met het internet/)).toHaveCount(0);
  online = false;
  await expect(button).toBeDisabled();
  expect(posts).toBe(0);
});

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
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ranges', exact: true })).toHaveCount(0);
  const importToggle = page.getByRole('button', { name: 'Expand Deelnemers importeren', exact: true });
  await expect(importToggle).toHaveAttribute('aria-expanded', 'false');
  await importToggle.click();
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
  await page.getByRole('button', { name: 'Expand Deelnemers importeren', exact: true }).click();
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
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand Deelnemers importeren', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Importeren is mislukt');
  await expect(page.getByRole('button', { name: 'Importeer deelnemers uit handboogsport', exact: true })).toBeEnabled();
});
