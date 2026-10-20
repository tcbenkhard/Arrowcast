import { t } from '@arrowcast/contracts/i18n';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { LaneQrCode, ScoringContext, ScoringMutation } from '@arrowcast/contracts';
import type { AppDatabase } from '../../db/index.js';
import { arrowScores, competitionLanes, competitionParticipants, competitions, laneScoringGrants,
  laneScoringState, lanes, participants, roundScores, scorecards, scoreChanges, scoringMutations, scoringSessions } from '../../db/schema.js';

type Database = Pick<AppDatabase, 'select' | 'insert' | 'update' | 'delete'>;
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export class ScoringError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export function initializeLaneScoring(db: Database, competitionId: string) {
  for (const lane of db.select().from(competitionLanes).where(eq(competitionLanes.competitionId, competitionId)).all()) {
    const order = db.select({ id: competitionParticipants.participantId }).from(competitionParticipants)
      .where(and(eq(competitionParticipants.competitionId, competitionId), eq(competitionParticipants.laneId, lane.laneId)))
      .orderBy(competitionParticipants.targetLetter).all().map((p) => p.id);
    db.insert(laneScoringState).values({ competitionId, laneId: lane.laneId, participantOrder: order,
      currentParticipantId: order[0] ?? null, completed: order.length === 0, updatedAt: Date.now() })
      .onConflictDoNothing().run();
  }
}

export function revokeGrants(db: Database, competitionId: string) {
  db.update(scoringSessions).set({ revokedAt: Date.now() }).where(inArray(scoringSessions.grantId,
    db.select({ id: laneScoringGrants.id }).from(laneScoringGrants).where(eq(laneScoringGrants.competitionId, competitionId)))).run();
  db.update(laneScoringGrants).set({ revokedAt: Date.now() })
    .where(and(eq(laneScoringGrants.competitionId, competitionId), isNull(laneScoringGrants.revokedAt))).run();
}

// Run within the closing transaction so every configured arrow counts in the final average.
export function finalizeScores(db: Database, competitionId: string) {
  const competition = db.select().from(competitions).where(eq(competitions.id, competitionId)).get()!;
  const now = Date.now();
  const people = db.select().from(competitionParticipants)
    .where(eq(competitionParticipants.competitionId, competitionId)).all();
  for (const person of people) {
    let card = db.select().from(scorecards).where(and(eq(scorecards.competitionId, competitionId),
      eq(scorecards.participantId, person.participantId))).get();
    if (!card) card = db.insert(scorecards).values({ id: randomUUID(), competitionId,
      participantId: person.participantId, createdAt: now, updatedAt: now }).returning().get()!;
    let changed = false;
    for (let number = 1; number <= competition.numberOfRounds; number++) {
      let round = db.select().from(roundScores).where(and(eq(roundScores.scorecardId, card.id),
        eq(roundScores.roundNumber, number))).get();
      if (!round) round = db.insert(roundScores).values({ id: randomUUID(), scorecardId: card.id,
        roundNumber: number }).returning().get()!;
      const entered = new Set(db.select().from(arrowScores).where(eq(arrowScores.roundScoreId, round.id))
        .all().map((arrow) => arrow.arrowIndex));
      for (let index = 1; index <= competition.arrowsPerRound; index++) {
        if (entered.has(index)) continue;
        db.insert(arrowScores).values({ roundScoreId: round.id, arrowIndex: index, symbol: 'M' }).run();
        changed = true;
      }
      if (round.status !== 'submitted') {
        db.update(roundScores).set({ status: 'submitted', submittedAt: now }).where(eq(roundScores.id, round.id)).run();
        changed = true;
      }
    }
    if (changed) db.update(scorecards).set({ version: card.version + 1, updatedAt: now }).where(eq(scorecards.id, card.id)).run();
  }
  for (const state of db.select().from(laneScoringState).where(eq(laneScoringState.competitionId, competitionId)).all()) {
    db.update(laneScoringState).set({ completed: true, currentParticipantId: null, version: state.version + 1, updatedAt: now })
      .where(and(eq(laneScoringState.competitionId, competitionId), eq(laneScoringState.laneId, state.laneId))).run();
  }
}

// Admins can retrieve issued codes for reprinting; replacements revoke previous grants.
export function issueLaneCodes(db: Database, competitionId: string): LaneQrCode[] {
  revokeGrants(db, competitionId);
  const now = Date.now();
  return db.select({ laneId: lanes.id, laneNumber: lanes.number }).from(competitionLanes)
    .innerJoin(lanes, eq(lanes.id, competitionLanes.laneId))
    .where(eq(competitionLanes.competitionId, competitionId)).orderBy(lanes.number).all().map((lane) => {
      const grantId = randomUUID(); const token = newToken(); const expiresAt = now + 7 * 86400_000;
      db.insert(laneScoringGrants).values({ id: grantId, competitionId, laneId: lane.laneId,
        token, tokenHash: hashToken(token), createdAt: now, expiresAt }).run();
      return { ...lane, grantId, expiresAt,
        path: `/scoring/${competitionId}/${lane.laneId}/${grantId}#token=${token}` };
    });
}

