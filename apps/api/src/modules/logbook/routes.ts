import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { protectScoringRequests, secureScoringCookie } from '../../shared/scoring-http.js';
import { logbookContextResponse, logbookEntryResponse } from './responses.js';
import { exportLogbook } from './results-export.js';
import { LogbookService } from './service.js';
import type { LogbookCredentials, LogbookMutation } from './types.js';

const cookieName = 'arrowcast.logbook';
const cookiePath = '/api/v1/scoring/logbook';
const idSchema = { type: 'string', minLength: 1, maxLength: 200 };

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string | undefined) {
  if (!token) return;
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: cookiePath,
    secure: secureScoringCookie(request),
    maxAge: 86400,
  });
}

export async function logbookRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const logbook = new LogbookService(context);
  await app.register(cookie);
  protectScoringRequests(app);
  app.post('/restart', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const result = logbook.restart(request.cookies[cookieName]);
    setSessionCookie(request, reply, result.token);
    return logbookContextResponse(result.context);
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
    async (request) => logbook.searchParticipants(request.query.q),
  );
  app.post<{ Body: LogbookCredentials }>(
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
      const result = await logbook.authenticate(request.body, request.cookies[cookieName]);
      setSessionCookie(request, reply, result.token);
      return logbookContextResponse(result.context);
    },
  );
  app.post('/logout', async (request, reply) => {
    logbook.logout(request.cookies[cookieName]);
    reply.clearCookie(cookieName, { path: cookiePath });
    return { ok: true };
  });
  app.get('/context', async (request) => logbookContextResponse(logbook.getContext(request.cookies[cookieName])));
  app.put<{ Body: LogbookMutation }>(
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
    async (request) => logbookEntryResponse(logbook.saveEntry(request.cookies[cookieName], request.body)),
  );
}

export async function adminLogbookRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const logbook = new LogbookService(context);
  app.get('/logbook', async () => logbook.summary());
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
      const buffer = exportLogbook(logbook.summary(), request.query.language ?? 'nl');
      return reply
        .type('application/vnd.ms-excel')
        .header('Content-Disposition', 'attachment; filename="scorelogboek.xls"')
        .send(buffer);
    },
  );
  app.get<{ Params: { participantId: string } }>(
    '/logbook/:participantId',
    {
      schema: { params: { type: 'object', required: ['participantId'], properties: { participantId: idSchema } } },
    },
    async (request) => logbook.history(request.params.participantId),
  );
}
