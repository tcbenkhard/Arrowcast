import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

for (const width of [1280, 375]) {
  test(`advanced settings opens live logs without a main navigation tab at ${width}px`, async ({ page }) => {
    let backend = 'Backend started';
    const reads: string[] = [];
    await page.route('**/api/v1/admin/logs/*', async (route) => {
      const source = route.request().url().split('/').pop()!;
      reads.push(source);
      await route.fulfill({ json: { text: source === 'backend' ? backend : `${source} log entry` } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Expand: Advanced', exact: true }).click();
    await page.getByRole('button', { name: 'View log files', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/logs$/);
    await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(3);
    await expect(page.getByRole('tabpanel')).toContainText('frontend log entry');
    await page.getByRole('tab', { name: 'Backend logs', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Backend started');
    backend = 'Backend started\nNew live entry <script>literal</script>';
    await expect(page.getByRole('tabpanel')).toContainText('New live entry <script>literal</script>');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const count = reads.length;
    backend = 'After resume';
    await page.waitForTimeout(2300);
    expect(reads.length).toBe(count);
    await expect(page.getByRole('tabpanel')).not.toContainText('After resume');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toHaveText('After resume');
    await page.getByRole('tab', { name: 'Backend logs', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Update service logs' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('updates log entry');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
  });
}

test('logs recover automatically after a read failure and show empty logs', async ({ page }) => {
  let available = false;
  await page.route('**/api/v1/admin/logs/*', (route) =>
    route.fulfill({
      status: available ? 200 : 503,
      json: available ? { text: '' } : { message: 'Unavailable' },
    }),
  );
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
  await page.goto('/admin/logs');
  await expect(page.getByRole('alert')).toContainText('Logs are unavailable');
  available = true;
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveText('No log entries yet.');
});

for (const width of [1280, 375]) {
  test(`synchronizations display request details and competition names at ${width}px`, async ({ page }) => {
    await page.route('**/api/v1/admin/logs/*', (route) =>
      route.fulfill({
        json: {
          text: '',
          entries: route.request().url().endsWith('/synchronizations')
            ? [
                {
                  id: 2,
                  requestedAt: 1793698000000,
                  requestDate: '2026-11-03',
                  requestTime: '10:00',
                  competitionId: 'competition',
                  competitionName: 'Autumn competition',
                  apiKeyName: 'Club integration',
                  statusCode: 200,
                  errorMessage: null,
                },
                {
                  id: 1,
                  requestedAt: 1793697000000,
                  requestDate: '2026-11-02',
                  requestTime: '09:00',
                  competitionId: null,
                  competitionName: null,
                  apiKeyName: 'Club integration',
                  statusCode: 404,
                  errorMessage: 'Wedstrijd niet gevonden',
                },
              ]
            : [],
        },
      }),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), testAdminToken());
    await page.goto('/admin/logs');
    await page.getByRole('tab', { name: 'Synchronizations', exact: true }).click();
    const rows = page.getByRole('tabpanel').getByRole('row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText('Autumn competition');
    await expect(rows.nth(1)).toContainText('2026-11-03 10:00');
    await expect(rows.nth(2)).toContainText('No competition selected');
    await expect(rows.nth(1)).toContainText('Succeeded (200)');
    await expect(rows.nth(1)).toContainText('Club integration');
    await expect(rows.nth(2)).toContainText('Failed (404)');
    await expect(rows.nth(2)).toContainText('Club integration');
    await expect(rows.nth(2)).toContainText('Wedstrijd niet gevonden');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
