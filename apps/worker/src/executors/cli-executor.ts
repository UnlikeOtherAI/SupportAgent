import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Executor, ExecutorRunInput, ExecutorRunResult } from './types.js';

const execAsync = promisify(exec);

interface CliExecutorOptions {
  key: string;
  buildCommand(input: ExecutorRunInput): string;
}

export function createCliExecutor(options: CliExecutorOptions): Executor {
  return {
    key: options.key,

    async run(input: ExecutorRunInput): Promise<ExecutorRunResult> {
      const { stdout } = await execAsync(options.buildCommand(input), {
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
}

export function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
