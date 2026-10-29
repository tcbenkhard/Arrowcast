import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { DatabaseContext } from './db/context.js';
import type { AuthConfig } from './modules/auth/config.js';
import { apiTokenRoutes } from './modules/api-tokens/routes.js';
import { accountRoutes, authRoutes } from './modules/auth/routes.js';
import { AuthenticationService } from './modules/auth/service.js';
import { administratorOnly, authenticatedManagement, passwordChanged } from './modules/auth/policies.js';
import { userRoutes } from './modules/auth/users.js';
import { clubSettingsRoutes } from './modules/clubs/routes.js';
import { competitionRoutes } from './modules/competitions/routes.js';
import { adminLogbookRoutes, logbookRoutes } from './modules/logbook/routes.js';
import { logRoutes } from './modules/logs/routes.js';
import { networkRoutes } from './modules/network/routes.js';
import { participantManagementRoutes } from './modules/participants/management.js';
import { participantRoutes } from './modules/participants/routes.js';
import { publicAccessRoutes, scoringOriginRoutes } from './modules/public-access/routes.js';
import { rangeRoutes } from './modules/ranges/routes.js';
import { adminScoringRoutes, scoringRoutes } from './modules/scoring/routes.js';
import { targetTypeRoutes } from './modules/target-types/routes.js';
import { updateRoutes } from './modules/updates/routes.js';

/** Composition root: plugins, access scopes and feature registration. */
export async function apiRoutes(app: FastifyInstance, config: AuthConfig & { context: DatabaseContext }) {
  const context = config.context;
  const service = await AuthenticationService.create(context);
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '24h', iss: 'arrowcast', aud: 'arrowcast-admin' },
    verify: { algorithms: ['HS256'], allowedIss: 'arrowcast', allowedAud: 'arrowcast-admin' },
  });
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  await app.register(authRoutes, { service });
  await app.register(scoringRoutes, { context, prefix: '/scoring' });
  await app.register(logbookRoutes, { context, prefix: '/scoring/logbook' });
  await app.register(
    async (admin) => {
      admin.addHook('onRequest', authenticatedManagement(context));
      await admin.register(accountRoutes, { service });
      await admin.register(async (features) => {
        features.addHook('onRequest', passwordChanged(context));
        await features.register(async (settings) => {
          settings.addHook('onRequest', administratorOnly);
          await settings.register(apiTokenRoutes, { context });
          await settings.register(clubSettingsRoutes, { context });
          await settings.register(userRoutes, { context });
          await settings.register(updateRoutes);
          await settings.register(logRoutes);
          await settings.register(networkRoutes);
          await settings.register(publicAccessRoutes);
          await settings.register(participantRoutes, { context });
        });
        await features.register(rangeRoutes, { context });
        await features.register(scoringOriginRoutes);
        await features.register(competitionRoutes, { context });
        await features.register(targetTypeRoutes, { context });
        await features.register(participantManagementRoutes, { context });
        await features.register(adminScoringRoutes, { context });
        await features.register(adminLogbookRoutes, { context });
      });
    },
    { prefix: '/admin' },
  );
}
