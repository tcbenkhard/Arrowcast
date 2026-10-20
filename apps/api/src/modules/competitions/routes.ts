import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { AssignmentError, assignParticipants } from './assignments.js';
import type { LaneQrCode } from '@arrowcast/contracts';
import { initializeLaneScoring, issueLaneCodes, revokeGrants } from '../scoring/service.js';
import { competitionParticipants, competitionLanes, competitionStatuses, competitions, lanes, laneScoringState, rangeDistances, ranges, scorecards, targetTypes } from '../../db/schema.js';
import { arrowScores, laneScoringGrants, roundScores, scoreChanges, scoringMutations, scoringSessions } from '../../db/schema.js';

interface CreateCompetitionBody {
  name: string;
  date: string;
  startingTime: string;
  endingTime: string;
  rangeId: string;
  numberOfRounds?: number;
  arrowsPerRound?: number;
  defaultTargetType?: string | null;
  lanes: { laneId: string; distanceMeters: number }[];
}

const timeSchema = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const numberOfRoundsSchema = { type: 'integer', minimum: 1, maximum: 1000 };
const arrowsPerRoundSchema = { type: 'integer', minimum: 1, maximum: 36 };
const competitionSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'date', 'startingTime', 'endingTime', 'range', 'lanes', 'status'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' },
    startingTime: timeSchema, endingTime: timeSchema,
    status: { type: 'string', enum: [...competitionStatuses] },
    numberOfRounds: numberOfRoundsSchema, arrowsPerRound: arrowsPerRoundSchema,
    defaultTargetType: { type: ['string', 'null'] },
    scoringLocked: { type: 'boolean' },
    range: { type: 'object', additionalProperties: false, required: ['id', 'name'],
      properties: { id: { type: 'string' }, name: { type: 'string' } } },
    lanes: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['laneId', 'number', 'distanceMeters'],
      properties: { laneId: { type: 'string' }, number: { type: 'integer' }, distanceMeters: { type: 'number' } },
    } },
  },
};

