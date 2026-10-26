import { randomUUID } from 'node:crypto';
import { t } from '@arrowcast/contracts/i18n';
import { calculateRoundTotal, isValidRound } from '@arrowcast/scoring';
import cookie from '@fastify/cookie';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { utils, write } from 'xlsx';
import type { AppDatabase } from '../../db/index.js';
import { clubs, logbookEntries, logbookPins, participants } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { clubMemberFilter } from '../clubs/routes.js';
import { hashToken, newToken } from '../scoring/service.js';

const cookieName = 'arrowcast.logbook';
const cookiePath = '/api/v1/scoring/logbook';
const idSchema = { type: 'string', minLength: 1, maxLength: 200 };
const emptyRounds = () => Array.from({ length: 10 }, () => Array<string | null>(3).fill(null));

function publicEntry(entry: typeof logbookEntries.$inferSelect) {
  return {
    id: entry.id,
    participantId: entry.participantId,
    rounds: entry.rounds,
    version: entry.version,
    total: entry.total,
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
  };
}

function history(db: AppDatabase, participantId: string) {
  return db
    .select({ id: logbookEntries.id, total: logbookEntries.total, completedAt: logbookEntries.completedAt })
    .from(logbookEntries)
    .where(and(eq(logbookEntries.participantId, participantId), isNotNull(logbookEntries.completedAt)))
    .orderBy(desc(logbookEntries.completedAt), logbookEntries.id)
    .all();
}

