import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    workerDispatch?: {
      id: string;
      workflowRunId: string;
      attemptNumber: number;
    };
  }
}

export const workerAuthPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('workerDispatch', undefined);
});

export async function verifyWorkerAuth(request: FastifyRequest, app: FastifyInstance): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing worker authorization'), { statusCode: 401 });
  }
  const secret = authHeader.slice(7);

  const dispatch = await app.prisma.workerDispatch.findFirst({
    where: { workerSharedSecret: secret },
  });
  if (!dispatch) {
    throw Object.assign(new Error('Invalid worker secret'), { statusCode: 401 });
  }

  // Verify this is the accepted dispatch for the run
  const run = await app.prisma.workflowRun.findUnique({
    where: { id: dispatch.workflowRunId },
  });
  if (run?.acceptedDispatchAttempt && run.acceptedDispatchAttempt !== dispatch.id) {
    throw Object.assign(new Error('Stale dispatch attempt'), { statusCode: 403 });
  }

  request.workerDispatch = {
    id: dispatch.id,
    workflowRunId: dispatch.workflowRunId,
    attemptNumber: dispatch.attemptNumber,
  };
}
