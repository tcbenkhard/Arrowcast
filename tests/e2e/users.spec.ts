import { request } from 'node:http';
import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('administrator adds and edits a user, who must change their password and cannot open settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Users', exact: true }).click();
  const users = page.getByRole('region', { name: 'Users', exact: true });
  await expect(users.getByRole('columnheader')).toHaveText(['Name', 'Username', 'Role']);
  await expect(users.getByRole('row', { name: /Administrator admin Administrator/ })).toBeVisible();
  await users.getByRole('button', { name: 'Add', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toHaveAccessibleName('Add user');
  await expect(modal.getByRole('button', { name: 'Remove user', exact: true })).toHaveCount(0);
  await modal.getByLabel('Name', { exact: true }).fill('Browser User');
  await modal.getByLabel('Username', { exact: true }).fill('browser-user');
  await modal.getByLabel('Initial password', { exact: true }).fill('initial-password');
  await modal.getByLabel('Language', { exact: true }).selectOption('en');
  await expect(modal.getByLabel('Role', { exact: true })).toHaveValue('competition_manager');
  await expect(modal.getByLabel('Role', { exact: true }).locator('option')).toHaveText([
    'Competition manager',
    'Administrator',
  ]);
  await modal.getByRole('button', { name: 'Add user', exact: true }).click();
  await expect(modal).toBeHidden();
  const row = users.getByRole('row', { name: /Browser User browser-user Competition manager/ });
  await row.getByText('browser-user', { exact: true }).click();
  await expect(modal).toHaveAccessibleName('Edit user');
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('Browser User');
  await expect(modal.getByLabel('Reset password', { exact: true })).toBeEmpty();
  await modal.getByLabel('Name', { exact: true }).fill('Edited Browser User');
  await modal.getByLabel('Username', { exact: true }).fill('edited-browser-user');
  await modal.getByRole('button', { name: 'Save user', exact: true }).click();
  await expect(modal).toBeHidden();
  await users.getByRole('button', { name: 'Edited Browser User', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(users.getByRole('button', { name: 'Edited Browser User', exact: true })).toBeFocused();

  // Use a separate loopback source for this real login so auth.spec.ts keeps its own rate-limit budget.
  const login = await new Promise<{ status: number | undefined; token: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.ARROWCAST_E2E_API_PORT ?? 3000),
        localAddress: '127.0.0.2',
        path: '/api/v1/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += String(chunk);
        });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, token: (JSON.parse(body) as { token: string }).token });
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ username: 'edited-browser-user', password: 'initial-password' }));
  });
  expect(login.status).toBe(200);
  await page.evaluate((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), login.token);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await page.getByLabel('Current password', { exact: true }).fill('initial-password');
  await page.getByLabel('New password', { exact: true }).fill('browser-user-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('browser-user-password');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.goto('/admin/settings');
  await expect(page).toHaveURL('/admin/competitions');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);

  await page.evaluate((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Users', exact: true }).click();
  await users.getByText('edited-browser-user', { exact: true }).click();
  const remove = modal.getByRole('button', { name: 'Remove user', exact: true });
  await expect(remove).toHaveClass('danger');
  await remove.click();
  await expect(modal).toBeHidden();
  await expect(users.getByRole('status')).toHaveText('User "Edited Browser User" removed.');
  await expect(users.getByText('edited-browser-user', { exact: true })).toHaveCount(0);
  const adminRow = users.getByRole('row', { name: /Administrator admin Administrator/ });
  await expect(adminRow.getByRole('button')).toHaveCount(0);
  await expect(adminRow).not.toHaveClass('user-row');
  await adminRow.getByRole('rowheader').click();
  await expect(modal).toBeHidden();
  await users.getByText('admin', { exact: true }).click();
  await expect(modal).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Users', exact: true }).click();
  await expect(users.getByRole('row', { name: /Administrator admin Administrator/ })).toBeVisible();
  await expect(users.getByText('edited-browser-user', { exact: true })).toHaveCount(0);
});
