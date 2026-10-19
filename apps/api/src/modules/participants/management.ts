import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { bowTypes, clubs, competitionParticipants, competitions, participants, targetTypes } from '../../db/schema.js';

type AddBody = ({ participantId: string } | { name: string; federationNumber: string; clubNumber: string }) & { bowType: string; targetType: string };
const nonBlank = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };

export async function participantManagementRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  const fields = { id: participants.id, federationNumber: participants.federationNumber,
    name: participants.name, clubNumber: participants.clubNumber, clubName: clubs.name };
  const people = () => db.select(fields).from(participants).innerJoin(clubs, eq(participants.clubNumber, clubs.clubNumber));
  app.get<{ Querystring: { q?: string } }>('/participants', {
    schema: { querystring: { type: 'object', additionalProperties: false,
      properties: { q: { type: 'string', maxLength: 200 } } } },
  }, async (request) => {
    const query = request.query.q?.trim() ?? '';
    if (!query) return [];
    const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    const match = terms.map((term) => `"${term}"*`).join(' AND ');
    const byNumber = sql`instr(${participants.federationNumber}, ${query}) > 0`;
    return people().where(match
      ? sql`(${byNumber} OR ${participants.id} IN (
          SELECT p.id FROM participants p JOIN participants_search s ON s.rowid = p.rowid
          WHERE participants_search MATCH ${match}
        ))` : byNumber)
      .orderBy(sql`CASE WHEN ${participants.federationNumber} = ${query} THEN 0 ELSE 1 END`, participants.name, participants.id)
      .limit(20).all();
  });
  app.get('/clubs', async () => db.select().from(clubs).orderBy(clubs.name, clubs.clubNumber).all());
  app.get('/bow-types', async () => db.select().from(bowTypes).orderBy(bowTypes.name).all().map((bow) => bow.name));

  const params = { type: 'object', required: ['competitionId'],
    properties: { competitionId: { type: 'string', minLength: 1 } } };
  const exists = (id: string) => db.select({ id: competitions.id, status: competitions.status }).from(competitions).where(eq(competitions.id, id)).get();
  app.patch<{ Params: { competitionId: string }; Body: { participantIds: string[]; targetType: string } }>('/competitions/:competitionId/participants', {
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['participantIds', 'targetType'],
      properties: {
        participantIds: { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true, items: nonBlank },
        targetType: { ...nonBlank, maxLength: 100 },
      } } },
  }, async (request, reply) => {
    const competitionId = request.params.competitionId;
    if (!exists(competitionId)) return reply.code(404).send({ message: 'Competition not found.' });
    const targetType = request.body.targetType.trim();
    if (!db.select().from(targetTypes).where(eq(targetTypes.name, targetType)).get()) {
      return reply.code(400).send({ message: 'Select an existing target type.' });
    }
    const updated = db.transaction((tx) => {
      const selection = and(eq(competitionParticipants.competitionId, competitionId),
        inArray(competitionParticipants.participantId, request.body.participantIds));
      const registered = tx.select().from(competitionParticipants).where(selection).all();
      if (registered.length !== request.body.participantIds.length) return null;
      if (registered.some((p) => p.laneId && p.targetType !== targetType)) return 'assigned';
      return tx.update(competitionParticipants).set({ targetType }).where(selection)
        .returning({ participantId: competitionParticipants.participantId }).all();
    });
    if (updated === 'assigned') return reply.code(409).send({ message: 'Target changes would invalidate existing shooting assignments.' });
    if (updated === null) return reply.code(404).send({ message: 'One or more participants are not registered for this competition.' });
    return { updatedParticipantIds: updated.map((row) => row.participantId), targetType };
  });
  app.patch<{ Params: { competitionId: string; participantId: string }; Body: { checkedIn: boolean } }>(
    '/competitions/:competitionId/participants/:participantId/check-in', {
      schema: { params: { type: 'object', required: ['competitionId', 'participantId'], properties: {
        ...params.properties, participantId: nonBlank } },
        body: { type: 'object', additionalProperties: false, required: ['checkedIn'], properties: { checkedIn: { type: 'boolean' } } } },
    }, async (request, reply) => {
      const competition = exists(request.params.competitionId);
      if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
      if (competition.status !== 'Check-in') return reply.code(409).send({ message: 'Participants can only check in during check-in.' });
      const updated = db.update(competitionParticipants).set({ checkedIn: request.body.checkedIn }).where(and(
        eq(competitionParticipants.competitionId, competition.id),
        eq(competitionParticipants.participantId, request.params.participantId))).returning().get();
      if (!updated) return reply.code(404).send({ message: 'Participant is not registered for this competition.' });
      return { checkedIn: updated.checkedIn };
    });
  app.delete<{ Params: { competitionId: string }; Body: { participantIds: string[] } }>('/competitions/:competitionId/participants', {
    schema: { params, body: { type: 'object', additionalProperties: false, required: ['participantIds'],
      properties: { participantIds: { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true, items: nonBlank } } } },
  }, async (request, reply) => {
    const competitionId = request.params.competitionId;
    const competition = exists(competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    if (competition.status !== 'Scheduled') return reply.code(409).send({ message: 'Participants can only be removed before check-in.' });
    const removed = db.delete(competitionParticipants).where(and(
      eq(competitionParticipants.competitionId, competitionId),
      inArray(competitionParticipants.participantId, request.body.participantIds),
    )).returning({ participantId: competitionParticipants.participantId }).all();
    return { removedParticipantIds: removed.map((row) => row.participantId) };
  });
  app.get<{ Params: { competitionId: string } }>('/competitions/:competitionId/participants', {
    schema: { params },
  }, async (request, reply) => {
    if (!exists(request.params.competitionId)) return reply.code(404).send({ message: 'Competition not found.' });
    return db.select({ ...fields, bowType: competitionParticipants.bowType, targetType: competitionParticipants.targetType, checkedIn: competitionParticipants.checkedIn,
      laneId: competitionParticipants.laneId, targetLetter: competitionParticipants.targetLetter }).from(participants)
      .innerJoin(clubs, eq(participants.clubNumber, clubs.clubNumber))
      .innerJoin(competitionParticipants, eq(competitionParticipants.participantId, participants.id))
      .where(eq(competitionParticipants.competitionId, request.params.competitionId)).orderBy(participants.name, participants.id).all();
  });
  app.post<{ Params: { competitionId: string }; Body: AddBody }>('/competitions/:competitionId/participants', {
    schema: { params, body: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['participantId', 'bowType', 'targetType'], properties: { participantId: nonBlank, bowType: nonBlank, targetType: { ...nonBlank, maxLength: 100 } } },
      { type: 'object', additionalProperties: false, required: ['name', 'federationNumber', 'clubNumber', 'bowType', 'targetType'],
        properties: { name: nonBlank, federationNumber: nonBlank, clubNumber: nonBlank, bowType: nonBlank, targetType: { ...nonBlank, maxLength: 100 } } },
    ] } },
  }, async (request, reply) => {
    const competitionId = request.params.competitionId;
    const competition = exists(competitionId);
    if (!competition) return reply.code(404).send({ message: 'Competition not found.' });
    if (competition.status !== 'Scheduled') return reply.code(409).send({ message: 'Participants can only be added before check-in.' });
    const body = request.body;
    const bowType = body.bowType.trim();
    if (!db.select().from(bowTypes).where(eq(bowTypes.name, bowType)).get()) {
      return reply.code(400).send({ message: 'Select an existing bow type.' });
    }
    const targetType = body.targetType.trim();
    if (!db.select().from(targetTypes).where(eq(targetTypes.name, targetType)).get()) {
      return reply.code(400).send({ message: 'Select an existing target type.' });
    }
    if ('participantId' in body) {
      const person = people().where(eq(participants.id, body.participantId)).get();
      if (!person) return reply.code(404).send({ message: 'Participant not found.' });
      const added = db.insert(competitionParticipants).values({ competitionId, participantId: person.id, bowType, targetType })
        .onConflictDoNothing().returning().get();
      if (!added) return reply.code(409).send({ message: 'This participant is already in this competition.' });
      return reply.code(201).send({ ...person, bowType, targetType });
    }
    const federationNumber = body.federationNumber.trim();
    const clubNumber = body.clubNumber.trim();
    if (!db.select().from(clubs).where(eq(clubs.clubNumber, clubNumber)).get()) {
      return reply.code(400).send({ message: 'Select an existing club.' });
    }
    if (db.select().from(participants).where(eq(participants.federationNumber, federationNumber)).get()) {
      return reply.code(409).send({ message: 'This federation number already exists. Select the existing participant.' });
    }
    const id = randomUUID();
    db.transaction((tx) => {
      tx.insert(participants).values({ id, name: body.name.trim(), federationNumber, clubNumber }).run();
      tx.insert(competitionParticipants).values({ competitionId, participantId: id, bowType, targetType }).run();
    });
    return reply.code(201).send({ ...people().where(eq(participants.id, id)).get()!, bowType, targetType });
  });
}
