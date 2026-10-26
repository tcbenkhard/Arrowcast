import { t } from '@arrowcast/contracts/i18n';
import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { CompetitionLifecycleService } from './lifecycle.js';
import { CompetitionLaneService } from './lanes.js';
import type { LaneConfiguration } from './lanes.js';
import { CompetitionService } from './service.js';
import {
  competitionListSchema,
  competitionDetailSchema,
  competitionUpdateSchema,
  competitionDeleteSchema,
  competitionStatusSchema,
  competitionScoringSchema,
  competitionReassignSchema,
  competitionLanesSchema,
  competitionLaneUpdateSchema,
  competitionCreateSchema,
} from './schemas.js';
import type { CompetitionStatus, CreateCompetition, UpdateCompetition } from './types.js';

export async function competitionRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new CompetitionService(context);
  const lifecycle = new CompetitionLifecycleService(context);
  const lanes = new CompetitionLaneService(context);
  app.get('/competitions', { schema: competitionListSchema }, async () => service.list());

  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId',
    { schema: competitionDetailSchema },
    async (request) => service.get(request.params.competitionId),
  );

  app.patch<{ Params: { competitionId: string }; Body: UpdateCompetition }>(
    '/competitions/:competitionId',
    { schema: competitionUpdateSchema },
    async (request) => service.update(request.params.competitionId, request.body),
  );

  app.delete<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId',
    { schema: competitionDeleteSchema },
    async (request, reply) => {
      service.delete(request.params.competitionId);
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { competitionId: string }; Body: { status: CompetitionStatus } }>(
    '/competitions/:competitionId/status',
    { schema: competitionStatusSchema },
    async (request) => lifecycle.changeStatus(request.params.competitionId, request.body.status),
  );

  app.patch<{ Params: { competitionId: string }; Body: { numberOfRounds: number; arrowsPerRound: number } }>(
    '/competitions/:competitionId/scoring-settings',
    { schema: competitionScoringSchema },
    async (request) => service.updateScoringSettings(request.params.competitionId, request.body),
  );

  app.post<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/assignments/reassign',
    { schema: competitionReassignSchema },
    async (request) => {
      lifecycle.reassignParticipants(request.params.competitionId);
      return { message: t('routes.checkedin_participants_reassigned') };
    },
  );

  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/lanes',
    { schema: competitionLanesSchema },
    async (request) => lanes.list(request.params.competitionId),
  );

  app.put<{ Params: { competitionId: string; laneId: string }; Body: LaneConfiguration }>(
    '/competitions/:competitionId/lanes/:laneId',
    { schema: competitionLaneUpdateSchema },
    async (request) => lanes.configure(request.params.competitionId, request.params.laneId, request.body),
  );

  app.post<{ Body: CreateCompetition }>('/competitions', { schema: competitionCreateSchema }, async (request, reply) =>
    reply.code(201).send(service.create(request.body)),
  );
}
