import { t } from '@arrowcast/contracts/i18n';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export function secureScoringCookie(request: FastifyRequest) {
  return request.protocol === 'https' || request.headers.origin?.startsWith('https://') === true;
}

export function protectScoringRequests(app: FastifyInstance, options: { hideReferrer?: boolean } = {}) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (options.hideReferrer) reply.header('Referrer-Policy', 'no-referrer');
    // A required non-simple header prevents cross-origin form/CSRF requests. No CORS is enabled.
    if (
      request.method !== 'GET' &&
      (request.headers['x-arrowcast-scoring'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      return reply.code(403).send({ message: t('routes.open_scoring_on_this_website_to_save_scores') });
    }
  });
}
