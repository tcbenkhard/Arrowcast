import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import {
  arrowScores,
  competitionLanes,
  competitionParticipants,
  competitions,
  lanes,
  laneScoringGrants,
  laneScoringState,
  rangeDistances,
  ranges,
  participants,
  roundScores,
  scorecards,
  scoringMutations,
  scoringSessions,
  targetTypes,
  type competitionStatuses,
} from '../../db/schema.js';

const competitionFields = {
  id: competitions.id,
  name: competitions.name,
  date: competitions.date,
  startingTime: competitions.startingTime,
  endingTime: competitions.endingTime,
  status: competitions.status,
  numberOfRounds: competitions.numberOfRounds,
  arrowsPerRound: competitions.arrowsPerRound,
  scoringLocked: competitions.scoringLocked,
  defaultTargetType: competitions.defaultTargetType,
  range: { id: ranges.id, name: ranges.name },
};

export class CompetitionDatabaseClient extends DatabaseClient {
  targetTypeExists(name: string) {
    return Boolean(this.db.select().from(targetTypes).where(eq(targetTypes.name, name)).get());
  }

  insertCompetition(input: typeof competitions.$inferInsert) {
    return this.db.insert(competitions).values(input).returning().get();
  }

  updateCompetition(id: string, values: Partial<typeof competitions.$inferInsert>) {
    this.db.update(competitions).set(values).where(eq(competitions.id, id)).run();
  }

  insertLane(input: typeof competitionLanes.$inferInsert) {
    this.db.insert(competitionLanes).values(input).run();
  }

  deleteLanes(competitionId: string) {
    this.db.delete(competitionLanes).where(eq(competitionLanes.competitionId, competitionId)).run();
  }

  clearParticipantAssignments(competitionId: string) {
    this.db
      .update(competitionParticipants)
      .set({ laneId: null, targetLetter: null })
      .where(eq(competitionParticipants.competitionId, competitionId))
      .run();
  }

  laneParticipants(competitionId: string, laneId: string) {
    return this.db
      .select()
      .from(competitionParticipants)
      .where(and(eq(competitionParticipants.competitionId, competitionId), eq(competitionParticipants.laneId, laneId)))
      .all();
  }

  updateLane(
    competitionId: string,
    laneId: string,
    configuration: { targetType: string | null; numberOfTargets: number },
  ) {
    return this.db
      .update(competitionLanes)
      .set(configuration)
      .where(and(eq(competitionLanes.competitionId, competitionId), eq(competitionLanes.laneId, laneId)))
      .returning()
      .get();
  }

  deleteScoringState(competitionId: string) {
    this.db.delete(laneScoringState).where(eq(laneScoringState.competitionId, competitionId)).run();
  }

  changeStatus(
    id: string,
    expectedStatus: (typeof competitionStatuses)[number],
    status: (typeof competitionStatuses)[number],
  ) {
    return this.db
      .update(competitions)
      .set({ status })
      .where(and(eq(competitions.id, id), eq(competitions.status, expectedStatus)))
      .returning()
      .get();
  }

  assignmentParticipants(competitionId: string) {
    return this.db
      .select({ ...getTableColumns(competitionParticipants), clubNumber: participants.clubNumber })
      .from(competitionParticipants)
      .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
      .where(eq(competitionParticipants.competitionId, competitionId))
      .all();
  }

  assignParticipant(
    competitionId: string,
    participantId: string,
    place: { laneId: string; targetLetter: 'A' | 'B' | 'C' | 'D' },
  ) {
    this.db
      .update(competitionParticipants)
      .set(place)
      .where(
        and(
          eq(competitionParticipants.competitionId, competitionId),
          eq(competitionParticipants.participantId, participantId),
        ),
      )
      .run();
  }
  private competitionQuery() {
    return this.db.select(competitionFields).from(competitions).innerJoin(ranges, eq(competitions.rangeId, ranges.id));
  }

  listCompetitions() {
    return this.competitionQuery().orderBy(competitions.date, competitions.startingTime, competitions.id).all();
  }

  findCompetition(id: string) {
    return this.competitionQuery().where(eq(competitions.id, id)).get();
  }

  assignedLanes(id: string) {
    return this.db
      .select({
        laneId: lanes.id,
        number: lanes.number,
        distanceMeters: competitionLanes.distanceMeters,
        targetType: competitionLanes.targetType,
        numberOfTargets: competitionLanes.numberOfTargets,
      })
      .from(competitionLanes)
      .innerJoin(lanes, eq(competitionLanes.laneId, lanes.id))
      .where(eq(competitionLanes.competitionId, id))
      .orderBy(lanes.number)
      .all();
  }

  hasScorecards(competitionId: string) {
    return Boolean(
      this.db.select({ id: scorecards.id }).from(scorecards).where(eq(scorecards.competitionId, competitionId)).get(),
    );
  }

  findRangeConfiguration(rangeId: string) {
    const range = this.db.select().from(ranges).where(eq(ranges.id, rangeId)).get();
    if (!range) return undefined;
    return {
      range,
      lanes: new Map(
        this.db
          .select()
          .from(lanes)
          .where(eq(lanes.rangeId, rangeId))
          .all()
          .map((lane) => [lane.id, lane.number]),
      ),
      distances: new Set(
        this.db
          .select()
          .from(rangeDistances)
          .where(eq(rangeDistances.rangeId, rangeId))
          .all()
          .map((distance) => distance.distanceMeters),
      ),
    };
  }

  /** Delete children before their parents, within the caller's transaction. */
  deleteScoringAccess(competitionId: string) {
    const grants = this.db
      .select({ id: laneScoringGrants.id })
      .from(laneScoringGrants)
      .where(eq(laneScoringGrants.competitionId, competitionId));
    const sessions = this.db
      .select({ id: scoringSessions.id })
      .from(scoringSessions)
      .where(inArray(scoringSessions.grantId, grants));
    this.db.delete(scoringMutations).where(inArray(scoringMutations.sessionId, sessions)).run();
    this.db.delete(scoringSessions).where(inArray(scoringSessions.grantId, grants)).run();
    this.db.delete(laneScoringGrants).where(eq(laneScoringGrants.competitionId, competitionId)).run();
    this.db.delete(laneScoringState).where(eq(laneScoringState.competitionId, competitionId)).run();
  }

  deleteCompetitionRecords(competitionId: string) {
    this.deleteScoringAccess(competitionId);
    const cards = this.db
      .select({ id: scorecards.id })
      .from(scorecards)
      .where(eq(scorecards.competitionId, competitionId));
    const rounds = this.db
      .select({ id: roundScores.id })
      .from(roundScores)
      .where(inArray(roundScores.scorecardId, cards));
    this.db.delete(arrowScores).where(inArray(arrowScores.roundScoreId, rounds)).run();
    this.db.delete(roundScores).where(inArray(roundScores.scorecardId, cards)).run();
    this.db.delete(scorecards).where(eq(scorecards.competitionId, competitionId)).run();
    this.db.delete(competitionParticipants).where(eq(competitionParticipants.competitionId, competitionId)).run();
    this.db.delete(competitionLanes).where(eq(competitionLanes.competitionId, competitionId)).run();
    this.db.delete(competitions).where(eq(competitions.id, competitionId)).run();
  }
}
