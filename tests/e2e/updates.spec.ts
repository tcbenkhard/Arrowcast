import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('refresh starts a fresh update check and shows the discovered version', async ({ page }) => {
  let status = 'idle';
  let checks = 0;
  await page.route('**/api/v1/admin/updates', (route) =>
    route.fulfill({
      json: {
        status,
        currentVersion: 'v1.0.0',
        availableVersion: status === 'available' ? 'v1.1.0' : null,
        message: '',
      },
    }),
  );
  await page.route('**/api/v1/admin/updates/check', async (route) => {
    expect(route.request().method()).toBe('POST');
    checks++;
    status = 'checking';
    await route.fulfill({
      status: 202,
      json: { status, currentVersion: 'v1.0.0', availableVersion: null, message: '' },
    });
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  const updates = page.getByRole('region', { name: 'Updates', exact: true });
  await updates.getByRole('button', { name: 'Expand: Updates', exact: true }).click();
  const refresh = updates.getByRole('button', { name: 'Check for updates', exact: true });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(updates.getByText('Checking for updates…', { exact: true })).toBeVisible();
  expect(checks).toBe(1);
  status = 'available';
  await expect(updates.getByText('Update available (v1.1.0)', { exact: false })).toBeVisible();
  await expect(refresh).toBeEnabled();
});

test('failed updates show the reason returned by the updater', async ({ page }) => {
  await page.route('**/api/v1/admin/updates', (route) =>
    route.fulfill({
      json: {
        status: 'failed',
        currentVersion: 'v1.0.0',
        availableVersion: 'v1.1.0',
        message: 'Update failed: Close active competitions before updating.',
      },
    }),
  );
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  const updates = page.getByRole('region', { name: 'Updates', exact: true });
  await expect(updates.getByRole('alert')).toHaveText('Update failed: Close active competitions before updating.');
  await expect(updates.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
});

test('no internet shows installed version and guidance, then resumes checks after reconnecting', async ({ page }) => {
  let online = false;
  await page.route('**/api/v1/admin/updates', (route) =>
    route.fulfill({
      json: {
        status: online ? 'available' : 'offline',
        currentVersion: 'v1.0.0',
        availableVersion: online ? 'v1.1.0' : null,
        message: online ? '' : 'Arrowcast must be connected to the internet to check for updates.',
      },
    }),
  );
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  const updates = page.getByRole('region', { name: 'Updates', exact: true });
  await updates.getByRole('button', { name: 'Expand: Updates', exact: true }).click();
  await expect(updates.getByText('Installed version: v1.0.0', { exact: true })).toBeVisible();
  await expect(
    updates.getByText('No internet connection. Connect to check for updates.', { exact: true }),
  ).toBeVisible();
  await expect(updates.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await expect(updates.getByText('No updates available', { exact: true })).toHaveCount(0);
  await expect(updates.getByRole('alert')).toHaveCount(0);
  online = true;
  await expect(updates.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  await expect(updates.getByText('No internet connection. Connect to check for updates.', { exact: true })).toHaveCount(
    0,
  );
});

test('settings checks updates and installs only after confirmation', async ({ page }) => {
  let available = false;
  let installing = false;
  let posts = 0;
  await page.route('**/api/v1/admin/updates', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      installing = true;
    }
    await route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      json: {
        status: installing ? 'installing' : available ? 'available' : 'idle',
        currentVersion: 'v1.0.0',
        availableVersion: available ? 'v1.1.0' : null,
        message: installing ? 'Downloading and verifying update…' : '',
      },
    });
  });
  await page.addInitScript((token) => {
    sessionStorage.setItem('arrowcast.admin.jwt', token);
  }, testAdminToken());
  await page.goto('/admin/settings');
  const updates = page.getByRole('region', { name: 'Updates', exact: true });
  const toggle = updates.getByRole('button', { name: /^(Expand|Collapse): Updates$/ });
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
  await expect(page.getByText('Installing update…', { exact: true })).toBeVisible();
  await expect(toggle).toBeDisabled();
  expect(posts).toBe(1);
});
