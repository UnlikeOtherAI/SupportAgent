import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codexExec, summarizeResult } from './codex-exec.js';

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
}

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

beforeEach(() => {
  spawnMock.mockReset();
});

describe('codexExec', () => {
  it('runs timeout 1800 codex exec with stdin ignored in the target working directory', async () => {
    spawnMock.mockImplementation((_command, _args, _options) => {
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.stdout.write('## Changes Made\n- Updated src/app.ts\n\n## Verification\n- pnpm test\n- passed');
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0, null);
      });
      return child;
    });

    const result = await codexExec('Implement the requested change', '/tmp/repo');

    expect(spawnMock).toHaveBeenCalledWith(
      'timeout',
      ['1800', 'codex', 'exec', 'Implement the requested change'],
      expect.objectContaining({
        cwd: '/tmp/repo',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
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
    spawnMock.mockImplementation((_command, _args, _options) => {
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.stdout.write('partial stdout');
        child.stderr.write('partial stderr');
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 124, 'SIGTERM');
      });
      return child;
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
