import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('DDNS uses one compact form and Save registers the hostname and configures HTTPS', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let state = {
    simulation: true,
    available: true,
    enabled: false,
    busy: false,
    active: false,
    domain: '',
    email: '',
    accessMode: undefined as string | undefined,
    ddns: {} as { hostname?: string; ready?: boolean; lastCheckedAt?: string; message?: string },
    origin: null as string | null,
  };
  let saves = 0;
  await page.route('**/api/v1/admin/public-access', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.action).toBeUndefined();
      expect(body.domain).toBe('scores.club.nl');
      expect(body.email).toBe('admin@club.nl');
      if (body.enabled) {
        expect(body.accessMode).toBe('ddns');
        expect(body.ddnsToken).toBe('private-rest-token');
        saves++;
      }
      state = {
        ...state,
        enabled: body.enabled,
        active: body.enabled,
        accessMode: 'ddns',
        domain: body.domain,
        email: body.email,
        ddns: { hostname: 'arrowcast-test.dynv6.net', ready: true, message: '' },
        origin: body.enabled ? 'https://scores.club.nl' : null,
      };
      await route.fulfill({ status: 202, json: { message: 'Applying' } });
    } else {
      await route.fulfill({ json: state });
    }
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  await expect(page.getByText(/Docker simulation: use a test token/)).toBeVisible();
  const access = page.getByRole('combobox', { name: 'Access', exact: true });
  await access.selectOption('ddns');
  const form = page.locator('#public-access-content form');
  await expect(form).toHaveCount(1);
  await expect(form.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Register or check/ })).toHaveCount(0);
  const tokenInput = page.getByLabel('dynv6 REST API token', { exact: true });
  await tokenInput.fill('private-rest-token');
  await page.getByLabel('Public hostname', { exact: true }).fill('scores.club.nl');
  await page.getByLabel('Contact email', { exact: true }).fill('admin@club.nl');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Public scoring is active.', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('scores.club.nl CNAME arrowcast-test.dynv6.net')).toBeVisible();
  await expect(form).toHaveCount(0);
  const summary = page.getByRole('button', { name: /Current settings/ });
  await expect(summary).toContainText('admin@club.nl');
  await expect(summary).not.toContainText('private-rest-token');
  await page.getByRole('button', { name: 'Copy dynv6 hostname', exact: true }).click();
  await expect(page.getByText('dynv6 hostname copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('arrowcast-test.dynv6.net');
  await expect(form).toHaveCount(0);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('Clipboard unavailable');
    };
  });
  await page.getByRole('button', { name: 'Copy dynv6 hostname', exact: true }).click();
  await expect(
    page.getByText('Could not copy. Select and copy the dynv6 hostname manually.', { exact: true }),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
  await summary.click();
  await expect(tokenInput).toHaveValue('');
  const status = await page.getByText('Public scoring is active.', { exact: true }).boundingBox();
  const selector = await access.boundingBox();
  expect(status!.y + status!.height).toBeLessThan(selector!.y);
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  await expect(form).toHaveCount(0);
  await summary.click();
  await expect(access).toHaveValue('ddns');
  await expect(tokenInput).toHaveValue('');
  await access.selectOption('internal');
  await page.getByRole('button', { name: 'Use internal-only access', exact: true }).click();
  await expect(page.getByLabel('Scoring website address', { exact: true })).toBeEnabled({ timeout: 10000 });
  expect(saves).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  await expect(access).toHaveValue('internal');
});

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
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  const hostname = page.getByLabel('Scoring website address', { exact: true });
  const access = page.getByRole('combobox', { name: 'Access', exact: true });
  await expect(access).toHaveValue('internal');
  await expect(hostname).toBeVisible();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveCount(0);
  await access.selectOption('public');
  await expect(hostname).toHaveCount(0);
  await page.getByLabel('Public hostname', { exact: true }).fill('scores.club.nl');
  await page.getByLabel('Contact email', { exact: true }).fill('admin@club.nl');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Public scoring is active.')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('https://scores.club.nl', { exact: true })).toBeVisible();
  await expect(hostname).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  await expect(page.getByRole('button', { name: /Current settings/ })).toContainText('https://scores.club.nl');
  await page.getByRole('button', { name: /Current settings/ }).click();
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
    attempt: { domain: 'scores.club.nl', email: 'admin@club.nl', accessMode: 'ddns' },
    ddns: { ready: true, hostname: 'arrowcast-pending.dynv6.net' },
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
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveValue('scores.club.nl');
  await expect(page.getByLabel('Contact email', { exact: true })).toHaveValue('admin@club.nl');
  await expect(page.getByRole('button', { name: /Current settings/ })).toHaveCount(0);
  await expect(page.getByText('scores.club.nl CNAME arrowcast-pending.dynv6.net')).toBeVisible();
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
  await page.getByRole('button', { name: 'Expand: Access settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Access', exact: true })).toHaveValue('internal');
  await expect(page.getByRole('option', { name: 'External without DDNS (static IP)', exact: true })).toBeDisabled();
  await expect(page.getByRole('option', { name: 'External with DDNS (dynv6)', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Scoring website address', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Public hostname', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Available on Pi images with public scoring support.', { exact: true })).toBeVisible();
});
