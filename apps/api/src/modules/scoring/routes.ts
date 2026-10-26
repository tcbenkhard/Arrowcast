import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { ScoringMutation } from '@arrowcast/contracts';
import type { DatabaseContext } from '../../db/context.js';
import { protectScoringRequests, secureScoringCookie } from '../../shared/scoring-http.js';
import { ScoringError } from './errors.js';
import { ScoringSessionService } from './sessions.js';
import { ScoringAdminService } from './admin-service.js';

const grantParams = {
  type: 'object',
  additionalProperties: false,
  required: ['grantId'],
  properties: { grantId: { type: 'string', format: 'uuid' } },
};
const competitionParams = {
  type: 'object',
  required: ['competitionId'],
  properties: { competitionId: { type: 'string', minLength: 1 } },
};
const cookieName = 'arrowcast.scoring';
const cookiePath = (id: string) => `/api/v1/scoring/${id}`;

export async function scoringRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new ScoringSessionService(context);
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ScoringError)
      return reply.code(error.statusCode).send({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  });
  protectScoringRequests(app, { hideReferrer: true });
  app.post<{ Params: { grantId: string }; Body: { token: string } }>(
    '/:grantId/exchange',
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: grantParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } },
        },
      },
    },
    async (request, reply) => {
      const { context, token, maxAge } = service.exchangeScoringToken(request.params.grantId, request.body.token);
      reply.setCookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'strict',
        path: cookiePath(request.params.grantId),
        secure: secureScoringCookie(request),
        maxAge,
      });
      return context;
    },
  );
  app.get<{ Params: { grantId: string } }>('/:grantId/context', { schema: { params: grantParams } }, async (request) =>
    service.getScoringContext(request.params.grantId, request.cookies[cookieName]),
  );
  app.post<{ Params: { grantId: string }; Body: ScoringMutation }>(
    '/:grantId/scores',
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        params: grantParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['submissionId', 'expectedVersion', 'participantId', 'roundNumber', 'arrows', 'submit'],
          properties: {
            submissionId: { type: 'string', format: 'uuid' },
            expectedVersion: { type: 'integer', minimum: 0 },
            participantId: { type: 'string', minLength: 1, maxLength: 100 },
            roundNumber: { type: 'integer', minimum: 1, maximum: 1000 },
            arrows: {
              type: 'array',
              minItems: 1,
              maxItems: 36,
              items: {
                anyOf: [
                  { type: 'null' },
                  { type: 'string', enum: ['M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
                ],
              },
            },
            submit: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => service.submitScores(request.params.grantId, request.cookies[cookieName], request.body),
  );
}

export async function adminScoringRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new ScoringAdminService(context);
  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes',
    { schema: { params: competitionParams } },
    async (request) => service.listScoringCodes(request.params.competitionId),
  );
  app.post<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes/restore',
    { schema: { params: competitionParams } },
    async (request, reply) => {
      service.restoreScoringCodes(request.params.competitionId);
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-standings',
    { schema: { params: competitionParams } },
    async (request) => service.getScoringStandings(request.params.competitionId),
  );
  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/results-export',
    { schema: { params: competitionParams } },
    async (request, reply) => {
      const result = service.getResultsExport(request.params.competitionId);
      return reply
        .type('application/vnd.ms-excel')
        .header(
          'Content-Disposition',
          `attachment; filename="results.xls"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        )
        .send(result.buffer);
    },
  );
  app.post<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes',
    { schema: { params: competitionParams } },
    async (request) => service.issueScoringCodes(request.params.competitionId),
  );
  app.delete<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes',
    { schema: { params: competitionParams } },
    async (request, reply) => {
      service.revokeScoringCodes(request.params.competitionId);
      return reply.code(204).send();
    },
  );
  app.patch<{ Params: { competitionId: string }; Body: { scoringLocked: boolean } }>(
    '/competitions/:competitionId/scoring-lock',
    {
      schema: {
        params: competitionParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['scoringLocked'],
          properties: { scoringLocked: { type: 'boolean' } },
        },
      },
    },
    async (request) => service.setScoringLock(request.params.competitionId, request.body.scoringLocked),
  );
}
