import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maxExecutor } from './max-executor.js';

let lastCommand = '';
let lastOptions: { timeout?: number; cwd?: string } = {};
let nextStdout = '';

vi.mock('node:child_process', () => ({
  exec: vi.fn((command: string, options: any, callback: any) => {
    lastCommand = command;
    lastOptions = options ?? {};
    callback(null, nextStdout, '');
    return { pid: 1234, once: vi.fn() };
  }),
}));

let workDir = '';

beforeEach(async () => {
  lastCommand = '';
  lastOptions = {};
  nextStdout = '';
  workDir = await mkdtemp(join(tmpdir(), 'max-executor-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('maxExecutor', () => {
  it('exposes the "max" key', () => {
    expect(maxExecutor.key).toBe('max');
  });

  it('invokes `max -p` with the prompt and forwards cwd + timeout', async () => {
    nextStdout = 'hello';
    const outputPath = join(workDir, 'out.json');
    await writeFile(outputPath, '{"k":"v"}');

    const result = await maxExecutor.run({
      prompt: 'Say hi',
      cwd: workDir,
      outputPath,
      timeoutMs: 1234,
    });

    expect(lastCommand).toBe('max -p "Say hi"');
    expect(lastOptions.cwd).toBe(workDir);
    expect(lastOptions.timeout).toBe(1234);
    expect(result.stdout).toBe('hello');
    expect(result.outputContent).toBe('{"k":"v"}');
  });

  it('escapes embedded double quotes in the prompt', async () => {
    const outputPath = join(workDir, 'out.json');
    await writeFile(outputPath, '{}');

    await maxExecutor.run({
      prompt: 'He said "hi"',
      outputPath,
      timeoutMs: 1000,
    });
    expect(lastCommand).toBe('max -p "He said \\"hi\\""');
  });

  it('returns empty outputContent when the file does not exist', async () => {
    nextStdout = 'no file written';
    const outputPath = join(workDir, 'never-written.json');

    const result = await maxExecutor.run({
      prompt: 'do nothing',
      outputPath,
      timeoutMs: 1000,
    });

    expect(result.stdout).toBe('no file written');
    expect(result.outputContent).toBe('');
  });
});
