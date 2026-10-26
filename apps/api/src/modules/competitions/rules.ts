import { t } from '@arrowcast/contracts/i18n';
import { ApplicationError } from '../../shared/errors.js';
import type { CompetitionDatabaseClient } from './database-client.js';
import type { CompetitionLaneSelection } from './types.js';

export class CompetitionRules {
  constructor(private readonly client: CompetitionDatabaseClient) {}

  requireCompetition(id: string) {
    const competition = this.client.findCompetition(id);
    if (!competition) throw new ApplicationError(t('CompetitionDetailPage.competition_not_found'), 404);
    return competition;
  }

  validateSchedule(details: { date: string; startingTime: string; endingTime: string }) {
    const date = new Date(`${details.date}T00:00:00Z`);
    if (
      details.date.startsWith('0000') ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== details.date
    ) {
      throw new ApplicationError(t('routes.enter_a_valid_competition_date'), 400);
    }
    if (details.endingTime <= details.startingTime) {
      throw new ApplicationError(t('CompetitionDetailsModal.ending_time_must_be_after_starting_time_on_the'), 400);
    }
  }

  canConfigureScoring(competition: { id: string; status: string }) {
    return competition.status === 'Scheduled' && !this.client.hasScorecards(competition.id);
  }

  requireScoringConfiguration(competition: { id: string; status: string }) {
    if (!this.canConfigureScoring(competition)) {
      throw new ApplicationError(t('routes.configure_scoring_before_checkin_and_before_any_scores_exist'), 409);
    }
  }

  validateDefaultTarget(name: string | null | undefined) {
    const targetType = name?.trim() ?? null;
    if (targetType && !this.client.targetTypeExists(targetType)) {
      throw new ApplicationError(t('competition.selectDefaultTarget'), 400);
    }
    return targetType;
  }

  validateLaneSelection(rangeId: string, selection: CompetitionLaneSelection[]) {
    const configuration = this.client.findRangeConfiguration(rangeId);
    if (!configuration) throw new ApplicationError(t('competition.selectExistingRange'), 400);
    if (
      selection.some(
        (lane) => !configuration.lanes.has(lane.laneId) || !configuration.distances.has(lane.distanceMeters),
      )
    ) {
      throw new ApplicationError(t('routes.choose_lanes_and_supported_distances_from_the_selected_range'), 400);
    }
    return configuration;
  }
}
