import { t } from '@arrowcast/contracts/i18n';
import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { CompetitionDatabaseClient } from './database-client.js';
import { CompetitionRules } from './rules.js';
import type { CreateCompetition, UpdateCompetition } from './types.js';

export class CompetitionService {
  private readonly client: CompetitionDatabaseClient;
  private readonly rules: CompetitionRules;

  constructor(private readonly context: DatabaseContext) {
    this.client = new CompetitionDatabaseClient(context);
    this.rules = new CompetitionRules(this.client);
  }

  list() {
    return this.client.listCompetitions();
  }

  get(id: string) {
    return this.rules.requireCompetition(id);
  }

  create(details: CreateCompetition) {
    this.rules.validateSchedule(details);
    if (new Set(details.lanes.map((lane) => lane.laneId)).size !== details.lanes.length) {
      throw new ApplicationError(t('competition.uniqueLanes'), 400);
    }
    return this.context.transaction((scope) => new CompetitionService(scope).createRecords(details));
  }

  private createRecords(details: CreateCompetition) {
    const defaultTargetType = this.rules.validateDefaultTarget(details.defaultTargetType);
    const configuration = this.rules.validateLaneSelection(details.rangeId, details.lanes);
    const { rangeId: _rangeId, ...created } = this.client.insertCompetition({
      id: randomUUID(),
      name: details.name.trim(),
      date: details.date,
      startingTime: details.startingTime,
      endingTime: details.endingTime,
      rangeId: details.rangeId,
      numberOfRounds: details.numberOfRounds ?? 10,
      arrowsPerRound: details.arrowsPerRound ?? 3,
      defaultTargetType,
    });
    for (const lane of details.lanes) {
      this.client.insertLane({
        competitionId: created.id,
        rangeId: details.rangeId,
        ...lane,
        targetType: defaultTargetType,
      });
    }
    return {
      ...created,
      range: configuration.range,
      lanes: details.lanes
        .map((lane) => ({ ...lane, number: configuration.lanes.get(lane.laneId)! }))
        .sort((a, b) => a.number - b.number),
    };
  }

  update(id: string, details: UpdateCompetition) {
    const competition = this.get(id);
    this.rules.validateSchedule(details);
    if (
      details.numberOfRounds !== competition.numberOfRounds ||
      details.arrowsPerRound !== competition.arrowsPerRound
    ) {
      this.rules.requireScoringConfiguration(competition);
    }
    const defaultTargetType = this.rules.validateDefaultTarget(details.defaultTargetType);
    const rangeChanged = details.rangeId !== undefined && details.rangeId !== competition.range.id;
    const currentLanes = this.client.assignedLanes(id);
    const lanesChanged =
      rangeChanged ||
      (details.lanes !== undefined &&
        (details.lanes.length !== currentLanes.length ||
          details.lanes.some(
            (lane) =>
              !currentLanes.some(
                (current) => current.laneId === lane.laneId && current.distanceMeters === lane.distanceMeters,
              ),
          )));
    if (rangeChanged || details.lanes !== undefined) {
      if (lanesChanged && !this.rules.canConfigureScoring(competition)) {
        throw new ApplicationError(t('routes.change_the_range_or_lanes_before_checkin_and_before'), 409);
      }
      if (!details.lanes?.length || new Set(details.lanes.map((lane) => lane.laneId)).size !== details.lanes.length) {
        throw new ApplicationError(t('competition.selectUniqueLanes'), 400);
      }
      this.rules.validateLaneSelection(details.rangeId ?? competition.range.id, details.lanes);
    }
    this.context.transaction((scope) => {
      const client = new CompetitionDatabaseClient(scope);
      if (lanesChanged) {
        client.deleteScoringAccess(id);
        client.clearParticipantAssignments(id);
        client.deleteLanes(id);
      }
      const { lanes: _lanes, rangeId, ...fields } = details;
      client.updateCompetition(id, {
        ...fields,
        name: details.name.trim(),
        defaultTargetType,
        ...(rangeChanged ? { rangeId } : {}),
      });
      if (lanesChanged) {
        for (const lane of details.lanes!) {
          const retained = currentLanes.find((current) => current.laneId === lane.laneId);
          client.insertLane({
            competitionId: id,
            rangeId: details.rangeId ?? competition.range.id,
            ...lane,
            targetType: retained ? retained.targetType : defaultTargetType,
            numberOfTargets: retained?.numberOfTargets ?? 1,
          });
        }
      }
    });
    return this.get(id);
  }

  delete(id: string) {
    this.get(id);
    this.context.transaction((scope) => new CompetitionDatabaseClient(scope).deleteCompetitionRecords(id));
  }

  updateScoringSettings(id: string, settings: { numberOfRounds: number; arrowsPerRound: number }) {
    this.rules.requireScoringConfiguration(this.get(id));
    this.client.updateCompetition(id, settings);
    return this.get(id);
  }
}
