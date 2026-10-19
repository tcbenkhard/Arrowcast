import { asc, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { competitionLanes, competitionParticipants, targetTypes } from '../../db/schema.js';

export async function targetTypeRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  app.get('/target-types', {
    schema: { response: { 200: { type: 'array', items: { type: 'string' } } } },
  }, async () => db.select().from(targetTypes).orderBy(asc(sql`lower(${targetTypes.name})`)).all()
    .map((type) => type.name));

  app.post<{ Body: { name: string } }>('/target-types', {
    schema: {
      body: { type: 'object', additionalProperties: false, required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } } },
      response: { 201: { type: 'string' } },
    },
  }, async (request, reply) => {
    const name = request.body.name.trim();
    const created = db.insert(targetTypes).values({ name }).onConflictDoNothing().returning().get();
    if (!created) return reply.code(409).send({ message: 'A target type with this name already exists.' });
    return reply.type('application/json').code(201).send(JSON.stringify(created.name));
  });

  app.delete<{ Body: { names: string[] } }>('/target-types', {
    schema: {
      body: { type: 'object', additionalProperties: false, required: ['names'], properties: {
        names: { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } },
      } },
    },
  }, async (request, reply) => {
    const removed = db.transaction((tx) => {
      const used = tx.select({ name: competitionLanes.targetType }).from(competitionLanes)
        .where(inArray(competitionLanes.targetType, request.body.names)).get();
      const usedByParticipant = tx.select({ name: competitionParticipants.targetType }).from(competitionParticipants)
        .where(inArray(competitionParticipants.targetType, request.body.names)).get();
      if (used || usedByParticipant) return null;
      return tx.delete(targetTypes).where(inArray(targetTypes.name, request.body.names)).returning().all();
    });
    if (removed === null) return reply.code(409).send({ message: 'Een of meer geselecteerde target types zijn in gebruik bij een wedstrijd. Er is niets verwijderd.' });
    return { removed: removed.map((type) => type.name) };
  });

}
