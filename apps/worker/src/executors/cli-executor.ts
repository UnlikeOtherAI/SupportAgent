import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Executor, ExecutorRunInput, ExecutorRunResult } from './types.js';

/**
 * Argv spec for an executor.
 *
 * - `command` is the program to run (looked up via PATH; never a shell).
 * - `args` is the argv tail. Inputs (prompt, model, paths) MUST flow through
 *   here; they are passed to `spawn` with `shell: false`, so shell
 *   metacharacters are inert.
 * - `stdin`, if set, is written to the child's stdin (and stdin is then
 *   closed). Use this for inputs that may exceed ARG_MAX.
 */
export interface CliCommandSpec {
  command: string;
  args: string[];
  stdin?: string;
}

interface CliExecutorOptions {
  key: string;
  buildArgv(input: ExecutorRunInput): CliCommandSpec;
}

export function createCliExecutor(options: CliExecutorOptions): Executor {
  return {
    key: options.key,

    async run(input: ExecutorRunInput): Promise<ExecutorRunResult> {
      const stdout = await new Promise<string>((resolve, reject) => {
        const spec = options.buildArgv(input);
        const child = spawn(spec.command, spec.args, {
          cwd: input.cwd,
          shell: false,
          stdio: [spec.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        });

        let collected = '';
        let collectedErr = '';
        let settled = false;

        const timer = input.timeoutMs
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              child.kill('SIGKILL');
              reject(new Error(
                `[cli-executor] ${spec.command} timed out after ${input.timeoutMs}ms`,
              ));
            }, input.timeoutMs)
          : null;

        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          collected += chunk;
        });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          collectedErr += chunk;
        });

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          reject(err);
        });

        child.on('close', (code, signal) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (code !== 0 || signal !== null) {
            const reason = signal ? `signal=${signal}` : `exit=${code}`;
            const err = new Error(
              `[cli-executor] ${spec.command} failed (${reason}): ${collectedErr.trim() || collected.trim()}`,
            );
            (err as Error & { stderr?: string; stdout?: string }).stderr = collectedErr;
            (err as Error & { stderr?: string; stdout?: string }).stdout = collected;
            reject(err);
            return;
          }
          resolve(collected);
        });

        if (spec.stdin !== undefined) {
          child.stdin?.end(spec.stdin, 'utf8');
        }

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
