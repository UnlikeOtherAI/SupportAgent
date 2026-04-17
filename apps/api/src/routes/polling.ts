import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPollingTriageService } from '../services/polling-triage-service.js';
import { createPollingEventService } from '../services/polling-event-service.js';
import { createScenarioMatcher } from '../services/scenario-matcher.js';

const EnqueuePolledIssueBody = z.object({
  connectorId: z.string().uuid(),
  repositoryMappingId: z.string().uuid(),
  issue: z.object({
    body: z.string().nullable(),
    comments: z.array(
      z.object({
        author: z.string(),
        body: z.string(),
        createdAt: z.string(),
        id: z.string(),
        url: z.string().optional(),
      }),
    ),
    labels: z.array(z.string()),
    number: z.number().int().positive(),
    state: z.string(),
    title: z.string().min(1),
    updatedAt: z.string().optional(),
    url: z.string().url(),
  }),
});

const PolledIssueSchema = z.object({
  body: z.string().nullable(),
  comments: z.array(
    z.object({
      author: z.string(),
      body: z.string(),
      createdAt: z.string(),
      id: z.string(),
      url: z.string().optional(),
    }),
  ),
  labels: z.array(z.string()),
  number: z.number().int().positive(),
  state: z.string(),
  title: z.string().min(1),
  updatedAt: z.string().optional(),
  url: z.string().url(),
});

const PolledPrSchema = z.object({
  body: z.string().nullable(),
  number: z.number().int().positive(),
  state: z.string(),
  title: z.string().min(1),
  updatedAt: z.string().optional(),
  url: z.string().url(),
  headSha: z.string().optional(),
  headRef: z.string().optional(),
  baseRef: z.string().optional(),
});

const PolledPrCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string().optional(),
});

const PollingEventBody = z.object({
  scenarioId: z.string().uuid(),
  actionKind: z.string().min(1),
  event: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('github.issue.opened'),
      connectorId: z.string().uuid(),
      repositoryMappingId: z.string().uuid(),
      issue: PolledIssueSchema,
    }),
    z.object({
      kind: z.literal('github.issue.labeled'),
      connectorId: z.string().uuid(),
      repositoryMappingId: z.string().uuid(),
      label: z.string().min(1),
      issue: PolledIssueSchema,
    }),
    z.object({
      kind: z.literal('github.pull_request.opened'),
      connectorId: z.string().uuid(),
      repositoryMappingId: z.string().uuid(),
      pr: PolledPrSchema,
    }),
    z.object({
      kind: z.literal('github.pull_request.comment'),
      connectorId: z.string().uuid(),
      repositoryMappingId: z.string().uuid(),
      pr: PolledPrSchema,
      comment: PolledPrCommentSchema,
    }),
    z.object({
      kind: z.literal('github.pull_request.merged'),
      connectorId: z.string().uuid(),
      repositoryMappingId: z.string().uuid(),
      pr: PolledPrSchema,
    }),
    z.object({
      kind: z.literal('github.issue.closed_comment'),
      connectorId: z.string().uuid(),
      repositoryMappingId: z.string().uuid(),
      issue: PolledIssueSchema,
      comment: PolledPrCommentSchema,
    }),
  ]),
});

export async function pollingRoutes(app: FastifyInstance) {
  const triageService = createPollingTriageService(app.prisma);
  const eventService = createPollingEventService(app.prisma);
  const matcher = createScenarioMatcher(app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/triage-targets', async (request) => {
    return triageService.listTargets(request.user.tenantId);
  });

  app.post('/triage-enqueue', async (request, reply) => {
    const body = EnqueuePolledIssueBody.parse(request.body);
    const result = await triageService.enqueueIssue(request.user.tenantId, body);
    return reply.status(result.status === 'created' ? 201 : 200).send(result);
  });

  app.get('/matchable-scenarios', async (request) => {
    return matcher.listMatchable(request.user.tenantId);
  });

  app.post('/event', async (request, reply) => {
    const body = PollingEventBody.parse(request.body);
    const result = await eventService.enqueueEvent(request.user.tenantId, body);
    return reply.status(result.status === 'created' ? 201 : 200).send(result);
  });
}
