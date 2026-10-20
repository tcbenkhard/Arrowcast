import Fastify from 'fastify';
import { readAuthConfig } from './modules/auth/config.js';
import type { AuthConfig } from './modules/auth/config.js';
import { authRoutes } from './modules/auth/routes.js';
import { openDatabase } from './db/index.js';
import { seedAdmin } from './db/seed.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildApp(config: AuthConfig = readAuthConfig()) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] },
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const database = openDatabase(config.databasePath);
  const versionFile = fileURLToPath(new URL('../../../VERSION', import.meta.url));
  const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'development';
  app.get('/api/v1/health', async () => ({ version }));
  app.addHook('onRequest', async (request, reply) => {
    if (request.url !== '/api/v1/health' && existsSync('/var/lib/arrowcast-update/maintenance')) {
      return reply.code(503).send({ message: 'Arrowcast is updating. Please reconnect shortly.' });
    }
  });
  app.addHook('onClose', async () => database.close());
  app.register(async (api) => {
    await seedAdmin(database.db);
    await api.register(authRoutes, { ...config, db: database.db, prefix: '/api/v1' });
  });
  return app;
}
