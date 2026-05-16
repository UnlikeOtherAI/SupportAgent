import { createCliExecutor } from './cli-executor.js';

// Threshold above which we pipe the prompt via stdin instead of argv to stay
// safely below ARG_MAX on every supported platform.
const PROMPT_STDIN_THRESHOLD = 64 * 1024;

export function createClaudeExecutor(model: string) {
  return createCliExecutor({
    key: `claude-${model}`,
    buildArgv(input) {
      if (input.prompt.length > PROMPT_STDIN_THRESHOLD) {
        return {
          command: 'claude',
          args: ['--model', model, '-p', '-'],
          stdin: input.prompt,
        };
      }
      return {
        command: 'claude',
        args: ['--model', model, '-p', input.prompt],
      };
    },
  });
}

export const claudeSonnetExecutor = createClaudeExecutor('sonnet');
export const claudeHaikuExecutor = createClaudeExecutor('haiku');
