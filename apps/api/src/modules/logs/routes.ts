import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { t } from '@arrowcast/contracts/i18n';

const execute = promisify(execFile);
const sources = {
  frontend: ['SYSLOG_IDENTIFIER=arrowcast_web'],
  backend: ['--unit=arrowcast.service'],
  updates: ['--unit=arrowcast-update.service'],
} as const;
type LogSource = keyof typeof sources;

export async function readServiceLogs(source: LogSource): Promise<string> {
  const { stdout } = await execute(
    'journalctl',
    ['--quiet', '--no-pager', '--lines=300', '--output=short-iso', ...sources[source]],
    { timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, SYSTEMD_COLORS: '0' } },
  );
  return stdout;
}

export async function logRoutes(app: FastifyInstance, options: { readLogs?: (source: LogSource) => Promise<string> }) {
  app.get<{ Params: { source: LogSource } }>(
    '/logs/:source',
    {
      // Polling the backend log must not generate more log entries itself.
      logLevel: 'silent',
      schema: {
        params: {
          type: 'object',
          required: ['source'],
          properties: { source: { type: 'string', enum: Object.keys(sources) } },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { text: await (options.readLogs ?? readServiceLogs)(request.params.source) };
      } catch {
        return reply.code(503).send({ message: t('Logs.unavailable') });
      }
    },
  );
}
