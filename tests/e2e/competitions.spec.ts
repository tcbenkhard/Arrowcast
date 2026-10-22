import { expect, test } from './fixtures';
import { testAdminToken } from './admin';

let token: string;
let rangeId: string;
const rangeName = 'Competition browser range';

test.beforeAll(async ({ request }) => {
  token = testAdminToken();
  const range = await request.post('/api/v1/admin/ranges', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: rangeName, supportedDistancesMeters: [18, 25], lanes: [{ number: 1 }, { number: 2 }] },
  });
  rangeId = (await range.json()).id;
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Competitions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
});

test('new competition tabs between fields without stopping on date and time pickers', async ({ page }) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add competition' });
  const fields = ['Name', 'Date', 'Starting time', 'Ending time', 'Number of rounds', 'Arrows per round'];
  await expect(modal.getByLabel(fields[0]!, { exact: true })).toBeFocused();
  for (const label of fields.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(modal.getByLabel(label, { exact: true })).toBeFocused();
  }
  for (const label of fields.slice(0, -1).reverse()) {
    await page.keyboard.press('Shift+Tab');
    await expect(modal.getByLabel(label, { exact: true })).toBeFocused();
  }
});

test('edit competition details, keep input on failure and confirm removal', async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const ranges = await request.get('/api/v1/admin/ranges', { headers });
  const range = (await ranges.json()).find((value: { id: string }) => value.id === rangeId);
  const created = await request.post('/api/v1/admin/competitions', {
    headers,
    data: {
      name: 'Editable browser competition',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId,
      lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
    },
  });
  const competition = await created.json();
  await page.goto(`/admin/competitions/${competition.id}`);
  const details = page.getByRole('region', { name: 'Details', exact: true });
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit competition' });
  await expect(edit.getByLabel('Name', { exact: true })).toBeFocused();
  await expect(edit.getByLabel('Name', { exact: true })).toHaveValue('Editable browser competition');
  await expect(edit.getByLabel('Range', { exact: true })).toHaveValue(rangeId);
  await expect(edit.getByRole('group', { name: 'Lanes and distances' })).toBeVisible();
  await expect(edit.getByLabel('Lane 1', { exact: true })).toHaveValue('18');
  await expect(edit.getByLabel('Lane 2', { exact: true })).toHaveValue('');
  await edit.getByLabel('Name', { exact: true }).fill('Updated browser competition');
  await edit.getByLabel('Date', { exact: true }).fill('2026-12-02');
  await edit.getByLabel('Starting time').fill('10:00');
  await edit.getByLabel('Ending time').fill('10:00');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByRole('alert')).toContainText('Ending time must be after');
  await edit.getByLabel('Ending time').fill('13:00');
  await edit.getByLabel('Number of rounds').fill('12');
  await edit.getByLabel('Arrows per round').fill('6');
  await edit.getByLabel('Default target', { exact: true }).selectOption('60 cm blazoen (10-rings)');
  const detailUrl = `**/api/v1/admin/competitions/${competition.id}`;
  await page.route(detailUrl, (route) =>
    route.fulfill({ status: 500, json: { message: 'Could not save competition.' } }),
  );
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByRole('alert')).toContainText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await expect(edit.getByLabel('Name', { exact: true })).toHaveValue('Updated browser competition');
  await page.unroute(detailUrl);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).not.toBeVisible();
  await expect(details.getByRole('status')).toHaveText('Competition details saved.');
  await page.reload();
  await expect(details).toContainText('Updated browser competition');
  await expect(details).toContainText('2026-12-02');
  await expect(details).toContainText('10:00');
  await expect(details).toContainText('13:00');
  await expect(details).toContainText('60 cm blazoen (10-rings)');
  await expect(details.getByText('12', { exact: true })).toBeVisible();
  await expect(details.getByText('6', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await edit.getByLabel('Name', { exact: true }).fill('Unsaved changes');
  await page.keyboard.press('Escape');
  await expect(edit).not.toBeVisible();
  await expect(details.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
  await expect(details).toContainText('Updated browser competition');
  await details.getByRole('button', { name: 'Remove', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Remove competition' });
  await expect(remove).toContainText('Updated browser competition');
  await expect(remove.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await remove.getByRole('button', { name: 'Cancel' }).click();
  expect((await request.get(`/api/v1/admin/competitions/${competition.id}`, { headers })).ok()).toBeTruthy();
  await details.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.route(detailUrl, (route) =>
    route.fulfill({ status: 500, json: { message: 'Could not remove competition.' } }),
  );
  await remove.getByRole('button', { name: 'Remove competition' }).click();
  await expect(remove.getByRole('alert')).toContainText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await page.unroute(detailUrl);
  await remove.getByRole('button', { name: 'Remove competition' }).click();
  await expect(page).toHaveURL('/admin/competitions');
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Updated browser competition', exact: true })).toHaveCount(0);
  expect((await request.get(`/api/v1/admin/competitions/${competition.id}`, { headers })).status()).toBe(404);
});

test('editing shows lanes for the selected range and refreshes saved lanes', async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const rangesResponse = await request.get('/api/v1/admin/ranges', { headers });
  const range = (await rangesResponse.json()).find((value: { id: string }) => value.id === rangeId);
  const other = await (
    await request.post('/api/v1/admin/ranges', {
      headers,
      data: { name: 'Replacement range', supportedDistancesMeters: [25, 50], lanes: [{ number: 8 }, { number: 9 }] },
    })
  ).json();
  const third = await (
    await request.post('/api/v1/admin/ranges', {
      headers,
      data: { name: 'Another replacement range', supportedDistancesMeters: [18], lanes: [{ number: 10 }] },
    })
  ).json();
  const competition = await (
    await request.post('/api/v1/admin/competitions', {
      headers,
      data: {
        name: 'Moving browser competition',
        date: '2026-12-05',
        startingTime: '09:00',
        endingTime: '12:00',
        rangeId,
        lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
      },
    })
  ).json();
  try {
    await page.goto(`/admin/competitions/${competition.id}`);
    const details = page.getByRole('region', { name: 'Details', exact: true });
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit competition' });
    const assignments = edit.getByRole('group', { name: 'Lanes and distances' });
    const selectRange = edit.getByLabel('Range', { exact: true });
    await expect(selectRange).toHaveValue(rangeId);
    await expect(assignments).toBeVisible();
    await expect(edit.getByLabel('Lane 1', { exact: true })).toHaveValue('18');
    await selectRange.selectOption(other.id);
    await expect(assignments).toBeVisible();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByRole('alert')).toContainText('at least one lane');
    await edit.getByRole('button', { name: 'Set all lanes to 50 m', exact: true }).click();
    await expect(edit.getByLabel('Lane 8', { exact: true })).toHaveValue('50');
    await selectRange.selectOption(third.id);
    await expect(edit.getByLabel('Lane 10', { exact: true })).toHaveValue('');
    await selectRange.selectOption(rangeId);
    await expect(assignments).toBeVisible();
    await expect(edit.getByLabel('Lane 1', { exact: true })).toHaveValue('18');
    await selectRange.selectOption(other.id);
    await expect(edit.getByLabel('Lane 8', { exact: true })).toHaveValue('');
    await edit.getByLabel('Lane 8', { exact: true }).selectOption('25');
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await expect(details).toContainText(rangeName);
    await expect(page.getByRole('row', { name: 'Lane 1 configuration' })).toBeVisible();
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    await selectRange.selectOption(other.id);
    await edit.getByLabel('Lane 8', { exact: true }).selectOption('50');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).not.toBeVisible();
    await expect(details).toContainText('Replacement range');
    await expect(page.getByRole('row', { name: 'Lane 8 configuration' })).toContainText('50 m');
    await expect(page.getByRole('row', { name: 'Lane 1 configuration' })).toHaveCount(0);
    await page.reload();
    await expect(details).toContainText('Replacement range');
    await expect(page.getByRole('row', { name: 'Lane 8 configuration' })).toContainText('50 m');
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(selectRange).toHaveValue(other.id);
    await expect(assignments).toBeVisible();
    await expect(edit.getByLabel('Lane 8', { exact: true })).toHaveValue('50');
  } finally {
    await request.delete(`/api/v1/admin/competitions/${competition.id}`, { headers });
  }
});

test('editing the current range adds and removes lanes and persists distances', async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const range = (await (await request.get('/api/v1/admin/ranges', { headers })).json()).find(
    (value: { id: string }) => value.id === rangeId,
  );
  const competition = await (
    await request.post('/api/v1/admin/competitions', {
      headers,
      data: {
        name: 'Editable lane selection',
        date: '2026-12-05',
        startingTime: '09:00',
        endingTime: '12:00',
        rangeId,
        lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
      },
    })
  ).json();
  try {
    await page.goto(`/admin/competitions/${competition.id}`);
    const details = page.getByRole('region', { name: 'Details', exact: true });
    const edit = page.getByRole('dialog', { name: 'Edit competition' });
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(edit.getByLabel('Lane 1', { exact: true })).toHaveValue('18');
    await expect(edit.getByLabel('Lane 2', { exact: true })).toHaveValue('');
    await edit.getByLabel('Lane 2', { exact: true }).selectOption('25');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).not.toBeVisible();
    await expect(page.getByRole('row', { name: 'Lane 2 configuration' })).toContainText('25 m');
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(edit.getByLabel('Lane 2', { exact: true })).toHaveValue('25');
    await edit.getByLabel('Lane 1', { exact: true }).selectOption('');
    await edit.getByLabel('Lane 2', { exact: true }).selectOption('');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByRole('alert')).toContainText('at least one lane');
    await edit.getByLabel('Lane 2', { exact: true }).selectOption('18');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).not.toBeVisible();
    await expect(page.getByRole('row', { name: 'Lane 1 configuration' })).toHaveCount(0);
    await expect(page.getByRole('row', { name: 'Lane 2 configuration' })).toContainText('18 m');
    await page.reload();
    await expect(page.getByRole('row', { name: 'Lane 2 configuration' })).toContainText('18 m');
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(edit.getByLabel('Lane 1', { exact: true })).toHaveValue('');
    await expect(edit.getByLabel('Lane 2', { exact: true })).toHaveValue('18');
  } finally {
    await request.delete(`/api/v1/admin/competitions/${competition.id}`, { headers });
  }
});

