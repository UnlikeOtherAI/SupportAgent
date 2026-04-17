import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ExecutorOutputError, runWithJsonOutput } from './json-output.js';
import type { Executor } from './types.js';

const Schema = z.object({
  summary: z.string(),
  count: z.number().int(),
});
type Out = z.infer<typeof Schema>;

const TEMPLATE: Out = { summary: '', count: 0 };

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'json-output-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeExecutor(opts: {
  outputContent: string;
  capture?: { prompt?: string; outputPath?: string };
}): Executor {
  return {
    key: 'mock',
    async run(input) {
      if (opts.capture) {
        opts.capture.prompt = input.prompt;
        opts.capture.outputPath = input.outputPath;
      }
      return { stdout: '', outputContent: opts.outputContent };
    },
  };
}

describe('runWithJsonOutput', () => {
  it('pre-creates the output file with the template before invoking the executor', async () => {
    const outputPath = join(workDir, 'pre.json');
    const seen = { prompt: '', outputPath: '' };
    const exec = makeExecutor({
      outputContent: JSON.stringify({ summary: 'ok', count: 1 }),
      capture: seen,
    });

    await runWithJsonOutput(exec, {
      promptBody: 'do the thing',
      schema: Schema,
      template: TEMPLATE,
      outputPath,
      timeoutMs: 1000,
    });

    const onDisk = await readFile(outputPath, 'utf8');
    // The pre-fill must have happened (executor mock did not write to disk).
    expect(JSON.parse(onDisk)).toEqual(TEMPLATE);
    expect(seen.outputPath).toBe(outputPath);
  });

  it('appends output instructions including the path and template to the prompt', async () => {
    const outputPath = join(workDir, 'p.json');
    const seen = { prompt: '', outputPath: '' };
    const exec = makeExecutor({
      outputContent: JSON.stringify({ summary: 'ok', count: 0 }),
      capture: seen,
    });

    await runWithJsonOutput(exec, {
      promptBody: 'core instructions',
      schema: Schema,
      template: TEMPLATE,
      outputPath,
      timeoutMs: 1000,
    });

    expect(seen.prompt).toContain('core instructions');
    expect(seen.prompt).toContain(outputPath);
    expect(seen.prompt).toContain('"summary":');
    expect(seen.prompt).toContain('"count":');
  });

  it('returns the parsed + validated output when the schema matches', async () => {
    const outputPath = join(workDir, 'ok.json');
    const exec = makeExecutor({
      outputContent: JSON.stringify({ summary: 'all good', count: 7 }),
    });
    const result = await runWithJsonOutput(exec, {
      promptBody: 'x',
      schema: Schema,
      template: TEMPLATE,
      outputPath,
      timeoutMs: 1000,
    });
    expect(result).toEqual({ summary: 'all good', count: 7 });
  });

  it('throws ExecutorOutputError when the file is missing', async () => {
    const outputPath = join(workDir, 'missing.json');
    const exec = makeExecutor({ outputContent: '' });
    await expect(
      runWithJsonOutput(exec, {
        promptBody: 'x',
        schema: Schema,
        template: TEMPLATE,
        outputPath,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(ExecutorOutputError);
  });

  it('throws ExecutorOutputError on malformed JSON', async () => {
    const outputPath = join(workDir, 'bad.json');
    const exec = makeExecutor({ outputContent: 'this { is not json' });
    await expect(
      runWithJsonOutput(exec, {
        promptBody: 'x',
        schema: Schema,
        template: TEMPLATE,
        outputPath,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws ExecutorOutputError when the JSON does not match the schema', async () => {
    const outputPath = join(workDir, 'wrong.json');
    const exec = makeExecutor({ outputContent: JSON.stringify({ summary: 1, count: 'oops' }) });
    await expect(
      runWithJsonOutput(exec, {
        promptBody: 'x',
        schema: Schema,
        template: TEMPLATE,
        outputPath,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/did not match schema/);
  });
});
