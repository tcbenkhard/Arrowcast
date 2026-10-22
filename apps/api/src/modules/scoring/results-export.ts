import { eq } from 'drizzle-orm';
import { utils, write } from 'xlsx';
import type { AppDatabase } from '../../db/index.js';
import { clubs, competitionParticipants, competitions, participants } from '../../db/schema.js';
import { scoringStandings } from './standings.js';

export function resultsFilename(competition: { name: string; date: string }): string {
  const name = competition.name
    .toLowerCase()
    .replace(/\s/g, '_')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return `${name}_${competition.date}.xls`;
}

export function exportResults(db: Pick<AppDatabase, 'select'>, competition: typeof competitions.$inferSelect): Buffer {
  const people = db
    .select({
      participantId: participants.id,
      federationNumber: participants.federationNumber,
      clubNumber: clubs.clubNumber,
      clubName: clubs.name,
    })
    .from(competitionParticipants)
    .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
    .innerJoin(clubs, eq(clubs.clubNumber, participants.clubNumber))
    .where(eq(competitionParticipants.competitionId, competition.id))
    .all();
  const details = new Map(people.map((person) => [person.participantId, person]));
  const rows = scoringStandings(db, competition).map((standing) => {
    const person = details.get(standing.participantId)!;
    return [
      person.federationNumber,
      standing.name,
      person.clubNumber,
      person.clubName,
      standing.checkedIn ? standing.totalScore : 'Afwezig',
      standing.checkedIn ? standing.averageScore : 'Afwezig',
    ];
  });
  const sheet = utils.aoa_to_sheet([
    ['bondsnummer', 'naam', 'clubnummer', 'clubnaam', 'totaalscore', 'gemiddelde'],
    ...rows,
  ]);
  sheet['!cols'] = [16, 32, 16, 32, 14, 14].map((wch) => ({ wch }));
  for (let row = 1; row <= rows.length; row++) sheet[`F${row + 1}`].z = '0.00';
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, 'Resultaten');
  return write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
}
