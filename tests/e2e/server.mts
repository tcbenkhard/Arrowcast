import { buildApp } from '../../apps/api/src/app.js';
import { openDatabase } from '../../apps/api/src/db/index.js';
import { clubs } from '../../apps/api/src/db/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testJwtSecret } from './admin.js';

const directory = mkdtempSync(join(tmpdir(), 'arrowcast-e2e-'));
const databasePath = join(directory, 'test.sqlite');
const fixture = openDatabase(databasePath);
fixture.db.insert(clubs).values({ clubNumber: 'e2e-club', name: 'Browser test club' }).run();
fixture.close();

// Isolated test credentials; never use the installation's .env or real account.
const app = buildApp({
  jwtSecret: testJwtSecret,
  databasePath,
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.ARROWCAST_E2E_API_PORT ?? 3000) });
async function shutdown() {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
