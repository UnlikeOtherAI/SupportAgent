import { type FastifyInstance } from 'fastify';
import { getUoaKeyMaterial, isSsoConfigured } from '../lib/uoa.js';

/**
 * RFC 7517 JWKS endpoint consumed by UOA to verify config JWT signatures.
 *
 * Must be served on the same hostname as `config_url` and the `domain` claim
 * — UOA enforces this match when it first sees an unknown `kid` during
 * Phase-1 auto-onboarding.
 */
export async function jwksRoutes(app: FastifyInstance) {
  app.get('/.well-known/jwks.json', async (_request, reply) => {
    if (!isSsoConfigured()) {
      return reply.status(404).send({ error: 'SSO not configured' });
    }

    const { publicJwk } = await getUoaKeyMaterial();
    reply.header('Cache-Control', 'public, max-age=300');
    return { keys: [publicJwk] };
  });
}
