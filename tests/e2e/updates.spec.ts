import { expect, test } from '@playwright/test';
import { testAdminToken } from './admin';

test('settings checks updates and installs only after confirmation', async ({ page }) => {
  let available = false;
  let installing = false;
  let posts = 0;
  await page.route('**/api/v1/admin/updates', async (route) => {
    if (route.request().method() === 'POST') { posts++; installing = true; }
    await route.fulfill({ status: route.request().method() === 'POST' ? 202 : 200, json: {
      status: installing ? 'installing' : available ? 'available' : 'idle',
      currentVersion: 'v1.0.0', availableVersion: available ? 'v1.1.0' : null,
      message: installing ? 'Downloading and verifying update…' : '',
    } });
  });
  await page.addInitScript((token) => {
    sessionStorage.setItem('arrowcast.admin.jwt', token);
  }, testAdminToken());
  await page.goto('/admin/settings');
  await expect(page.getByText('No updates available', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  available = true;
  await expect(page.getByText('Update available (v1.1.0)', { exact: false })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  expect(posts).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByText('Downloading and verifying update…')).toBeVisible();
  expect(posts).toBe(1);
});
