import { Prisma } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';

const WorkflowType = z.enum(['triage', 'build', 'merge']);

const ReviewProfileBody = z.object({
  name: z.string().min(1).max(255).optional(),
  maxRounds: z.number().int().min(1).optional(),
  mandatoryHumanApproval: z.boolean().optional(),
  continueAfterPassing: z.boolean().optional(),
  allowedWorkflowTypes: z.array(WorkflowType).optional(),
  promptSetRef: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const CreateReviewProfileBody = ReviewProfileBody.extend({
  name: z.string().min(1).max(255),
});

const ReviewProfileConfig = z.object({
  mandatoryHumanApproval: z.boolean().optional(),
  continueAfterPassing: z.boolean().optional(),
  allowedWorkflowTypes: z.array(WorkflowType).optional(),
  promptSetRef: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

type ReviewProfileWithVersions = Prisma.ReviewProfileGetPayload<{
  include: { versions: true };
}>;

function createProfileKey(name: string) {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return key || 'review-profile';
}

function parseConfig(value: unknown) {
  const parsed = ReviewProfileConfig.safeParse(value);
  const config = parsed.success ? parsed.data : {};

  return {
    mandatoryHumanApproval: config.mandatoryHumanApproval ?? false,
    continueAfterPassing: config.continueAfterPassing ?? false,
    allowedWorkflowTypes: config.allowedWorkflowTypes ?? ['triage', 'build', 'merge'],
    promptSetRef: config.promptSetRef ?? null,
    active: config.active ?? true,
  };
}

function mapProfile(profile: ReviewProfileWithVersions) {
  const latestVersion = profile.versions[0];
  const config = parseConfig(latestVersion?.config);

  return {
    id: profile.id,
    name: profile.displayName,
    version: latestVersion?.version ?? 1,
    maxRounds: profile.maxRounds,
    mandatoryHumanApproval: config.mandatoryHumanApproval,
    continueAfterPassing: config.continueAfterPassing,
    allowedWorkflowTypes: config.allowedWorkflowTypes,
    promptSetRef: config.promptSetRef,
    active: config.active,
  };
}

function mergeConfig(existing: unknown, body: z.infer<typeof ReviewProfileBody>) {
  const current = parseConfig(existing);

  return {
    mandatoryHumanApproval: body.mandatoryHumanApproval ?? current.mandatoryHumanApproval,
    continueAfterPassing: body.continueAfterPassing ?? current.continueAfterPassing,
    allowedWorkflowTypes: body.allowedWorkflowTypes ?? current.allowedWorkflowTypes,
    promptSetRef: body.promptSetRef !== undefined ? body.promptSetRef : current.promptSetRef,
    active: body.active ?? current.active,
  };
}

export async function reviewProfileRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    const profiles = await app.prisma.reviewProfile.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    return profiles.map(mapProfile);
  });

  app.get<{ Params: { profileId: string } }>('/:profileId', async (request, reply) => {
    const profile = await app.prisma.reviewProfile.findFirst({
      where: { id: request.params.profileId, tenantId: request.user.tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!profile) {
      return reply.status(404).send({ error: 'Review profile not found' });
    }

    return mapProfile(profile);
  });

  app.post('/', async (request, reply) => {
    const body = CreateReviewProfileBody.parse(request.body);
    const profile = await app.prisma.reviewProfile.create({
      data: {
        tenantId: request.user.tenantId,
        key: createProfileKey(body.name),
        displayName: body.name,
        maxRounds: body.maxRounds ?? 1,
        versions: {
          create: {
            version: 1,
            config: mergeConfig(undefined, body) as Prisma.InputJsonValue,
          },
        },
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    return reply.status(201).send(mapProfile(profile));
  });

  app.put<{ Params: { profileId: string } }>('/:profileId', async (request, reply) => {
    const body = ReviewProfileBody.parse(request.body);
    const existing = await app.prisma.reviewProfile.findFirst({
      where: { id: request.params.profileId, tenantId: request.user.tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Review profile not found' });
    }

    const latestVersion = existing.versions[0];
    const profile = await app.prisma.reviewProfile.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { displayName: body.name } : {}),
        ...(body.maxRounds !== undefined ? { maxRounds: body.maxRounds } : {}),
        versions: latestVersion
          ? {
              update: {
                where: { id: latestVersion.id },
                data: { config: mergeConfig(latestVersion.config, body) as Prisma.InputJsonValue },
              },
            }
          : {
              create: {
                version: 1,
                config: mergeConfig(undefined, body) as Prisma.InputJsonValue,
              },
            },
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    return mapProfile(profile);
  });
}
