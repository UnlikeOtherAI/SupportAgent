import path from 'node:path';
import { parseEnv } from '@support-agent/config';
import { seedBuiltinSkills } from '@support-agent/skills-runtime';
import { buildApp } from './app.js';

async function main() {
  const env = parseEnv();
  const app = await buildApp();
  const builtinDir = path.resolve(__dirname, '../../../packages/skills/builtin');
  const seedResult = await seedBuiltinSkills(app.prisma, path.resolve(builtinDir));

  app.log.info(
    { builtinDir: path.resolve(builtinDir), ...seedResult },
    'Seeded builtin skills',
  );

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`API listening on port ${env.PORT}`);
}

main().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
