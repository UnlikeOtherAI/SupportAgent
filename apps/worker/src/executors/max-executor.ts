import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Executor, ExecutorRunInput, ExecutorRunResult } from './types.js';

const execAsync = promisify(exec);

export const maxExecutor: Executor = {
  key: 'max',

  async run(input: ExecutorRunInput): Promise<ExecutorRunResult> {
    const escaped = input.prompt.replace(/"/g, '\\"');
    const { stdout } = await execAsync(`max -p "${escaped}"`, {
      timeout: input.timeoutMs,
      cwd: input.cwd,
    });
    let outputContent = '';
    try {
      outputContent = await readFile(input.outputPath, 'utf8');
    } catch {
      // File missing — caller decides how to react.
    }
    return { stdout, outputContent };
  },
};
