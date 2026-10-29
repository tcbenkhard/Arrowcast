import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import {
  arrowScores,
  clubs,
  competitionLanes,
  competitionParticipants,
  competitions,
  laneScoringGrants,
  laneScoringState,
  lanes,
  participants,
  roundScores,
  scorecards,
  scoringMutations,
  scoringSessions,
} from '../../db/schema.js';

export class ScoringDatabaseClient extends DatabaseClient {
  findCompetition(id: string) {
    return this.db.select().from(competitions).where(eq(competitions.id, id)).get();
  }

  findCompetitionBySchedule(date: string, startingTime: string) {
    return this.db
      .select()
      .from(competitions)
      .where(and(eq(competitions.date, date), eq(competitions.startingTime, startingTime)))
      .orderBy(competitions.id)
      .get();
  }

  markScoresSynchronized(competitionId: string, scoresSyncedAt: number) {
    this.db.update(competitions).set({ scoresSyncedAt }).where(eq(competitions.id, competitionId)).run();
  }

  listCompetitionLanes(competitionId: string) {
    return this.db
      .select({ laneId: lanes.id, laneNumber: lanes.number })
      .from(competitionLanes)
      .innerJoin(lanes, eq(lanes.id, competitionLanes.laneId))
      .where(eq(competitionLanes.competitionId, competitionId))
      .orderBy(lanes.number)
      .all();
  }

  listCheckedInParticipants(competitionId: string) {
    return this.db
      .select()
      .from(competitionParticipants)
      .where(and(eq(competitionParticipants.competitionId, competitionId), eq(competitionParticipants.checkedIn, true)))
      .orderBy(competitionParticipants.targetLetter)
      .all();
  }

  listAbsentParticipantIds(competitionId: string) {
    return this.db
      .select({ id: competitionParticipants.participantId })
      .from(competitionParticipants)
      .where(
        and(eq(competitionParticipants.competitionId, competitionId), eq(competitionParticipants.checkedIn, false)),
      )
      .all()
      .map((person) => person.id);
  }

  listLaneParticipants(competitionId: string, laneId: string) {
    return this.db
      .select({ id: participants.id, name: participants.name, targetLetter: competitionParticipants.targetLetter })
      .from(competitionParticipants)
      .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
      .where(
        and(
          eq(competitionParticipants.competitionId, competitionId),
          eq(competitionParticipants.laneId, laneId),
          eq(competitionParticipants.checkedIn, true),
        ),
      )
      .all();
  }

  findLaneAssignment(competitionId: string, participantId: string, laneId: string) {
    return this.db
      .select()
      .from(competitionParticipants)
      .where(
        and(
          eq(competitionParticipants.competitionId, competitionId),
          eq(competitionParticipants.participantId, participantId),
          eq(competitionParticipants.laneId, laneId),
          eq(competitionParticipants.checkedIn, true),
        ),
      )
      .get();
  }

  findLane(laneId: string) {
    return this.db.select().from(lanes).where(eq(lanes.id, laneId)).get();
  }

  findLaneState(competitionId: string, laneId: string) {
    return this.db
      .select()
      .from(laneScoringState)
      .where(and(eq(laneScoringState.competitionId, competitionId), eq(laneScoringState.laneId, laneId)))
      .get();
  }

  listLaneStates(competitionId: string) {
    return this.db.select().from(laneScoringState).where(eq(laneScoringState.competitionId, competitionId)).all();
  }

  insertLaneState(state: typeof laneScoringState.$inferInsert) {
    this.db.insert(laneScoringState).values(state).onConflictDoNothing().run();
  }

  updateLaneState(
    competitionId: string,
    laneId: string,
    changes: Partial<typeof laneScoringState.$inferInsert>,
    expectedVersion?: number,
  ) {
    return this.db
      .update(laneScoringState)
      .set(changes)
      .where(
        and(
          eq(laneScoringState.competitionId, competitionId),
          eq(laneScoringState.laneId, laneId),
          expectedVersion === undefined ? undefined : eq(laneScoringState.version, expectedVersion),
        ),
      )
      .returning()
      .get();
  }

