import { expect, test } from './fixtures';
import { testAdminToken } from './admin';

let token: string;
test.beforeAll(() => {
  token = testAdminToken();
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Expand: Target types', exact: true }).click();
});

test('list seeded names, create a type, prevent duplicates and autosave it on a lane', async ({ page, request }) => {
  const types = page.getByRole('table', { name: 'Target types', exact: true });
  await expect(types.getByRole('rowheader', { name: 'Dutch Target 40 cm (3-spot)', exact: true })).toBeVisible();
  await expect(types.getByRole('rowheader', { name: 'Compound 40 cm (4-spot)', exact: true })).toBeVisible();
  const form = page.getByRole('form', { name: 'Add target type', exact: true });
  await form.getByLabel('Name', { exact: true }).fill('  Custom browser target  ');
  await form.getByRole('button', { name: 'Add target type', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Custom browser target');
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(types.getByRole('rowheader', { name: 'Custom browser target', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Target types', exact: true }).click();
  await expect(types.getByRole('rowheader', { name: 'Custom browser target', exact: true })).toBeVisible();
  await form.getByLabel('Name', { exact: true }).fill('custom BROWSER target');
  await form.getByRole('button', { name: 'Add target type', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('already exists');
  const headers = { Authorization: `Bearer ${token}` };
  const rangeResponse = await request.post('/api/v1/admin/ranges', { headers,
    data: { name: 'Target type browser range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] } });
  const range = await rangeResponse.json();
  const competitionResponse = await request.post('/api/v1/admin/competitions', { headers,
    data: { name: 'Target type browser competition', date: '2026-12-02', startingTime: '09:00', endingTime: '12:00',
      rangeId: range.id, lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }] } });
  const competition = await competitionResponse.json();
  await page.goto(`/admin/competitions/${competition.id}`);
  const lane = page.getByRole('row', { name: 'Lane 1 configuration', exact: true });
  await lane.getByLabel('Target type', { exact: true }).selectOption('Custom browser target');
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(lane.getByLabel('Target type', { exact: true })).toHaveValue('Custom browser target');
  await lane.getByLabel('Target type', { exact: true }).selectOption('');
  await expect(lane).toHaveAttribute('aria-busy', 'false');
});

test('failed loads and creates can be retried without losing input', async ({ page }) => {
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ status: 500, json: {} }));
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Target types', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load target types');
  await page.unroute('**/api/v1/admin/target-types');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add target type', exact: true });
  await expect(form.getByRole('button', { name: 'Add target type', exact: true })).toBeEnabled();
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ status: 500, json: {} }));
  await form.getByLabel('Name', { exact: true }).fill('Retry browser target');
  await form.getByRole('button', { name: 'Add target type', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Could not create');
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Retry browser target');
  await page.unroute('**/api/v1/admin/target-types');
  await form.getByRole('button', { name: 'Add target type', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Retry browser target');
});


test('bulk deletion requires confirmation and preserves selection when deletion fails', async ({ page }) => {
  const table = page.getByRole('table', { name: 'Target types', exact: true });
  const first = table.getByRole('checkbox', { name: 'Select target type Dutch Target 40 cm (3-spot)', exact: true });
  const second = table.getByRole('checkbox', { name: 'Select target type Compound 40 cm (4-spot)', exact: true });
  await first.check();
  await second.check();
  const bulk = page.getByRole('group', { name: 'Apply to selection', exact: true });
  await expect(bulk).toContainText('2 selected');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Dutch Target 40 cm (3-spot)');
    await dialog.dismiss();
  });
  await bulk.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(first).toBeChecked();
  await page.route('**/api/v1/admin/target-types', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 500, json: {} });
    else await route.continue();
  });
  page.once('dialog', (dialog) => dialog.accept());
  await bulk.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your selection has been kept');
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await page.unroute('**/api/v1/admin/target-types');
  page.once('dialog', (dialog) => dialog.accept());
  await bulk.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  await expect(bulk).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Expand: Target types', exact: true }).click();
  await expect(table).toBeVisible();
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  const all = table.getByRole('checkbox', { name: 'Select all target types', exact: true });
  await all.check();
  await expect(table.locator('input[type="checkbox"]:not(:checked)')).toHaveCount(0);
  await all.uncheck();
  await expect(bulk).toHaveCount(0);
});
