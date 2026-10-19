import { buildApp } from '../../apps/api/src/app.js';

// Isolated test credentials; never use the installation's .env or real account.
const app = buildApp({
  jwtSecret: 'isolated-e2e-secret-with-at-least-32-bytes',
  databasePath: ':memory:',
});
await app.listen({ host: '127.0.0.1', port: 3000 });
