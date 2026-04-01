import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { ConnectionManager } from './ws/connection-manager.js';

export async function buildGatewayApp(
  connections: ConnectionManager,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket) => {
    connections.handleConnection(socket);
  });

  app.get('/health', async () => ({
    status: 'ok',
    connectedWorkers: connections.count(),
    idleWorkers: connections.idleCount(),
  }));

  return app;
}
