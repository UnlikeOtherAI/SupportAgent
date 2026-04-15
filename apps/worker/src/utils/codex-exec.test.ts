import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codexExec, summarizeResult } from './codex-exec.js';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

beforeEach(() => {
  execFileMock.mockReset();
});

describe('codexExec', () => {
  it('runs timeout 1800 codex exec in the target working directory', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        null,
        '## Changes Made\n- Updated src/app.ts\n\n## Verification\n- pnpm test\n- passed',
        '',
      );
    });

    const result = await codexExec('Implement the requested change', '/tmp/repo');

    expect(execFileMock).toHaveBeenCalledWith(
      'timeout',
      ['1800', 'codex', 'exec', 'Implement the requested change'],
      expect.objectContaining({
        cwd: '/tmp/repo',
        shell: false,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      timedOut: false,
      stdout: expect.stringContaining('## Changes Made'),
      stderr: '',
    });
    expect(summarizeResult(result)).toContain('status=ok');
    expect(summarizeResult(result)).toContain('## Verification');
  });

  it('captures unsuccessful executions without throwing', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        Object.assign(new Error('Command failed'), { code: 124, signal: 'SIGTERM' }),
        'partial stdout',
        'partial stderr',
      );
    });

    const result = await codexExec('Implement the requested change', '/tmp/repo');

    expect(result).toMatchObject({
      ok: false,
      exitCode: 124,
      timedOut: true,
      stdout: 'partial stdout',
      stderr: 'partial stderr',
    });
    expect(summarizeResult(result)).toContain('status=timeout');
    expect(summarizeResult(result)).toContain('partial stdout');
  });
});
