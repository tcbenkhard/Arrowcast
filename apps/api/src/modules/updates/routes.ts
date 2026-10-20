import { t } from '@arrowcast/contracts/i18n';
import { request } from 'node:http';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

export function updaterCommand(command: 'status' | 'install'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: '/run/arrowcast-update/control.sock', path: `/${command}`,
      method: command === 'install' ? 'POST' : 'GET', timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; if (body.length > 65536) res.destroy(); });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(body) as unknown }); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(t('updates.timeout'))));
    req.on('error', reject);
    req.end();
  });
}

export async function updateRoutes(app: FastifyInstance) {
  async function send(command: 'status' | 'install', reply: import('fastify').FastifyReply) {
    try {
      const result = await updaterCommand(command) as { code: number; body: unknown };
      return reply.code(result.code).send(result.body);
    } catch {
      if (command === 'status' && !existsSync('/etc/arrowcast/update.json')) {
        return { status: 'disabled', currentVersion: 'development', availableVersion: null,
          message: t('updates.configuredImage') };
      }
      return reply.code(503).send({ message: t('updates.onlyConfiguredImage') });
    }
  }
  app.get('/updates', async (_request, reply) => send('status', reply));
  app.post('/updates', async (_request, reply) => send('install', reply));
}
