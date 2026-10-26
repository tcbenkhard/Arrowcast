import type { FastifyInstance, FastifyReply } from 'fastify';
import { UpdateService, type UpdateCommand } from './service.js';

export async function updateRoutes(app: FastifyInstance) {
  const service = new UpdateService();
  async function send(command: UpdateCommand, reply: FastifyReply) {
    const result = await service.execute(command);
    return reply.code(result.code).send(result.body);
  }
  app.get('/updates', async (_request, reply) => send('status', reply));
  app.post('/updates', async (_request, reply) => send('install', reply));
  app.post('/updates/check', async (_request, reply) => send('check', reply));
}
