import { expect, test } from './fixtures';
import { testAdminToken } from './admin';

test('participant import is disabled without internet and becomes available after reconnection', async ({ page }) => {
  let online = false;
  let posts = 0;
  await page.route('**/api/v1/admin/participants/import', async (route) => {
    if (route.request().method() === 'POST') posts++;
    await route.fulfill({
      json: {
        status: 'idle',
        progress: null,
        result: null,
        error: null,
        available: online,
        message: online ? null : 'Arrowcast must be connected to the internet to import participants.',
      },
    });
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Import participants', exact: true }).click();
  const section = page.getByRole('region', { name: 'Import participants', exact: true });
  const button = section.getByRole('button', { name: 'Import participants from Handboogsport', exact: true });
  await expect(button).toBeDisabled();
  await expect(section.getByRole('status')).toContainText('internet');
  await expect(section.getByRole('alert')).toHaveCount(0);
  online = true;
  await expect(button).toBeEnabled();
  await expect(section.getByText(/must be connected to the internet/)).toHaveCount(0);
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
      posts++;
      started = true;
      await route.fulfill({ status: 202, json: { status: 'running' } });
      return;
    }
    await route.fulfill({
      json: {
        status: completed ? 'completed' : started ? 'running' : 'idle',
        progress: started ? 'Finding the latest competition.' : null,
        result: completed ? { season: '2026-2027', participants: 2590, clubs: 208 } : null,
        error: null,
      },
    });
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ranges', exact: true })).toHaveCount(0);
  const importToggle = page.getByRole('button', { name: 'Expand: Import participants', exact: true });
  await expect(importToggle).toHaveAttribute('aria-expanded', 'false');
  await importToggle.click();
  const rangesToggle = page.getByRole('button', { name: 'Expand: Ranges', exact: true });
  await expect(rangesToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Expand: Target types', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeHidden();
  await rangesToggle.click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse: Ranges', exact: true }).click();
  const button = page.getByRole('button', { name: 'Import participants from Handboogsport', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  await expect(
    page.getByRole('region', { name: 'Import participants', exact: true }).getByRole('status'),
  ).toContainText('Finding the latest competition.');
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Import participants', exact: true }).click();
  await expect(button).toBeDisabled();
  completed = true;
  await expect(
    page.getByRole('region', { name: 'Import participants', exact: true }).getByRole('status'),
  ).toContainText('2590 participants and 208 clubs saved');
  await expect(button).toBeEnabled();
  expect(posts).toBe(1);
});

test('settings shows failed imports and lets the administrator retry', async ({ page }) => {
  await page.route('**/api/v1/admin/participants/import', (route) =>
    route.fulfill({
      json: {
        status: 'failed',
        progress: null,
        result: null,
        error: 'Import failed. No data was saved. Please try again.',
      },
    }),
  );
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Import participants', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Import failed');
  await expect(page.getByRole('button', { name: 'Import participants from Handboogsport', exact: true })).toBeEnabled();
});
