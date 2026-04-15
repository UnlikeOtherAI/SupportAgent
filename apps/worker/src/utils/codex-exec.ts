import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const SUMMARY_MAX_CHARS = 2_000;

export interface CodexResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  ok: boolean;
}

export function codexExec(prompt: string, cwd?: string): Promise<CodexResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let finished = false;

    const child = spawn('timeout', ['1800', 'codex', 'exec', prompt], {
      cwd: cwd ?? process.cwd(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = appendChunk(stdout, chunk);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on('error', () => {
      finish(null, null);
    });

    child.on('close', (code, signal) => {
      finish(code, signal);
    });

    function finish(code: number | null, signal: NodeJS.Signals | null) {
      if (finished) {
        return;
      }
      finished = true;

      const timedOut = code === 124 || signal === 'SIGTERM' || signal === 'SIGKILL';
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - start,
        ok: code === 0 && signal === null,
      });
    }
  });
}

export function summarizeResult(result: CodexResult): string {
  const status = result.ok
    ? 'ok'
    : result.timedOut
      ? 'timeout'
      : `exit=${result.exitCode ?? 'signal'}`;

  const outputSummary = summarizeOutput(result.stdout, result.stderr);

  return [`status=${status}`, `duration=${Math.round(result.durationMs / 1000)}s`, outputSummary].join(
    ' | ',
  );
}

function summarizeOutput(stdout: string, stderr: string): string {
  const preferred = extractPreferredSections(stdout);
  if (preferred) {
    return truncate(preferred);
  }

  const fallback = stdout.trim() || stderr.trim();
  if (!fallback) {
    return 'no output';
  }

  const lastLines = fallback
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join('\n');

  return truncate(lastLines);
}

function extractPreferredSections(output: string): string {
  const changes = extractSection(output, '## Changes Made', '## Verification');
  const verification = extractSection(output, '## Verification');

  return [changes, verification].filter(Boolean).join('\n\n').trim();
}

function extractSection(output: string, heading: string, nextHeading?: string): string {
  const start = output.indexOf(heading);
  if (start < 0) {
    return '';
  }

  const end = nextHeading ? output.indexOf(nextHeading, start + heading.length) : -1;
  return output.slice(start, end >= 0 ? end : undefined).trim();
}

function truncate(value: string): string {
  if (value.length <= SUMMARY_MAX_CHARS) {
    return value;
  }

  return `${value.slice(0, SUMMARY_MAX_CHARS)} ... [${value.length - SUMMARY_MAX_CHARS} chars truncated]`;
}

function appendChunk(current: string, chunk: string): string {
  if (!chunk) {
    return current;
  }

  const currentBytes = Buffer.byteLength(current, 'utf8');
  if (currentBytes >= MAX_OUTPUT_BYTES) {
    return current;
  }

  const remainingBytes = MAX_OUTPUT_BYTES - currentBytes;
  const chunkBytes = Buffer.byteLength(chunk, 'utf8');
  if (chunkBytes <= remainingBytes) {
    return current + chunk;
  }

  let end = chunk.length;
  while (end > 0 && Buffer.byteLength(chunk.slice(0, end), 'utf8') > remainingBytes) {
    end -= 1;
  }

  return current + chunk.slice(0, end);
}
