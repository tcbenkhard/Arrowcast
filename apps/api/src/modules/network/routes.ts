import { t } from '@arrowcast/contracts/i18n';
import { request } from 'node:http';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

export function networkCommand(body?: unknown): Promise<{ code: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: '/run/arrowcast-network/control.sock',
        path: body ? '/connect' : '/status',
        method: body ? 'POST' : 'GET',
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
          if (data.length > 65536) res.destroy();
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve({ code: res.statusCode ?? 503, body: JSON.parse(data) as unknown });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(t('routes.network_service_timed_out'))));
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

export async function networkRoutes(app: FastifyInstance) {
  app.get('/network', async (_request, reply) => {
    try {
      const result = await networkCommand();
      return reply.code(result.code).send(result.body);
    } catch {
      if (!existsSync('/usr/local/lib/arrowcast/network.py')) {
        return {
          mode: 'disabled',
          busy: false,
          ssid: null,
          address: null,
          message: t('routes.network_settings_are_available_on_configured_raspberry_pi_images'),
        };
      }
      return reply.code(503).send({ message: t('routes.network_service_unavailable_try_again_shortly') });
    }
  });
  app.post(
    '/network',
    {
      bodyLimit: 2048,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ssid', 'password'],
          properties: {
            ssid: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
            password: { type: 'string', maxLength: 64, pattern: '^[^\\u0000-\\u001f\\u007f]*$' },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await networkCommand(req.body);
        return reply.code(result.code).send(result.body);
      } catch {
        return reply.code(503).send({ message: t('routes.network_service_unavailable_try_again_shortly') });
      }
    },
  );
}
