import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { CompetitionDatabaseClient } from './database-client.js';
import { CompetitionRules } from './rules.js';

export interface LaneConfiguration {
  targetType: string | null;
  numberOfTargets: number | null;
}

export class CompetitionLaneService {
  private readonly client: CompetitionDatabaseClient;
  private readonly rules: CompetitionRules;

  constructor(context: DatabaseContext) {
    this.client = new CompetitionDatabaseClient(context);
    this.rules = new CompetitionRules(this.client);
  }

  list(competitionId: string) {
    this.rules.requireCompetition(competitionId);
    return this.client.assignedLanes(competitionId);
  }

  configure(competitionId: string, laneId: string, configuration: LaneConfiguration) {
    const competition = this.rules.requireCompetition(competitionId);
    if (competition.status !== 'Scheduled')
      throw new ApplicationError(t('routes.lanes_can_only_be_configured_before_checkin'), 409);
    const targetType = configuration.targetType?.trim() ?? null;
    const numberOfTargets = configuration.numberOfTargets ?? 1;
    const assigned = this.client.laneParticipants(competitionId, laneId);
    if (
      assigned.some(
        (person) =>
          person.targetType !== targetType ||
          ((person.targetLetter === 'B' || person.targetLetter === 'D') && numberOfTargets < 2),
      )
    ) {
      throw new ApplicationError(t('routes.this_change_would_invalidate_existing_shooting_assignments'), 409);
    }
    const updated = this.client.updateLane(competitionId, laneId, { targetType, numberOfTargets });
    if (!updated) throw new ApplicationError(t('routes.competition_lane_not_found'), 404);
    return this.client.assignedLanes(competitionId).find((lane) => lane.laneId === laneId)!;
  }
}
