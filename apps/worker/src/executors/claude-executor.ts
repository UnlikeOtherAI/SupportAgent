import { createCliExecutor, shellQuote } from './cli-executor.js';

function buildClaudeCommand(model: string, prompt: string): string {
  return `claude --model ${shellQuote(model)} -p ${shellQuote(prompt)}`;
}

export function createClaudeExecutor(model: string) {
  return createCliExecutor({
    key: `claude-${model}`,
    buildCommand(input) {
      return buildClaudeCommand(model, input.prompt);
    },
  });
}

export const claudeSonnetExecutor = createClaudeExecutor('sonnet');
export const claudeHaikuExecutor = createClaudeExecutor('haiku');
