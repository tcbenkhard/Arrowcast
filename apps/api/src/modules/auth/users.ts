import { t } from '@arrowcast/contracts/i18n';
import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from '../../db/context.js';
import { UserService, type UserInput } from './user-service.js';
const properties = {
  name: { type: 'string', minLength: 1, maxLength: 100 },
  username: { type: 'string', minLength: 1, maxLength: 100 },
  password: { type: 'string', minLength: 8, maxLength: 1024 },
  role: { type: 'string', enum: ['admin', 'competition_manager'] },
  language: { type: 'string', enum: ['nl', 'en'] },
};
export async function userRoutes(app: FastifyInstance, { context }: { context: DatabaseContext }) {
  const service = new UserService(context);
  app.addHook('onRequest', async (request, reply) => {
    if (request.user.role !== 'admin')
      return reply.code(403).send({ message: t('users.only_administrators_can_manage_users') });
  });

  app.get('/users', async () => service.list());
  app.delete<{ Params: { username: string } }>(
    '/users/:username',
    { schema: { params: { type: 'object', required: ['username'], properties: { username: properties.username } } } },
    async (request) => service.remove(request.params.username, request.user.sub),
  );
  app.post<{ Body: UserInput }>(
    '/users',
    {
      bodyLimit: 8192,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'username', 'password', 'role'],
          properties,
        },
      },
    },
    async (request, reply) => reply.code(201).send(await service.create(request.body)),
  );
  app.put<{ Params: { username: string }; Body: UserInput }>(
    '/users/:username',
    {
      bodyLimit: 8192,
      schema: {
        params: { type: 'object', required: ['username'], properties: { username: properties.username } },
        body: { type: 'object', additionalProperties: false, required: ['name', 'username', 'role'], properties },
      },
    },
    async (request) => service.update(request.params.username, request.body, request.user.sub),
  );
}
