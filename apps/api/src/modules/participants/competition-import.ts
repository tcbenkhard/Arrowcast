import { t } from '@arrowcast/contracts/i18n';
import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/context.js';
import { ParticipantsDatabaseClient } from './database-client.js';
import { ParticipantImportError } from './errors.js';
import { requireParticipantCompetition, requireScheduledRegistration } from './rules.js';
import { matchTarget, normalize } from './target-matching.js';
import type { ParticipantWorkbookRow } from './types.js';

export class CompetitionParticipantImportService {
  private readonly participants: ParticipantsDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.participants = new ParticipantsDatabaseClient(context);
  }

  import(competitionId: string, rows: ParticipantWorkbookRow[]) {
    return this.context.transaction((scope) =>
      new CompetitionParticipantImportService(scope).importInTransaction(competitionId, rows),
    );
  }

  private importInTransaction(competitionId: string, rows: ParticipantWorkbookRow[]) {
    const competition = requireParticipantCompetition(this.participants.findCompetition(competitionId));
    requireScheduledRegistration(competition, 'add');
    const availableClubs = this.participants.listClubs();
    const bows = this.participants.listBowTypes();
    const targets = this.participants.listTargetTypes().map((target) => target.name);
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
      let person = this.participants.findByFederationNumber(row.Bondsnummer);
      if (!person) {
        person = { id: randomUUID(), federationNumber: row.Bondsnummer, name: row.Schutter, clubNumber };
        this.participants.addParticipant(person);
        created++;
      } else if (person.clubNumber !== clubNumber) {
        this.participants.updateClub(person.id, clubNumber);
      }
      const registration = this.participants.findRegistrations(competitionId, [person.id])[0];
      if (registration?.laneId && (registration.bowType !== bowType || registration.targetType !== targetType))
        fail(t('xlsx_import.boogtype_of_blazoen_wijzigen_zou_een_bestaande_baanindeling_ongeldig', {}, 'nl'));
      this.participants.upsertRegistration({
        competitionId,
        participantId: person.id,
        bowType: bowType!,
        targetType: targetType!,
      });
    }
    return { imported: rows.length, created };
  }
}
