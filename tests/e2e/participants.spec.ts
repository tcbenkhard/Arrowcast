import { expect, test } from './fixtures';
import { testAdminToken } from './admin';

test('creates a participant and a new club when no clubs are available in the form', async ({ page, request }) => {
  const token = testAdminToken();
  const headers = { Authorization: `Bearer ${token}` };
  const rangeResponse = await request.post('/api/v1/admin/ranges', {
    headers,
    data: { name: 'Manual club range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] },
  });
  expect(rangeResponse.ok()).toBeTruthy();
  const range = await rangeResponse.json();
  const response = await request.post('/api/v1/admin/competitions', {
    headers,
    data: {
      name: 'Manual club competition',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: range.id,
      lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const competition = await response.json();
  const targetResponse = await request.get('/api/v1/admin/target-types', { headers });
  const targets: string[] = await targetResponse.json();
  await page.route('**/api/v1/admin/clubs', (route) => route.fulfill({ json: [] }));
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto(`/admin/competitions/${competition.id}`);
  await page.getByRole('button', { name: 'Add participant', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add participant', exact: true });
  await modal.getByRole('combobox', { name: 'Search by name or federation number' }).fill('Manual Club Archer');
  await modal.getByRole('option', { name: 'New participant', exact: true }).click();
  await modal.getByLabel('Federation number', { exact: true }).fill('009876');
  await modal.getByLabel('Club number', { exact: true }).fill('0099');
  const clubName = modal.getByLabel('Club name', { exact: true });
  await expect(clubName).toBeEditable();
  await modal.getByRole('combobox', { name: 'Bow type', exact: true }).selectOption('Recurve');
  await modal.getByLabel('Target', { exact: true }).selectOption(targets[0]!);
  await modal.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(clubName).toBeFocused();
  await clubName.fill('Manual Browser Club');
  await modal.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(modal.getByRole('status')).toContainText('added.');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  const row = page.getByRole('row', { name: /Manual Club Archer/ });
  await expect(row).toContainText('Manual Browser Club');
  const clubsResponse = await request.get('/api/v1/admin/clubs', { headers });
  expect(await clubsResponse.json()).toContainEqual({ clubNumber: '0099', name: 'Manual Browser Club' });
});

test('participant modal searches, adds existing people with the keyboard and creates new participants', async ({
  page,
  request,
}) => {
  const token = testAdminToken();
  const headers = { Authorization: `Bearer ${token}` };
  const rangeResponse = await request.post('/api/v1/admin/ranges', {
    headers,
    data: { name: 'Participant range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] },
  });
  const range = await rangeResponse.json();
  const created = await request.post('/api/v1/admin/competitions', {
    headers,
    data: {
      name: 'Participant competition',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: range.id,
      lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
    },
  });
  const competition = await created.json();
  const existing = {
    id: 'existing',
    name: 'Zoë van Dijk',
    federationNumber: '000123',
    clubNumber: '0012',
    clubName: 'Testclub',
  };
  const people: (typeof existing & { bowType: string; targetType: string | null })[] = [];
  await page.route('**/api/v1/admin/target-types', (route) => route.fulfill({ json: ['Custom face'] }));
  const searches: string[] = [];
  let fail = false;
  await page.route('**/api/v1/admin/participants?*', async (route) => {
    searches.push(new URL(route.request().url()).searchParams.get('q')!);
    await route.fulfill({ json: [existing] });
  });
  await page.route('**/api/v1/admin/clubs', (route) =>
    route.fulfill({ json: [{ clubNumber: '0012', name: 'Testclub' }] }),
  );
  await page.route('**/api/v1/admin/bow-types', (route) =>
    route.fulfill({ json: ['Barebow', 'Compound', 'Longbow', 'Recurve', 'Traditional'] }),
  );
  await page.route(`**/api/v1/admin/competitions/${competition.id}/participants`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: people });
      return;
    }
    if (route.request().method() === 'PATCH') {
      if (fail) {
        await route.fulfill({ status: 500, json: {} });
        return;
      }
      const body = route.request().postDataJSON();
      for (const person of people) if (body.participantIds.includes(person.id)) person.targetType = body.targetType;
      await route.fulfill({ json: { updatedParticipantIds: body.participantIds, targetType: body.targetType } });
      return;
    }
    if (route.request().method() === 'DELETE') {
      if (fail) {
        await route.fulfill({ status: 500, json: {} });
        return;
      }
      const ids = route.request().postDataJSON().participantIds as string[];
      people.splice(0, people.length, ...people.filter((person) => !ids.includes(person.id)));
      await route.fulfill({ json: { removedParticipantIds: ids } });
      return;
    }
    if (fail) {
      await route.fulfill({
        status: 409,
        json: { message: 'This federation number already exists. Select the existing participant.' },
      });
      return;
    }
    const body = route.request().postDataJSON();
    const person = body.participantId
      ? { ...existing, bowType: body.bowType, targetType: body.targetType }
      : { id: 'new', ...body, clubName: 'Testclub' };
    people.push(person);
    await route.fulfill({ status: 201, json: person });
  });
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto(`/admin/competitions/${competition.id}`);
  const section = page.getByRole('region', { name: 'Participants', exact: true });
  const add = section.getByRole('button', { name: 'Add participant', exact: true });
  await add.click();
  const modal = page.getByRole('dialog', { name: 'Add participant', exact: true });
  const search = modal.getByRole('combobox', { name: 'Search by name or federation number' });
  const bow = modal.getByRole('combobox', { name: 'Bow type', exact: true });
  await expect(search).toBeFocused();
  await expect(modal.locator('[role="option"]')).toHaveCount(0);
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.press('Enter');
  await expect(search).toBeVisible();
  await search.fill('   ');
  await expect(modal.locator('[role="option"]')).toHaveCount(0);
  const spacing = await search.evaluate((input) => {
    const label = document.querySelector('label[for="participant-search"]')!;
    return input.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
  });
  expect(spacing).toBeGreaterThanOrEqual(12);
  await search.fill('dijk zo');
  await expect(modal.locator('[role="option"]')).toHaveCount(2);
  await expect(modal.locator('[role="option"]').first()).toHaveText('New participant');
  await expect(modal.locator('[role="option"]').nth(1)).toContainText('Zoë van Dijk');
  expect(searches).toContain('dijk zo');
  await search.press('ArrowUp');
  await expect(modal.locator('[role="option"]').first()).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowDown');
  await expect(modal.locator('[role="option"]').nth(1)).toHaveAttribute('aria-selected', 'true');
  // A long result list must follow keyboard selection while focus stays in the search field.
  await page.route('**/api/v1/admin/participants?q=scroll', (route) =>
    route.fulfill({
      json: Array.from({ length: 20 }, (_, index) => ({ ...existing, id: `scroll-${index}`, name: `Archer ${index}` })),
    }),
  );
  await search.fill('scroll');
  const suggestions = modal.getByRole('listbox', { name: 'Participant suggestions' });
  await expect(suggestions.getByRole('option')).toHaveCount(21);
  const activeIsVisible = () =>
    suggestions.evaluate((list) => {
      const selected = list.querySelector('[aria-selected="true"]')!;
      const item = selected.getBoundingClientRect();
      const viewport = list.getBoundingClientRect();
      return item.top >= viewport.top && item.bottom <= viewport.bottom;
    });
  for (let index = 0; index < 19; index++) await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'participant-option-20');
  await expect.poll(activeIsVisible).toBe(true);
  expect(await suggestions.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'participant-option-0');
  await expect.poll(activeIsVisible).toBe(true);
  await search.press('ArrowUp');
  await expect(search).toHaveAttribute('aria-activedescendant', 'participant-option-20');
  await expect.poll(activeIsVisible).toBe(true);
  for (let index = 0; index < 19; index++) await search.press('ArrowUp');
  await expect(search).toHaveAttribute('aria-activedescendant', 'participant-option-1');
  await expect.poll(activeIsVisible).toBe(true);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(modal.locator('[role="option"]')).toHaveCount(0);
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.fill('000123');
  await expect.poll(() => searches.at(-1)).toBe('000123');
  await expect(modal.locator('[role="option"]')).toHaveCount(2);
  await expect(modal.locator('[role="option"]').nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Tab');
  await expect(bow).toBeFocused();
  expect(people).toHaveLength(0);
  const modalSize = await modal.boundingBox();
  await bow.click();
  expect(await modal.boundingBox()).toEqual(modalSize);
  await bow.press('Escape');
  await bow.selectOption('Recurve');
  await expect(bow).toHaveValue('Recurve');
  expect(people).toHaveLength(0);
  await expect(modal.getByRole('listbox')).toHaveCount(0);
  await bow.press('Enter');
  expect(people).toHaveLength(0);
  await expect(modal.getByRole('button', { name: 'Add participant', exact: true })).toBeDisabled();
  await expect(modal.getByLabel('Target', { exact: true })).toHaveAttribute('required', '');
  await expect(modal.getByLabel('Target', { exact: true }).locator('option')).toHaveText([
    'Select a target',
    'Custom face',
  ]);
  await modal.getByLabel('Target', { exact: true }).selectOption('Custom face');
  await modal.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(modal).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(bow).toHaveValue('');
  await expect(modal.getByLabel('Target', { exact: true })).toHaveValue('');
  await expect(modal.locator('[role="option"]')).toHaveCount(0);
  await expect(modal.getByRole('status')).toContainText('added.');
  await search.fill('New Archer');
  await modal.getByRole('option', { name: 'New participant', exact: true }).click();
  await expect(modal.getByLabel('Full name', { exact: true })).toHaveValue('New Archer');
  await modal.getByLabel('Federation number', { exact: true }).fill('000124');
  await modal.getByLabel('Club number', { exact: true }).fill('0012');
  await expect(modal.getByLabel('Club name', { exact: true })).toHaveValue('Testclub');
  await expect(modal.getByLabel('Club name', { exact: true })).toHaveAttribute('readonly', '');
  await bow.selectOption('Compound');
  await expect(bow).toHaveValue('Compound');
  await modal.getByLabel('Target', { exact: true }).selectOption('Custom face');
  fail = true;
  await modal.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('already exists');
  await expect(modal.getByLabel('Full name', { exact: true })).toHaveValue('New Archer');
  await expect(bow).toHaveValue('Compound');
  fail = false;
  await bow.press('Enter');
  expect(people).toHaveLength(1);
  await modal.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(modal).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(section.getByRole('row', { name: /Zoë van Dijk/ })).toContainText('000123');
  await expect(section.getByRole('row', { name: /Zoë van Dijk/ })).toContainText('Recurve');
  await expect(section.getByRole('row', { name: /van Dijk/ })).toContainText('Custom face');
  await page.reload();
  await expect(section.getByRole('row', { name: /van Dijk/ })).toContainText('Custom face');
  await expect(section.getByRole('row', { name: /New Archer/ })).toContainText('000124');
  await expect(section.getByRole('row', { name: /New Archer/ })).toContainText('Compound');
  await add.click();
  await modal.getByRole('heading').click();
  await expect(modal).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(modal).not.toBeVisible();
  await expect(add).toBeFocused();
  const selectAll = section.getByRole('checkbox', { name: 'Select all participants', exact: true });
  const selectExisting = section.getByRole('checkbox', {
    name: 'Select participant Zoë van Dijk (000123)',
    exact: true,
  });
  const action = section.getByRole('button', { name: 'Unregister', exact: true });
  await expect(action).not.toBeVisible();
  await selectExisting.check();
  await expect(action).toBeVisible();
  await expect(selectAll).toHaveJSProperty('indeterminate', true);
  const targetSelection = section.getByRole('combobox', { name: 'Target for selected participants' });
  fail = true;
  await targetSelection.selectOption(JSON.stringify('Custom face'));
  await expect(section.getByRole('alert')).toContainText('Could not save the target');
  await expect(selectExisting).toBeChecked();
  fail = false;
  await targetSelection.selectOption(JSON.stringify('Custom face'));
  await expect(section.getByRole('status')).toContainText('Target updated for 1 participant.');
  expect(people.find((person) => person.id === 'new')?.targetType).toBe('Custom face');
  await selectAll.check();
  await targetSelection.selectOption(JSON.stringify('Custom face'));
  await expect(section.getByRole('status')).toContainText('Target updated for 2 participants.');
  await expect(section.getByRole('row', { name: /New Archer/ })).toContainText('Custom face');
  await page.reload();
  await expect(section.getByRole('row', { name: /New Archer/ })).toContainText('Custom face');
  await selectAll.check();
  await expect(targetSelection.locator('option')).toHaveText(['Target', 'Custom face']);
  await selectAll.uncheck();
  await selectExisting.check();
  await selectAll.check();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('2 selected participants');
    await dialog.dismiss();
  });
  await action.click();
  expect(people).toHaveLength(2);
  await expect(selectAll).toBeChecked();
  await selectAll.uncheck();
  await selectExisting.check();
  fail = true;
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('the selected participant');
    await dialog.accept();
  });
  await action.click();
  await expect(section.getByRole('alert')).toContainText('Your selection has been kept');
  await expect(selectExisting).toBeChecked();
  await expect(section.getByRole('row', { name: /New Archer/ })).toBeVisible();
  fail = false;
  page.once('dialog', (dialog) => dialog.accept());
  await section.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(section.getByRole('row', { name: /Zoë van Dijk/ })).toHaveCount(0);
  await expect(section.getByRole('row', { name: /New Archer/ })).toBeVisible();
  await expect(action).not.toBeVisible();
  await selectAll.check();
  await expect(selectAll).toBeChecked();
  page.once('dialog', (dialog) => dialog.accept());
  await action.click();
  await expect(section).toContainText('No participants yet.');
  await page.reload();
  await expect(section).toContainText('No participants yet.');
});
