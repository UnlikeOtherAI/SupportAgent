import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ZodType } from 'zod';
import type { Executor } from './types.js';

export interface JsonOutputRunInput<T> {
  /** The handler-specific instructions (without any output-file boilerplate). */
  promptBody: string;
  /** Zod schema the file contents must satisfy. */
  schema: ZodType<T>;
  /** Object with every expected key set to a placeholder; written to disk before exec. */
  template: T;
  /** Absolute path the LLM is told to write its JSON output to. */
  outputPath: string;
  cwd?: string;
  timeoutMs: number;
}

export class ExecutorOutputError extends Error {
  constructor(
    message: string,
    readonly outputPath: string,
    readonly rawContent: string,
  ) {
    super(message);
    this.name = 'ExecutorOutputError';
  }
}

function buildOutputInstructions(outputPath: string, template: unknown): string {
  return `\n\n---\nWrite your final structured output as JSON to this absolute path:
${outputPath}

The file is pre-created with placeholder values matching this exact shape:
${JSON.stringify(template, null, 2)}

Overwrite the file with valid JSON that matches this shape exactly.
- All keys must be present.
- Do not add extra keys.
- Do not write anything else to the file.
- Do not wrap the JSON in markdown code fences.`;
}

/**
 * Pre-create the output file with a template, run the executor, then read +
 * Zod-validate the file the LLM wrote. Throws ExecutorOutputError on a missing
 * file, invalid JSON, or schema mismatch — callers catch and decide policy.
 */
export async function runWithJsonOutput<T>(
  executor: Executor,
  input: JsonOutputRunInput<T>,
): Promise<T> {
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, JSON.stringify(input.template, null, 2), 'utf8');

  const fullPrompt = input.promptBody + buildOutputInstructions(input.outputPath, input.template);

  const { outputContent } = await executor.run({
    prompt: fullPrompt,
    cwd: input.cwd,
    outputPath: input.outputPath,
    timeoutMs: input.timeoutMs,
  });

  if (!outputContent) {
    throw new ExecutorOutputError(
      `Executor produced no output file at ${input.outputPath}`,
      input.outputPath,
      '',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputContent);
  } catch (err) {
    throw new ExecutorOutputError(
      `Executor output at ${input.outputPath} is not valid JSON: ${(err as Error).message}`,
      input.outputPath,
      outputContent,
    );
  }

  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    throw new ExecutorOutputError(
      `Executor output at ${input.outputPath} did not match schema:\n${result.error.message}`,
      input.outputPath,
      outputContent,
    );
  }
  return result.data;
}
