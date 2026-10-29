import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('API Keys generates a usable read-only key once and copies it on local HTTP', async ({ page, request }) => {
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  const card = page.getByRole('region', { name: 'API Keys', exact: true });
  const name = `Browser integration ${Date.now()}`;
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await card.getByRole('button', { name: 'Generate API Key', exact: true }).click();
  const generated = card.getByRole('textbox', { name: 'Generated API Key', exact: true });
  await expect(generated).toBeVisible();
  await expect(generated).toHaveAttribute('readonly', '');
  const secret = await generated.inputValue();
  expect(secret.length).toBeGreaterThanOrEqual(43);
  const scoring = await request.post('/api/scores', {
    headers: { Authorization: `Bearer ${secret}` },
    data: {},
  });
  expect(scoring.status()).toBe(400);
  expect(
    await page.evaluate(
      (value) => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes(value),
      secret,
    ),
  ).toBe(false);

  // Pi management runs on HTTP, where navigator.clipboard is unavailable.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string) => {
        if (command !== 'copy') return false;
        const field = document.activeElement as HTMLInputElement;
        document.documentElement.dataset.copiedApiKey = field.value.slice(
          field.selectionStart ?? 0,
          field.selectionEnd ?? 0,
        );
        return true;
      },
    });
  });
  await card.getByRole('button', { name: 'Copy API Key', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('API Key copied.');
  expect(await page.locator('html').getAttribute('data-copied-api-key')).toBe(secret);
  await page.evaluate(() => delete document.documentElement.dataset.copiedApiKey);
  await card.getByRole('button', { name: 'I have saved the key', exact: true }).click();
  await expect(generated).toHaveCount(0);
  await expect(card.getByRole('rowheader', { name, exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  await expect(card.getByRole('rowheader', { name, exact: true })).toBeVisible();
  await expect(generated).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
});

test('API Keys discards the one-time key when the card is collapsed or the page is left', async ({ page }) => {
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  const card = page.getByRole('region', { name: 'API Keys', exact: true });
  const generated = card.getByRole('textbox', { name: 'Generated API Key', exact: true });
  for (const action of ['collapse', 'navigate']) {
    await card.getByRole('textbox', { name: 'Name', exact: true }).fill(`One-time ${action} ${Date.now()}`);
    await card.getByRole('button', { name: 'Generate API Key', exact: true }).click();
    await expect(generated).toBeVisible();
    const secret = await generated.inputValue();
    if (action === 'collapse') {
      await card.getByRole('button', { name: 'Collapse: API Keys', exact: true }).click();
    } else {
      await page.getByRole('link', { name: 'Competitions', exact: true }).click();
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
    await expect(generated).toHaveCount(0);
    expect(await page.content()).not.toContain(secret);
  }
});

test('API Keys prevents duplicate generation while waiting for the response', async ({ page }) => {
  let posts = 0;
  let complete: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route('**/api/v1/admin/api-tokens', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: [] });
      return;
    }
    posts++;
    await ready;
    await route.fulfill({
      status: 201,
      json: { id: 'a'.repeat(32), name: 'Pending integration', createdDate: Date.now(), token: 'a'.repeat(43) },
    });
  });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  const card = page.getByRole('region', { name: 'API Keys', exact: true });
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill('Pending integration');
  await card.getByRole('button', { name: 'Generate API Key', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Generating…', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Collapse: API Keys', exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  complete?.();
  await expect(card.getByRole('textbox', { name: 'Generated API Key', exact: true })).toHaveValue('a'.repeat(43));
  expect(posts).toBe(1);
});

test('API Keys revokes the selected duplicate name immediately and clears its displayed secret', async ({
  page,
  request,
}) => {
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  const card = page.getByRole('region', { name: 'API Keys', exact: true });
  const name = `Revocable integration ${Date.now()}`;
  const generated = card.getByRole('textbox', { name: 'Generated API Key', exact: true });
  const secrets: string[] = [];
  for (let index = 0; index < 2; index++) {
    await card.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await card.getByRole('button', { name: 'Generate API Key', exact: true }).click();
    await expect(generated).toBeVisible();
    secrets.push(await generated.inputValue());
  }
  const rows = card.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
  await expect(rows).toHaveCount(2);
  await rows
    .nth(1)
    .getByRole('button', { name: `Revoke API Key: ${name}`, exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(generated).toHaveValue(secrets[1]!);
  expect((await request.post('/api/scores', { headers: { Authorization: `Bearer ${secrets[0]}` } })).status()).toBe(
    401,
  );
  expect((await request.post('/api/scores', { headers: { Authorization: `Bearer ${secrets[1]}` } })).status()).toBe(
    400,
  );
  await rows.getByRole('button', { name: `Revoke API Key: ${name}`, exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(generated).toHaveCount(0);
  expect((await request.post('/api/scores', { headers: { Authorization: `Bearer ${secrets[1]}` } })).status()).toBe(
    401,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  await expect(card.getByRole('rowheader', { name, exact: true })).toHaveCount(0);
});

test('API Keys retains a key after revoke failure and prevents duplicate revoke requests while retrying', async ({
  page,
}) => {
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Expand: API Keys', exact: true }).click();
  const card = page.getByRole('region', { name: 'API Keys', exact: true });
  const name = `Retry revoke ${Date.now()}`;
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await card.getByRole('button', { name: 'Generate API Key', exact: true }).click();
  const generated = card.getByRole('textbox', { name: 'Generated API Key', exact: true });
  await expect(generated).toBeVisible();
  const secret = await generated.inputValue();
  let deletes = 0;
  let complete: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route('**/api/v1/admin/api-tokens/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    deletes++;
    if (deletes === 1) {
      await route.fulfill({ status: 503, json: { message: 'Temporary failure' } });
      return;
    }
    await ready;
    await route.continue();
  });
  const revoke = card.getByRole('button', { name: `Revoke API Key: ${name}`, exact: true });
  await revoke.click();
  await expect(card.getByRole('alert')).toHaveText('The API Key could not be revoked. Please try again.');
  await expect(card.getByRole('rowheader', { name, exact: true })).toBeVisible();
  await expect(generated).toHaveValue(secret);
  await expect(revoke).toBeEnabled();
  await revoke.click();
  await expect(revoke).toBeDisabled();
  await expect(revoke).toHaveText('Revoking…');
  await expect(card.getByRole('button', { name: 'Generate API Key', exact: true })).toBeDisabled();
  expect(deletes).toBe(2);
  complete?.();
  await expect(card.getByRole('rowheader', { name, exact: true })).toHaveCount(0);
  await expect(generated).toHaveCount(0);
  await expect(card.getByRole('alert')).toHaveCount(0);
});
