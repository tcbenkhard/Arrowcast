import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import type { LaneQrCode, ScoringContext } from '../../packages/contracts/src/index';
import { testAdminToken } from './admin';

async function fixture(request: APIRequestContext, arrowsPerRound = 2) {
  const token = testAdminToken();
  const headers = { Authorization: `Bearer ${token}` };
  const range = await (
    await request.post('/api/v1/admin/ranges', {
      headers,
      data: {
        name: `Scoring range ${randomUUID()}`,
        supportedDistancesMeters: [18],
        lanes: [{ number: 1 }, { number: 2 }],
      },
    })
  ).json();
  const competition = await (
    await request.post('/api/v1/admin/competitions', {
      headers,
      data: {
        name: `Scoring competition ${randomUUID().slice(0, 8)}`,
        date: '2026-11-01',
        startingTime: '09:00',
        endingTime: '12:00',
        rangeId: range.id,
        lanes: range.lanes.map((lane: { id: string }) => ({ laneId: lane.id, distanceMeters: 18 })),
        numberOfRounds: 2,
        arrowsPerRound,
      },
    })
  ).json();
  const base = `/api/v1/admin/competitions/${competition.id}`;
  const types = (await (await request.get('/api/v1/admin/target-types', { headers })).json()) as string[];
  const targetType = types[0]!;
  for (const lane of range.lanes) {
    expect(
      (await request.put(`${base}/lanes/${lane.id}`, { headers, data: { targetType, numberOfTargets: 1 } })).ok(),
    ).toBeTruthy();
  }
  for (const name of [
    'First browser archer',
    'Second browser archer',
    'Third browser archer',
    'Fourth browser archer',
  ]) {
    expect(
      (
        await request.post(`${base}/participants`, {
          headers,
          data: { name, federationNumber: randomUUID(), clubNumber: 'e2e-club', bowType: 'Recurve', targetType },
        })
      ).ok(),
    ).toBeTruthy();
  }
  return { token, headers, competition, base };
}
async function pressScore(page: Page, value: number) {
  await page.getByRole('button', { name: value === 0 ? 'Score Miss' : `Score ${value}`, exact: true }).click();
  await expect(page.locator('.scoring-notice')).toContainText('Draft saved.');
  await expect(page.getByRole('button', { name: 'Score 10', exact: true })).toBeEnabled();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.scoring-notice')).toContainText(/Scores saved|All rounds saved/);
}

