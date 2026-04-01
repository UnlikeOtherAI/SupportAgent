import { type FastifyInstance } from 'fastify';
import { z } from 'zod';

const updateTenantSchema = z.object({
  orgName: z.string().min(1).max(255).optional(),
  productMode: z.enum(['standalone-saas', 'standalone-enterprise', 'integrated']).optional(),
  hostingMode: z.string().optional(),
  modelAccessMode: z.string().optional(),
  outputVisibilityPolicy: z.string().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  /* GET /tenant — current tenant settings */
  app.get('/tenant', async (request) => {
    const { tenantId } = request.user;

    // Check for existing settings in identity provider config as lightweight storage
    const idp = await app.prisma.identityProvider.findFirst({
      where: { tenantId },
    });

    return {
      orgName: idp?.displayName ?? '',
      productMode: 'standalone-saas',
      hostingMode: 'cloud',
      modelAccessMode: 'platform',
      outputVisibilityPolicy: 'internal',
      onboardingRequired: !idp,
    };
  });

  /* PUT /tenant — update tenant settings */
  app.put('/tenant', async (request) => {
    const { tenantId } = request.user;
    const body = updateTenantSchema.parse(request.body);

    // Upsert identity provider with org name
    const existing = await app.prisma.identityProvider.findFirst({
      where: { tenantId },
    });

    if (existing) {
      await app.prisma.identityProvider.update({
        where: { id: existing.id },
        data: {
          displayName: body.orgName ?? existing.displayName,
          config: {
            ...(existing.config as Record<string, unknown>),
            productMode: body.productMode,
            hostingMode: body.hostingMode,
            modelAccessMode: body.modelAccessMode,
            outputVisibilityPolicy: body.outputVisibilityPolicy,
          },
        },
      });
    } else if (body.orgName) {
      await app.prisma.identityProvider.create({
        data: {
          tenantId,
          providerType: 'unlikeotherai',
          displayName: body.orgName,
          config: {
            productMode: body.productMode ?? 'standalone-saas',
            hostingMode: body.hostingMode ?? 'cloud',
            modelAccessMode: body.modelAccessMode ?? 'platform',
            outputVisibilityPolicy: body.outputVisibilityPolicy ?? 'internal',
          },
          isEnabled: true,
        },
      });
    }

    return {
      orgName: body.orgName ?? '',
      productMode: body.productMode ?? 'standalone-saas',
      hostingMode: body.hostingMode ?? 'cloud',
      modelAccessMode: body.modelAccessMode ?? 'platform',
      outputVisibilityPolicy: body.outputVisibilityPolicy ?? 'internal',
      onboardingRequired: false,
    };
  });
}
