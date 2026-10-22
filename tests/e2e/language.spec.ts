import { expect, test } from '@playwright/test';
import { testAdminToken } from './admin';

test('a profile language switch updates all pages immediately and survives a fresh browser preference', async ({
  page,
  request,
}) => {
  const token = testAdminToken();
  await request.patch('/api/v1/admin/me/language', {
    headers: { Authorization: `Bearer ${token}` },
    data: { language: 'nl' },
  });
  await page.addInitScript((jwt) => sessionStorage.setItem('arrowcast.admin.jwt', jwt), token);
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: 'Wedstrijden', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Profiel: admin' }).click();
  await page.locator('#profile-dropdown').getByRole('button', { name: 'Engels', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Competitions', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('arrowcast.language', 'nl'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Profile: admin' }).click();
  await page.locator('#profile-dropdown').getByRole('button', { name: 'Dutch', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Instellingen', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gebruikers', exact: true })).toBeVisible();
});

test('visitors can change language on the home page and login page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Taal', { exact: true }).selectOption('en');
  await expect(page.getByText('Welcome to Arrowcast.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open the admin portal' }).click();
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dutch', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
});