// Recover displayable codes for older grants without revoking printed codes or sessions.
export function restoreLaneCodes(db: Database, competitionId: string) {
  const now = Date.now();
  const grants = db.select().from(laneScoringGrants)
    .where(and(eq(laneScoringGrants.competitionId, competitionId), isNull(laneScoringGrants.revokedAt)))
    .all().filter((grant) => grant.expiresAt > now);
  const restoredLanes = new Set(grants.filter((grant) => grant.token).map((grant) => grant.laneId));
  for (const grant of grants) {
    if (restoredLanes.has(grant.laneId)) continue;
    const token = newToken();
    db.insert(laneScoringGrants).values({ id: randomUUID(), competitionId, laneId: grant.laneId,
      token, tokenHash: hashToken(token), createdAt: now, expiresAt: grant.expiresAt }).run();
    restoredLanes.add(grant.laneId);
  }
}

export function validGrant(db: Database, grantId: string) {
  const grant = db.select().from(laneScoringGrants).where(eq(laneScoringGrants.id, grantId)).get();
  if (grant) {
    const status = db.select().from(competitions).where(eq(competitions.id, grant.competitionId)).get()?.status;
    if (status !== 'Active') {
      throw new ScoringError(403, t(status === 'Closed'
        ? "service.this_competition_is_closed_scoring_access_has_ended" : "routes.scoring_has_not_started"));
    }
  }
  if (!grant || grant.revokedAt !== null || grant.expiresAt <= Date.now()) {
    throw new ScoringError(401, t("service.this_scoring_code_has_expired_or_been_revoked_ask"));
  }
  return grant;
}

export function scoringContext(db: Database, grant: typeof laneScoringGrants.$inferSelect): ScoringContext {
  const competition = db.select().from(competitions).where(eq(competitions.id, grant.competitionId)).get()!;
  const lane = db.select().from(lanes).where(eq(lanes.id, grant.laneId)).get()!;
  const state = db.select().from(laneScoringState).where(and(eq(laneScoringState.competitionId, grant.competitionId),
    eq(laneScoringState.laneId, grant.laneId))).get();
  if (!state) throw new ScoringError(403, t("service.scoring_has_not_started_for_this_lane"));
  const assigned = db.select({ id: participants.id, name: participants.name, targetLetter: competitionParticipants.targetLetter })
    .from(competitionParticipants).innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
    .where(and(eq(competitionParticipants.competitionId, grant.competitionId), eq(competitionParticipants.laneId, grant.laneId))).all();
  const people = state.participantOrder.map((id) => assigned.find((p) => p.id === id));
  if (people.some((p) => !p)) throw new ScoringError(403, t("service.lane_assignments_have_changed_ask_the_organizer_for_a"));
  const rounds: ScoringContext['rounds'] = [];
  for (const person of assigned) {
    const card = db.select().from(scorecards).where(and(eq(scorecards.competitionId, competition.id), eq(scorecards.participantId, person.id))).get();
    if (!card) continue;
    for (const round of db.select().from(roundScores).where(eq(roundScores.scorecardId, card.id)).orderBy(roundScores.roundNumber).all()) {
      const arrows: (string | null)[] = Array.from({ length: competition.arrowsPerRound }, () => null);
      for (const arrow of db.select().from(arrowScores).where(eq(arrowScores.roundScoreId, round.id)).all()) arrows[arrow.arrowIndex - 1] = arrow.symbol;
      rounds.push({ participantId: person.id, roundNumber: round.roundNumber, status: round.status, arrows,
        total: arrows.reduce<number>((sum, value) => sum + (value === 'M' || value === null ? 0 : Number(value)), 0) });
    }
  }
  return { competition: { id: competition.id, name: competition.name, numberOfRounds: competition.numberOfRounds,
    arrowsPerRound: competition.arrowsPerRound, status: competition.status, scoringLocked: competition.scoringLocked },
    lane: { id: lane.id, number: lane.number }, version: state.version, currentRoundNumber: state.currentRoundNumber,
    currentParticipantId: state.currentParticipantId, completed: state.completed,
    participants: people.filter((p) => p !== undefined), rounds };
}

