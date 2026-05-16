import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export function tempDir(): string {
  return path.join(
    os.tmpdir(),
    `support-agent-gh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

export async function withJsonBodyFile<T>(
  prefix: string,
  body: Record<string, unknown>,
  callback: (file: string) => Promise<T>,
): Promise<T> {
  const file = path.join(os.tmpdir(), `${prefix}-${Date.now()}.json`);
  await fs.writeFile(file, JSON.stringify(body), 'utf-8');
  try {
    return await callback(file);
  } finally {
    await fs.unlink(file).catch(() => undefined);
  }
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors from temp directories.
  }
}
