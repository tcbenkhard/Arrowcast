import { t } from '@arrowcast/contracts/i18n';
import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { ParticipantImportJob, type ParticipantImportOptions } from './import-job.js';

export async function participantRoutes(
  app: FastifyInstance,
  options: ParticipantImportOptions & { context: DatabaseContext },
) {
  const job = ParticipantImportJob.create(options.context, {
    ...options,
    onError: (error) => app.log.error({ err: error }, 'Deelnemersimport mislukt'),
  });
  // Finish the import before the parent closes its database.
  app.addHook('onClose', async () => job.waitForCompletion());
  app.get('/participants/import', async () => job.status());
  app.post('/participants/import', async (_request, reply) => {
    const result = await job.start();
    if (result.outcome === 'offline') return reply.code(503).send(result.state);
    if (result.outcome === 'running') {
      return reply.code(409).send({ message: t('routes.er_loopt_al_een_deelnemersimport', {}, 'nl') });
    }
    return reply.code(202).send({ status: 'running', available: true });
  });
}
