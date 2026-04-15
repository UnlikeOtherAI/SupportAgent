import { execFile } from 'node:child_process';

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

    execFile(
      'timeout',
      ['1800', 'codex', 'exec', prompt],
      {
        shell: false,
        cwd: cwd ?? process.cwd(),
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        const exitCode = error && typeof error.code === 'number' ? error.code : error ? null : 0;
        const timedOut = Boolean(
          error && (error.code === 124 || error.signal === 'SIGTERM' || error.signal === 'SIGKILL'),
        );

        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode,
          timedOut,
          durationMs: Date.now() - start,
          ok: !error,
        });
      },
    );
  });
}

export function summarizeResult(result: CodexResult): string {
  const status = result.ok
    ? 'ok'
    : result.timedOut
      ? 'timeout'
      : `exit=${result.exitCode ?? 'signal'}`;

  const outputSummary = summarizeOutput(result.stdout, result.stderr);

  return [
    `status=${status}`,
    `duration=${Math.round(result.durationMs / 1000)}s`,
    outputSummary,
  ].join(' | ');
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
    .map(line => line.trim())
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
