import { expect, test } from './fixtures';
import { testAdminToken } from './admin';

test('settings saves Wi-Fi credentials and explains Ethernet priority and reconnection', async ({ page }) => {
  let posted: unknown;
  let busy = false;
  await page.route('**/api/v1/admin/network', async (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON();
      busy = true;
    }
    await route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      json: {
        mode: 'ethernet',
        busy,
        ssid: busy ? 'Club Wi-Fi' : null,
        address: null,
        message: busy ? 'Wi-Fi settings saved.' : '',
      },
    });
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Network', exact: true }).click();
  const network = page.getByRole('region', { name: 'Network', exact: true });
  await expect(network.getByText('Ethernet cable connected. Wi-Fi is disabled.', { exact: true })).toBeVisible();
  await network.getByLabel('Wi-Fi network name (SSID)', { exact: true }).fill('Club Wi-Fi');
  await network.getByLabel('Wi-Fi password', { exact: false }).fill('club-password');
  await network.getByRole('button', { name: 'Save Wi-Fi settings', exact: true }).click();
  await expect(network.getByText(/Wi-Fi settings accepted/)).toBeVisible();
  expect(posted).toEqual({ ssid: 'Club Wi-Fi', password: 'club-password' });
  await expect(network.getByLabel('Wi-Fi password', { exact: false })).toHaveValue('');
  await expect(network.getByRole('button', { name: 'Save Wi-Fi settings', exact: true })).toBeDisabled();
  busy = false;
  await expect(network.getByRole('button', { name: 'Save Wi-Fi settings', exact: true })).toBeEnabled();
});

test('settings reports invalid Wi-Fi credentials and permits correction', async ({ page }) => {
  await page.route('**/api/v1/admin/network', async (route) => {
    await route.fulfill(
      route.request().method() === 'POST'
        ? {
            status: 400,
            json: {
              message:
                'Use an 8–63 character Wi-Fi password, 64 hexadecimal digits, or leave it empty for an open network.',
            },
          }
        : { json: { mode: 'hotspot', busy: false, ssid: null, address: '10.42.0.1', message: '' } },
    );
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Network', exact: true }).click();
  const network = page.getByRole('region', { name: 'Network', exact: true });
  await expect(network.getByText('ArrowCast hotspot active: http://10.42.0.1', { exact: true })).toBeVisible();
  await network.getByLabel('Wi-Fi network name (SSID)', { exact: true }).fill('Club Wi-Fi');
  await network.getByLabel('Wi-Fi password', { exact: false }).fill('short');
  await network.getByRole('button', { name: 'Save Wi-Fi settings', exact: true }).click();
  await expect(network.getByRole('alert')).toContainText('8–63 character');
  await expect(network.getByRole('button', { name: 'Save Wi-Fi settings', exact: true })).toBeEnabled();
});
