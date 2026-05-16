import { parseEnv } from '@support-agent/config';
import { processJob } from './worker.js';
import { type JobTransport } from './transport/transport.js';

async function main() {
  const env = parseEnv();
  const mode = process.argv[2] ?? (env.GATEWAY_URL ? 'gateway' : 'bullmq');

  let transport: JobTransport;

  if (mode === 'gateway' || mode === 'ws') {
    const { createWebSocketTransport } = await import(
      './transport/ws-transport.js'
    );
    if (!env.GATEWAY_URL) {
      throw new Error('GATEWAY_URL required for gateway mode');
    }
    transport = createWebSocketTransport(env.GATEWAY_URL, {
      runtimeApiKey: env.RUNTIME_API_KEY,
      workerId: env.WORKER_ID,
    });
    console.log(`[worker] Starting in WebSocket mode → ${env.GATEWAY_URL}`);
  } else {
    const { createBullMQTransport } = await import(
      './transport/bullmq-transport.js'
    );
    transport = createBullMQTransport(env.REDIS_URL);
    console.log('[worker] Starting in BullMQ mode');
  }

  transport.start(processJob);
}

main().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