export async function logbookRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (
      request.method !== 'GET' &&
      (request.headers['x-arrowcast-scoring'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      return reply.code(403).send({ message: t('routes.open_scoring_on_this_website_to_save_scores') });
    }
  });
  function session(request: FastifyRequest) {
    const token = request.cookies[cookieName];
    const access = token
      ? db
          .select({ id: logbookEntries.id, participantId: logbookEntries.participantId })
          .from(logbookEntries)
          .where(and(eq(logbookEntries.tokenHash, hashToken(token)), sql`${logbookEntries.expiresAt} > ${Date.now()}`))
          .get()
      : undefined;
    if (!access) return undefined;
    return db
      .select({ id: participants.id })
      .from(participants)
      .where(and(eq(participants.id, access.participantId), clubMemberFilter(db)))
      .get()
      ? access
      : undefined;
  }
  function openEntry(request: FastifyRequest, reply: FastifyReply, person: { id: string; name: string }) {
    const participantId = person.id;
    const token = newToken();
    const now = Date.now();
    const entry = db
      .insert(logbookEntries)
      .values({
        id: randomUUID(),
        participantId,
        tokenHash: hashToken(token),
        expiresAt: now + 86400_000,
        rounds: emptyRounds(),
        createdAt: now,
      })
      .returning()
      .get()!;
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: cookiePath,
      secure: request.protocol === 'https' || request.headers.origin?.startsWith('https://') === true,
      maxAge: 86400,
    });
    return {
      participant: { id: person.id, name: person.name },
      entry: publicEntry(entry),
      history: history(db, participantId),
    };
  }
  app.post('/restart', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const access = session(request);
    if (!access) return reply.code(401).send({ message: t('logbook.enterPin') });
    const person = db.select().from(participants).where(eq(participants.id, access.participantId)).get()!;
    const entry = db.select().from(logbookEntries).where(eq(logbookEntries.id, access.id)).get()!;
    if (entry.completedAt === null)
      return {
        participant: { id: person.id, name: person.name },
        entry: publicEntry(entry),
        history: history(db, person.id),
      };
    return openEntry(request, reply, person);
  });
  app.get<{ Querystring: { q?: string } }>(
    '/participants',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { q: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request) => {
      const query = request.query.q?.trim() ?? '';
      if (!query) return [];
      return db
        .select({
          id: participants.id,
          name: participants.name,
          clubName: clubs.name,
          hasPin: sql<boolean>`${logbookPins.participantId} IS NOT NULL`.mapWith(Boolean),
        })
        .from(participants)
        .innerJoin(clubs, eq(clubs.clubNumber, participants.clubNumber))
        .leftJoin(logbookPins, eq(logbookPins.participantId, participants.id))
        .where(and(sql`instr(lower(${participants.name}), lower(${query})) > 0`, clubMemberFilter(db)))
        .orderBy(participants.name, participants.id)
        .limit(20)
        .all();
    },
  );
  app.post<{ Body: { participantId: string; pin: string; createPin: boolean } }>(
    '/authenticate',
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['participantId', 'pin', 'createPin'],
          properties: {
            participantId: idSchema,
            pin: { type: 'string', pattern: '^[0-9]{4,6}$' },
            createPin: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const { participantId, pin, createPin } = request.body;
      const person = db
        .select()
        .from(participants)
        .where(and(eq(participants.id, participantId), clubMemberFilter(db)))
        .get();
      if (!person) return reply.code(404).send({ message: t('logbook.personMissing') });
      const existing = db.select().from(logbookPins).where(eq(logbookPins.participantId, participantId)).get();
      if (existing && createPin) return reply.code(409).send({ message: t('logbook.pinExists') });
      if (!existing && !createPin) return reply.code(409).send({ message: t('logbook.createPin') });
      if (existing && !(await verifyPassword(pin, existing.pinHash))) {
        return reply.code(401).send({ message: t('logbook.wrongPin') });
      }
      if (!existing) {
        const pinHash = await hashPassword(pin);
        const inserted = db
          .insert(logbookPins)
          .values({ participantId, pinHash })
          .onConflictDoNothing()
          .returning()
          .get();
        if (!inserted) return reply.code(409).send({ message: t('logbook.pinExists') });
      }
      // Re-entering a PIN on this device resumes its saved draft, without bypassing the PIN prompt.
      const previous = session(request);
      if (previous?.participantId === participantId) {
        const entry = db.select().from(logbookEntries).where(eq(logbookEntries.id, previous.id)).get();
        if (entry && entry.completedAt === null) {
          return {
            participant: { id: person.id, name: person.name },
            entry: publicEntry(entry),
            history: history(db, participantId),
          };
        }
      }
      return openEntry(request, reply, person);
    },
  );
  app.post('/logout', async (request, reply) => {
    const token = request.cookies[cookieName];
    if (token) {
      db.update(logbookEntries)
        .set({ expiresAt: 0 })
        .where(eq(logbookEntries.tokenHash, hashToken(token)))
        .run();
    }
    reply.clearCookie(cookieName, { path: cookiePath });
    return { ok: true };
  });
  app.get('/context', async (request, reply) => {
    const access = session(request);
    if (!access) return reply.code(401).send({ message: t('logbook.enterPin') });
    const person = db.select().from(participants).where(eq(participants.id, access.participantId)).get()!;
    const entry = db.select().from(logbookEntries).where(eq(logbookEntries.id, access.id)).get()!;
    return {
      participant: { id: person.id, name: person.name },
      entry: publicEntry(entry),
      history: history(db, person.id),
    };
  });
  app.put<{ Body: { entryId: string; rounds: (string | null)[][]; expectedVersion: number; finish: boolean } }>(
    '/entry',
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['entryId', 'rounds', 'expectedVersion', 'finish'],
          properties: {
            entryId: idSchema,
            expectedVersion: { type: 'integer', minimum: 0 },
            finish: { type: 'boolean' },
            rounds: {
              type: 'array',
              minItems: 10,
              maxItems: 10,
              items: {
                type: 'array',
                minItems: 3,
                maxItems: 3,
                items: {
                  anyOf: [
                    { type: 'null' },
                    { type: 'string', enum: ['M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
                  ],
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const access = session(request);
      if (!access) return reply.code(401).send({ message: t('logbook.enterPin') });
      const { rounds, expectedVersion, finish } = request.body;
      if (!rounds.every((round) => isValidRound(round, 3, finish)))
        return reply.code(400).send({ message: t('logbook.completeFirst') });
      const result = db.transaction((tx) => {
        const entry = tx.select().from(logbookEntries).where(eq(logbookEntries.id, access.id)).get()!;
        if (entry.id !== request.body.entryId) return null;
        // An identical retry must never create a second result, even after a lost response.
        if (JSON.stringify(entry.rounds) === JSON.stringify(rounds) && Boolean(entry.completedAt) === finish)
          return entry;
        if (entry.completedAt !== null || entry.version !== expectedVersion) return null;
        return tx
          .update(logbookEntries)
          .set({
            rounds,
            version: entry.version + 1,
            completedAt: finish ? Date.now() : null,
            total: finish ? rounds.reduce((sum, round) => sum + calculateRoundTotal(round), 0) : null,
          })
          .where(eq(logbookEntries.id, entry.id))
          .returning()
          .get()!;
      });
      if (!result) return reply.code(409).send({ message: t('logbook.conflict') });
      return publicEntry(result);
    },
  );
}

export async function adminLogbookRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  const completedEntries = db
    .select({
      participantId: logbookEntries.participantId,
      total: logbookEntries.total,
      rank: sql<number>`row_number() over (partition by ${logbookEntries.participantId} order by ${logbookEntries.completedAt} desc, ${logbookEntries.id} desc)`.as(
        'rank',
      ),
    })
    .from(logbookEntries)
    .where(isNotNull(logbookEntries.completedAt))
    .as('completed_entries');
  const summary = () =>
    db
      .select({
        participantId: participants.id,
        name: participants.name,
        averageScore: sql<number>`avg(case when ${completedEntries.rank} <= 5 then ${completedEntries.total} end)`,
        averagePerArrow: sql<number>`avg(case when ${completedEntries.rank} <= 5 then ${completedEntries.total} end) / 30.0`,
        highestScore: sql<number>`max(${completedEntries.total})`,
      })
      .from(completedEntries)
      .innerJoin(participants, eq(participants.id, completedEntries.participantId))
      .where(clubMemberFilter(db))
      .groupBy(participants.id)
      .orderBy(participants.name, participants.id)
      .all();
  app.get('/logbook', async () => summary());
  app.get<{ Querystring: { language?: 'nl' | 'en' } }>(
    '/logbook/export',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { language: { type: 'string', enum: ['nl', 'en'] } },
        },
      },
    },
    async (request, reply) => {
      const language = request.query.language ?? 'nl';
      const rows = summary();
      const sheet = utils.aoa_to_sheet([
        [
          t('logbook.name', {}, language),
          t('logbook.averageScore', {}, language),
          t('logbook.averageArrow', {}, language),
          t('logbook.highest', {}, language),
        ],
        ...rows.map((row) => [row.name, row.averageScore, row.averagePerArrow, row.highestScore]),
      ]);
      sheet['!cols'] = [32, 22, 24, 20].map((wch) => ({ wch }));
      for (let row = 2; row <= rows.length + 1; row++) {
        sheet[`B${row}`].z = '0.##';
        sheet[`C${row}`].z = '0.##';
      }
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, sheet, t('logbook.title', {}, language));
      return reply
        .type('application/vnd.ms-excel')
        .header('Content-Disposition', 'attachment; filename="scorelogboek.xls"')
        .send(write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer);
    },
  );
  app.get<{ Params: { participantId: string } }>(
    '/logbook/:participantId',
    {
      schema: { params: { type: 'object', required: ['participantId'], properties: { participantId: idSchema } } },
    },
    async (request, reply) => {
      const person = db
        .select()
        .from(participants)
        .where(and(eq(participants.id, request.params.participantId), clubMemberFilter(db)))
        .get();
      if (!person) return reply.code(404).send({ message: t('logbook.personMissing') });
      return history(db, person.id);
    },
  );
}
