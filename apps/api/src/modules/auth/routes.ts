import { t } from '@arrowcast/contracts/i18n';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { AuthConfig } from './config.js';
import { hashPassword, verifyPassword } from './password.js';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { rangeRoutes } from '../ranges/routes.js';
import { competitionRoutes } from '../competitions/routes.js';
import { targetTypeRoutes } from '../target-types/routes.js';
import { participantRoutes } from '../participants/routes.js';
import { participantManagementRoutes } from '../participants/management.js';
import { adminScoringRoutes, scoringRoutes } from '../scoring/routes.js';
import { updateRoutes } from '../updates/routes.js';
import { networkRoutes } from '../network/routes.js';
import { userRoutes } from './users.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'admin' | 'competition_manager'; sessionVersion?: number };
    user: { sub: string; role: 'admin' | 'competition_manager'; exp: number; sessionVersion?: number };
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
    if (!passwordValid || !user || !['admin', 'competition_manager'].includes(user.role)) {
      return reply.code(401).send({ message: t("AdminPage.gebruikersnaam_of_wachtwoord_is_onjuist", {}, 'nl') });
    }
    const token = await reply.jwtSign({ sub: user.username, role: user.role, sessionVersion: user.sessionVersion });
    return { token, expiresAt: app.jwt.decode<{ exp: number }>(token)!.exp * 1000,
      forceChangePassword: user.forceChangePassword };
  });

  // Register every management API route inside this scope to enforce authentication.
  await app.register(scoringRoutes, { db: config.db, prefix: '/scoring' });
  await app.register(async (admin) => {
    admin.addHook('onRequest', async (request, reply) => {
      try {
        await request.jwtVerify();
        const user = typeof request.user.sub === 'string' ? findUser(request.user.sub) : undefined;
        if (!user || !['admin', 'competition_manager'].includes(user.role) || request.user.role !== user.role
          || !Number.isFinite(request.user.exp)
          || (request.user.sessionVersion ?? 0) !== user.sessionVersion) {
          return reply.code(401).send({ message: t("PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan", {}, 'nl') });
        }
        if (user.forceChangePassword && !['/api/v1/admin/me', '/api/v1/admin/password'].includes(request.routeOptions.url ?? '')) {
          return reply.code(403).send({ code: 'PASSWORD_CHANGE_REQUIRED', message: t("routes.wijzig_eerst_je_wachtwoord", {}, 'nl') });
        }
        const route = request.routeOptions.url ?? '';
        const settingsOnly = ['/users', '/updates', '/network', '/participants/import']
          .some((path) => route === `/api/v1/admin${path}` || route.startsWith(`/api/v1/admin${path}/`))
          || (request.method !== 'GET' && ['/ranges', '/target-types'].some((path) => route === `/api/v1/admin${path}`));
        if (settingsOnly && user.role !== 'admin') {
          return reply.code(403).send({ message: t("routes.only_administrators_can_access_settings") });
        }
      } catch {
        return reply.code(401).send({ message: t("PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan", {}, 'nl') });
      }
    });
    admin.get('/me', async (request) => ({
      username: request.user.sub,
      name: findUser(request.user.sub)!.name,
      role: request.user.role,
      expiresAt: request.user.exp * 1000,
      forceChangePassword: findUser(request.user.sub)!.forceChangePassword,
      language: findUser(request.user.sub)!.language,
    }));
    admin.patch<{ Body: { language: 'nl' | 'en' } }>('/me/language', {
      schema: { body: {
        type: 'object', additionalProperties: false, required: ['language'],
        properties: { language: { type: 'string', enum: ['nl', 'en'] } },
      } },
    }, async (request) => {
      config.db.update(users).set({ language: request.body.language })
        .where(eq(users.username, request.user.sub)).run();
      return { language: request.body.language };
    });
    admin.post<{ Body: { currentPassword: string; newPassword: string } }>('/password', {
      bodyLimit: 8192,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: {
        type: 'object', additionalProperties: false, required: ['currentPassword', 'newPassword'],
        properties: { currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
          newPassword: { type: 'string', minLength: 8, maxLength: 1024 } },
      } },
    }, async (request, reply) => {
      const user = findUser(request.user.sub)!;
      if (!await verifyPassword(request.body.currentPassword, user.passwordHash)) {
        return reply.code(400).send({ message: t("routes.het_huidige_wachtwoord_is_onjuist", {}, 'nl') });
      }
      if (request.body.newPassword.trim().length < 8 || request.body.newPassword === 'admin'
          || await verifyPassword(request.body.newPassword, user.passwordHash)) {
        return reply.code(400).send({ message: t("routes.kies_een_ander_wachtwoord_met_minstens_8_tekens", {}, 'nl') });
      }
      const passwordHash = await hashPassword(request.body.newPassword);
      const changed = config.db.update(users).set({ passwordHash, forceChangePassword: false,
        sessionVersion: user.sessionVersion + 1 }).where(and(eq(users.username, user.username),
        eq(users.passwordHash, user.passwordHash), eq(users.sessionVersion, user.sessionVersion)))
        .returning().get();
      if (!changed) return reply.code(409).send({ message: t("routes.het_wachtwoord_is_ondertussen_gewijzigd_log_opnieuw_in", {}, 'nl') });
      const token = await reply.jwtSign({ sub: changed.username, role: changed.role, sessionVersion: changed.sessionVersion });
      return { token, expiresAt: app.jwt.decode<{ exp: number }>(token)!.exp * 1000, forceChangePassword: false };
    });
    await admin.register(userRoutes, { db: config.db });
    await admin.register(rangeRoutes, { db: config.db });
    await admin.register(updateRoutes);
    await admin.register(networkRoutes);
    await admin.register(competitionRoutes, { db: config.db });
    await admin.register(targetTypeRoutes, { db: config.db });
    await admin.register(participantRoutes, { db: config.db });
    await admin.register(participantManagementRoutes, { db: config.db });
    await admin.register(adminScoringRoutes, { db: config.db });
  }, { prefix: '/admin' });
}