export async function competitionRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  const competitionFields = { id: competitions.id, name: competitions.name, date: competitions.date,
    startingTime: competitions.startingTime, endingTime: competitions.endingTime, status: competitions.status,
    numberOfRounds: competitions.numberOfRounds, arrowsPerRound: competitions.arrowsPerRound, scoringLocked: competitions.scoringLocked,
    defaultTargetType: competitions.defaultTargetType,
    range: { id: ranges.id, name: ranges.name } };
  const params = { type: 'object', required: ['competitionId'],
    properties: { competitionId: { type: 'string', minLength: 1 } } };
  const detailSchema = { ...competitionSchema,
    required: ['id', 'name', 'date', 'startingTime', 'endingTime', 'range', 'status'],
    properties: { id: competitionSchema.properties.id, name: competitionSchema.properties.name,
      date: competitionSchema.properties.date, startingTime: timeSchema, endingTime: timeSchema,
      range: competitionSchema.properties.range, status: competitionSchema.properties.status,
      defaultTargetType: competitionSchema.properties.defaultTargetType,
      numberOfRounds: numberOfRoundsSchema, arrowsPerRound: arrowsPerRoundSchema, scoringLocked: { type: 'boolean' } } };
  const laneSchema = { type: 'object', additionalProperties: false,
    required: ['laneId', 'number', 'distanceMeters', 'targetType', 'numberOfTargets'],
    properties: { laneId: { type: 'string' }, number: { type: 'integer' }, distanceMeters: { type: 'number' },
      targetType: { type: ['string', 'null'] }, numberOfTargets: { type: 'integer' } } };
  function findCompetition(id: string) {
    return db.select(competitionFields).from(competitions).innerJoin(ranges, eq(competitions.rangeId, ranges.id))
      .where(eq(competitions.id, id)).get();
  }
  function assignedLanes(id: string) {
    return db.select({ laneId: lanes.id, number: lanes.number, distanceMeters: competitionLanes.distanceMeters,
      targetType: competitionLanes.targetType, numberOfTargets: competitionLanes.numberOfTargets })
      .from(competitionLanes).innerJoin(lanes, eq(competitionLanes.laneId, lanes.id))
      .where(eq(competitionLanes.competitionId, id)).orderBy(lanes.number).all();
  }

  app.get('/competitions', { schema: { response: { 200: { type: 'array', items: detailSchema } } } },
    async () => db.select(competitionFields).from(competitions).innerJoin(ranges, eq(competitions.rangeId, ranges.id))
      .orderBy(competitions.date, competitions.startingTime, competitions.id).all());

  app.get<{ Params: { competitionId: string } }>('/competitions/:competitionId', {
    schema: { params, response: { 200: detailSchema } },
  }, async (request, reply) => {
    const competition = findCompetition(request.params.competitionId);
    return competition ?? reply.code(404).send({ message: 'Competition not found.' });
  });

  app.patch<{ Params: { competitionId: string }; Body: {
    name: string; date: string; startingTime: string; endingTime: string;
    defaultTargetType: string | null; numberOfRounds: number; arrowsPerRound: number;
    rangeId?: string; lanes?: { laneId: string; distanceMeters: number }[];
  } }>('/competitions/:competitionId', {
    schema: { params, body: { type: 'object', additionalProperties: false,
      required: ['name', 'date', 'startingTime', 'endingTime', 'defaultTargetType', 'numberOfRounds', 'arrowsPerRound'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
        date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        startingTime: timeSchema, endingTime: timeSchema,
        defaultTargetType: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' }, { type: 'null' }] },
        numberOfRounds: numberOfRoundsSchema, arrowsPerRound: arrowsPerRoundSchema,
        rangeId: { type: 'string', minLength: 1 },
        lanes: { type: 'array', minItems: 1, maxItems: 1000, items: {
          type: 'object', additionalProperties: false, required: ['laneId', 'distanceMeters'],
          properties: { laneId: { type: 'string', minLength: 1 }, distanceMeters: { type: 'number', exclusiveMinimum: 0 } },
        } },
      } }, response: { 200: detailSchema } },
  }, async (request, reply) => {
    const competition = findCompetition(request.params.competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    const body = request.body;
    const date = new Date(`${body.date}T00:00:00Z`);
    if (body.date.startsWith('0000') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) {
      return reply.code(400).send({ message: 'Enter a valid competition date.' });
    }
    if (body.endingTime <= body.startingTime) {
      return reply.code(400).send({ message: 'Ending time must be after starting time on the competition date.' });
    }
    if ((body.numberOfRounds !== competition.numberOfRounds || body.arrowsPerRound !== competition.arrowsPerRound)
      && (competition.status !== 'Scheduled' || db.select({ id: scorecards.id }).from(scorecards).where(eq(scorecards.competitionId, competition.id)).get())) {
      return reply.code(409).send({ message: 'Configure scoring before check-in and before any scores exist.' });
    }
    const defaultTargetType = body.defaultTargetType?.trim() ?? null;
    if (defaultTargetType && !db.select().from(targetTypes).where(eq(targetTypes.name, defaultTargetType)).get()) {
      return reply.code(400).send({ message: 'Select an existing default target type.' });
    }
    const rangeChanged = body.rangeId !== undefined && body.rangeId !== competition.range.id;
    const currentLanes = assignedLanes(competition.id);
    const lanesChanged = rangeChanged || (body.lanes !== undefined && (body.lanes.length !== currentLanes.length
      || body.lanes.some((lane) => !currentLanes.some((current) => current.laneId === lane.laneId && current.distanceMeters === lane.distanceMeters))));
    if (rangeChanged || body.lanes !== undefined) {
      if (lanesChanged && (competition.status !== 'Scheduled' || db.select({ id: scorecards.id }).from(scorecards).where(eq(scorecards.competitionId, competition.id)).get())) {
        return reply.code(409).send({ message: 'Change the range or lanes before check-in and before any scores exist.' });
      }
      if (!body.lanes?.length || new Set(body.lanes.map((lane) => lane.laneId)).size !== body.lanes.length) {
        return reply.code(400).send({ message: 'Select at least one lane and select each lane only once.' });
      }
      const range = db.select().from(ranges).where(eq(ranges.id, body.rangeId ?? competition.range.id)).get();
      if (!range) return reply.code(400).send({ message: 'Select an existing range.' });
      const availableLanes = new Set(db.select({ id: lanes.id }).from(lanes).where(eq(lanes.rangeId, range.id)).all().map((lane) => lane.id));
      const distances = new Set(db.select().from(rangeDistances).where(eq(rangeDistances.rangeId, range.id)).all().map((value) => value.distanceMeters));
      if (body.lanes.some((lane) => !availableLanes.has(lane.laneId) || !distances.has(lane.distanceMeters))) {
        return reply.code(400).send({ message: 'Choose lanes and supported distances from the selected range.' });
      }
    }
    db.transaction((tx) => {
      if (lanesChanged) {
        const grants = tx.select({ id: laneScoringGrants.id }).from(laneScoringGrants).where(eq(laneScoringGrants.competitionId, competition.id));
        const sessions = tx.select({ id: scoringSessions.id }).from(scoringSessions).where(inArray(scoringSessions.grantId, grants));
        tx.delete(scoringMutations).where(inArray(scoringMutations.sessionId, sessions)).run();
        tx.delete(scoringSessions).where(inArray(scoringSessions.grantId, grants)).run();
        tx.delete(laneScoringGrants).where(eq(laneScoringGrants.competitionId, competition.id)).run();
        tx.delete(laneScoringState).where(eq(laneScoringState.competitionId, competition.id)).run();
        tx.update(competitionParticipants).set({ laneId: null, targetLetter: null }).where(eq(competitionParticipants.competitionId, competition.id)).run();
        tx.delete(competitionLanes).where(eq(competitionLanes.competitionId, competition.id)).run();
      }
      const { lanes: _lanes, rangeId, ...details } = body;
      tx.update(competitions).set({ ...details, name: body.name.trim(), defaultTargetType,
        ...(rangeChanged ? { rangeId } : {}),
      }).where(eq(competitions.id, competition.id)).run();
      if (lanesChanged) {
        for (const lane of body.lanes!) {
          const retained = currentLanes.find((current) => current.laneId === lane.laneId);
          tx.insert(competitionLanes).values({ competitionId: competition.id, rangeId: body.rangeId ?? competition.range.id, ...lane,
            targetType: retained ? retained.targetType : defaultTargetType,
            numberOfTargets: retained?.numberOfTargets ?? 1 }).run();
        }
      }
    });
    return findCompetition(competition.id);
  });

  app.delete<{ Params: { competitionId: string } }>('/competitions/:competitionId', {
    schema: { params },
  }, async (request, reply) => {
    const competition = findCompetition(request.params.competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    // Remove dependent scoring records before their parents; all changes roll back together.
    db.transaction((tx) => {
      const cards = tx.select({ id: scorecards.id }).from(scorecards).where(eq(scorecards.competitionId, competition.id));
      const rounds = tx.select({ id: roundScores.id }).from(roundScores).where(inArray(roundScores.scorecardId, cards));
      const grants = tx.select({ id: laneScoringGrants.id }).from(laneScoringGrants).where(eq(laneScoringGrants.competitionId, competition.id));
      const sessions = tx.select({ id: scoringSessions.id }).from(scoringSessions).where(inArray(scoringSessions.grantId, grants));
      tx.delete(scoreChanges).where(inArray(scoreChanges.scorecardId, cards)).run();
      tx.delete(arrowScores).where(inArray(arrowScores.roundScoreId, rounds)).run();
      tx.delete(roundScores).where(inArray(roundScores.scorecardId, cards)).run();
      tx.delete(scorecards).where(eq(scorecards.competitionId, competition.id)).run();
      tx.delete(scoringMutations).where(inArray(scoringMutations.sessionId, sessions)).run();
      tx.delete(scoringSessions).where(inArray(scoringSessions.grantId, grants)).run();
      tx.delete(laneScoringGrants).where(eq(laneScoringGrants.competitionId, competition.id)).run();
      tx.delete(laneScoringState).where(eq(laneScoringState.competitionId, competition.id)).run();
      tx.delete(competitionParticipants).where(eq(competitionParticipants.competitionId, competition.id)).run();
      tx.delete(competitionLanes).where(eq(competitionLanes.competitionId, competition.id)).run();
      tx.delete(competitions).where(eq(competitions.id, competition.id)).run();
    });
    return reply.code(204).send();
  });

  app.patch<{ Params: { competitionId: string }; Body: { status: typeof competitionStatuses[number] } }>('/competitions/:competitionId/status', {
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['status'],
      properties: { status: competitionSchema.properties.status } }, response: { 200: { ...detailSchema,
        properties: { ...detailSchema.properties, qrCodes: { type: 'array', items: { type: 'object',
          properties: { grantId: { type: 'string' }, laneId: { type: 'string' }, laneNumber: { type: 'integer' },
            path: { type: 'string' }, expiresAt: { type: 'integer' } } } } } } } },
  }, async (request, reply) => {
    const current = findCompetition(request.params.competitionId);
    if (!current) return reply.code(404).send({ message: 'Competition not found.' });
    const currentIndex = competitionStatuses.indexOf(current.status);
    const targetIndex = competitionStatuses.indexOf(request.body.status);
    if (targetIndex === currentIndex || targetIndex > currentIndex + 1) {
      return reply.code(409).send({ message: 'Move to the next status or an earlier status in the competition flow.' });
    }
    if (targetIndex < 2 && db.select({ id: scorecards.id }).from(scorecards).where(eq(scorecards.competitionId, current.id)).get()) {
      return reply.code(409).send({ message: 'Scores already exist. Participants, assignments and scoring format must remain unchanged.' });
    }
    let updated;
    let qrCodes: LaneQrCode[] | undefined;
    try {
      updated = db.transaction((tx) => {
        if (targetIndex < 2) {
          revokeGrants(tx, current.id);
          tx.delete(laneScoringState).where(eq(laneScoringState.competitionId, current.id)).run();
        }
        if (request.body.status === 'Closed') revokeGrants(tx, current.id);
        if (request.body.status === 'Check-in') assignParticipants(tx, current.id);
        if (request.body.status === 'Active') {
          initializeLaneScoring(tx, current.id);
          if (current.status === 'Check-in') qrCodes = issueLaneCodes(tx, current.id);
        }
        return tx.update(competitions).set({ status: request.body.status })
          .where(and(eq(competitions.id, current.id), eq(competitions.status, current.status))).returning().get();
      });
    } catch (error) {
      if (error instanceof AssignmentError) return reply.code(409).send({ message: error.message });
      throw error;
    }
    if (!updated) return reply.code(409).send({ message: 'Competition status has changed. Reload and try again.' });
    return { ...findCompetition(current.id)!, ...(qrCodes ? { qrCodes } : {}) };
  });

  app.patch<{ Params: { competitionId: string }; Body: { numberOfRounds: number; arrowsPerRound: number } }>('/competitions/:competitionId/scoring-settings', {
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['numberOfRounds', 'arrowsPerRound'],
      properties: { numberOfRounds: numberOfRoundsSchema, arrowsPerRound: arrowsPerRoundSchema } }, response: { 200: detailSchema } },
  }, async (request, reply) => {
    const competition = findCompetition(request.params.competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    if (competition.status !== 'Scheduled' || db.select({ id: scorecards.id }).from(scorecards).where(eq(scorecards.competitionId, competition.id)).get()) {
      return reply.code(409).send({ message: 'Configure scoring before check-in and before any scores exist.' });
    }
    db.update(competitions).set(request.body).where(eq(competitions.id, competition.id)).run();
    return findCompetition(competition.id);
  });

  app.post<{ Params: { competitionId: string } }>('/competitions/:competitionId/assignments/reassign', {
    schema: { params },
  }, async (request, reply) => {
    const competition = findCompetition(request.params.competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    if (competition.status !== 'Check-in') return reply.code(409).send({ message: 'Reassignment is only available during check-in.' });
    try { db.transaction((tx) => assignParticipants(tx, competition.id, true)); }
    catch (error) {
      if (error instanceof AssignmentError) return reply.code(409).send({ message: error.message });
      throw error;
    }
    return { message: 'Checked-in participants reassigned.' };
  });

  app.get<{ Params: { competitionId: string } }>('/competitions/:competitionId/lanes', {
    schema: { params, response: { 200: { type: 'array', items: laneSchema } } },
  }, async (request, reply) => {
    if (!findCompetition(request.params.competitionId)) return reply.code(404).send({ message: 'Competition not found.' });
    return assignedLanes(request.params.competitionId);
  });

  app.put<{ Params: { competitionId: string; laneId: string };
    Body: { targetType: string | null; numberOfTargets: number | null } }>('/competitions/:competitionId/lanes/:laneId', {
    schema: { params: { ...params, required: ['competitionId', 'laneId'],
      properties: { ...params.properties, laneId: { type: 'string', minLength: 1 } } },
      body: { type: 'object', additionalProperties: false, required: ['targetType', 'numberOfTargets'],
        properties: { targetType: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' }, { type: 'null' }] },
          numberOfTargets: { anyOf: [{ type: 'integer', minimum: 1, maximum: 2 }, { type: 'null' }] } } },
      response: { 200: laneSchema } },
  }, async (request, reply) => {
    const { competitionId, laneId } = request.params;
    const competition = findCompetition(competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    if (competition.status !== 'Scheduled') return reply.code(409).send({ message: 'Lanes can only be configured before check-in.' });
    const assigned = db.select().from(competitionParticipants).where(and(
      eq(competitionParticipants.competitionId, competitionId), eq(competitionParticipants.laneId, laneId))).all();
    if (assigned.some((p) => p.targetType !== (request.body.targetType?.trim() ?? null)
      || ((p.targetLetter === 'B' || p.targetLetter === 'D') && (request.body.numberOfTargets ?? 1) < 2))) {
      return reply.code(409).send({ message: 'This change would invalidate existing shooting assignments.' });
    }
    const updated = db.update(competitionLanes).set({
      targetType: request.body.targetType?.trim() ?? null, numberOfTargets: request.body.numberOfTargets ?? 1,
    }).where(and(eq(competitionLanes.competitionId, competitionId), eq(competitionLanes.laneId, laneId))).returning().get();
    if (!updated) return reply.code(404).send({ message: 'Competition lane not found.' });
    return assignedLanes(competitionId).find((lane) => lane.laneId === laneId);
  });

  app.post<{ Body: CreateCompetitionBody }>('/competitions', {
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'date', 'startingTime', 'endingTime', 'rangeId', 'lanes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
          date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
          startingTime: timeSchema, endingTime: timeSchema,
          numberOfRounds: numberOfRoundsSchema, arrowsPerRound: arrowsPerRoundSchema,
          defaultTargetType: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' }, { type: 'null' }] },
          rangeId: { type: 'string', minLength: 1 },
          lanes: { type: 'array', minItems: 1, maxItems: 1000, items: {
            type: 'object', additionalProperties: false, required: ['laneId', 'distanceMeters'],
            properties: { laneId: { type: 'string', minLength: 1 }, distanceMeters: { type: 'number', exclusiveMinimum: 0 } },
          } },
        },
      },
      response: { 201: competitionSchema },
    },
  }, async (request, reply) => {
    const body = request.body;
    const date = new Date(`${body.date}T00:00:00Z`);
    if (body.date.startsWith('0000') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) {
      return reply.code(400).send({ message: 'Enter a valid competition date.' });
    }
    if (body.endingTime <= body.startingTime) {
      return reply.code(400).send({ message: 'Ending time must be after starting time on the competition date.' });
    }
    if (new Set(body.lanes.map((lane) => lane.laneId)).size !== body.lanes.length) {
      return reply.code(400).send({ message: 'Select each lane only once.' });
    }
    const defaultTargetType = body.defaultTargetType?.trim() ?? null;
    const result = db.transaction((tx) => {
      if (defaultTargetType && !tx.select().from(targetTypes).where(eq(targetTypes.name, defaultTargetType)).get()) {
        return { error: 'Select an existing default target type.' };
      }
      const range = tx.select().from(ranges).where(eq(ranges.id, body.rangeId)).get();
      if (!range) return { error: 'Select an existing range.' };
      const availableLanes = new Map(tx.select().from(lanes).where(eq(lanes.rangeId, range.id)).all()
        .map((lane) => [lane.id, lane.number]));
      const availableDistances = new Set(tx.select().from(rangeDistances).where(eq(rangeDistances.rangeId, range.id))
        .all().map((distance) => distance.distanceMeters));
      if (body.lanes.some((lane) => !availableLanes.has(lane.laneId) || !availableDistances.has(lane.distanceMeters))) {
        return { error: 'Choose lanes and supported distances from the selected range.' };
      }
      const { rangeId: _rangeId, ...created } = tx.insert(competitions).values({
        id: randomUUID(), name: body.name.trim(), date: body.date,
        startingTime: body.startingTime, endingTime: body.endingTime, rangeId: range.id,
        numberOfRounds: body.numberOfRounds ?? 10, arrowsPerRound: body.arrowsPerRound ?? 3, defaultTargetType,
      }).returning().get();
      for (const lane of body.lanes) {
        tx.insert(competitionLanes).values({ competitionId: created.id, rangeId: range.id, ...lane, targetType: defaultTargetType }).run();
      }
      return { competition: { ...created, range, lanes: body.lanes.map((lane) => ({
        ...lane, number: availableLanes.get(lane.laneId)!,
      })).sort((a, b) => a.number - b.number) } };
    });
    if (result.error) return reply.code(400).send({ message: result.error });
    return reply.code(201).send(result.competition);
  });
}