export function saveScores(db: Database, grantId: string, sessionId: string, body: ScoringMutation) {
  const grant = validGrant(db, grantId);
  const requestHash = hashToken(JSON.stringify({ grantId, expectedVersion: body.expectedVersion,
    participantId: body.participantId, roundNumber: body.roundNumber, arrows: body.arrows, submit: body.submit }));
  const previous = db.select().from(scoringMutations).where(eq(scoringMutations.id, body.submissionId)).get();
  if (previous) {
    if (previous.sessionId !== sessionId || previous.requestHash !== requestHash) throw new ScoringError(409, t("service.submission_id_has_already_been_used_with_different_input"));
    return previous.result;
  }
  const competition = db.select().from(competitions).where(eq(competitions.id, grant.competitionId)).get()!;
  if (competition.status !== 'Active' || competition.scoringLocked) throw new ScoringError(403, t("service.scoring_is_paused_or_the_competition_is_closed"));
  const state = db.select().from(laneScoringState).where(and(eq(laneScoringState.competitionId, grant.competitionId),
    eq(laneScoringState.laneId, grant.laneId))).get();
  if (!state || state.version !== body.expectedVersion) throw new ScoringError(409, t("ScoringPage.lane_progress_changed_on_another_device_reload_the_latest"));
  const assignment = db.select().from(competitionParticipants).where(and(eq(competitionParticipants.competitionId, grant.competitionId),
    eq(competitionParticipants.participantId, body.participantId), eq(competitionParticipants.laneId, grant.laneId))).get();
  if (!assignment) throw new ScoringError(403, t("service.this_participant_is_not_assigned_to_your_lane"));
  if (body.roundNumber > competition.numberOfRounds || body.arrows.length !== competition.arrowsPerRound
    || body.arrows.some((s) => s !== null && !/^(M|[1-9]|10)$/.test(s))
    || (body.submit && body.arrows.some((s) => s === null))) throw new ScoringError(400, t("service.enter_the_configured_number_of_valid_arrow_scores"));
  if (body.roundNumber > state.currentRoundNumber) {
    throw new ScoringError(409, t("service.finish_round_for_everyone_in_your_lane_before_entering", { p0: state.currentRoundNumber, p1: body.roundNumber }));
  }
  const now = Date.now();
  let card = db.select().from(scorecards).where(and(eq(scorecards.competitionId, grant.competitionId), eq(scorecards.participantId, body.participantId))).get();
  if (!card) card = db.insert(scorecards).values({ id: randomUUID(), competitionId: grant.competitionId,
    participantId: body.participantId, createdAt: now, updatedAt: now }).returning().get();
  let round = db.select().from(roundScores).where(and(eq(roundScores.scorecardId, card.id), eq(roundScores.roundNumber, body.roundNumber))).get();
  if (round?.status === 'submitted' && !body.submit) throw new ScoringError(409, t("service.save_a_complete_correction_to_update_a_submitted_round"));
  if (!round) round = db.insert(roundScores).values({ id: randomUUID(), scorecardId: card.id, roundNumber: body.roundNumber }).returning().get();
  const before: (string | null)[] = Array.from({ length: competition.arrowsPerRound }, () => null);
  for (const arrow of db.select().from(arrowScores).where(eq(arrowScores.roundScoreId, round.id)).all()) before[arrow.arrowIndex - 1] = arrow.symbol;
  db.delete(arrowScores).where(eq(arrowScores.roundScoreId, round.id)).run();
  body.arrows.forEach((symbol, index) => {
    if (symbol !== null) db.insert(arrowScores).values({ roundScoreId: round.id, arrowIndex: index + 1, symbol }).run();
  });
  if (body.submit) db.update(roundScores).set({ status: 'submitted', submittedAt: now }).where(eq(roundScores.id, round.id)).run();
  db.update(scorecards).set({ version: card.version + 1, updatedAt: now }).where(eq(scorecards.id, card.id)).run();
  let nextParticipant: string | null = state.currentParticipantId; let nextRound = state.currentRoundNumber; let completed = state.completed;
  if (body.submit) {
    const submitted = db.select({ participantId: scorecards.participantId, roundNumber: roundScores.roundNumber })
      .from(scorecards).innerJoin(roundScores, eq(roundScores.scorecardId, scorecards.id))
      .where(and(eq(scorecards.competitionId, grant.competitionId), eq(roundScores.status, 'submitted'))).all();
    const saved = new Set(submitted.map((r) => `${r.participantId}/${r.roundNumber}`));
    nextParticipant = null; completed = true;
    for (let number = 1; number <= competition.numberOfRounds; number++) {
      const missing = state.participantOrder.find((id) => !saved.has(`${id}/${number}`));
      if (missing) { nextParticipant = missing; nextRound = number; completed = false; break; }
    }
  }
  const result = { version: state.version + 1 };
  const updated = db.update(laneScoringState).set({ version: result.version, currentParticipantId: nextParticipant,
    currentRoundNumber: nextRound, completed, updatedAt: now }).where(and(eq(laneScoringState.competitionId, grant.competitionId),
    eq(laneScoringState.laneId, grant.laneId), eq(laneScoringState.version, body.expectedVersion))).returning().get();
  if (!updated) throw new ScoringError(409, t("service.lane_progress_changed_reload_the_latest_scores"));
  db.insert(scoringMutations).values({ id: body.submissionId, sessionId, requestHash, result, createdAt: now }).run();
  db.insert(scoreChanges).values({ id: randomUUID(), scorecardId: card.id, sessionId, mutationId: body.submissionId,
    roundNumber: body.roundNumber, before, after: body.arrows, submitted: body.submit, createdAt: now }).run();
  return result;
}
