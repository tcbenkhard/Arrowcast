import { t } from '@arrowcast/contracts/i18n';
import { utils, write } from 'xlsx';
import type { LogbookService } from './service.js';

export function exportLogbook(rows: ReturnType<LogbookService['summary']>, language: 'nl' | 'en') {
  const sheet = utils.aoa_to_sheet([
    [
      t('logbook.name', {}, language),
      t('logbook.averageScore', {}, language),
      t('logbook.averageArrow', {}, language),
      t('logbook.highest', {}, language),
    ],
    ...rows.map((row) => [row.name, row.averageScore, row.averagePerArrow, row.highestScore]),
  ]);
  sheet['!cols'] = [32, 22, 24, 20].map((wch) => ({ wch }));
  for (let row = 2; row <= rows.length + 1; row++) {
    sheet[`B${row}`].z = '0.##';
    sheet[`C${row}`].z = '0.##';
  }
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, t('logbook.title', {}, language));
  return write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
}
