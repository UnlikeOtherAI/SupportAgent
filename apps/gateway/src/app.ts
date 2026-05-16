import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { type Env } from '@support-agent/config';
import { ConnectionManager } from './ws/connection-manager.js';
import { prismaPlugin } from './plugins/prisma.js';
import { authorizeUpgrade } from './ws/upgrade-auth.js';
import { parseOriginPolicy } from './ws/origin-allowlist.js';

export interface BuildGatewayAppOptions {
  env: Env;
}

/**
 * Build the gateway Fastify instance. The `connections` arg is created by
 * `index.ts` so tests can inject a stub; in production the index wires up
 * one shared instance.
 */
export async function buildGatewayApp(
  connections: ConnectionManager,
  { env }: BuildGatewayAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(prismaPlugin);
  await app.register(websocket, {
    options: {
      // Reject oversize frames at the protocol level — before they hit
      // JSON.parse in the connection manager.
      maxPayload: env.GATEWAY_WS_MAX_PAYLOAD_BYTES,
    },
  });

  const originPolicy = parseOriginPolicy(
    env.GATEWAY_ALLOWED_ORIGINS,
    env.NODE_ENV === 'production',
  );

  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const result = await authorizeUpgrade(request, {
          prisma: app.prisma,
          originPolicy,
        });
        if (!result.ok) {
          reply.code(result.statusCode).send({ error: result.reason });
          return reply;
        }
        // Stash for the route handler.
        (request as unknown as { auth: typeof result.auth }).auth = result.auth;
        (request as unknown as { remoteAddr: string }).remoteAddr = result.remoteAddr;
      },
    },
    (socket, request) => {
      const ctx = request as unknown as {
        auth: Parameters<typeof connections.acceptConnection>[0]['auth'];
        remoteAddr: string;
      };
      connections.acceptConnection({
        ws: socket,
        auth: ctx.auth,
        remoteAddr: ctx.remoteAddr,
      });
    },
  );

  app.get('/health', async () => ({
    status: 'ok',
    connectedWorkers: connections.count(),
    idleWorkers: connections.idleCount(),
  }));

  return app;
}
