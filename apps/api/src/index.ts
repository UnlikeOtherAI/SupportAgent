import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from '@support-agent/config';
import { seedBuiltinSkills } from '@support-agent/skills-runtime';
import { seedBuiltinExecutors } from '../scripts/seed-builtin-executors.js';
import { buildApp } from './app.js';

// Walk up from __dirname to find the workspace `packages/` directory. The
// number of `..` segments differs between dev (`apps/api/src/`) and prod
// (`apps/api/dist/src/`) because tsc writes outputs under `dist/src/` when
// `rootDir` is `.`, so a fixed relative path is unreliable.
function findPackagesDir(start: string): string {
  let dir = start;
  const { root } = path.parse(dir);
  while (dir !== root) {
    const candidate = path.join(dir, 'packages');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not locate workspace packages/ above ${start}`);
}

async function main() {
  const env = parseEnv();
  const app = await buildApp();
  const packagesDir = findPackagesDir(__dirname);
  const builtinSkillsDir = path.join(packagesDir, 'skills', 'builtin');
  const builtinExecutorsDir = path.join(packagesDir, 'executors', 'builtin');
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
