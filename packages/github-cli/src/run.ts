import { spawn } from 'node:child_process';
import { DEFAULT_TIMEOUT_MS } from './types.js';

export interface RunArgvOptions {
  cwd?: string;
  timeoutMs?: number;
  /** When set, written to child stdin then stdin is closed. */
  stdin?: string;
  /** When false (default), stderr lines are forwarded to console.warn. */
  quiet?: boolean;
}

/**
 * Run a command with an argv array, no shell. All inputs flow through argv —
 * shell metacharacters are inert. Returns trimmed stdout. Throws on non-zero
 * exit, signal termination, or timeout.
 */
export function runArgv(
  command: string,
  args: string[],
  options: RunArgvOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(
        `[github-cli] ${command} timed out after ${timeoutMs}ms (args=${formatArgsForError(args)})`,
      ));
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const trimmedErr = stderr.trim();
      if (code !== 0 || signal !== null) {
        const reason = signal ? `signal=${signal}` : `exit=${code}`;
        const err = new Error(
          `[github-cli] ${command} failed (${reason}) args=${formatArgsForError(args)}: ${trimmedErr || stdout.trim()}`,
        );
        // attach raw stderr so callers can pattern-match (e.g. "already exists")
        (err as Error & { stderr?: string; stdout?: string }).stderr = trimmedErr;
        (err as Error & { stderr?: string; stdout?: string }).stdout = stdout.trim();
        reject(err);
        return;
      }
      if (trimmedErr && !options.quiet) {
        console.warn('[github-cli]', trimmedErr);
      }
      resolve(stdout.trim());
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, 'utf8');
    }
  });
}

function formatArgsForError(args: string[]): string {
  return args
    .map((arg) => (arg.length > 80 ? `${arg.slice(0, 80)}…` : arg))
    .join(' ');
}