test('live scores stay up to date in fullscreen and return to the competition screen', async ({ page, request }) => {
  const f = await fixture(request);
  await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Check-in' } });
  await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Active' } });
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), f.token);
  let totalScore = 10;
  await page.route(`**${f.base}/scoring-standings`, (route) =>
    route.fulfill({
      json: [
        {
          participantId: 'fullscreen-archer',
          name: 'Fullscreen archer',
          laneNumber: 1,
          targetLetter: 'A',
          enteredRounds: 1,
          totalRounds: 2,
          totalScore,
          averageScore: totalScore / 2,
        },
      ],
    }),
  );
  await page.goto(`/admin/competitions/${f.competition.id}`);
  const scores = page.getByRole('region', { name: 'Live scoring', exact: true });
  const table = scores.getByRole('table', { name: 'Scoring standings' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Participant',
    'Assignment',
    'Round',
    'Total score',
    'Average score',
  ]);
  await expect(table.getByRole('cell', { name: '1 A', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '10', exact: true })).toBeVisible();
  await scores.getByRole('button', { name: 'Show live scores in fullscreen' }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('live-score-panel')))
    .toBe(true);
  await expect(scores.getByRole('button', { name: 'Pause scoring', exact: true })).toBeHidden();
  await expect(table.getByRole('cell', { name: '1 A', exact: true })).toBeVisible();
  totalScore = 20;
  await expect(table.getByRole('cell', { name: '20', exact: true })).toBeVisible({ timeout: 10_000 });
  await scores.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(scores.getByRole('button', { name: 'Pause scoring', exact: true })).toBeVisible();
  await expect(scores.getByRole('button', { name: 'Show live scores in fullscreen' })).toBeFocused();
  await scores.getByRole('button', { name: 'Show live scores in fullscreen' }).click();
  await expect(scores.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expect(scores.getByRole('button', { name: 'Show live scores in fullscreen' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(
    (await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Closed' } })).ok(),
  ).toBeTruthy();
  await page.reload();
  await expect(table.getByRole('columnheader')).toHaveText(['Participant', 'Round', 'Total score', 'Average score']);
});

test('correcting the second arrow with backspace selects the next arrow in drafts and submitted rounds', async ({
  page,
  request,
}) => {
  const f = await fixture(request, 3);
  const started = await (
    await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Check-in' } })
  ).json();
  await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Active' } });
  await page.goto((started.qrCodes[0] as LaneQrCode).path);
  const participant = page
    .getByRole('group', { name: 'Lane participants', exact: true })
    .locator('.scoring-participant-toggle')
    .first();
  const secondArrow = page.getByRole('button', { name: /^Arrow 2:/ });
  const thirdArrow = page.getByRole('button', { name: /^Arrow 3:/ });
  const backspace = page.getByRole('button', { name: 'Backspace', exact: true });
  await pressScore(page, 10);
  await pressScore(page, 9);
  await pressScore(page, 8);
  await secondArrow.click();
  await backspace.click();
  await expect(secondArrow).toHaveAttribute('aria-pressed', 'true');
  await pressScore(page, 7);
  await expect(thirdArrow).toHaveAttribute('aria-pressed', 'true');
  await expect(thirdArrow).toHaveAccessibleName('Arrow 3: 8');
  await save(page);
  await participant.click();
  await secondArrow.click();
  await backspace.click();
  await expect(secondArrow).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Score 6', exact: true }).click();
  await expect(thirdArrow).toHaveAttribute('aria-pressed', 'true');
  await expect(secondArrow).toHaveAccessibleName('Arrow 2: 6');
  await expect(thirdArrow).toHaveAccessibleName('Arrow 3: 8');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(page.locator('.scoring-notice')).toHaveText('Correction saved.');
});

test('print lane QRs during check-in, start, enter on a phone, resume on another device and wrap through all rounds', async ({
  page,
  request,
  browser,
}) => {
  const f = await fixture(request);
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), f.token);
  await page.goto(`/admin/competitions/${f.competition.id}`);
  const settings = page.getByRole('region', { name: 'Live scoring', exact: true });
  await expect(page.getByRole('region', { name: 'Details', exact: true })).toContainText(f.competition.name);
  await expect(settings).toHaveCount(0);
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start competition', exact: true })).toBeVisible();
  await expect(settings).toHaveCount(0);
  const qr = page.getByRole('region', { name: 'Lane scoring QR codes' });
  await expect(qr.getByRole('button', { name: 'Expand lane scoring QR codes' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Expand: lanes', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await qr.getByRole('button', { name: 'Expand lane scoring QR codes' }).click();
  await expect(qr.getByRole('img')).toHaveCount(2);
  const links = qr.getByRole('link');
  const urls = await links.evaluateAll((elements) => elements.map((link) => (link as HTMLAnchorElement).href));
  expect(urls.every((url) => url.includes('#token='))).toBeTruthy();
  await page.reload();
  await expect(qr.getByRole('button', { name: 'Expand lane scoring QR codes' })).toBeVisible();
  await qr.getByRole('button', { name: 'Expand lane scoring QR codes' }).click();
  await expect(qr.getByRole('img').first()).toBeVisible();
  expect(
    await qr.getByRole('link').evaluateAll((elements) => elements.map((link) => (link as HTMLAnchorElement).href)),
  ).toEqual(urls);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('region', { name: 'Details', exact: true })).toBeHidden();
  await expect(qr.getByRole('img').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print lane QR codes' })).toBeHidden();
  await page.screenshot({ path: 'test-results/scoring-qr-print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Start competition', exact: true }).click();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('table', { name: 'Scoring standings' }).getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Expand: participants', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(settings.getByRole('spinbutton')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Save scoring format' })).toHaveCount(0);
  expect(await links.evaluateAll((elements) => elements.map((link) => (link as HTMLAnchorElement).href))).toEqual(urls);
  // Four archers across two lanes give two participants per lane.
  const assignments = await (await request.get(`${f.base}/participants`, { headers: f.headers })).json();
  const occupiedLaneId = assignments[0].laneId;
  const linkIndex = await links.evaluateAll(
    (elements, id) => elements.findIndex((link) => (link as HTMLAnchorElement).href.includes(`/${id}/`)),
    occupiedLaneId,
  );
  const url = urls[linkIndex]!;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phoneContext.addInitScript(() => localStorage.setItem('arrowcast.language', 'en'));
  await otherContext.addInitScript(() => localStorage.setItem('arrowcast.language', 'en'));
  try {
    const phone = await phoneContext.newPage();
    const other = await otherContext.newPage();
    await phone.goto(url);
    await expect(phone.locator('#current-archer')).toBeVisible();
    expect(new URL(phone.url()).hash).toBe('');
    expect(await phone.evaluate(() => sessionStorage.getItem('arrowcast.admin.jwt'))).toBeNull();
    await expect(phone.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const firstParticipant = await phone.locator('#current-archer').textContent();
    let loseResponse = true;
    await phone.route('**/api/v1/scoring/*/scores', async (route) => {
      if (!loseResponse) {
        await route.continue();
        return;
      }
      loseResponse = false;
      await route.fetch();
      await route.abort();
    });
    // Exercise the LAN fallback even though localhost normally has randomUUID.
    await phone.evaluate(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
    await phone.getByRole('button', { name: 'Score 10', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await phone.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(phone.locator('.scoring-notice')).toContainText('Draft saved.');
    await other.goto(url);
    await expect(other.getByRole('button', { name: 'Arrow 1: 10', exact: true })).toBeVisible();
    await expect(other.locator('#current-archer')).toHaveText(firstParticipant!);
    await expect(other.getByRole('button', { name: 'Arrow 2: not entered', exact: true })).toBeVisible();
    await pressScore(other, 9);
    await save(other);
    const grantId = new URL(url).pathname.split('/').at(-1)!;
    const contextUrl = `/api/v1/scoring/${grantId}/context`;
    const progress = (await (await other.request.get(new URL(contextUrl, url).href)).json()) as ScoringContext;
    const count = progress.participants.length;
    expect(count).toBe(2);
    await phone.reload();
    if (count > 1) {
      await expect(phone.locator('#current-archer')).not.toHaveText(firstParticipant!);
      await pressScore(phone, 8);
      await pressScore(phone, 7);
      await save(phone);
    }
    await expect(phone.getByText('Round 2 of 2 · 2 arrows', { exact: true })).toBeVisible();
    await expect(phone.locator('#current-archer')).toHaveText(firstParticipant!);
    await phone.screenshot({ path: 'test-results/scoring-mobile.png', fullPage: true });
    await pressScore(phone, 0);
    await pressScore(phone, 1);
    await save(phone);
    if (count > 1) {
      await pressScore(phone, 6);
      await pressScore(phone, 5);
      await save(phone);
    }
    await expect(phone.getByRole('heading', { name: 'Lane scoring complete' })).toBeVisible();
    const final = (await (await phone.request.get(new URL(contextUrl, url).href)).json()) as ScoringContext;
    await expect(
      settings
        .getByRole('table', { name: 'Scoring standings' })
        .getByRole('row')
        .filter({ hasText: progress.participants[0]!.name }),
    ).toContainText('2/2');
    await expect(
      settings
        .getByRole('table', { name: 'Scoring standings' })
        .getByRole('row')
        .filter({ hasText: progress.participants[0]!.name }),
    ).toContainText('5.00');
    expect(final.completed).toBeTruthy();
    expect(
      final.rounds.filter((r) => r.participantId === progress.participants[0]!.id).reduce((sum, r) => sum + r.total, 0),
    ).toBe(20);
    expect(final.version).toBe(count * 2 * 3); // Two drafts and one submission per participant per round; retries do not increment it.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'End competition', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Move back to Active', exact: true })).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(
      settings
        .getByRole('table', { name: 'Scoring standings' })
        .getByRole('row')
        .filter({ hasText: progress.participants[0]!.name }),
    ).toContainText('5.00');
    await expect(settings.getByRole('spinbutton')).toHaveCount(0);
    await expect(settings.getByRole('button', { name: /Pause scoring|Resume scoring/ })).toHaveCount(0);
    await page.reload();
    await expect(
      settings
        .getByRole('table', { name: 'Scoring standings' })
        .getByRole('row')
        .filter({ hasText: progress.participants[0]!.name }),
    ).toContainText('5.00');
  } finally {
    await phoneContext.close();
    await otherContext.close();
  }
});

test('choose lane participants, retain drafts and correct recorded scores including misses', async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  const started = await (
    await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Check-in' } })
  ).json();
  await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Active' } });
  const code = started.qrCodes[0] as LaneQrCode;
  await page.goto(code.path);
  const cards = page.getByRole('group', { name: 'Lane participants', exact: true });
  const participants = cards.locator('.scoring-participant-toggle');
  const first = participants.nth(0);
  const second = participants.nth(1);
  await expect(cards.getByRole('combobox')).toHaveCount(0);
  await expect(participants).toHaveCount(2);
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(cards.getByRole('group', { name: 'Score keypad', exact: true })).toHaveCount(1);
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height);
  await expect(page.getByRole('heading', { name: 'Lane scores', exact: true })).toHaveCount(0);
  await expect(page.locator('.scoring-notice')).toBeEmpty();
  const backspace = page.getByRole('button', { name: 'Backspace', exact: true });
  await expect(backspace).toHaveText('←');
  await expect(backspace).toBeDisabled();
  await pressScore(page, 10);
  await backspace.click();
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Score 10', exact: true })).toBeEnabled();
  await expect(backspace).toBeDisabled();
  await pressScore(page, 10);
  await second.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await pressScore(page, 0);
  await expect(page.getByRole('button', { name: 'Arrow 1: M', exact: true })).toHaveText('M');
  await first.click();
  await expect(page.getByRole('button', { name: 'Arrow 1: 10', exact: true })).toBeVisible();
  await second.click();
  await pressScore(page, 8);
  await save(page);
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(async () => Math.abs((await page.locator('#current-archer').boundingBox())!.y - 16))
    .toBeLessThan(2);
  await second.click();
  const scorecard = page.getByRole('table', { name: 'Participant scores', exact: true });
  await expect(scorecard.getByRole('columnheader')).toHaveText([
    'Round',
    'Arrow 1',
    'Arrow 2',
    'Round Total',
    'Cumulative Total',
  ]);
  await expect(scorecard.getByRole('row').nth(1).locator('th, td')).toHaveText(['1', 'M', '8', '8', '8']);
  await expect(scorecard.getByRole('row').nth(2).locator('th, td')).toHaveText(['2', '—', '—', '—', '—']);
  await page.getByRole('button', { name: 'Arrow 1: M', exact: true }).click();
  await page.getByRole('button', { name: 'Score 9', exact: true }).click();
  await expect(page.locator('.scoring-notice')).toContainText('Correction not saved');
  page.once('dialog', (dialog) => dialog.dismiss());
  await first.click();
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(page.locator('.scoring-notice')).toHaveText('Correction saved.');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await second.click();
  await expect(scorecard.getByRole('row').nth(1).locator('th, td')).toHaveText(['1', '9', '8', '17', '17']);
  await page.reload();
  await second.click();
  await expect(page.getByRole('button', { name: 'Arrow 1: 9', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit round 2', exact: true })).toBeDisabled();
  await scorecard.getByRole('row').nth(2).locator('td').first().click();
  await expect(page.getByRole('button', { name: 'Edit round 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Edit round 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await first.click();
  await pressScore(page, 9);
  await save(page);
  await second.click();
  await expect(page.getByRole('button', { name: 'Edit round 2', exact: true })).toBeEnabled();
  await scorecard.getByRole('row').nth(2).locator('td').first().click();
  await expect(page.getByRole('button', { name: 'Edit round 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Arrow 1: not entered', exact: true })).toBeVisible();
  await pressScore(page, 10);
  await pressScore(page, 0);
  await save(page);
  await second.click();
  await expect(scorecard.getByRole('row').nth(2).locator('th, td')).toHaveText(['2', '10', 'M', '10', '27']);
  await page.getByRole('button', { name: 'Edit round 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Arrow 1: 9', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Arrow 1: 9', exact: true }).click();
  await page.getByRole('button', { name: 'Score 7', exact: true }).click();
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(page.locator('.scoring-notice')).toHaveText('Correction saved.');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Round 2 of 2 · 2 arrows', { exact: true })).toBeVisible();
});

test('a stale phone cannot overwrite another phone and revoked codes stop access', async ({ request, browser }) => {
  const f = await fixture(request);
  const checkingIn = await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Check-in' } });
  expect(checkingIn.ok()).toBeTruthy();
  const started = await checkingIn.json();
  await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Active' } });
  const people = await (await request.get(`${f.base}/participants`, { headers: f.headers })).json();
  const code = (started.qrCodes as LaneQrCode[]).find((c) => c.laneId === people[0].laneId)!;
  const url = new URL(code.path, test.info().project.use.baseURL).href;
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  await firstContext.addInitScript(() => localStorage.setItem('arrowcast.language', 'en'));
  await secondContext.addInitScript(() => localStorage.setItem('arrowcast.language', 'en'));
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    await first.goto(url);
    await second.goto(url);
    await expect(first.locator('#current-archer')).toBeVisible();
    await expect(second.locator('#current-archer')).toBeVisible();
    const contextUrl = new URL(`/api/v1/scoring/${code.grantId}/context`, url).href;
    const stale = await (await second.request.get(contextUrl)).json();
    await second.route('**/context', (route) => route.fulfill({ json: stale }));
    await pressScore(first, 10);
    await second.getByRole('button', { name: 'Score 9', exact: true }).click();
    await expect(second.getByRole('alert')).toContainText('another device');
    await second.unroute('**/context');
    await second.getByRole('button', { name: 'Reload latest scores' }).click();
    await expect(second.getByRole('button', { name: 'Arrow 1: 10', exact: true })).toBeVisible();
    expect((await request.delete(`${f.base}/scoring-codes`, { headers: f.headers })).ok()).toBeTruthy();
    await second.reload();
    await expect(second.getByRole('alert')).toContainText('revoked');
    await expect(second.getByRole('group', { name: 'Score keypad' })).toHaveCount(0);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test('ending a competition removes open scoring cards and rejects QR scans', async ({ page, request, browser }) => {
  const f = await fixture(request);
  const started = await (
    await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Check-in' } })
  ).json();
  await request.patch(`${f.base}/status`, { headers: f.headers, data: { status: 'Active' } });
  const code = started.qrCodes[0] as LaneQrCode;
  const url = new URL(code.path, test.info().project.use.baseURL).href;
  await page.addInitScript((token) => sessionStorage.setItem('arrowcast.admin.jwt', token), f.token);
  await page.goto(`/admin/competitions/${f.competition.id}`);
  const phoneContext = await browser.newContext();
  await phoneContext.addInitScript(() => localStorage.setItem('arrowcast.language', 'en'));
  try {
    const phone = await phoneContext.newPage();
    await phone.goto(url);
    await expect(phone.getByRole('group', { name: 'Score keypad' })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'End competition', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Lane scoring QR codes' })).toHaveCount(0);
    await expect(phone.getByRole('alert')).toContainText('Scoring access has ended', { timeout: 10000 });
    await expect(phone.getByRole('group', { name: 'Score keypad' })).toHaveCount(0);
    await expect(phone.getByRole('table')).toHaveCount(0);
    await phone.goto(url);
    await expect(phone.getByRole('alert')).toContainText('Scoring access has ended');
    await expect(phone.getByRole('group', { name: 'Score keypad' })).toHaveCount(0);
  } finally {
    await phoneContext.close();
  }
});
