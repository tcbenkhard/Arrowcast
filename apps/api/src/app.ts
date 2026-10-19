import Fastify from 'fastify';
import { readAuthConfig } from './modules/auth/config.js';
import type { AuthConfig } from './modules/auth/config.js';
import { authRoutes } from './modules/auth/routes.js';
import { openDatabase } from './db/index.js';
import { seedAdmin } from './db/seed.js';

export function buildApp(config: AuthConfig = readAuthConfig()) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization'] },
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const database = openDatabase(config.databasePath);
  app.addHook('onClose', async () => database.close());
  app.register(async (api) => {
    await seedAdmin(database.db);
    await api.register(authRoutes, { ...config, db: database.db, prefix: '/api/v1' });
  });
  return app;
}
