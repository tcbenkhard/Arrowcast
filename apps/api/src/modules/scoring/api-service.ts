import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { ClubSettingsDatabaseClient } from '../clubs/database-client.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';
import { scoringStandings } from './standings.js';

export interface ApiScoresRequest {
  verenigingsnummer: number;
  date: string;
  starttime: string;
}

const bowCodes = new Map([
  ['Recurve', 'R'],
  ['Compound', 'C'],
  ['Barebow', 'BB'],
  ['Longbow', 'LB'],
  ['Traditional', 'TR'],
]);

export class ApiScoringService {
  constructor(private readonly context: DatabaseContext) {}

  results(input: ApiScoresRequest) {
    return this.context.transaction((context) => {
      const club = new ClubSettingsDatabaseClient(context).selected();
      if (club?.clubNumber !== String(input.verenigingsnummer)) {
        throw new ApplicationError('Verkeerde vereniging', 400);
      }

      const client = new ScoringDatabaseClient(context);
      const competition = client.findCompetitionBySchedule(input.date, input.starttime);
      if (!competition) throw new ApplicationError('Wedstrijd niet gevonden', 404);
      if (competition.status !== 'Closed') {
        throw new ApplicationError('De wedstrijd is nog niet afgesloten', 409);
      }

      const people = new Map(
        client.listResultsParticipants(competition.id).map((person) => [person.participantId, person]),
      );
      const standings = scoringStandings(
        competition,
        client.listStandingParticipants(competition.id),
        client.listStandingScores(competition.id),
      );
      const response = {
        results: standings
          .filter((standing) => standing.checkedIn)
          .map((standing) => {
            const person = people.get(standing.participantId)!;
            const boogtype = bowCodes.get(person.bowType ?? '');
            if (!boogtype) {
              throw new ApplicationError(
                `Onbekend of ontbrekend boogtype voor lidnummer ${person.federationNumber}`,
                409,
              );
            }
            return { score: standing.totalScore, lidnummer: person.federationNumber, boogtype };
          }),
      };
      client.markScoresSynchronized(competition.id, Date.now());
      return response;
    });
  }
}
