import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { applicationErrorHandler } from '../../shared/http-errors.js';
import { ParticipantDirectoryService } from './directory-service.js';
import { ParticipantRegistrationService } from './registration-service.js';
import type { AddParticipant } from './types.js';

const nonBlank = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
const participantIds = { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true, items: nonBlank };
const targetType = { ...nonBlank, maxLength: 100 };
const params = {
  type: 'object',
  required: ['competitionId'],
  properties: { competitionId: { type: 'string', minLength: 1 } },
};

export async function participantManagementRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const directory = new ParticipantDirectoryService(context);
  const registrations = new ParticipantRegistrationService(context);
  app.setErrorHandler(applicationErrorHandler);

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
    async (request) => directory.search(request.query.q?.trim() ?? ''),
  );
  app.get('/clubs', async () => directory.clubs());
  app.get('/bow-types', async () => directory.bowTypes());

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );
  app.post<{ Params: { competitionId: string }; Body: Buffer }>(
    '/competitions/:competitionId/participants/import',
    { bodyLimit: 5 * 1024 * 1024, schema: { params } },
    async (request) => registrations.importWorkbook(request.params.competitionId, request.body),
  );
  app.patch<{ Params: { competitionId: string }; Body: { participantIds: string[]; targetType: string } }>(
    '/competitions/:competitionId/participants',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['participantIds', 'targetType'],
          properties: { participantIds, targetType },
        },
      },
    },
    async (request) =>
      registrations.changeTarget(
        request.params.competitionId,
        request.body.participantIds,
        request.body.targetType.trim(),
      ),
  );
  app.patch<{ Params: { competitionId: string; participantId: string }; Body: { checkedIn: boolean } }>(
    '/competitions/:competitionId/participants/:participantId/check-in',
    {
      schema: {
        params: {
          type: 'object',
          required: ['competitionId', 'participantId'],
          properties: { ...params.properties, participantId: nonBlank },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['checkedIn'],
          properties: { checkedIn: { type: 'boolean' } },
        },
      },
    },
    async (request) =>
      registrations.checkIn(request.params.competitionId, request.params.participantId, request.body.checkedIn),
  );
  app.delete<{ Params: { competitionId: string }; Body: { participantIds: string[] } }>(
    '/competitions/:competitionId/participants',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['participantIds'],
          properties: { participantIds },
        },
      },
    },
    async (request) => registrations.remove(request.params.competitionId, request.body.participantIds),
  );
  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/participants',
    { schema: { params } },
    async (request) => registrations.list(request.params.competitionId),
  );
  app.post<{ Params: { competitionId: string }; Body: AddParticipant }>(
    '/competitions/:competitionId/participants',
    {
      schema: {
        params,
        body: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['participantId', 'bowType', 'targetType'],
              properties: { participantId: nonBlank, bowType: nonBlank, targetType },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'federationNumber', 'clubNumber', 'bowType', 'targetType'],
              properties: {
                name: nonBlank,
                federationNumber: nonBlank,
                clubNumber: nonBlank,
                clubName: { type: 'string', maxLength: 200 },
                bowType: nonBlank,
                targetType,
              },
            },
          ],
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(registrations.add(request.params.competitionId, mapAddParticipant(request.body))),
  );
}

function mapAddParticipant(body: AddParticipant): AddParticipant {
  const selection = { bowType: body.bowType.trim(), targetType: body.targetType.trim() };
  if ('participantId' in body) return { participantId: body.participantId, ...selection };
  return {
    ...selection,
    name: body.name.trim(),
    federationNumber: body.federationNumber.trim(),
    clubNumber: body.clubNumber.trim(),
    ...(body.clubName === undefined ? {} : { clubName: body.clubName.trim() }),
  };
}
