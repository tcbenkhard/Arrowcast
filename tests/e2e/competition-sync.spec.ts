import { testAdminToken } from './admin';
import { expect, test } from './fixtures';

test('a successful scores request shows synchronization in competition details and the overview', async ({
  page,
  request,
}) => {
  const token = testAdminToken();
  const headers = { Authorization: `Bearer ${token}` };
  const previousClub = await (await request.get('/api/v1/admin/settings/club', { headers })).json();
  const competitionIds: string[] = [];
  let keyId: string | undefined;
  try {
    expect(
      (
        await request.put('/api/v1/admin/settings/club', {
          headers,
          data: { clubNumber: '1241', name: 'Synchronization browser club' },
        })
      ).status(),
    ).toBe(200);
    const rangeResponse = await request.post('/api/v1/admin/ranges', {
      headers,
      data: { name: 'Synchronization browser range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] },
    });
    expect(rangeResponse.status()).toBe(201);
    const range = await rangeResponse.json();
    for (const [index, name] of ['Synchronized browser competition', 'Unsynchronized browser competition'].entries()) {
      const created = await request.post('/api/v1/admin/competitions', {
        headers,
        data: {
          name,
          date: `2080-11-0${index + 1}`,
          startingTime: '10:00',
          endingTime: '12:00',
          rangeId: range.id,
          lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
        },
      });
      expect(created.status()).toBe(201);
      competitionIds.push((await created.json()).id);
    }
    const competitionId = competitionIds[0]!;
    for (const status of ['Check-in', 'Active', 'Closed']) {
      expect(
        (
          await request.patch(`/api/v1/admin/competitions/${competitionId}/status`, {
            headers,
            data: { status },
          })
        ).status(),
      ).toBe(200);
    }
    const createdKey = await request.post('/api/v1/admin/api-tokens', {
      headers,
      data: { name: 'Synchronization browser integration' },
    });
    expect(createdKey.status()).toBe(201);
    const key = await createdKey.json();
    keyId = key.id;
    await page.addInitScript((jwt) => sessionStorage.setItem('arrowcast.admin.jwt', jwt), token);
    await page.goto(`/admin/competitions/${competitionId}`);
    const details = page.getByRole('region', { name: 'Details', exact: true });
    await expect(details).toBeVisible();
    await expect(details.getByText(/^Synced on /)).toHaveCount(0);

    const scores = await request.post('/api/scores', {
      headers: { Authorization: `Bearer ${key.token}` },
      data: { verenigingsnummer: 1241, date: '2080-11-01', starttime: '10:00' },
    });
    expect(scores.status()).toBe(200);
    expect(await scores.json()).toEqual({ results: [] });
    const synced = await (await request.get(`/api/v1/admin/competitions/${competitionId}`, { headers })).json();
    expect(synced.scoresSyncedAt).toEqual(expect.any(Number));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const syncText = details.getByText(/^Synced on /);
    await expect(syncText).toBeVisible();
    await expect(syncText).toHaveAttribute('datetime', new Date(synced.scoresSyncedAt).toISOString());
    await expect(details.locator('.competition-sync-status svg')).toBeVisible();
    const label = await syncText.textContent();

    await page.getByRole('link', { name: 'Competitions', exact: true }).click();
    const syncedRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: 'Synchronized browser competition', exact: true }) });
    const icon = syncedRow.getByRole('img', { name: /^Synced on / });
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('title', label ?? '');
    await expect(syncedRow.getByRole('cell').last().getByRole('img')).toBeVisible();
    const unsyncedRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: 'Unsynchronized browser competition', exact: true }) });
    await expect(unsyncedRow.getByRole('img')).toHaveCount(0);

    await test.step('a delayed focus response cannot restore synchronization after reopening', async () => {
      await syncedRow.getByRole('link', { name: 'Synchronized browser competition', exact: true }).click();
      await expect(details.getByText(/^Synced on /)).toBeVisible();
      const detailUrl = `**/api/v1/admin/competitions/${competitionId}`;
      let releaseResponse!: () => void;
      let capturedResponse!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      const captured = new Promise<void>((resolve) => {
        capturedResponse = resolve;
      });
      await page.route(detailUrl, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const snapshot = await route.fetch();
        capturedResponse();
        await release;
        await route.fulfill({ response: snapshot });
      });
      try {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await captured;
        await page.getByRole('button', { name: 'Move back to Active', exact: true }).click();
        await expect(page.locator('.competition-flow [aria-current="step"]')).toContainText('Active');
        await expect(details.getByText(/^Synced on /)).toHaveCount(0);
        const delivered = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/v1/admin/competitions/${competitionId}`) &&
            response.request().method() === 'GET',
        );
        releaseResponse();
        await (await delivered).finished();
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        );
        await expect(details.getByText(/^Synced on /)).toHaveCount(0);
      } finally {
        releaseResponse();
        await page.unroute(detailUrl);
      }
    });

    expect(
      (
        await request.patch(`/api/v1/admin/competitions/${competitionId}/status`, {
          headers,
          data: { status: 'Closed' },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post('/api/scores', {
          headers: { Authorization: `Bearer ${key.token}` },
          data: { verenigingsnummer: 1241, date: '2080-11-01', starttime: '10:00' },
        })
      ).status(),
    ).toBe(200);
    await request.patch('/api/v1/admin/me/language', { headers, data: { language: 'nl' } });
    await page.goto(`/admin/competitions/${competitionId}`);
    await expect(
      page.getByRole('region', { name: 'Gegevens', exact: true }).getByText(/^Gesynchroniseerd op /),
    ).toBeVisible();
    await test.step('reopening externally clears the marker when the page regains focus', async () => {
      expect(
        (
          await request.patch(`/api/v1/admin/competitions/${competitionId}/status`, {
            headers,
            data: { status: 'Active' },
          })
        ).status(),
      ).toBe(200);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(
        page.getByRole('region', { name: 'Gegevens', exact: true }).getByText(/^Gesynchroniseerd op /),
      ).toHaveCount(0);
    });
  } finally {
    await request.patch('/api/v1/admin/me/language', { headers, data: { language: 'en' } });
    if (keyId) await request.delete(`/api/v1/admin/api-tokens/${keyId}`, { headers });
    for (const id of competitionIds) await request.delete(`/api/v1/admin/competitions/${id}`, { headers });
    await request.put('/api/v1/admin/settings/club', {
      headers,
      data: { clubNumber: previousClub?.clubNumber ?? null },
    });
  }
});
