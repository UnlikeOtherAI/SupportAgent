import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash } from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    workerDispatch?: {
      id: string;
      tenantId: string;
      workflowRunId: string;
      attemptNumber: number;
    };
  }
}

export const workerAuthPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('workerDispatch', undefined);
});

export async function verifyWorkerAuth(
  request: FastifyRequest,
  app: FastifyInstance,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing worker authorization'), { statusCode: 401 });
  }
  const secret = authHeader.slice(7);
  const hashedSecret = createHash('sha256').update(secret).digest('hex');

  // Extract the dispatch/job ID from the URL for precise lookup
  const params = request.params as { jobId?: string };
  const jobId = params.jobId;

  const where = jobId
    ? { id: jobId, workerSharedSecret: hashedSecret }
    : { workerSharedSecret: hashedSecret };

  let dispatch = await app.prisma.workerDispatch.findFirst({ where });
  if (!dispatch && jobId) {
    // Legacy plaintext migration: look up by ID + plaintext, then hash
    const legacyDispatch = await app.prisma.workerDispatch.findFirst({
      where: { id: jobId, workerSharedSecret: secret },
    });
    if (legacyDispatch) {
      dispatch = await app.prisma.workerDispatch.update({
        where: { id: legacyDispatch.id },
        data: { workerSharedSecret: hashedSecret },
      });
    }
  } else if (!dispatch) {
    // Fallback without job ID (e.g. non-standard paths)
    const legacyDispatch = await app.prisma.workerDispatch.findFirst({
      where: { workerSharedSecret: secret },
    });
    if (legacyDispatch) {
      dispatch = await app.prisma.workerDispatch.update({
        where: { id: legacyDispatch.id },
        data: { workerSharedSecret: hashedSecret },
      });
    }
  }
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
    tenantId: run?.tenantId ?? '',
    workflowRunId: dispatch.workflowRunId,
    attemptNumber: dispatch.attemptNumber,
  };
}
