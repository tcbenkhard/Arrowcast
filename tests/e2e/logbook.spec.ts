import { expect, test } from './fixtures';
import { testAdminToken } from './admin';
import type { Page } from '@playwright/test';

async function enterCode(page: Page, digits: string) {
  for (const digit of digits) await page.getByRole('button', { name: `Digit ${digit}`, exact: true }).click();
}

test('guest scores need no identity and are never persisted', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/scoring/logbook') && request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/scores/logbook');
  await page.getByRole('button', { name: 'Guest', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Guest', exact: true })).toBeVisible();
  await expect(page.getByLabel('Find your name')).toHaveCount(0);
  for (let round = 1; round <= 10; round++) {
    for (let arrow = 0; arrow < 3; arrow++) await page.getByRole('button', { name: 'Score 10', exact: true }).click();
    await page.getByRole('button', { name: round === 10 ? 'Finish' : 'Next round', exact: true }).click();
  }
  await expect(page.getByRole('status')).toHaveText('Score: 300 of 300. Your guest scores have not been saved.');
  expect(await page.evaluate(() => sessionStorage.getItem('arrowcast.logbook.draft'))).toBeNull();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Score 9', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Find your name')).toBeVisible();
  await page.getByRole('button', { name: 'Guest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Score 8', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Exit score entry', exact: true }).click();
  await expect(page.getByLabel('Find your name')).toBeVisible();
  expect(writes).toEqual([]);
});

test('permanent club link protects a personal sheet, resumes saved rounds and finishes exactly once', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scores/logbook');
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByLabel('Find your name').fill('Logbook browser archer');
  await page.getByRole('option', { name: 'Logbook browser archer (Browser test club)', exact: true }).click();
  await expect(page.getByText('Create a PIN of 4 to 6 digits to protect your name.')).toBeVisible();
  await enterCode(page, '1234');
  await expect(page.getByRole('heading', { name: 'Score logbook', exact: true })).toHaveCount(0);
  await expect(page.getByText('Select your name and track your own scores.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Repeat PIN', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Repeat your PIN to confirm it.')).toBeVisible();
  await enterCode(page, '4321');
  await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The PINs do not match.');
  await page.getByRole('button', { name: 'Code position 1', exact: true }).click();
  await enterCode(page, '1234');
  await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Logbook browser archer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Score 10', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Logbook browser archer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arrow 1: 10', exact: true })).toBeVisible();
  for (let arrow = 0; arrow < 2; arrow++) await page.getByRole('button', { name: 'Score 10', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Round 2 of 10', { exact: false })).toBeVisible();
  await expect(page.getByText('Your draft has been saved.', { exact: true })).toHaveCount(0);
  const headers = { Authorization: `Bearer ${testAdminToken()}` };
  expect(await (await request.get('/api/v1/admin/logbook', { headers })).json()).toEqual([]);
  await page.reload();
  await expect(page.getByText('Round 2 of 10', { exact: false })).toBeVisible();
  const phone = await page.context().newPage();
  await phone.goto('/scores/logbook');
  await phone.getByLabel('Find your name').fill('Logbook browser archer');
  await phone.getByRole('option', { name: 'Logbook browser archer (Browser test club)', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Repeat PIN', exact: true })).toHaveCount(0);
  await enterCode(phone, '0000');
  await phone.getByRole('button', { name: 'Enter scores', exact: true }).click();
  await expect(phone.getByRole('alert')).toHaveText('Incorrect PIN.');
  await phone.getByRole('button', { name: 'Code position 5', exact: true }).focus();
  for (let digit = 0; digit < 4; digit++) await phone.keyboard.press('Backspace');
  await enterCode(phone, '1234');
  await phone.getByRole('button', { name: 'Enter scores', exact: true }).click();
  await expect(phone.getByText('Round 2 of 10', { exact: false })).toBeVisible();
  await phone.close();
  for (let round = 2; round <= 10; round++) {
    for (let arrow = 0; arrow < 3; arrow++) await page.getByRole('button', { name: 'Score 10', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    if (round < 10) {
      await expect(page.getByText(`Round ${round + 1} of 10`, { exact: false })).toBeVisible();
    }
  }
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  // The server commits the sheet, but the phone loses the response. Retrying must not duplicate it.
  await page.route(
    '**/api/v1/scoring/logbook/entry',
    async (route) => {
      await route.fetch();
      await route.fulfill({ status: 503, json: { message: 'Temporary connection failure' } });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your score has been saved.');
  await expect(page.getByText('Score: 300 of 300', { exact: false })).toBeVisible();
  const summary = await (await request.get('/api/v1/admin/logbook', { headers })).json();
  expect(summary).toEqual([
    {
      participantId: 'logbook-browser-archer',
      name: 'Logbook browser archer',
      averageScore: 300,
      averagePerArrow: 10,
      highestScore: 300,
    },
  ]);
  const history = await (await request.get('/api/v1/admin/logbook/logbook-browser-archer', { headers })).json();
  expect(history).toHaveLength(1);
  expect(history[0].completedAt).toBeGreaterThan(Date.now() - 60000);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Select another name', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Round 1 of 10', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Logbook browser archer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toBeVisible();
  const exit = page.getByRole('button', { name: 'Exit score entry', exact: true });
  await expect(exit).toHaveText('');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Leave score entry and return to name selection?');
    await dialog.dismiss();
  });
  await exit.click();
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Score 10', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await exit.click();
  await expect(page.getByRole('button', { name: 'Arrow 1: 10', exact: true })).toBeVisible();
  for (let arrow = 0; arrow < 2; arrow++) await page.getByRole('button', { name: 'Score 10', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Round 2 of 10', { exact: false })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await exit.click();
  await expect(page.getByLabel('Find your name')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Find your name')).toBeVisible();
  expect((await page.request.get('/api/v1/scoring/logbook/context')).status()).toBe(401);
  await page.getByLabel('Find your name').fill('Logbook browser archer');
  await page.getByRole('option', { name: 'Logbook browser archer (Browser test club)', exact: true }).click();
  await enterCode(page, '1234');
  await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
  await expect(page.getByText('Round 1 of 10', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toBeVisible();
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/logbook');
  await expect(page.getByRole('link', { name: 'Score logbook', exact: true })).toHaveAttribute('aria-current', 'page');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as XLS', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('scorelogboek.xls');
  expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: 'Logbook browser archer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Score history', exact: true })).toBeVisible();
  await expect(page.locator('.logbook-qr-panel img')).toBeHidden();
  await page.locator('.logbook-qr-panel .panel-toggle').click();
  await expect(page.locator('.logbook-qr-panel img')).toBeVisible();
  await expect(page.locator('.logbook-qr-panel img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.locator('.logbook-qr-panel a')).toHaveAttribute('href', /\/scores\/logbook$/);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.logbook-qr-panel img')).toBeVisible();
  await expect(page.locator('.admin-nav')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await request.patch('/api/v1/admin/me/language', { headers, data: { language: 'nl' } });
  await page.reload();
  await expect(
    page.getByText(
      'Alleen be\u00ebindigde lijstjes van 10 \u00d7 3 pijlen tellen mee. Selecteer een naam voor de scorehistorie.',
      { exact: true },
    ),
  ).toBeVisible();
});
