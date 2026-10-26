import Fastify from 'fastify';
import { readAuthConfig } from './modules/auth/config.js';
import type { AuthConfig } from './modules/auth/config.js';
import { apiRoutes } from './api.js';
import { DatabaseConnection } from './db/index.js';
import { AdminBootstrapService } from './modules/auth/bootstrap-service.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applicationErrorHandler } from './shared/http-errors.js';

export function buildApp(config: AuthConfig = readAuthConfig()) {
  const app = Fastify({
    // Both nginx listeners overwrite forwarded headers. Trust only the local proxy,
    // so scoring limits apply per visitor rather than to every phone collectively.
    trustProxy: ['127.0.0.1', '::1'],
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] },
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const database = new DatabaseConnection(config.databasePath);
  app.setErrorHandler(applicationErrorHandler);
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
    await new AdminBootstrapService(database.context).initialize();
    await api.register(apiRoutes, { ...config, context: database.context, prefix: '/api/v1' });
  });
  return app;
}
