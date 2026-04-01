import { parseEnv } from '@support-agent/config';
import { buildApp } from './app.js';

async function main() {
  const env = parseEnv();
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`API listening on port ${env.PORT}`);
}

main().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
