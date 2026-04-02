import { PLATFORM_REGISTRY } from '@support-agent/contracts';
import { getEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';
import { getOAuthCredentials } from '../lib/oauth-platforms.js';

type PlatformTypeRecord = {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string;
  supportsWebhook: boolean;
  supportsPolling: boolean;
  supportsInbound: boolean;
  supportsOutbound: boolean;
};

function enrichPlatformType(
  pt: PlatformTypeRecord,
  env: ReturnType<typeof getEnv>,
) {
  const registry = PLATFORM_REGISTRY[pt.key];
  const oauthAvailable = (registry?.supportsOAuth ?? false)
    ? getOAuthCredentials(pt.key, env) !== null
    : false;

  return {
    id: pt.id,
    key: pt.key,
    displayName: pt.displayName,
    description: registry?.description ?? pt.description,
    category: registry?.category ?? pt.category,
    iconSlug: registry?.iconSlug ?? pt.key,
    supportsWebhook: pt.supportsWebhook,
    supportsPolling: pt.supportsPolling,
    supportsInbound: pt.supportsInbound,
    supportsOutbound: pt.supportsOutbound,
    supportsCustomServer: registry?.supportsCustomServer ?? false,
    defaultDirection: registry?.defaultDirection ?? 'inbound',
    defaultIntakeMode: registry?.defaultIntakeMode ?? 'webhook',
    oauthAvailable,
    configFields: registry?.configFields ?? [],
  };
}

export async function platformTypeRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async () => {
    const env = getEnv();
    const platformTypes = await app.prisma.platformType.findMany({
      orderBy: { displayName: 'asc' },
    });

    return platformTypes.map((pt) => enrichPlatformType(pt, env));
  });

  app.get<{ Params: { key: string } }>('/:key', async (request) => {
    const env = getEnv();
    const platformType = await app.prisma.platformType.findUnique({
      where: { key: request.params.key },
    });

    if (!platformType) {
      throw Object.assign(new Error('Platform type not found'), { statusCode: 404 });
    }

    return enrichPlatformType(platformType, env);
  });
}
