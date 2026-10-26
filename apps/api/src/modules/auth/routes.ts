import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthenticationService, SessionIdentity } from './service.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'admin' | 'competition_manager'; sessionVersion?: number };
    user: { sub: string; role: 'admin' | 'competition_manager'; exp: number; sessionVersion?: number };
  }
}

type RouteOptions = { service: AuthenticationService };

export async function authRoutes(app: FastifyInstance, { service }: RouteOptions) {
  app.post<{ Body: { username: string; password: string } }>(
    '/auth/login',
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 100 },
            password: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await service.authenticate(request.body.username, request.body.password);
      return sessionResponse(app, reply, user);
    },
  );
}

export async function accountRoutes(app: FastifyInstance, { service }: RouteOptions) {
  app.get('/me', async (request) => ({
    ...service.profile(request.user.sub),
    expiresAt: request.user.exp * 1000,
  }));
  app.patch<{ Body: { language: 'nl' | 'en' } }>(
    '/me/language',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['language'],
          properties: { language: { type: 'string', enum: ['nl', 'en'] } },
        },
      },
    },
    async (request) => service.changeLanguage(request.user.sub, request.body.language),
  );
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/password',
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
            newPassword: { type: 'string', minLength: 8, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await service.changePassword(
        request.user.sub,
        request.body.currentPassword,
        request.body.newPassword,
      );
      return sessionResponse(app, reply, user);
    },
  );
}

async function sessionResponse(app: FastifyInstance, reply: FastifyReply, user: SessionIdentity) {
  const token = await reply.jwtSign({ sub: user.username, role: user.role, sessionVersion: user.sessionVersion });
  return {
    token,
    expiresAt: app.jwt.decode<{ exp: number }>(token)!.exp * 1000,
    forceChangePassword: user.forceChangePassword,
  };
}
