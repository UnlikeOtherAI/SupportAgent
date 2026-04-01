import { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const statusCode = error.statusCode ?? 500;

  request.log.error(error);

  reply.status(statusCode).send({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: error.message,
      details: error.validation ? { validation: error.validation } : undefined,
    },
  });
}
