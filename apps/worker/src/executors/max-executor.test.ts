import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd?: string; shell?: boolean; stdio?: unknown };
}

const spawnCalls: SpawnCall[] = [];
let nextStdout = '';
let nextExitCode = 0;
let stdinWrites: string[] = [];

class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void };
  stderr = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void };
  stdin = {
    end: vi.fn((chunk: string) => {
      stdinWrites.push(chunk);
    }),
  };

  constructor() {
    super();
    (this.stdout as any).setEncoding = () => undefined;
    (this.stderr as any).setEncoding = () => undefined;
  }

  kill(_signal?: string): void {
    /* noop */
  }
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((command: string, args: string[], options: any) => {
    spawnCalls.push({ command, args, options });
    const child = new FakeChild();
    queueMicrotask(() => {
      if (nextStdout) child.stdout.emit('data', nextStdout);
      child.emit('close', nextExitCode, null);
    });
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
  }),
}));

let workDir = '';

beforeEach(async () => {
  spawnCalls.length = 0;
  nextStdout = '';
  nextExitCode = 0;
  stdinWrites = [];
  workDir = await mkdtemp(join(tmpdir(), 'max-executor-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('maxExecutor', () => {
  it('exposes the "max" key', async () => {
    const { maxExecutor } = await import('./max-executor.js');
    expect(maxExecutor.key).toBe('max');
  });

  it('invokes `max -p <prompt>` via argv (no shell)', async () => {
    nextStdout = 'hello';
    const outputPath = join(workDir, 'out.json');
    await writeFile(outputPath, '{"k":"v"}');

    const { maxExecutor } = await import('./max-executor.js');
    const result = await maxExecutor.run({
      prompt: 'Say hi',
      cwd: workDir,
      outputPath,
      timeoutMs: 1234,
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('max');
    expect(spawnCalls[0].args).toEqual(['-p', 'Say hi']);
    expect(spawnCalls[0].options.shell).toBe(false);
    expect(spawnCalls[0].options.cwd).toBe(workDir);
    expect(result.stdout).toBe('hello');
    expect(result.outputContent).toBe('{"k":"v"}');
  });

  it('passes shell metacharacters through argv verbatim — no shell expansion', async () => {
    const outputPath = join(workDir, 'out.json');
    await writeFile(outputPath, '{}');

    const adversarialPrompt = `He said "hi"; touch /tmp/pwn; #`;
    const { maxExecutor } = await import('./max-executor.js');
    await maxExecutor.run({
      prompt: adversarialPrompt,
      outputPath,
      timeoutMs: 1000,
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args[1]).toBe(adversarialPrompt);
    expect(spawnCalls[0].options.shell).toBe(false);
  });

  it('switches to stdin transport for prompts above the threshold', async () => {
    const outputPath = join(workDir, 'out.json');
    await writeFile(outputPath, '{}');

    const huge = 'A'.repeat(70 * 1024);
    const { maxExecutor } = await import('./max-executor.js');
    await maxExecutor.run({
      prompt: huge,
      outputPath,
      timeoutMs: 1000,
    });

    expect(spawnCalls[0].args).toEqual(['-p', '-']);
    expect(stdinWrites).toContain(huge);
  });

  it('returns empty outputContent when the file does not exist', async () => {
    nextStdout = 'no file written';
    const outputPath = join(workDir, 'never-written.json');

    const { maxExecutor } = await import('./max-executor.js');
    const result = await maxExecutor.run({
      prompt: 'do nothing',
      outputPath,
      timeoutMs: 1000,
    });

    expect(result.stdout).toBe('no file written');
    expect(result.outputContent).toBe('');
  });
});
