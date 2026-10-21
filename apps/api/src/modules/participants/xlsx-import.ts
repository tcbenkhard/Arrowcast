import { t } from '@arrowcast/contracts/i18n';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { bowTypes, clubs, competitionParticipants, competitions, participants, targetTypes } from '../../db/schema.js';

export class ParticipantImportError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const columns = ['Bondsnummer', 'Schutter', 'Vereniging', 'Boog', 'Blazoen'] as const;
type ImportRow = Record<(typeof columns)[number], string> & { row: number };

export async function readParticipantWorkbook(buffer: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  } catch {
    throw new ParticipantImportError(t('xlsx_import.het_bestand_is_geen_geldig_xlsxbestand', {}, 'nl'));
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ParticipantImportError(t('xlsx_import.het_bestand_bevat_geen_werkblad', {}, 'nl'));
  const rows: ImportRow[] = [];
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
    rows.push({ ...Object.fromEntries(columns.map((name, index) => [name, values[index]])), row: number } as ImportRow);
    if (rows.length > 10000)
      throw new ParticipantImportError(t('xlsx_import.het_bestand_mag_maximaal_10000_deelnemers_bevatten', {}, 'nl'));
  });
  if (!rows.length) throw new ParticipantImportError(t('xlsx_import.het_bestand_bevat_geen_deelnemers', {}, 'nl'));
  return rows;
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

export function matchTarget(value: string, options: string[]): string | undefined {
  const key = normalize(value);
  const alias = key === '40cm' ? '40 cm blazoen (10-rings)' : key === 'dt' ? 'Dutch Target 40 cm (3-spot)' : undefined;
  if (alias) return options.find((name) => normalize(name) === normalize(alias));
  const exact = options.find((name) => normalize(name) === key);
  if (exact) return exact;
  const size = value.match(/(\d+)\s*cm/i)?.[1];
  if (/^\d+cm$/.test(key)) {
    const standard = options.find((name) => normalize(name) === `${size}cmblazoen10rings`);
    if (standard) return standard;
  }
  const ranked = options
    .filter((name) => !size || name.match(/(\d+)\s*cm/i)?.[1] === size)
    .map((name) => {
      const candidate = normalize(name);
      return {
        name,
        score: candidate.includes(key)
          ? key.length / candidate.length
          : 1 - distance(key, candidate) / Math.max(key.length, candidate.length),
      };
    })
    .sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 0.5 || ranked[0].score === ranked[1]?.score) return undefined;
  return ranked[0].name;
}

export function importCompetitionParticipants(db: AppDatabase, competitionId: string, rows: ImportRow[]) {
  return db.transaction((tx) => {
    const competition = tx.select().from(competitions).where(eq(competitions.id, competitionId)).get();
    if (!competition) throw new ParticipantImportError(t('CompetitionDetailPage.competition_not_found'), 404);
    if (competition.status !== 'Scheduled')
      throw new ParticipantImportError(t('management.participants_can_only_be_added_before_checkin'), 409);
    const availableClubs = tx.select().from(clubs).all();
    const bows = tx.select().from(bowTypes).all();
    const targets = tx
      .select()
      .from(targetTypes)
      .all()
      .map((target) => target.name);
    const seen = new Set<string>();
    let created = 0;
    for (const row of rows) {
      const fail = (message: string): never => {
        throw new ParticipantImportError(t('xlsx_import.regel', { p0: row.row, p1: message }, 'nl'));
      };
      if (seen.has(row.Bondsnummer))
        fail(t('xlsx_import.bondsnummer_komt_meerdere_keren_voor', { p0: row.Bondsnummer }, 'nl'));
      seen.add(row.Bondsnummer);
      const matchingClubs = availableClubs.filter((club) => normalize(club.name) === normalize(row.Vereniging));
      if (matchingClubs.length !== 1)
        fail(t('xlsx_import.vereniging_niet_gevonden_of_niet_uniek', { p0: row.Vereniging }, 'nl'));
      const clubNumber = matchingClubs[0]!.clubNumber;
      const bowType = bows.find((bow) => normalize(bow.name) === normalize(row.Boog))?.name;
      if (!bowType) fail(t('xlsx_import.onbekend_boogtype', { p0: row.Boog }, 'nl'));
      const targetType = matchTarget(row.Blazoen, targets);
      if (!targetType) fail(t('xlsx_import.blazoen_kan_niet_eenduidig_worden_gekoppeld', { p0: row.Blazoen }, 'nl'));
      let person = tx.select().from(participants).where(eq(participants.federationNumber, row.Bondsnummer)).get();
      if (!person) {
        person = { id: randomUUID(), federationNumber: row.Bondsnummer, name: row.Schutter, clubNumber };
        tx.insert(participants).values(person).run();
        created++;
      } else if (person.clubNumber !== clubNumber) {
        tx.update(participants).set({ clubNumber }).where(eq(participants.id, person.id)).run();
      }
      const registration = tx
        .select()
        .from(competitionParticipants)
        .where(
          and(
            eq(competitionParticipants.competitionId, competitionId),
            eq(competitionParticipants.participantId, person.id),
          ),
        )
        .get();
      if (registration?.laneId && (registration.bowType !== bowType || registration.targetType !== targetType))
        fail(t('xlsx_import.boogtype_of_blazoen_wijzigen_zou_een_bestaande_baanindeling_ongeldig', {}, 'nl'));
      tx.insert(competitionParticipants)
        .values({ competitionId, participantId: person.id, bowType: bowType!, targetType: targetType! })
        .onConflictDoUpdate({
          target: [competitionParticipants.competitionId, competitionParticipants.participantId],
          set: { bowType: bowType!, targetType: targetType! },
        })
        .run();
    }
    return { imported: rows.length, created };
  });
}
