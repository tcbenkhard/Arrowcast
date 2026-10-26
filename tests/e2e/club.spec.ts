import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('club selection supports manual entry, searching, persistence and clearing', async ({ page }) => {
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  const card = page.getByRole('region', { name: 'Club', exact: true });
  await card.getByRole('button', { name: 'Expand: Club', exact: true }).click();
  await card.getByLabel('Club number', { exact: true }).fill('test-123');
  await card.getByLabel('Club name', { exact: true }).fill('Test archery club');
  await card.getByRole('button', { name: 'Save and select club' }).click();
  await expect(card.getByRole('status')).toContainText('Test archery club');
  await page.reload();
  await card.getByRole('button', { name: 'Expand: Club', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('test-123');
  await card.getByRole('button', { name: 'Clear club selection' }).click();
  await expect(card.getByRole('status')).toContainText('No club selected');
  await card.getByLabel('Search by club number or name').fill('test-123');
  await card.getByRole('button', { name: /test-123.*Test archery club/ }).click();
  await expect(card.getByRole('status')).toContainText('Test archery club');
  await card.getByRole('button', { name: 'Clear club selection' }).click();
  await expect(card.getByRole('status')).toContainText('No club selected');
});
