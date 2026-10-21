import { expect, test } from './fixtures';
import { testAdminToken } from './admin';

let token: string;

test.beforeAll(() => {
  token = testAdminToken();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((savedToken) => sessionStorage.setItem('arrowcast.admin.jwt', savedToken), token);
  await page.goto('/admin/ranges');
  await expect(page).toHaveURL('/admin/settings');
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
});

test('add a range through the modal, validate lanes, and retain it after reloading', async ({ page }) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add range' });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('Name', { exact: true })).toBeFocused();
  await modal.getByLabel('Name', { exact: true }).fill('Indoor browser test');
  await modal.getByLabel('Supported distances (meters)').fill('18, 25');
  await modal.getByLabel('Lane numbers').fill('1-11, 11');
  await modal.getByRole('button', { name: 'Add range', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('must be unique');
  await modal.getByLabel('Lane numbers').fill('1-11');
  await modal.getByRole('button', { name: 'Add range', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Ranges', exact: true }).getByRole('status')).toContainText('added');
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused();
  const row = page.getByRole('row', { name: /Indoor browser test/ });
  await expect(row).toContainText('18 m');
  await expect(row).toContainText('25 m');
  await expect(row).toContainText('11 lanes');
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('link', { name: 'Competitions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
  await expect(row).toBeVisible();
});

test('modal cancels with Escape and Cancel, and a failed save keeps the entered values', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add', exact: true });
  const modal = page.getByRole('dialog', { name: 'Add range' });
  await add.click();
  await modal.getByRole('heading', { name: 'Add range', exact: true }).click();
  await expect(modal).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(modal).not.toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).not.toBeVisible();
  await add.click();
  await modal.getByLabel('Name', { exact: true }).fill('Outdoor');
  await modal.getByLabel('Supported distances (meters)').fill('30, 50, 70');
  await modal.getByLabel('Lane numbers').fill('1-5, 7');
  await page.route('**/api/v1/admin/ranges', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { message: 'Failed' } })
      : route.continue(),
  );
  await modal.getByRole('button', { name: 'Add range', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Could not save');
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('Outdoor');
  await expect(modal.getByLabel('Lane numbers')).toHaveValue('1-5, 7');
  await expect(modal.getByRole('button', { name: 'Add range', exact: true })).toBeEnabled();
});

test('overview offers retry on failure and returns to login on an expired session', async ({ page }) => {
  await page.route('**/api/v1/admin/ranges', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load ranges');
  await page.unroute('**/api/v1/admin/ranges');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
  await page.route('**/api/v1/admin/ranges', (route) => route.fulfill({ status: 401, json: {} }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('expired');
});

test('click a range to edit its fields, persist changes, and remove it from the modal', async ({ page, request }) => {
  const created = await request.post('/api/v1/admin/ranges', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Editable browser range', supportedDistancesMeters: [18, 25], lanes: [{ number: 1 }, { number: 2 }] },
  });
  expect(created.status()).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
  const row = page.getByRole('row', { name: /Editable browser range/ });
  await row.getByText('25 m', { exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit range', exact: true });
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('Editable browser range');
  await expect(modal.getByLabel('Supported distances (meters)')).toHaveValue('18, 25');
  await expect(modal.getByLabel('Lane numbers')).toHaveValue('1, 2');
  await page.keyboard.press('Escape');
  const edit = page.getByRole('button', { name: 'Editable browser range', exact: true });
  await expect(edit).toBeFocused();
  await edit.press('Enter');
  await modal.getByLabel('Name', { exact: true }).fill('Updated browser range');
  await modal.getByLabel('Supported distances (meters)').fill('18, 30');
  await modal.getByLabel('Lane numbers').fill('1-3');
  await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
  const updated = page.getByRole('row', { name: /Updated browser range/ });
  await expect(updated).toContainText('30 m');
  await expect(updated).toContainText('3 lanes');
  await updated.click();
  const remove = modal.getByRole('button', { name: 'Remove range', exact: true });
  await expect(remove).toHaveCSS('background-color', 'rgb(185, 28, 28)');
  await page.route('**/api/v1/admin/ranges/*', (route) => route.fulfill({ status: 409, json: {} }));
  await remove.click();
  await expect(modal.getByRole('alert')).toContainText('used by a competition');
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('Updated browser range');
  await page.unroute('**/api/v1/admin/ranges/*');
  await remove.click();
  await expect(modal).not.toBeVisible();
  await expect(updated).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused();
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Ranges', exact: true }).click();
  await expect(updated).toHaveCount(0);
});
