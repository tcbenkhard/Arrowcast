import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { ScoringLifecycleService } from './competition-scoring.js';
import { ScoringGrantService } from './grants.js';
import { exportResults, resultsFilename } from './results-export.js';
import { ScoringDatabaseClient } from './scoring-database-client.js';
import { scoringStandings } from './standings.js';
import type { ScoringCompetition } from './types.js';

function codesAvailable(competition: ScoringCompetition) {
  return competition.status === 'Check-in' || competition.status === 'Active';
}

export class ScoringAdminService {
  private readonly client: ScoringDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.client = new ScoringDatabaseClient(context);
  }

  private requireCompetition(id: string) {
    const competition = this.client.findCompetition(id);
    if (!competition) throw new ApplicationError(t('CompetitionDetailPage.competition_not_found'), 404);
    return competition;
  }

  private standings(competition: ScoringCompetition) {
    return scoringStandings(
      competition,
      this.client.listStandingParticipants(competition.id),
      this.client.listStandingScores(competition.id),
    );
  }

  listScoringCodes(competitionId: string) {
    if (!codesAvailable(this.requireCompetition(competitionId))) return [];
    const now = Date.now();
    return this.client
      .listScoringCodes(competitionId)
      .filter((grant) => grant.expiresAt > now)
      .filter(
        (grant, _, grants) => grant.token || !grants.some((other) => other.laneId === grant.laneId && other.token),
      )
      .map(({ token, id, ...grant }) => ({
        ...grant,
        grantId: id,
        ...(token ? { path: `/scores/${competitionId}/${grant.laneId}/${id}#token=${token}` } : {}),
      }));
  }

  restoreScoringCodes(competitionId: string) {
    const competition = this.requireCompetition(competitionId);
    if (!codesAvailable(competition)) throw new ApplicationError(t('routes.scoring_has_not_started'), 409);
    this.context.transaction((context) => new ScoringGrantService(context).restoreLaneCodes(competition.id));
  }

  getScoringStandings(competitionId: string) {
    const competition = this.requireCompetition(competitionId);
    return this.context.transaction((context) => new ScoringAdminService(context).standings(competition));
  }

  getResultsExport(competitionId: string) {
    const competition = this.requireCompetition(competitionId);
    if (competition.status !== 'Closed') throw new ApplicationError(t('ScoringSettings.close_before_export'), 409);
    return {
      buffer: this.context.transaction((context) => {
        const service = new ScoringAdminService(context);
        return exportResults(service.standings(competition), service.client.listResultsParticipants(competition.id));
      }),
      filename: resultsFilename(competition),
    };
  }

  issueScoringCodes(competitionId: string) {
    const competition = this.requireCompetition(competitionId);
    if (!codesAvailable(competition))
      throw new ApplicationError(t('routes.start_checkin_before_issuing_scoring_codes'), 409);
    return this.context.transaction((context) => {
      if (competition.status === 'Active') new ScoringLifecycleService(context).initializeLaneScoring(competition.id);
      return new ScoringGrantService(context).issueLaneCodes(competition.id);
    });
  }

  revokeScoringCodes(competitionId: string) {
    this.requireCompetition(competitionId);
    this.context.transaction((context) => new ScoringGrantService(context).revokeGrants(competitionId));
  }

  setScoringLock(competitionId: string, scoringLocked: boolean) {
    const competition = this.requireCompetition(competitionId);
    this.client.setScoringLock(competition.id, scoringLocked);
    return { scoringLocked };
  }
}
