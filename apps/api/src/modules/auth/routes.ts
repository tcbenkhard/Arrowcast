import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { AuthConfig } from './config.js';
import { hashPassword, verifyPassword } from './password.js';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { rangeRoutes } from '../ranges/routes.js';
import { competitionRoutes } from '../competitions/routes.js';
import { targetTypeRoutes } from '../target-types/routes.js';
import { participantRoutes } from '../participants/routes.js';
import { participantManagementRoutes } from '../participants/management.js';
import { adminScoringRoutes, scoringRoutes } from '../scoring/routes.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'admin' };
    user: { sub: string; role: 'admin'; exp: number };
  }
}

export async function authRoutes(app: FastifyInstance, config: AuthConfig & { db: AppDatabase }) {
  const dummyHash = await hashPassword('unknown-user');
  const findUser = (username: string) => config.db.select().from(users)
    .where(eq(users.username, username)).get();
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '1h', iss: 'arrowcast', aud: 'arrowcast-admin' },
    verify: { algorithms: ['HS256'], allowedIss: 'arrowcast', allowedAud: 'arrowcast-admin' },
  });
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post<{ Body: { username: string; password: string } }>('/auth/login', {
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
  }, async (request, reply) => {
    // Always derive the hash, including for unknown usernames.
    const user = findUser(request.body.username);
    const passwordValid = await verifyPassword(request.body.password, user?.passwordHash ?? dummyHash);
    if (!passwordValid || !user || user.role !== 'admin') {
      return reply.code(401).send({ message: 'Gebruikersnaam of wachtwoord is onjuist.' });
    }
    const token = await reply.jwtSign({ sub: user.username, role: user.role });
    return { token, expiresAt: app.jwt.decode<{ exp: number }>(token)!.exp * 1000 };
  });

  // Register every management API route inside this scope to enforce authentication.
  await app.register(scoringRoutes, { db: config.db, prefix: '/scoring' });
  await app.register(async (admin) => {
    admin.addHook('onRequest', async (request, reply) => {
      try {
        await request.jwtVerify();
        const user = typeof request.user.sub === 'string' ? findUser(request.user.sub) : undefined;
        if (request.user.role !== 'admin' || user?.role !== 'admin'
          || !Number.isFinite(request.user.exp)) {
          return reply.code(401).send({ message: 'Log opnieuw in om verder te gaan.' });
        }
      } catch {
        return reply.code(401).send({ message: 'Log opnieuw in om verder te gaan.' });
      }
    });
    admin.get('/me', async (request) => ({
      username: request.user.sub,
      role: request.user.role,
      expiresAt: request.user.exp * 1000,
    }));
    await admin.register(rangeRoutes, { db: config.db });
    await admin.register(competitionRoutes, { db: config.db });
    await admin.register(targetTypeRoutes, { db: config.db });
    await admin.register(participantRoutes, { db: config.db });
    await admin.register(participantManagementRoutes, { db: config.db });
    await admin.register(adminScoringRoutes, { db: config.db });
  }, { prefix: '/admin' });
}
