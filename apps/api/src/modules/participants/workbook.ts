import { t } from '@arrowcast/contracts/i18n';
import ExcelJS from 'exceljs';
import { ParticipantImportError } from './errors.js';
import { normalize } from './target-matching.js';
import type { ParticipantWorkbookRow } from './types.js';

const columns = ['Bondsnummer', 'Schutter', 'Vereniging', 'Boog', 'Blazoen'] as const;
export async function readParticipantWorkbook(buffer: Buffer): Promise<ParticipantWorkbookRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  } catch {
    throw new ParticipantImportError(t('xlsx_import.het_bestand_is_geen_geldig_xlsxbestand', {}, 'nl'));
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ParticipantImportError(t('xlsx_import.het_bestand_bevat_geen_werkblad', {}, 'nl'));
  const rows: ParticipantWorkbookRow[] = [];
  let indices: number[] | undefined;
  sheet.eachRow((row, number) => {
    if (!indices) {
      const headers = new Map<string, number>();
      row.eachCell((cell, index) => {
        if (cell.text.trim()) headers.set(normalize(cell.text), index);
      });
      if (!headers.size) return;
      if (columns.some((name) => !headers.has(normalize(name)))) {
        throw new ParticipantImportError(
          t('xlsx_import.regel_verwachte_kolommen', { p0: number, p1: columns.join(', ') }, 'nl'),
        );
      }
      indices = columns.map((name) => headers.get(normalize(name))!);
      return;
    }
    const values = indices.map((index) => {
      const cell = row.getCell(index);
      // Preserve leading zeroes when the external workbook uses a number format.
      return typeof cell.value === 'number' && /^0+$/.test(cell.numFmt)
        ? String(cell.value).padStart(cell.numFmt.length, '0')
        : cell.text.trim();
    });
    if (values.every((value) => !value)) return;
    columns.forEach((name, index) => {
      if (!values[index] || values[index]!.length > 200)
        throw new ParticipantImportError(
          t('xlsx_import.regel_ontbreekt_of_is_te_lang', { p0: number, p1: name }, 'nl'),
        );
    });
    rows.push({
      ...Object.fromEntries(columns.map((name, index) => [name, values[index]])),
      row: number,
    } as ParticipantWorkbookRow);
    if (rows.length > 10000)
      throw new ParticipantImportError(t('xlsx_import.het_bestand_mag_maximaal_10000_deelnemers_bevatten', {}, 'nl'));
  });
  if (!rows.length) throw new ParticipantImportError(t('xlsx_import.het_bestand_bevat_geen_deelnemers', {}, 'nl'));
  return rows;
}
