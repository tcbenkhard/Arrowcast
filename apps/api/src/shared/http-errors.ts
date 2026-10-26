import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from './errors.js';

export function applicationErrorHandler(error: Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApplicationError) return reply.code(error.code).send({ message: error.message });
  // Propagate unexpected errors to Fastify's parent/default handler.
  throw error;
}
