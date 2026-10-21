import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('administrator can configure public HTTPS and see certificate status', async ({ page }) => {
  let state = {
    available: true,
    enabled: false,
    busy: false,
    active: false,
    domain: '',
    email: '',
    expiresAt: null as string | null,
    lastCheckedAt: null as string | null,
    message: '',
    origin: null as string | null,
  };
  await page.route('**/api/v1/admin/public-access', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ enabled: expect.any(Boolean), domain: 'scores.club.nl', email: 'admin@club.nl' });
      state = {
        ...state,
        ...body,
        active: body.enabled,
        expiresAt: 'Jan 1 00:00:00 2027 GMT',
        lastCheckedAt: '2026-10-21T12:00:00+00:00',
        origin: body.enabled ? 'https://scores.club.nl' : null,
      };
      await route.fulfill({ status: 202, json: { message: 'Applying' } });
    } else {
      await route.fulfill({ json: state });
    }
  });
  await page.goto('/');
  await page.evaluate((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Score entry access', exact: true }).click();
  const hostname = page.getByLabel('Scoring website address', { exact: true });
  const access = page.getByRole('combobox', { name: 'Access', exact: true });
  await expect(access).toHaveValue('internal');
  await expect(hostname).toBeVisible();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveCount(0);
  await access.selectOption('public');
  await expect(hostname).toHaveCount(0);
  await page.getByLabel('Public hostname', { exact: true }).fill('scores.club.nl');
  await page.getByLabel('Contact email', { exact: true }).fill('admin@club.nl');
  await page.getByRole('button', { name: 'Activate HTTPS', exact: true }).click();
  await expect(page.getByText('Public scoring is active. QR codes use this HTTPS address.')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('https://scores.club.nl', { exact: true })).toBeVisible();
  await expect(page.getByText(/Certificate expires: Jan 1/)).toBeVisible();
  await expect(hostname).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Score entry access', exact: true }).click();
  await expect(access).toHaveValue('public');
  await access.selectOption('internal');
  await expect(hostname).toBeVisible();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Contact email', { exact: true })).toHaveCount(0);
  await expect(hostname).toBeDisabled();
  await page.getByRole('button', { name: 'Use internal-only access', exact: true }).click();
  await expect(hostname).toBeEnabled({ timeout: 10000 });
  await hostname.fill('http://arrowcast.local');
  await page.getByRole('button', { name: 'Save hostname', exact: true }).click();
  await expect(page.getByText('Arrowcast hostname saved.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('arrowcast.hostname'))).toBe('http://arrowcast.local');
});

test('failed certificate setup preserves inputs and shows a styled actionable warning', async ({ page }) => {
  const state = {
    available: true,
    enabled: false,
    busy: false,
    active: false,
    domain: '',
    email: '',
    attempt: { domain: 'scores.club.nl', email: 'admin@club.nl' },
    expiresAt: null,
    lastCheckedAt: '2026-10-21T12:00:00Z',
    origin: null,
    errorCode: 'challenge_response',
    message: '217.104.2.19: Error reading HTTP response body: reader size limit exceeded',
  };
  await page.route('**/api/v1/admin/public-access', (route) => route.fulfill({ json: state }));
  await page.goto('/');
  await page.evaluate((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Score entry access', exact: true }).click();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveValue('scores.club.nl');
  await expect(page.getByLabel('Contact email', { exact: true })).toHaveValue('admin@club.nl');
  const warning = page.getByRole('alert').filter({ hasText: 'valid challenge file' });
  await expect(warning).toHaveClass('settings-warning');
  await expect(warning).toHaveCSS('background-color', 'rgb(255, 251, 235)');
  await expect(warning).toContainText('external TCP port 80 reaches its public HTTP listener on port 80 or 8080');
  await warning.getByText('Technical details', { exact: true }).click();
  await expect(warning.locator('pre')).toHaveText(state.message);
});

test('internal scoring remains available when public scoring is unsupported', async ({ page }) => {
  await page.route('**/api/v1/admin/public-access', (route) =>
    route.fulfill({ json: { available: false, origin: null } }),
  );
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Score entry access', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Access', exact: true })).toHaveValue('internal');
  await expect(page.getByRole('option', { name: 'Public score entry', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Scoring website address', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Available on Pi images with public scoring support.', { exact: true })).toBeVisible();
});
