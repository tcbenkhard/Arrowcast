import { expect, test } from './fixtures';
import ExcelJS from 'exceljs';
import { testAdminToken } from './admin';

test('imports XLSX participants, refreshes the table and reports invalid clubs without partial writes', async ({ page, request }) => {
  const token = testAdminToken();
  const headers = { Authorization: `Bearer ${token}` };
  const rangeResponse = await request.post('/api/v1/admin/ranges', { headers,
    data: { name: 'XLSX range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] } });
  expect(rangeResponse.ok()).toBeTruthy();
  const range = await rangeResponse.json();
  const created = await request.post('/api/v1/admin/competitions', { headers, data: {
    name: 'XLSX competition', date: '2026-12-01', startingTime: '09:00', endingTime: '12:00', rangeId: range.id,
    lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
  } });
  expect(created.ok()).toBeTruthy();
  const competition = await created.json();
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('External participants');
  sheet.addRow([]);
  sheet.addRow(['Bondsnummer', 'Schutter', 'Vereniging', 'Boog', 'Blazoen']);
  sheet.addRow(['000789', 'XLSX Archer', 'Browser test club', 'Recurve', '40cm']);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  await page.addInitScript((value) => sessionStorage.setItem('arrowcast.admin.jwt', value), token);
  await page.goto(`/admin/competitions/${competition.id}`);
  const section = page.getByRole('region', { name: 'Participants', exact: true });
  const button = section.getByRole('button', { name: 'Import', exact: true });
  await expect(button).toBeEnabled();
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name: 'external.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await expect(section.getByRole('status')).toContainText('1 participants imported; 1 new archers created.');
  const participant = section.getByRole('row').filter({ hasText: 'XLSX Archer' });
  await expect(participant).toContainText('000789');
  await expect(participant).toContainText('Browser test club');
  await expect(participant).toContainText('Recurve');
  await expect(participant).toContainText('40 cm blazoen (10-rings)');
  const upload = section.getByLabel('Import participants XLSX');
  await upload.setInputFiles({ name: 'external.xlsx', mimeType: 'application/octet-stream', buffer });
  await expect(section.getByRole('status')).toContainText('1 participants imported; 0 new archers created.');
  await expect(participant).toHaveCount(1);
  sheet.addRow(['000790', 'Invalid club archer', 'Unknown club', 'Compound', '40cm']);
  await upload.setInputFiles({ name: 'invalid.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(await book.xlsx.writeBuffer()) });
  await expect(section.getByRole('alert')).toContainText('Row 4: club "Unknown club"');
  await expect(participant).toHaveCount(1);
  await expect(section.getByRole('row').filter({ hasText: 'Invalid club archer' })).toHaveCount(0);
});
