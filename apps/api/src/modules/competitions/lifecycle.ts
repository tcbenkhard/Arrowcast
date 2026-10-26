import type { LaneQrCode } from '@arrowcast/contracts';
import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { competitionStatuses } from '../../db/schema.js';
import { ApplicationError } from '../../shared/errors.js';
import { ScoringLifecycleService } from '../scoring/competition-scoring.js';
import { ScoringGrantService } from '../scoring/grants.js';
import { AssignmentError } from './assignments.js';
import { AssignmentService } from './assignment-service.js';
import { CompetitionDatabaseClient } from './database-client.js';
import { CompetitionRules } from './rules.js';
import type { CompetitionStatus } from './types.js';

export class CompetitionLifecycleService {
  private readonly client: CompetitionDatabaseClient;
  private readonly rules: CompetitionRules;

  constructor(private readonly context: DatabaseContext) {
    this.client = new CompetitionDatabaseClient(context);
    this.rules = new CompetitionRules(this.client);
  }

  changeStatus(id: string, status: CompetitionStatus) {
    const current = this.rules.requireCompetition(id);
    const currentIndex = competitionStatuses.indexOf(current.status);
    const targetIndex = competitionStatuses.indexOf(status);
    if (targetIndex === currentIndex || targetIndex > currentIndex + 1) {
      throw new ApplicationError(t('routes.move_to_the_next_status_or_an_earlier_status'), 409);
    }
    let qrCodes: LaneQrCode[] | undefined;
    this.withAssignmentErrors(() =>
      this.context.transaction((scope) => {
        const client = new CompetitionDatabaseClient(scope);
        const scoring = new ScoringLifecycleService(scope);
        const grants = new ScoringGrantService(scope);
        if (targetIndex < 2) {
          if (!scoring.resetUnenteredScores(id))
            throw new AssignmentError(
              t('routes.scores_already_exist_participants_assignments_and_scoring_format_must'),
            );
          grants.revokeGrants(id);
          client.deleteScoringState(id);
        }
        if (status === 'Closed') {
          scoring.finalizeScores(id);
          grants.revokeGrants(id);
        }
        if (status === 'Check-in') {
          new AssignmentService(scope).assignParticipants(id);
          qrCodes = grants.issueLaneCodes(id);
        }
        if (status === 'Active') scoring.initializeLaneScoring(id);
        const updated = client.changeStatus(id, current.status, status);
        if (!updated) throw new ApplicationError(t('routes.competition_status_has_changed_reload_and_try_again'), 409);
      }),
    );
    return { ...this.rules.requireCompetition(id), ...(qrCodes ? { qrCodes } : {}) };
  }

  reassignParticipants(id: string) {
    const competition = this.rules.requireCompetition(id);
    if (competition.status !== 'Check-in')
      throw new ApplicationError(t('routes.reassignment_is_only_available_during_checkin'), 409);
    this.withAssignmentErrors(() =>
      this.context.transaction((scope) => new AssignmentService(scope).assignParticipants(id, true)),
    );
  }

  private withAssignmentErrors<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof AssignmentError) throw new ApplicationError(error.message, 409);
      throw error;
    }
  }
}
