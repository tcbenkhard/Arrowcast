import { expect, test } from '@playwright/test';

let token: string;
let rangeId: string;
const rangeName = 'Competition browser range';

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/v1/auth/login', { data: { username: 'admin', password: 'admin' } });
  token = (await login.json()).token;
  const range = await request.post('/api/v1/admin/ranges', { headers: { Authorization: `Bearer ${token}` },
    data: { name: rangeName, supportedDistancesMeters: [18, 25], lanes: [{ number: 1 }, { number: 2 }] } });
  rangeId = (await range.json()).id;
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Competitions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
});

test('create competitions, validate times, select lane distances and preserve chronological order after reload', async ({ page }) => {
  for (const [name, date, start] of [['Later browser competition', '2026-11-02', '09:00'],
    ['Afternoon browser competition', '2026-11-01', '13:00'], ['Morning browser competition', '2026-11-01', '09:00']]) {
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
    'Morning browser competition', 'Afternoon browser competition', 'Later browser competition',
  ]);
  await expect(page.getByRole('row', { name: /Morning browser competition/ })).toContainText(rangeName);
});

test('modal cancels, resets assignments when changing range, and keeps input after failed saves', async ({ page, request }) => {
  const other = await request.post('/api/v1/admin/ranges', { headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Other competition range', supportedDistancesMeters: [50], lanes: [{ number: 3 }] } });
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
  const created = await request.post('/api/v1/admin/competitions', { headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Detail browser competition', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00', rangeId,
      lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }, { laneId: range.lanes[1].id, distanceMeters: 25 }] } });
  const competition = await created.json();
  await page.reload();
  await page.route(`**/api/v1/admin/competitions/${competition.id}/lanes`, (route) => route.fulfill({ status: 500, json: {} }));
  await page.getByRole('link', { name: 'Detail browser competition', exact: true }).click();
  await expect(page).toHaveURL(`/admin/competitions/${competition.id}`);
  const details = page.getByRole('region', { name: 'Details', exact: true });
  await expect(details).toContainText('2026-12-01');
  await expect(details).toContainText('09:00');
  await expect(details).toContainText('12:00');
  await expect(details).toContainText(rangeName);
  await expect(details.locator('dd').last()).toHaveText('Scheduled');
  const lanes = page.getByRole('region', { name: 'Lanes', exact: true });
  await expect(lanes.getByRole('alert')).toContainText('Could not load lane configuration');
  await page.unroute(`**/api/v1/admin/competitions/${competition.id}/lanes`);
  await lanes.getByRole('button', { name: 'Try again' }).click();
  const lane = page.getByRole('row', { name: 'Lane 1 configuration' });
  await expect(lane.getByLabel('Target type')).toHaveValue('');
  await expect(lane.getByLabel('Number of targets')).toHaveValue('1');
  await expect(lanes.getByRole('columnheader')).toHaveText(['Select all', 'Lane', 'Distance', 'Target type', 'Number of targets']);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const immediateSave = page.waitForResponse((response) => response.request().method() === 'PUT'
    && response.url().endsWith(`/competitions/${competition.id}/lanes/${range.lanes[0].id}`));
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
  const started = new Promise<void>((resolve) => { saveStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseSave = resolve; });
  let firstSave = true;
  const queuedChanges: { targetType: string; numberOfTargets: number }[] = [];
  await page.route(laneUrl, async (route) => {
    queuedChanges.push(route.request().postDataJSON());
    if (firstSave) { firstSave = false; saveStarted(); await release; }
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
  for (const name of ['Federation number', 'Full name', 'Club name', 'Club ID', 'Bow type']) {
    await expect(participants.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(participants).toContainText('No participants yet.');
  await page.getByRole('link', { name: 'Competitions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competitions', exact: true })).toBeVisible();
  await page.goto('/admin/competitions/missing');
  await expect(page.getByRole('alert')).toHaveText('Competition not found.');
});


test('competition flow starts in Scheduled, handles a failed update and advances through Closed', async ({ page, request }) => {
  const range = (await (await request.get('/api/v1/admin/ranges', { headers: { Authorization: `Bearer ${token}` } })).json()).find((value: { id: string }) => value.id === rangeId);
  const created = await request.post('/api/v1/admin/competitions', { headers: { Authorization: `Bearer ${token}` }, data: {
    name: 'Flow browser competition', date: '2026-12-03', startingTime: '09:00', endingTime: '12:00', rangeId,
    lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
  } });
  const competition = await created.json();
  expect(competition.status).toBe('Scheduled');
  const configured = await request.put(`/api/v1/admin/competitions/${competition.id}/lanes/${range.lanes[0].id}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { targetType: '40 cm', numberOfTargets: 1 },
  });
  expect(configured.ok()).toBe(true);
  await page.goto(`/admin/competitions/${competition.id}`);
  const flow = page.getByRole('region', { name: 'Competition flow', exact: true });
  const details = page.getByRole('region', { name: 'Details', exact: true });
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  await expect(flow.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to competitions' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: competition.name, exact: true })).toHaveCount(0);
  const statusUrl = `**/api/v1/admin/competitions/${competition.id}/status`;
  await page.route(statusUrl, (route) => route.fulfill({ status: 500, json: { message: 'Could not update status.' } }));
  await details.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Could not update status.');
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  await page.unroute(statusUrl);
  for (const [status, label] of [['Check-in', 'Start check-in'], ['Active', 'Start competition'], ['Closed', 'End competition']]) {
    if (status === 'Active') page.once('dialog', (dialog) => dialog.accept());
    await details.getByRole('button', { name: label, exact: true }).click();
    await expect(flow.locator('[aria-current="step"]')).toContainText(status);
    await expect(flow.getByRole('button')).toHaveCount(['Check-in', 'Active', 'Closed'].indexOf(status) + 1);
    await expect(flow.getByRole('button', { name: `Move back to ${status}`, exact: true })).toHaveCount(0);
    await page.reload();
    await expect(flow.locator('[aria-current="step"]')).toContainText(status);
  }
  await expect(details.getByRole('button')).toHaveCount(0);
  await page.goto('/admin/competitions');
  await expect(page.getByRole('row', { name: /Flow browser competition/ })).toContainText('Closed');
  await page.goto(`/admin/competitions/${competition.id}`);
  await expect(flow.getByRole('button')).toHaveCount(3);
  await page.route(statusUrl, (route) => route.fulfill({ status: 500, json: { message: 'Could not update status.' } }));
  await flow.getByRole('button', { name: 'Move back to Active', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Could not update status.');
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
    const competition = { id: 'start-confirmation', name: 'Start confirmation', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00',
      status: 'Check-in', range: { id: 'range', name: 'Range' } };
    const base = '**/api/v1/admin/competitions/start-confirmation';
    await page.route(base, (route) => route.fulfill({ json: competition }));
    await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A'] }));
    await page.route(`${base}/lanes`, (route) => route.fulfill({ json: [
      { laneId: 'lane', number: 1, distanceMeters: 18, targetType: 'Face A', numberOfTargets: 1 },
    ] }));
    await page.route(`${base}/participants`, (route) => route.fulfill({ json: [
      { id: '1', name: 'Checked-in archer', federationNumber: '1', clubNumber: '1', clubName: 'Club', bowType: 'Recurve', targetType: 'Face A', checkedIn: true },
      { id: '2', name: 'Second archer', federationNumber: '2', clubNumber: '1', clubName: 'Club', bowType: 'Recurve', targetType: 'Face A', checkedIn: allCheckedIn },
    ] }));
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

test('warnings below the flow follow lane edits, participant target changes and removals', async ({ page }) => {
  const competition = { id: 'warnings', name: 'Warnings competition', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00',
    status: 'Scheduled', range: { id: 'range', name: 'Range' } };
  const lanes = [{ laneId: 'lane', number: 1, distanceMeters: 18, targetType: null as string | null, numberOfTargets: 0 }];
  let people = Array.from({ length: 4 }, (_, index) => ({ id: String(index), name: `Archer ${index}`, federationNumber: String(index),
    clubNumber: '1', clubName: 'Club', bowType: index === 3 ? null : 'Recurve', targetType: index === 3 ? null : 'Face A' }));
  await page.route('**/api/v1/admin/competitions/warnings', (route) => route.fulfill({ json: competition }));
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A', 'Face B'] }));
  await page.route('**/api/v1/admin/competitions/warnings/lanes', (route) => route.fulfill({ json: lanes }));
  await page.route('**/api/v1/admin/competitions/warnings/lanes/lane', (route) => route.fulfill({ json: { ...lanes[0], ...route.request().postDataJSON() } }));
  await page.route('**/api/v1/admin/competitions/warnings/participants', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      people = people.map((person) => body.participantIds.includes(person.id) ? { ...person, targetType: body.targetType } : person);
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
  await expect(warnings).toContainText('Not enough targets: 4 participants need at least 2 targets, but 0 configured');
  await expect(warnings).toContainText('Face A: 3 participants need at least 2 targets, but 0 configured');
  const flow = page.getByRole('region', { name: 'Competition flow', exact: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('alert');
    expect(dialog.message()).toBe('All warnings must be resolved before transitioning to the next phase.');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  expect(statusRequests).toBe(0);

  expect(await warnings.evaluate((element) => !!(document.querySelector('.competition-flow-strip')!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const lane = page.getByRole('row', { name: 'Lane 1 configuration', exact: true });
  await lane.getByLabel('Target type', { exact: true }).selectOption('Face B');
  await lane.getByLabel('Number of targets', { exact: true }).selectOption('2');
  await expect(warnings).not.toContainText('Lane 1 must');
  await expect(warnings).not.toContainText('Not enough targets:');
  await expect(warnings).toContainText('but 0 configured');
  await lane.getByLabel('Target type', { exact: true }).selectOption('Face A');
  await lane.getByLabel('Number of targets', { exact: true }).selectOption('1');
  await expect(warnings).toContainText('Not enough targets: 4 participants need at least 2 targets, but 1 configured');
  await expect(warnings).toContainText('but 1 configured');
  await lane.getByLabel('Number of targets', { exact: true }).selectOption('2');
  await expect(warnings).not.toContainText('Not enough targets:');
  await expect(warnings).not.toContainText('Face A:');
  const participants = page.getByRole('region', { name: 'Participants', exact: true });
  await participants.getByRole('checkbox', { name: 'Select participant Archer 3 (3)', exact: true }).check();
  await participants.getByLabel('Target for selected participants').selectOption(JSON.stringify('Face A'));
  await expect(warnings).not.toContainText('All participants must have a selected target.');
  await expect(warnings).toContainText('All participants must have a selected bow type.');
  page.once('dialog', (dialog) => dialog.accept());
  await participants.getByRole('button', { name: 'Uitschrijven', exact: true }).click();
  await expect(warnings).toHaveCount(0);
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Check-in');
  expect(statusRequests).toBe(1);
  await lane.getByLabel('Target type', { exact: true }).selectOption('');
  await expect(warnings).toContainText('Lane 1 must have a selected target type.');
  await expect(warnings).toContainText('but 0 configured');
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('alert');
    expect(dialog.message()).toContain('All warnings must be resolved');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Start competition', exact: true }).click();
  expect(statusRequests).toBe(1);
  await flow.getByRole('button', { name: 'Move back to Scheduled', exact: true }).click();
  await expect(flow.locator('[aria-current="step"]')).toContainText('Scheduled');
  expect(statusRequests).toBe(2);
});


test('check-in controls persist, show assignments and refresh after reassignment', async ({ page }) => {
  const competition = { id: 'assignments', name: 'Shooting assignments', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00',
    status: 'Scheduled', range: { id: 'range', name: 'Range' } };
  const lanes = [{ laneId: 'lane', number: 1, distanceMeters: 18, targetType: 'Face A', numberOfTargets: 2 }];
  let people = Array.from({ length: 2 }, (_, index) => ({ id: String(index), name: `Shooter ${index}`, federationNumber: String(index),
    clubNumber: '1', clubName: 'Club', bowType: 'Recurve', targetType: 'Face A', checkedIn: false,
    laneId: null as string | null, targetLetter: null as string | null }));
  const base = '**/api/v1/admin/competitions/assignments';
  await page.route(base, (route) => route.fulfill({ json: competition }));
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Face A'] }));
  await page.route(`${base}/lanes`, (route) => route.fulfill({ json: lanes }));
  await page.route(`${base}/participants`, (route) => route.fulfill({ json: people }));
  await page.route(`${base}/status`, (route) => {
    competition.status = route.request().postDataJSON().status;
    if (competition.status === 'Check-in') people = people.map((p, i) => ({ ...p, laneId: 'lane', targetLetter: i ? 'B' : 'A' }));
    return route.fulfill({ json: competition });
  });
  let failCheckIn = true;
  await page.route(`${base}/participants/*/check-in`, (route) => {
    if (failCheckIn) return route.fulfill({ status: 500, json: { message: 'Check-in failed.' } });
    const id = route.request().url().split('/').at(-2)!;
    const { checkedIn } = route.request().postDataJSON();
    people = people.map((p) => p.id === id ? { ...p, checkedIn } : p);
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
  await expect(checkIn).toHaveCount(0);
  await expect(section.getByRole('columnheader', { name: 'Assignment', exact: true })).toHaveCount(0);
  await expect(section.getByRole('columnheader', { name: 'Check-in', exact: true })).toHaveCount(0);
  await expect(reassign).toHaveCount(0);
  await page.getByRole('button', { name: 'Start check-in', exact: true }).click();
  await expect(section.getByRole('row', { name: /Shooter 0/ })).toContainText('Lane 1 A');
  await expect(section.getByRole('row', { name: /Shooter 1/ })).toContainText('Lane 1 B');
  await expect(reassign).toBeDisabled();
  await checkIn.click();
  await expect(section.getByRole('alert')).toHaveText('Check-in failed.');
  await expect(checkIn).not.toBeChecked();
  failCheckIn = false;
  await checkIn.click();
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
  await expect(section.getByRole('alert')).toHaveText('Reassignment failed.');
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
    await expect(section.getByRole('row', { name: /Shooter 0/ })).toBeVisible();
    await expect(checkIn).toHaveCount(0);
    await expect(reassign).toHaveCount(0);
    await expect(section.getByRole('columnheader', { name: 'Assignment', exact: true })).toHaveCount(0);
    await expect(section.getByRole('columnheader', { name: 'Check-in', exact: true })).toHaveCount(0);
  }
});