  hasScoringMutations(competitionId: string) {
    const cards = this.db
      .select({ id: scorecards.id })
      .from(scorecards)
      .where(eq(scorecards.competitionId, competitionId));
    return Boolean(
      this.db
        .select({ id: scoringMutations.id })
        .from(scoringMutations)
        .where(inArray(scoringMutations.scorecardId, cards))
        .get(),
    );
  }

  hasEnteredScores(competitionId: string) {
    const cards = this.db
      .select({ id: scorecards.id })
      .from(scorecards)
      .where(eq(scorecards.competitionId, competitionId));
    return Boolean(
      this.db
        .select({ id: arrowScores.roundScoreId })
        .from(arrowScores)
        .innerJoin(roundScores, eq(roundScores.id, arrowScores.roundScoreId))
        .where(
          and(
            inArray(roundScores.scorecardId, cards),
            or(ne(arrowScores.symbol, 'M'), isNull(roundScores.submittedAt)),
          ),
        )
        .get(),
    );
  }

  deleteCompetitionScores(competitionId: string) {
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
  }

  findScorecard(competitionId: string, participantId: string) {
    return this.db
      .select()
      .from(scorecards)
      .where(and(eq(scorecards.competitionId, competitionId), eq(scorecards.participantId, participantId)))
      .get();
  }

  ensureScorecard(competitionId: string, participantId: string, now: number) {
    return (
      this.findScorecard(competitionId, participantId) ??
      this.db
        .insert(scorecards)
        .values({ id: randomUUID(), competitionId, participantId, createdAt: now, updatedAt: now })
        .returning()
        .get()!
    );
  }

  ensureRound(scorecardId: string, roundNumber: number) {
    return (
      this.db
        .select()
        .from(roundScores)
        .where(and(eq(roundScores.scorecardId, scorecardId), eq(roundScores.roundNumber, roundNumber)))
        .get() ?? this.db.insert(roundScores).values({ id: randomUUID(), scorecardId, roundNumber }).returning().get()!
    );
  }

  listRounds(scorecardId: string) {
    return this.db
      .select()
      .from(roundScores)
      .where(eq(roundScores.scorecardId, scorecardId))
      .orderBy(roundScores.roundNumber)
      .all();
  }

  listArrows(roundId: string) {
    return this.db.select().from(arrowScores).where(eq(arrowScores.roundScoreId, roundId)).all();
  }

  insertArrow(roundScoreId: string, arrowIndex: number, symbol: string) {
    this.db.insert(arrowScores).values({ roundScoreId, arrowIndex, symbol }).run();
  }

  deleteRoundArrows(roundId: string) {
    this.db.delete(arrowScores).where(eq(arrowScores.roundScoreId, roundId)).run();
  }

  markRoundSubmitted(roundId: string, submittedAt: number) {
    this.db.update(roundScores).set({ submittedAt }).where(eq(roundScores.id, roundId)).run();
  }

  updateScorecardVersion(cardId: string, version: number, updatedAt: number) {
    this.db.update(scorecards).set({ version, updatedAt }).where(eq(scorecards.id, cardId)).run();
  }

  listSubmittedRounds(competitionId: string) {
    return this.db
      .select({ participantId: scorecards.participantId, roundNumber: roundScores.roundNumber })
      .from(scorecards)
      .innerJoin(roundScores, eq(roundScores.scorecardId, scorecards.id))
      .where(and(eq(scorecards.competitionId, competitionId), isNotNull(roundScores.submittedAt)))
      .all();
  }

  findMutation(id: string) {
    return this.db.select().from(scoringMutations).where(eq(scoringMutations.id, id)).get();
  }

  insertMutation(mutation: typeof scoringMutations.$inferInsert) {
    this.db.insert(scoringMutations).values(mutation).run();
  }

