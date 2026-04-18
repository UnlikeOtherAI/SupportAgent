import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Executor, ExecutorRunInput, ExecutorRunResult } from './types.js';

interface CliExecutorOptions {
  key: string;
  buildCommand(input: ExecutorRunInput): string;
}

export function createCliExecutor(options: CliExecutorOptions): Executor {
  return {
    key: options.key,

    async run(input: ExecutorRunInput): Promise<ExecutorRunResult> {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = exec(
          options.buildCommand(input),
          {
            timeout: input.timeoutMs,
            cwd: input.cwd,
          },
          (error, childStdout) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(childStdout);
          },
        );

        input.onSpawn?.(child);
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
