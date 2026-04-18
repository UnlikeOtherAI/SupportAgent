import path from 'node:path';
import { parseEnv } from '@support-agent/config';
import { seedBuiltinSkills } from '@support-agent/skills-runtime';
import { seedBuiltinExecutors } from '../scripts/seed-builtin-executors.js';
import { buildApp } from './app.js';

async function main() {
  const env = parseEnv();
  const app = await buildApp();
  const builtinSkillsDir = path.resolve(__dirname, '../../../packages/skills/builtin');
  const builtinExecutorsDir = path.resolve(__dirname, '../../../packages/executors/builtin');
  const skillSeedResult = await seedBuiltinSkills(app.prisma, path.resolve(builtinSkillsDir));
  const executorSeedResult = await seedBuiltinExecutors(
    app.prisma,
    path.resolve(builtinExecutorsDir),
  );

  app.log.info(
    { builtinDir: path.resolve(builtinSkillsDir), ...skillSeedResult },
    'Seeded builtin skills',
  );
  app.log.info(
    { builtinDir: path.resolve(builtinExecutorsDir), ...executorSeedResult },
    'Seeded builtin executors',
  );

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`API listening on port ${env.PORT}`);
}

main().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