test('create competitions, validate times, select lane distances and preserve chronological order after reload', async ({
  page,
}) => {
  for (const [name, date, start] of [
    ['Later browser competition', '2026-11-02', '09:00'],
    ['Afternoon browser competition', '2026-11-01', '13:00'],
    ['Morning browser competition', '2026-11-01', '09:00'],
  ]) {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Add competition' });
    await expect(modal.getByLabel('Name', { exact: true })).toBeFocused();
    await modal.getByLabel('Name', { exact: true }).fill(name);
    await modal.getByLabel('Date', { exact: true }).fill(date);
    await modal.getByLabel('Starting time').fill(start);
    await modal.getByLabel('Ending time').fill(start);
    await modal.getByLabel('Range', { exact: true }).selectOption(rangeId);
    await modal.getByLabel('Lane 1', { exact: true }).selectOption('18');
    await modal.getByLabel('Lane 2', { exact: true }).selectOption('25');
    await modal.getByRole('button', { name: 'Add competition', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('Ending time must be after');
    await modal.getByLabel('Ending time').fill('17:00');
    await modal.getByRole('button', { name: 'Add competition', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeFocused();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(rangeName);
  }
  await page.reload();
  await expect(page.locator('tbody tr th')).toHaveText([
    'Morning browser competition',
    'Afternoon browser competition',
    'Later browser competition',
  ]);
  await expect(page.getByRole('row', { name: /Morning browser competition/ })).toContainText(rangeName);
});

test('modal cancels, resets assignments when changing range, and keeps input after failed saves', async ({
  page,
  request,
}) => {
  const other = await request.post('/api/v1/admin/ranges', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Other competition range', supportedDistancesMeters: [50], lanes: [{ number: 3 }] },
  });
  const otherId = (await other.json()).id;
  const add = page.getByRole('button', { name: 'Add', exact: true });
  const modal = page.getByRole('dialog', { name: 'Add competition' });
  await add.click();
  await modal.getByRole('heading', { name: 'Add competition', exact: true }).click();
  await expect(modal).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(modal).not.toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await add.click();
  await modal.getByLabel('Name', { exact: true }).fill('Keep my input');
  await modal.getByLabel('Date', { exact: true }).fill('2026-11-03');
  await modal.getByLabel('Starting time').fill('09:00');
  await modal.getByLabel('Ending time').fill('12:00');
  await modal.getByLabel('Range', { exact: true }).selectOption(rangeId);
  await modal.getByLabel('Lane 1', { exact: true }).selectOption('18');
  await modal.getByLabel('Range', { exact: true }).selectOption(otherId);
  await expect(modal.getByLabel('Lane 1', { exact: true })).not.toBeVisible();
  await modal.getByRole('button', { name: 'Add competition', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('at least one lane');
  await modal.getByLabel('Lane 3', { exact: true }).selectOption('50');
  await page.route('**/api/v1/admin/competitions', (route) => route.fulfill({ status: 500, json: {} }));
  await modal.getByRole('button', { name: 'Add competition', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Could not save');
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('Keep my input');
  await expect(modal.getByLabel('Lane 3', { exact: true })).toHaveValue('50');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).not.toBeVisible();
});

test('competition details load lanes separately and persist target configuration', async ({ page, request }) => {
  const rangeResponse = await request.get('/api/v1/admin/ranges', { headers: { Authorization: `Bearer ${token}` } });
  const range = (await rangeResponse.json()).find((value: { id: string }) => value.id === rangeId);
  const created = await request.post('/api/v1/admin/competitions', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Detail browser competition',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId,
      lanes: [
        { laneId: range.lanes[0].id, distanceMeters: 18 },
        { laneId: range.lanes[1].id, distanceMeters: 25 },
      ],
    },
  });
  const competition = await created.json();
  await page.reload();
  await page.route(`**/api/v1/admin/competitions/${competition.id}/lanes`, (route) =>
    route.fulfill({ status: 500, json: {} }),
  );
  await page.getByRole('link', { name: 'Detail browser competition', exact: true }).click();
  await expect(page).toHaveURL(`/admin/competitions/${competition.id}`);
  const details = page.getByRole('region', { name: 'Details', exact: true });
  await expect(details).toContainText('2026-12-01');
  await expect(details).toContainText('09:00');
  await expect(details).toContainText('12:00');
  await expect(details).toContainText(rangeName);
  await expect(details.locator('.competition-status-badge')).toHaveText('Scheduled');
  await expect(details.getByText('10', { exact: true })).toBeVisible();
  await expect(details.getByText('3', { exact: true })).toBeVisible();
  const lanes = page.getByRole('region', { name: 'Lanes', exact: true });
  await expect(lanes.getByRole('alert')).toContainText('Could not load lane configuration');
  await page.unroute(`**/api/v1/admin/competitions/${competition.id}/lanes`);
  await lanes.getByRole('button', { name: 'Try again' }).click();
  const lane = page.getByRole('row', { name: 'Lane 1 configuration' });
  await expect(lane.getByLabel('Target type')).toHaveValue('');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('1');
  await expect(lanes.getByRole('columnheader')).toHaveText([
    '',
    'Lane',
    'Distance',
    'Target type',
    'Number of targets',
  ]);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const immediateSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/competitions/${competition.id}/lanes/${range.lanes[0].id}`),
  );
  await lane.getByLabel('Target type').selectOption('Dutch Target 40 cm (3-spot)');
  // Saving must work while browser timers are paused.
  expect((await immediateSave).ok()).toBeTruthy();
  await page.clock.resume();
  await lane.getByLabel('Number of targets').selectOption('2');
  await expect(lane.getByRole('button', { name: 'Save lane' })).toHaveCount(0);
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(lane.getByLabel('Target type')).toHaveValue('Dutch Target 40 cm (3-spot)');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('2');
  const laneUrl = `**/api/v1/admin/competitions/${competition.id}/lanes/${range.lanes[0].id}`;
  let releaseSave!: () => void;
  let saveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    saveStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let firstSave = true;
  const queuedChanges: { targetType: string; numberOfTargets: number }[] = [];
  await page.route(laneUrl, async (route) => {
    queuedChanges.push(route.request().postDataJSON());
    if (firstSave) {
      firstSave = false;
      saveStarted();
      await release;
    }
    await route.continue();
  });
  await lane.getByLabel('Target type').selectOption('60 cm blazoen (10-rings)');
  await started;
  await expect(lane.getByLabel('Target type')).toBeEnabled();
  await lane.getByLabel('Target type').selectOption('80 cm blazoen (10-rings)');
  await lane.getByLabel('Number of targets').selectOption('2');
  releaseSave();
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  expect(queuedChanges).toEqual([
    { targetType: '60 cm blazoen (10-rings)', numberOfTargets: 2 },
    { targetType: '80 cm blazoen (10-rings)', numberOfTargets: 2 },
    { targetType: '80 cm blazoen (10-rings)', numberOfTargets: 2 },
  ]);
  await page.reload();
  await expect(lane.getByLabel('Target type')).toHaveValue('80 cm blazoen (10-rings)');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('2');
  await page.unroute(laneUrl);
  await page.route(laneUrl, (route) => route.fulfill({ status: 500, json: {} }));
  await lane.getByLabel('Number of targets').selectOption('1');
  await expect(lane.getByRole('alert')).toContainText('Could not save');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('1');
  await page.unroute(laneUrl);
  await lane.getByRole('button', { name: 'Try again' }).click();
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(lane.getByLabel('Number of targets')).toHaveValue('1');
  await lane.getByLabel('Number of targets').selectOption('1');
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(lane.getByLabel('Number of targets')).toHaveValue('1');
  const secondLane = page.getByRole('row', { name: 'Lane 2 configuration', exact: true });
  await expect(lane.getByLabel('Number of targets').locator('option')).toHaveText(['1', '2']);
  const bulk = lanes.getByRole('group', { name: 'Edit selected lanes', exact: true });
  const selectAll = lanes.getByRole('checkbox', { name: 'Select all lanes', exact: true });
  await expect(bulk).toHaveCount(0);
  await expect(lanes.getByRole('button', { name: /Set all lanes/ })).toHaveCount(0);
  await lane.getByRole('checkbox', { name: 'Select lane 1', exact: true }).check();
  await expect(bulk).toContainText('Apply to selection');
  await expect(selectAll).toHaveJSProperty('indeterminate', true);
  await bulk.getByLabel('Target type for selected lanes').selectOption({ label: 'Dutch Target 40 cm (3-spot)' });
  await bulk.getByLabel('Number of targets for selected lanes').selectOption('1');
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  await expect(lane.getByLabel('Target type')).toHaveValue('Dutch Target 40 cm (3-spot)');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('1');
  await expect(secondLane.getByLabel('Target type')).toHaveValue('');
  await expect(secondLane.getByLabel('Number of targets')).toHaveValue('1');
  // Selecting another lane must not replay the previous bulk changes.
  await secondLane.getByRole('checkbox', { name: 'Select lane 2', exact: true }).check();
  await expect(selectAll).toBeChecked();
  await expect(selectAll).toHaveJSProperty('indeterminate', false);
  await expect(secondLane.getByLabel('Number of targets')).toHaveValue('1');
  await selectAll.uncheck();
  await expect(bulk).toHaveCount(0);
  await expect(lane.getByRole('checkbox')).not.toBeChecked();
  await expect(secondLane.getByRole('checkbox')).not.toBeChecked();
  await selectAll.check();
  await bulk.getByLabel('Target type for selected lanes').selectOption({ label: '60 cm blazoen (10-rings)' });
  for (const count of [1, 2]) {
    await bulk.getByLabel('Number of targets for selected lanes').selectOption(String(count));
    for (const row of [lane, secondLane]) {
      await expect(row.getByLabel('Number of targets', { exact: true })).toHaveValue(String(count));
      await expect(row).toHaveAttribute('aria-busy', 'false');
    }
  }
  await page.reload();
  for (const row of [lane, secondLane]) {
    await expect(row.getByLabel('Number of targets')).toHaveValue('2');
    await expect(row.getByLabel('Target type')).toHaveValue('60 cm blazoen (10-rings)');
  }
  await expect(bulk).toHaveCount(0);
  await lane.getByRole('checkbox').check();
  await bulk.getByLabel('Target type for selected lanes').selectOption({ label: 'Not configured' });
  await expect(lane).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(lane.getByLabel('Target type')).toHaveValue('');
  await expect(secondLane.getByLabel('Target type')).toHaveValue('60 cm blazoen (10-rings)');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('2');
  const participants = page.getByRole('region', { name: 'Participants', exact: true });
  for (const name of ['#', 'Name', 'Club', 'Bow type', 'Target']) {
    await expect(participants.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(participants).toContainText('No participants yet.');
  await page.getByRole('link', { name: 'Competitions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await page.goto('/admin/competitions/missing');
  await expect(page.getByRole('alert')).toHaveText('Competition not found.');
});

test('competition flow starts in Scheduled, handles a failed update and advances through Closed', async ({
  page,
  request,
}) => {
  const range = (
    await (await request.get('/api/v1/admin/ranges', { headers: { Authorization: `Bearer ${token}` } })).json()
  ).find((value: { id: string }) => value.id === rangeId);
  const created = await request.post('/api/v1/admin/competitions', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Flow browser competition',
      date: '2026-12-03',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId,
      lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
    },
  });
  const competition = await created.json();
  expect(competition.status).toBe('Scheduled');
  const configured = await request.put(`/api/v1/admin/competitions/${competition.id}/lanes/${range.lanes[0].id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { targetType: '40 cm', numberOfTargets: 1 },
  });
  expect(configured.ok()).toBe(true);
  await page.goto(`/admin/competitions/${competition.id}`);
  const flow = page.getByRole('region', { name: 'Competition flow', exact: true });
  const details = page.getByRole('region', { name: 'Details', exact: true });
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  await expect(details.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await expect(flow.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to competitions' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: competition.name, exact: true })).toHaveCount(0);
  const statusUrl = `**/api/v1/admin/competitions/${competition.id}/status`;
  await page.route(statusUrl, (route) => route.fulfill({ status: 500, json: { message: 'Could not update status.' } }));
  await details.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  await page.unroute(statusUrl);
  for (const [status, label] of [
    ['Check-in', 'Start check-in'],
    ['Active', 'Start competition'],
    ['Closed', 'End competition'],
  ]) {
    if (status === 'Active' || status === 'Closed') page.once('dialog', (dialog) => dialog.accept());
    await details.getByRole('button', { name: label, exact: true }).click();
    await expect(flow.locator('[aria-current="step"]')).toContainText(status);
    await expect(flow.getByRole('button')).toHaveCount(['Check-in', 'Active', 'Closed'].indexOf(status) + 1);
    await expect(flow.getByRole('button', { name: `Move back to ${status}`, exact: true })).toHaveCount(0);
    await page.reload();
    await expect(flow.locator('[aria-current="step"]')).toContainText(status);
    await expect(details.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(status === 'Closed' ? 1 : 0);
  }
  await expect(details.getByRole('button')).toHaveCount(1);
  await expect(details.getByRole('button')).toHaveAccessibleName('Remove');
  await page.goto('/admin/competitions');
  await expect(page.getByRole('row', { name: /Flow browser competition/ })).toContainText('Closed');
  await page.goto(`/admin/competitions/${competition.id}`);
  await expect(flow.getByRole('button')).toHaveCount(3);
  await page.route(statusUrl, (route) => route.fulfill({ status: 500, json: { message: 'Could not update status.' } }));
  await flow.getByRole('button', { name: 'Move back to Active', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await expect(flow.locator('[aria-current="step"]')).toContainText('Closed');
  await page.unroute(statusUrl);
  const scheduled = flow.getByRole('button', { name: 'Move back to Scheduled', exact: true });
  await scheduled.focus();
  await scheduled.press('Enter');
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  await expect(flow.getByRole('button')).toHaveCount(0);
  await page.reload();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  await details.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Check-in');
  await flow.getByRole('button', { name: 'Move back to Scheduled', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
});

for (const allCheckedIn of [true, false]) {
  test(`starting a competition confirms participant locking with allCheckedIn=${allCheckedIn}`, async ({ page }) => {
    const competition = {
      id: 'start-confirmation',
      name: 'Start confirmation',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      status: 'Check-in',
      range: { id: 'range', name: 'Range' },
    };
    const base = '**/api/v1/admin/competitions/start-confirmation';
    await page.route(base, (route) => route.fulfill({ json: competition }));
    await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A'] }));
    await page.route(`${base}/lanes`, (route) =>
      route.fulfill({
        json: [{ laneId: 'lane', number: 1, distanceMeters: 18, targetType: 'Face A', numberOfTargets: 1 }],
      }),
    );
    await page.route(`${base}/participants`, (route) =>
      route.fulfill({
        json: [
          {
            id: '1',
            name: 'Checked-in archer',
            federationNumber: '1',
            clubNumber: '1',
            clubName: 'Club',
            bowType: 'Recurve',
            targetType: 'Face A',
            checkedIn: true,
          },
          {
            id: '2',
            name: 'Second archer',
            federationNumber: '2',
            clubNumber: '1',
            clubName: 'Club',
            bowType: 'Recurve',
            targetType: 'Face A',
            checkedIn: allCheckedIn,
          },
        ],
      }),
    );
    let statusRequests = 0;
    await page.route(`${base}/status`, (route) => {
      statusRequests++;
      expect(route.request().postDataJSON()).toEqual({ status: 'Active' });
      competition.status = 'Active';
      return route.fulfill({ json: competition });
    });
    await page.goto('/admin/competitions/start-confirmation');
    const start = page.getByRole('button', { name: 'Start competition', exact: true });
    const flow = page.getByRole('region', { name: 'Competition flow', exact: true });
    for (const accept of [false, true]) {
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Starting the competition will lock the competition participants.');
        if (allCheckedIn) expect(dialog.message()).not.toContain('Warning:');
        else expect(dialog.message()).toContain('Warning: Not all participants are checked in.');
        if (accept) await dialog.accept();
        else await dialog.dismiss();
      });
      await start.click();
      await expect(flow.locator('[aria-current="step"]')).toContainText(accept ? 'Active' : 'Check-in');
      expect(statusRequests).toBe(accept ? 1 : 0);
    }
  });
}

for (const enteredRounds of [0, 1, 2]) {
  test(`closing a competition checks current scores with ${enteredRounds} submitted rounds`, async ({ page }) => {
    const competition = {
      id: 'close-confirmation',
      name: 'Close confirmation',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      numberOfRounds: 2,
      arrowsPerRound: 3,
      status: 'Active',
      range: { id: 'range', name: 'Range' },
    };
    const base = '**/api/v1/admin/competitions/close-confirmation';
    await page.route(base, (route) => route.fulfill({ json: competition }));
    await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A'] }));
    await page.route(`${base}/lanes`, (route) =>
      route.fulfill({
        json: [{ laneId: 'lane', number: 1, distanceMeters: 18, targetType: 'Face A', numberOfTargets: 1 }],
      }),
    );
    await page.route(`${base}/participants`, (route) => route.fulfill({ json: [] }));
    let standingsRequests = 0;
    let failCheck = true;
    await page.route(`${base}/scoring-standings`, (route) => {
      standingsRequests++;
      return failCheck
        ? route.fulfill({ status: 500, json: {} })
        : route.fulfill({
            json: [
              { checkedIn: true, enteredRounds: 2, totalRounds: 2 },
              { checkedIn: true, enteredRounds, totalRounds: 2 },
              { checkedIn: false, enteredRounds: 0, totalRounds: 2 },
            ].map((standing, index) => ({
              ...standing,
              participantId: String(index),
              name: `Archer ${index}`,
              totalScore: 0,
              averageScore: 0,
              lastArrows: [],
            })),
          });
    });
    let statusRequests = 0;
    await page.route(`${base}/status`, (route) => {
      statusRequests++;
      expect(route.request().postDataJSON()).toEqual({ status: 'Closed' });
      competition.status = 'Closed';
      return route.fulfill({ json: competition });
    });
    await page.goto('/admin/competitions/close-confirmation');
    const end = page.getByRole('button', { name: 'End competition', exact: true });
    const flow = page.getByRole('region', { name: 'Competition flow', exact: true });
    await expect(end).toBeEnabled();
    await end.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Could not check whether all rounds' })).toBeVisible();
    expect(statusRequests).toBe(0);
    failCheck = false;
    for (const accept of [false, true]) {
      const previousStandingsRequests = standingsRequests;
      const dialogPromise = page.waitForEvent('dialog').then(async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Closing the competition will lock all scores');
        if (enteredRounds < 2)
          expect(dialog.message()).toContain(
            'Warning: Not all checked-in participants have submitted scores for every round.',
          );
        else expect(dialog.message()).not.toContain('Warning:');
        if (accept) await dialog.accept();
        else await dialog.dismiss();
      });
      await end.click();
      await dialogPromise;
      expect(standingsRequests).toBeGreaterThan(previousStandingsRequests);
      await expect(flow.locator('[aria-current="step"]')).toContainText(accept ? 'Closed' : 'Active');
      if (!accept) await expect(end).toBeEnabled();
      expect(statusRequests).toBe(accept ? 1 : 0);
    }
  });
}

test('warnings below the flow follow lane edits, participant target changes and removals', async ({ page }) => {
  const competition = {
    id: 'warnings',
    name: 'Warnings competition',
    date: '2026-12-01',
    startingTime: '09:00',
    endingTime: '12:00',
    status: 'Scheduled',
    range: { id: 'range', name: 'Range' },
  };
  const lanes = [
    { laneId: 'lane', number: 1, distanceMeters: 18, targetType: null as string | null, numberOfTargets: 0 },
  ];
  let people = Array.from({ length: 4 }, (_, index) => ({
    id: String(index),
    name: `Archer ${index}`,
    federationNumber: String(index),
    clubNumber: '1',
    clubName: 'Club',
    bowType: index === 3 ? null : 'Recurve',
    targetType: index === 3 ? null : 'Face A',
  }));
  await page.route('**/api/v1/admin/competitions/warnings', (route) => route.fulfill({ json: competition }));
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A', 'Face B'] }));
  await page.route('**/api/v1/admin/competitions/warnings/lanes', (route) => route.fulfill({ json: lanes }));
  await page.route('**/api/v1/admin/competitions/warnings/lanes/lane', (route) =>
    route.fulfill({ json: { ...lanes[0], ...route.request().postDataJSON() } }),
  );
  await page.route('**/api/v1/admin/competitions/warnings/participants', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      people = people.map((person) =>
        body.participantIds.includes(person.id) ? { ...person, targetType: body.targetType } : person,
      );
      await route.fulfill({ json: { updatedParticipantIds: body.participantIds, targetType: body.targetType } });
    } else if (route.request().method() === 'DELETE') {
      const ids = route.request().postDataJSON().participantIds;
      people = people.filter((person) => !ids.includes(person.id));
      await route.fulfill({ json: { removedParticipantIds: ids } });
    } else await route.fulfill({ json: people });
  });
  let statusRequests = 0;
  await page.route('**/api/v1/admin/competitions/warnings/status', (route) => {
    statusRequests++;
    return route.fulfill({ json: { ...competition, status: route.request().postDataJSON().status } });
  });
  await page.goto('/admin/competitions/warnings');
  const warnings = page.getByRole('region', { name: 'Competition warnings', exact: true });
  await expect(warnings).toContainText('All participants must have a selected target.');
  await expect(warnings).toContainText('All participants must have a selected bow type.');
  await expect(warnings).toContainText('Lane 1 must have at least 1 target.');
  await expect(warnings).toContainText('Lane 1 must have a selected target type.');
  await expect(warnings).toContainText('Not enough targets. Participants: 4; targets required: 2; configured: 0');
  await expect(warnings).toContainText('Face A: participants: 3; targets required: 2; configured: 0');
  const flow = page.getByRole('region', { name: 'Competition flow', exact: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('alert');
    expect(dialog.message()).toBe('All warnings must be resolved before transitioning to the next phase.');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  expect(statusRequests).toBe(0);

  expect(
    await warnings.evaluate(
      (element) =>
        !!(
          document.querySelector('.competition-flow-strip')!.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
  ).toBe(true);
  const lane = page.getByRole('row', { name: 'Lane 1 configuration', exact: true });
  await lane.getByLabel('Target type', { exact: true }).selectOption('Face B');
  await lane.getByLabel('Number of targets', { exact: true }).selectOption('2');
  await expect(warnings).not.toContainText('Lane 1 must');
  await expect(warnings).not.toContainText('Not enough targets.');
  await expect(warnings).toContainText('configured: 0');
  await lane.getByLabel('Target type', { exact: true }).selectOption('Face A');
  await lane.getByLabel('Number of targets', { exact: true }).selectOption('1');
  await expect(warnings).toContainText('Not enough targets. Participants: 4; targets required: 2; configured: 1');
  await expect(warnings).toContainText('configured: 1');
  await lane.getByLabel('Number of targets', { exact: true }).selectOption('2');
  await expect(warnings).not.toContainText('Not enough targets.');
  await expect(warnings).not.toContainText('Face A:');
  const participants = page.getByRole('region', { name: 'Participants', exact: true });
  await participants.getByRole('checkbox', { name: 'Select participant Archer 3 (3)', exact: true }).check();
  await participants.getByLabel('Target for selected participants').selectOption(JSON.stringify('Face A'));
  await expect(warnings).not.toContainText('All participants must have a selected target.');
  await expect(warnings).toContainText('All participants must have a selected bow type.');
  page.once('dialog', (dialog) => dialog.accept());
  await participants.getByRole('button', { name: 'Unregister', exact: true }).click();
  await expect(warnings).toHaveCount(0);
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Check-in');
  expect(statusRequests).toBe(1);
  // Lane configuration is locked during Check-in. Return to setup before editing it.
  await flow.getByRole('button', { name: 'Move back to Scheduled', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  expect(statusRequests).toBe(2);
  await lane.getByLabel('Target type', { exact: true }).selectOption('');
  await expect(warnings).toContainText('Lane 1 must have a selected target type.');
  await expect(warnings).toContainText('configured: 0');
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('alert');
    expect(dialog.message()).toContain('All warnings must be resolved');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  expect(statusRequests).toBe(2);
});

test('check-in controls persist, show assignments and refresh after reassignment', async ({ page }) => {
  const competition = {
    id: 'assignments',
    name: 'Shooting assignments',
    date: '2026-12-01',
    startingTime: '09:00',
    endingTime: '12:00',
    status: 'Scheduled',
    range: { id: 'range', name: 'Range' },
  };
  const lanes = [{ laneId: 'lane', number: 1, distanceMeters: 18, targetType: 'Face A', numberOfTargets: 2 }];
  let people = Array.from({ length: 2 }, (_, index) => ({
    id: String(index),
    name: `Shooter ${index}`,
    federationNumber: String(index),
    clubNumber: '1',
    clubName: 'Club',
    bowType: 'Recurve',
    targetType: 'Face A',
    checkedIn: false,
    laneId: null as string | null,
    targetLetter: null as string | null,
  }));
  const base = '**/api/v1/admin/competitions/assignments';
  await page.route(base, (route) => route.fulfill({ json: competition }));
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A'] }));
  await page.route(`${base}/lanes`, (route) => route.fulfill({ json: lanes }));
  await page.route(`${base}/participants`, (route) => route.fulfill({ json: people }));
  await page.route(`${base}/status`, (route) => {
    competition.status = route.request().postDataJSON().status;
    if (competition.status === 'Check-in')
      people = people.map((p, i) => ({ ...p, laneId: 'lane', targetLetter: i ? 'B' : 'A' }));
    return route.fulfill({ json: competition });
  });
  let failCheckIn = true;
  await page.route(`${base}/participants/*/check-in`, (route) => {
    if (failCheckIn) return route.fulfill({ status: 500, json: { message: 'Check-in failed.' } });
    const id = route.request().url().split('/').at(-2)!;
    const { checkedIn } = route.request().postDataJSON();
    people = people.map((p) => (p.id === id ? { ...p, checkedIn } : p));
    return route.fulfill({ json: { checkedIn } });
  });
  let failReassign = true;
  let reassignRequests = 0;
  await page.route(`${base}/assignments/reassign`, (route) => {
    reassignRequests++;
    if (failReassign) return route.fulfill({ status: 500, json: { message: 'Reassignment failed.' } });
    people = people.map((p) => ({ ...p, laneId: p.checkedIn ? 'lane' : null, targetLetter: p.checkedIn ? 'A' : null }));
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/competitions/assignments');
  const section = page.getByRole('region', { name: 'Participants', exact: true });
  const checkIn = section.getByRole('checkbox', { name: 'Check in Shooter 0 (0)', exact: true });
  const reassign = section.getByRole('button', { name: 'Reassign checked-in participants', exact: true });
  const filter = section.getByRole('searchbox', { name: 'Filter participants', exact: true });
  await expect(filter).toHaveCount(0);
  await expect(checkIn).toHaveCount(0);
  await expect(section.getByRole('columnheader', { name: 'Assignment', exact: true })).toHaveCount(0);
  await expect(section.getByRole('columnheader', { name: 'Check-in', exact: true })).toHaveCount(0);
  await expect(reassign).toHaveCount(0);
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(section.getByRole('row', { name: /Shooter 0/ })).toContainText('Lane 1 A');
  await expect(section.getByRole('row', { name: /Shooter 1/ })).toContainText('Lane 1 B');
  await expect(reassign).toBeDisabled();
  await filter.fill('  sHoOtEr 0  ');
  await expect(section.getByRole('row', { name: /Shooter 0/ })).toBeVisible();
  await expect(section.getByRole('row', { name: /Shooter 1/ })).toHaveCount(0);
  await checkIn.click();
  await expect(section.getByRole('alert')).toHaveText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await expect(checkIn).not.toBeChecked();
  failCheckIn = false;
  await checkIn.click();
  await expect(checkIn).toBeChecked();
  await filter.fill('missing participant');
  await expect(section).toContainText('No matching participants.');
  await expect(reassign).toBeEnabled();
  await filter.fill('1');
  await expect(section.getByRole('row', { name: /Shooter 1/ })).toBeVisible();
  await filter.fill('CLUB');
  await expect(section.getByRole('row', { name: /Shooter/ })).toHaveCount(2);
  await filter.fill('');
  await expect(checkIn).toBeChecked();
  await page.reload();
  await expect(checkIn).toBeChecked();
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('overwrite all existing assignments for checked-in participants');
    await dialog.dismiss();
  });
  await reassign.click();
  expect(reassignRequests).toBe(0);
  await expect(section.getByRole('row', { name: /Shooter 1/ })).toContainText('Lane 1 B');
  page.once('dialog', (dialog) => dialog.accept());
  await reassign.click();
  await expect(section.getByRole('alert')).toHaveText(
    'Something went wrong. Check your input and connection and try again.',
  );
  await expect(section.getByRole('row', { name: /Shooter 1/ })).toContainText('Lane 1 B');
  failReassign = false;
  page.once('dialog', (dialog) => dialog.accept());
  await reassign.click();
  await expect(section.getByRole('row', { name: /Shooter 1/ })).not.toContainText('Lane 1 B');
  await expect(section.getByRole('row', { name: /Shooter 0/ })).toContainText('Lane 1 A');
  await expect(checkIn).toBeChecked();
  for (const status of ['Active', 'Closed']) {
    competition.status = status;
    await page.reload();
    if (status === 'Active') await section.getByRole('button', { name: 'Expand: participants', exact: true }).click();
    await expect(section.getByRole('row', { name: /Shooter 0/ })).toBeVisible();
    await expect(checkIn).toHaveCount(0);
    await expect(reassign).toHaveCount(0);
    await expect(filter).toHaveCount(0);
    await expect(section.getByRole('columnheader', { name: 'Assignment', exact: true })).toHaveCount(0);
    await expect(section.getByRole('columnheader', { name: 'Check-in', exact: true })).toHaveCount(0);
  }
});

test('competition default initializes lanes and participant targets while allowing individual overrides', async ({
  page,
  request,
}) => {
  const token = testAdminToken();
  const headers = { Authorization: `Bearer ${token}` };
  for (const name of ['Browser default face', 'Browser override face']) {
    expect((await request.post('/api/v1/admin/target-types', { headers, data: { name } })).ok()).toBeTruthy();
  }
  const range = await (
    await request.post('/api/v1/admin/ranges', {
      headers,
      data: {
        name: 'Default target browser range',
        supportedDistancesMeters: [18],
        lanes: [{ number: 1 }, { number: 2 }],
      },
    })
  ).json();
  const bows = (await (await request.get('/api/v1/admin/bow-types', { headers })).json()) as string[];
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto('/admin/competitions');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Add competition' });
  await create.getByLabel('Name', { exact: true }).fill('Browser default target competition');
  await create.getByLabel('Date', { exact: true }).fill('2026-12-01');
  await create.getByLabel('Starting time').fill('09:00');
  await create.getByLabel('Ending time').fill('12:00');
  await create.getByLabel('Default target', { exact: true }).selectOption('Browser default face');
  await create.getByLabel('Range', { exact: true }).selectOption(range.id);
  await create.getByRole('button', { name: 'Set all lanes to 18 m', exact: true }).click();
  await create.getByRole('button', { name: 'Add competition', exact: true }).click();
  await page.getByRole('link', { name: 'Browser default target competition', exact: true }).click();
  await page.reload();
  const lane1 = page.getByRole('row', { name: 'Lane 1 configuration' });
  const lane2 = page.getByRole('row', { name: 'Lane 2 configuration' });
  await expect(lane1.getByLabel('Target type', { exact: true })).toHaveValue('Browser default face');
  await expect(lane2.getByLabel('Target type', { exact: true })).toHaveValue('Browser default face');
  await lane1.getByLabel('Target type', { exact: true }).selectOption('Browser override face');
  await expect(lane1).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(lane1.getByLabel('Target type', { exact: true })).toHaveValue('Browser override face');
  await expect(lane2.getByLabel('Target type', { exact: true })).toHaveValue('Browser default face');

  const participants = page.getByRole('region', { name: 'Participants', exact: true });
  await participants.getByRole('button', { name: 'Add participant', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add participant', exact: true });
  for (const [index, target] of ['Browser default face', 'Browser override face'].entries()) {
    await expect(modal.getByLabel('Target', { exact: true })).toHaveValue('Browser default face');
    await modal
      .getByRole('combobox', { name: 'Search by name or federation number' })
      .fill(`Default browser archer ${index}`);
    await modal.getByRole('option', { name: 'New participant', exact: true }).click();
    await expect(modal.getByLabel('Target', { exact: true })).toHaveValue('Browser default face');
    await modal.getByLabel('Federation number', { exact: true }).fill(`default-browser-${index}`);
    await modal.getByRole('combobox', { name: 'Search by club name or number' }).fill('e2e-club');
    await modal.getByRole('option', { name: 'Browser test club (e2e-club)', exact: true }).click();
    await modal.getByRole('combobox', { name: 'Bow type', exact: true }).selectOption(bows[0]!);
    if (index === 1) await modal.getByLabel('Target', { exact: true }).selectOption(target);
    await modal.getByRole('button', { name: 'Add participant', exact: true }).click();
    await expect(modal.getByRole('status')).toContainText(`Default browser archer ${index} added.`);
  }
  await expect(modal.getByLabel('Target', { exact: true })).toHaveValue('Browser default face');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(participants.getByRole('row').filter({ hasText: 'Default browser archer 0' })).toContainText(
    'Browser default face',
  );
  await expect(participants.getByRole('row').filter({ hasText: 'Default browser archer 1' })).toContainText(
    'Browser override face',
  );
  await participants.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(modal.getByLabel('Target', { exact: true })).toHaveValue('Browser default face');
});
