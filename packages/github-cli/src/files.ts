import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runArgv } from './run.js';

/**
 * Resolve `relativePath` against `workDir` and ensure the result is contained
 * inside `workDir`. Rejects absolute paths, `..` escape, and symlink-style
 * traversal that would resolve outside the work tree.
 *
 * Returns the resolved absolute path on success.
 */
export function resolveContainedPath(workDir: string, relativePath: string): string {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error(`Invalid file path: ${JSON.stringify(relativePath)}`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${JSON.stringify(relativePath)}`);
  }
  if (relativePath.includes('\0')) {
    throw new Error(`NUL byte in file path: ${JSON.stringify(relativePath)}`);
  }

  const root = path.resolve(workDir);
  const resolved = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(
      `Path traversal rejected: ${JSON.stringify(relativePath)} resolves outside ${root}`,
    );
  }
  return resolved;
}

export async function ghCommitFiles(
  workDir: string,
  files: Array<{ content: string; path: string }>,
  message: string,
): Promise<void> {
  for (const file of files) {
    const filePath = resolveContainedPath(workDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf-8');
    // Pass the validated relative path with `--` separator so leading dashes
    // can never be re-interpreted as flags.
    await runArgv('git', ['add', '--', file.path], { cwd: workDir });
  }

  await runArgv('git', ['commit', '-m', message], { cwd: workDir });
  await runArgv('git', ['push'], { cwd: workDir });
}

export async function ghCommitAll(workDir: string, message: string): Promise<void> {
  await runArgv('git', ['add', '-A'], { cwd: workDir });
  await runArgv('git', ['commit', '-m', message], { cwd: workDir });
  await runArgv('git', ['push'], { cwd: workDir });
}
