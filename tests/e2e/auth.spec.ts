import { expect, test } from '@playwright/test';
import { testAdminToken } from './admin';

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
  const profile = page.getByRole('button', { name: 'Profile: admin' });
  await expect(profile).toHaveText('A');
  await profile.click();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Logoff', exact: true })).toBeHidden();
  await profile.click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Logoff', exact: true })).toBeHidden();
  await profile.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Logoff', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Logoff', exact: true }).click();
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

test('profile menu opens a cancellable password change and saves the new password', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken('profile-user'));
  await page.goto('/admin/settings');
  const profile = page.getByRole('button', { name: 'Profile: profile-user' });
  await expect(profile).toHaveText('P');
  await profile.click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wachtwoord wijzigen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await profile.click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Huidig wachtwoord', { exact: true }).fill('admin');
  await page.getByLabel('Nieuw wachtwoord', { exact: true }).fill('updated-password');
  await page.getByLabel('Bevestig nieuw wachtwoord', { exact: true }).fill('updated-password');
  await page.getByRole('button', { name: 'Wachtwoord opslaan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
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

test('first login requires a new password, survives reload and unlocks the portal', async ({ page }) => {
  await page.goto('/admin/settings');
  await page.getByLabel('Gebruikersnaam').fill('first-login');
  await page.getByLabel('Wachtwoord', { exact: true }).fill('admin');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wachtwoord wijzigen', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Wachtwoord wijzigen', exact: true })).toBeVisible();
  await page.getByLabel('Huidig wachtwoord', { exact: true }).fill('admin');
  await page.getByLabel('Nieuw wachtwoord', { exact: true }).fill('new-pass');
  await page.getByLabel('Bevestig nieuw wachtwoord', { exact: true }).fill('a-different-password');
  await page.getByRole('button', { name: 'Wachtwoord opslaan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('komen niet overeen');
  await page.getByLabel('Bevestig nieuw wachtwoord', { exact: true }).fill('new-pass');
  await page.getByRole('button', { name: 'Wachtwoord opslaan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Profile: first-login' }).click();
  await page.getByRole('button', { name: 'Logoff', exact: true }).click();
  await page.getByLabel('Gebruikersnaam').fill('first-login');
  await page.getByLabel('Wachtwoord', { exact: true }).fill('new-pass');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
