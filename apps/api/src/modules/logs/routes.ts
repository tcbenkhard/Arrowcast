import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { SynchronizationDatabaseClient } from '../scoring/synchronization-database-client.js';
import { LogService, logSources, type LogSource } from './service.js';

export async function logRoutes(
  app: FastifyInstance,
  options: { context?: DatabaseContext; readLogs?: (source: LogSource) => Promise<string> },
) {
  if (options.context) {
    const history = new SynchronizationDatabaseClient(options.context);
    app.get('/logs/synchronizations', { logLevel: 'silent' }, async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { entries: history.list() };
    });
  }
  const service = options.readLogs ? new LogService({ read: options.readLogs }) : new LogService();
  app.get<{ Params: { source: LogSource } }>(
    '/logs/:source',
    {
      // Polling the backend log must not generate more log entries itself.
      logLevel: 'silent',
      schema: {
        params: {
          type: 'object',
          required: ['source'],
          properties: { source: { type: 'string', enum: logSources } },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const result = await service.read(request.params.source);
      return reply.code(result.code).send(result.body);
    },
  );
}
