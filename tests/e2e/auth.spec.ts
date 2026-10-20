import { expect, test } from '@playwright/test';

test('admin requires login, reports bad credentials, restores login and logs out', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
  await page.getByLabel('Gebruikersnaam').fill('admin');
  await page.getByLabel('Wachtwoord').fill('incorrect');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Gebruikersnaam of wachtwoord is onjuist.');
  await page.getByLabel('Wachtwoord').fill('admin');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/admin/competitions');
  await expect(page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link')).toHaveText(['Competitions', 'Settings']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Uitloggen' }).click();
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('arrowcast.admin.jwt'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
});

test('an invalid stored token is removed and the portal stays protected', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('arrowcast.admin.jwt', 'forged-token'));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('ongeldig');
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('arrowcast.admin.jwt'))).toBeNull();
});

test('an active portal returns to login when its JWT expires', async ({ page }) => {
  await page.clock.install();
  await page.goto('/admin');
  await page.getByLabel('Gebruikersnaam').fill('admin');
  await page.getByLabel('Wachtwoord').fill('admin');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await page.clock.fastForward(3600001);
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('verlopen');
});

test('connection failures keep admin content hidden and allow retry', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('arrowcast.admin.jwt', 'unverified-token'));
  await page.route('**/api/v1/admin/me', (route) => route.abort());
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toContainText('verbinding');
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/admin/me');
  await page.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(page.getByRole('heading', { name: 'Inloggen', exact: true })).toBeVisible();
});

test('the public home stays public and scoring requires a lane link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arrowcast', exact: true })).toBeVisible();
  await page.goto('/scoring');
  await expect(page.getByRole('heading', { name: 'Pagina niet gevonden' })).toBeVisible();
});
