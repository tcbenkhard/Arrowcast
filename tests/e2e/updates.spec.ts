import { expect, test } from '@playwright/test';
import { testAdminToken } from './admin';

test('no internet shows installed version and guidance, then resumes checks after reconnecting', async ({ page }) => {
  let online = false;
  await page.route('**/api/v1/admin/updates', (route) => route.fulfill({ json: {
    status: online ? 'available' : 'offline', currentVersion: 'v1.0.0',
    availableVersion: online ? 'v1.1.0' : null,
    message: online ? '' : 'Arrowcast must be connected to the internet to check for updates.',
  } }));
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  const updates = page.getByRole('region', { name: 'Updates', exact: true });
  await updates.getByRole('button', { name: 'Expand Updates', exact: true }).click();
  await expect(updates.getByText('Installed version: v1.0.0', { exact: true })).toBeVisible();
  await expect(updates.getByText(/must be connected to the internet/)).toBeVisible();
  await expect(updates.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await expect(updates.getByText('No updates available', { exact: true })).toHaveCount(0);
  await expect(updates.getByRole('alert')).toHaveCount(0);
  online = true;
  await expect(updates.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  await expect(updates.getByText(/must be connected to the internet/)).toHaveCount(0);
});

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
  const updates = page.getByRole('region', { name: 'Updates', exact: true });
  const toggle = updates.getByRole('button', { name: /^(Expand|Collapse) Updates$/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('No updates available', { exact: true })).toBeHidden();
  await toggle.click();
  await expect(page.getByText('No updates available', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  available = true;
  await expect(page.getByText('Update available (v1.1.0)', { exact: false })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeDisabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  expect(posts).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByText('Downloading and verifying update…')).toBeVisible();
  await expect(toggle).toBeDisabled();
  expect(posts).toBe(1);
});