  findGrant(grantId: string) {
    return this.db.select().from(laneScoringGrants).where(eq(laneScoringGrants.id, grantId)).get();
  }

  listUnrevokedGrants(competitionId: string) {
    return this.db
      .select()
      .from(laneScoringGrants)
      .where(and(eq(laneScoringGrants.competitionId, competitionId), isNull(laneScoringGrants.revokedAt)))
      .all();
  }

  insertGrant(grant: typeof laneScoringGrants.$inferInsert) {
    this.db.insert(laneScoringGrants).values(grant).run();
  }

  revokeGrantSessions(competitionId: string, revokedAt: number) {
    this.db
      .update(scoringSessions)
      .set({ revokedAt })
      .where(
        inArray(
          scoringSessions.grantId,
          this.db
            .select({ id: laneScoringGrants.id })
            .from(laneScoringGrants)
            .where(eq(laneScoringGrants.competitionId, competitionId)),
        ),
      )
      .run();
  }

  revokeGrants(competitionId: string, revokedAt: number) {
    this.db
      .update(laneScoringGrants)
      .set({ revokedAt })
      .where(and(eq(laneScoringGrants.competitionId, competitionId), isNull(laneScoringGrants.revokedAt)))
      .run();
  }

  listScoringCodes(competitionId: string) {
    return this.db
      .select({
        id: laneScoringGrants.id,
        laneId: laneScoringGrants.laneId,
        laneNumber: lanes.number,
        token: laneScoringGrants.token,
        expiresAt: laneScoringGrants.expiresAt,
      })
      .from(laneScoringGrants)
      .innerJoin(lanes, eq(lanes.id, laneScoringGrants.laneId))
      .where(and(eq(laneScoringGrants.competitionId, competitionId), isNull(laneScoringGrants.revokedAt)))
      .orderBy(lanes.number)
      .all();
  }

  findSession(tokenHash: string) {
    return this.db.select().from(scoringSessions).where(eq(scoringSessions.tokenHash, tokenHash)).get();
  }

  insertSession(session: typeof scoringSessions.$inferInsert) {
    this.db.insert(scoringSessions).values(session).run();
  }

  setScoringLock(competitionId: string, scoringLocked: boolean) {
    this.db.update(competitions).set({ scoringLocked }).where(eq(competitions.id, competitionId)).run();
  }

  listStandingParticipants(competitionId: string) {
    return this.db
      .select({
        participantId: participants.id,
        checkedIn: competitionParticipants.checkedIn,
        name: participants.name,
        laneNumber: lanes.number,
        targetLetter: competitionParticipants.targetLetter,
      })
      .from(competitionParticipants)
      .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
      .leftJoin(lanes, eq(lanes.id, competitionParticipants.laneId))
      .where(eq(competitionParticipants.competitionId, competitionId))
      .all();
  }

  listStandingScores(competitionId: string) {
    return this.db
      .select({ participantId: scorecards.participantId, roundId: roundScores.id, symbol: arrowScores.symbol })
      .from(scorecards)
      .innerJoin(roundScores, and(eq(roundScores.scorecardId, scorecards.id), isNotNull(roundScores.submittedAt)))
      .leftJoin(arrowScores, eq(arrowScores.roundScoreId, roundScores.id))
      .where(eq(scorecards.competitionId, competitionId))
      .orderBy(roundScores.roundNumber, arrowScores.arrowIndex)
      .all();
  }

  listResultsParticipants(competitionId: string) {
    return this.db
      .select({
        participantId: participants.id,
        federationNumber: participants.federationNumber,
        bowType: competitionParticipants.bowType,
        clubNumber: clubs.clubNumber,
        clubName: clubs.name,
      })
      .from(competitionParticipants)
      .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
      .innerJoin(clubs, eq(clubs.clubNumber, participants.clubNumber))
      .where(eq(competitionParticipants.competitionId, competitionId))
      .all();
  }
}
