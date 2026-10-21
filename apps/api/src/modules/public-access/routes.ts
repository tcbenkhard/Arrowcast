import { existsSync } from 'node:fs';
import { request } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { networkCommand } from '../network/routes.js';

export function publicAccessCommand(body?: unknown): Promise<{ code: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: '/run/arrowcast-public/control.sock',
        path: body ? '/configure' : '/status',
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
    req.on('timeout', () => req.destroy(new Error('Public access service timed out.')));
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function status() {
  try {
    return await publicAccessCommand();
  } catch {
    if (!existsSync('/usr/local/lib/arrowcast/public-access.py')) {
      return { code: 200, body: { available: false, origin: null } };
    }
    return { code: 503, body: { message: 'Public access service unavailable.' } };
  }
}

export async function scoringOrigin(
  networkStatus = async () => (existsSync('/usr/local/lib/arrowcast/network.py') ? networkCommand() : null),
  publicStatus = status,
) {
  try {
    const network = await networkStatus();
    if (network) {
      const state = network.body as { mode?: string };
      if (network.code !== 200 || !['hotspot', 'wifi', 'ethernet'].includes(state.mode ?? '')) {
        return { code: 503, body: { message: 'Network service unavailable. Try again shortly.' } };
      }
      if (state.mode === 'hotspot') {
        return { code: 200, body: { origin: 'http://10.42.0.1', hotspot: true } };
      }
    }
    const result = await publicStatus();
    const state = result.body as { origin?: string | null };
    return { code: result.code, body: { origin: state.origin ?? null } };
  } catch {
    return { code: 503, body: { message: 'Network service unavailable. Try again shortly.' } };
  }
}

export async function scoringOriginRoutes(app: FastifyInstance) {
  app.get('/scoring-origin', async (_request, reply) => {
    const result = await scoringOrigin();
    return reply.header('Cache-Control', 'no-store').code(result.code).send(result.body);
  });
}

export async function publicAccessRoutes(app: FastifyInstance) {
  app.get('/public-access', async (_request, reply) => {
    const result = await status();
    return reply.code(result.code).send(result.body);
  });
  app.post(
    '/public-access',
    {
      bodyLimit: 2048,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'domain', 'email'],
          properties: {
            enabled: { type: 'boolean' },
            domain: { type: 'string', maxLength: 253 },
            email: { type: 'string', maxLength: 254 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await publicAccessCommand(req.body);
        return reply.code(result.code).send(result.body);
      } catch {
        return reply.code(503).send({ message: 'Public access service unavailable.' });
      }
    },
  );
}
