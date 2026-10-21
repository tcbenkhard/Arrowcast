import { t } from '@arrowcast/contracts/i18n';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { competitionRoutes } from '../competitions/routes.js';
import { networkRoutes } from '../network/routes.js';
import { logRoutes } from '../logs/routes.js';
import { participantManagementRoutes } from '../participants/management.js';
import { participantRoutes } from '../participants/routes.js';
import { publicAccessRoutes, scoringOriginRoutes } from '../public-access/routes.js';
import { rangeRoutes } from '../ranges/routes.js';
import { adminScoringRoutes, scoringRoutes } from '../scoring/routes.js';
import { targetTypeRoutes } from '../target-types/routes.js';
import { updateRoutes } from '../updates/routes.js';
import type { AuthConfig } from './config.js';
import { hashPassword, verifyPassword } from './password.js';
import { administratorOnly, authenticatedManagement, passwordChanged } from './policies.js';
import { userRoutes } from './users.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'admin' | 'competition_manager'; sessionVersion?: number };
    user: { sub: string; role: 'admin' | 'competition_manager'; exp: number; sessionVersion?: number };
  }
}

export async function authRoutes(app: FastifyInstance, config: AuthConfig & { db: AppDatabase }) {
  const dummyHash = await hashPassword('unknown-user');
  const findUser = (username: string) => config.db.select().from(users).where(eq(users.username, username)).get();
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '1h', iss: 'arrowcast', aud: 'arrowcast-admin' },
    verify: { algorithms: ['HS256'], allowedIss: 'arrowcast', allowedAud: 'arrowcast-admin' },
  });
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

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
      // Always derive the hash, including for unknown usernames.
      const user = findUser(request.body.username);
      const passwordValid = await verifyPassword(request.body.password, user?.passwordHash ?? dummyHash);
      if (!passwordValid || !user || !['admin', 'competition_manager'].includes(user.role)) {
        return reply.code(401).send({ message: t('AdminPage.gebruikersnaam_of_wachtwoord_is_onjuist', {}, 'nl') });
      }
      const token = await reply.jwtSign({ sub: user.username, role: user.role, sessionVersion: user.sessionVersion });
      return {
        token,
        expiresAt: app.jwt.decode<{ exp: number }>(token)!.exp * 1000,
        forceChangePassword: user.forceChangePassword,
      };
    },
  );

  // Register every management API route inside this scope to enforce authentication.
  await app.register(scoringRoutes, { db: config.db, prefix: '/scoring' });
  await app.register(
    async (admin) => {
      admin.addHook('onRequest', authenticatedManagement(config.db));
      admin.get('/me', async (request) => ({
        username: request.user.sub,
        name: findUser(request.user.sub)!.name,
        role: request.user.role,
        expiresAt: request.user.exp * 1000,
        forceChangePassword: findUser(request.user.sub)!.forceChangePassword,
        language: findUser(request.user.sub)!.language,
      }));
      admin.patch<{ Body: { language: 'nl' | 'en' } }>(
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
        async (request) => {
          config.db
            .update(users)
            .set({ language: request.body.language })
            .where(eq(users.username, request.user.sub))
            .run();
          return { language: request.body.language };
        },
      );
      admin.post<{ Body: { currentPassword: string; newPassword: string } }>(
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
          const user = findUser(request.user.sub)!;
          if (!(await verifyPassword(request.body.currentPassword, user.passwordHash))) {
            return reply.code(400).send({ message: t('routes.het_huidige_wachtwoord_is_onjuist', {}, 'nl') });
          }
          if (
            request.body.newPassword.trim().length < 8 ||
            request.body.newPassword === 'admin' ||
            (await verifyPassword(request.body.newPassword, user.passwordHash))
          ) {
            return reply
              .code(400)
              .send({ message: t('routes.kies_een_ander_wachtwoord_met_minstens_8_tekens', {}, 'nl') });
          }
          const passwordHash = await hashPassword(request.body.newPassword);
          const changed = config.db
            .update(users)
            .set({ passwordHash, forceChangePassword: false, sessionVersion: user.sessionVersion + 1 })
            .where(
              and(
                eq(users.username, user.username),
                eq(users.passwordHash, user.passwordHash),
                eq(users.sessionVersion, user.sessionVersion),
              ),
            )
            .returning()
            .get();
          if (!changed)
            return reply
              .code(409)
              .send({ message: t('routes.het_wachtwoord_is_ondertussen_gewijzigd_log_opnieuw_in', {}, 'nl') });
          const token = await reply.jwtSign({
            sub: changed.username,
            role: changed.role,
            sessionVersion: changed.sessionVersion,
          });
          return { token, expiresAt: app.jwt.decode<{ exp: number }>(token)!.exp * 1000, forceChangePassword: false };
        },
      );
      await admin.register(async (features) => {
        features.addHook('onRequest', passwordChanged(config.db));
        await features.register(async (settings) => {
          settings.addHook('onRequest', administratorOnly);
          await settings.register(userRoutes, { db: config.db });
          await settings.register(updateRoutes);
          await settings.register(logRoutes);
          await settings.register(networkRoutes);
          await settings.register(publicAccessRoutes);
          await settings.register(participantRoutes, { db: config.db });
        });
        await features.register(rangeRoutes, { db: config.db });
        await features.register(scoringOriginRoutes);
        await features.register(competitionRoutes, { db: config.db });
        await features.register(targetTypeRoutes, { db: config.db });
        await features.register(participantManagementRoutes, { db: config.db });
        await features.register(adminScoringRoutes, { db: config.db });
      });
    },
    { prefix: '/admin' },
  );
}
