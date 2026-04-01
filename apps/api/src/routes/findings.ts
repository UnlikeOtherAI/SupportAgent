import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createFindingRepository } from '../repositories/finding-repository.js';
import { createFindingService } from '../services/finding-service.js';

const CreateFindingBody = z.object({
  summary: z.string().min(1),
  rootCauseHypothesis: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reproductionStatus: z.string().optional(),
  affectedAreas: z.unknown().optional(),
  evidenceRefs: z.unknown().optional(),
  recommendedNextAction: z.string().optional(),
  outboundSummary: z.string().optional(),
  suspectCommits: z.unknown().optional(),
  suspectFiles: z.unknown().optional(),
  userVisibleImpact: z.string().optional(),
  designNotes: z.string().optional(),
});

/** Routes mounted at /v1/runs — adds /:runId/findings endpoints. */
export async function findingRunRoutes(app: FastifyInstance) {
  const repo = createFindingRepository(app.prisma);
  const service = createFindingService(repo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get<{ Params: { runId: string } }>('/:runId/findings', async (request) => {
    return service.listFindings(request.params.runId, request.user.tenantId);
  });

  app.post<{ Params: { runId: string } }>('/:runId/findings', async (request, reply) => {
    const body = CreateFindingBody.parse(request.body);
    const finding = await service.createFinding(request.params.runId, request.user.tenantId, body);
    return reply.status(201).send(finding);
  });
}

/** Routes mounted at /v1/findings — adds /:findingId endpoint. */
export async function findingDetailRoutes(app: FastifyInstance) {
  const repo = createFindingRepository(app.prisma);
  const service = createFindingService(repo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get<{ Params: { findingId: string } }>('/:findingId', async (request) => {
    return service.getFinding(request.params.findingId, request.user.tenantId);
  });
}
