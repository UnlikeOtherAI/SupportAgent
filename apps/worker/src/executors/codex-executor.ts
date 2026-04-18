import { createCliExecutor, shellQuote } from './cli-executor.js';

export const codexExecutor = createCliExecutor({
  key: 'codex',
  buildCommand(input) {
    return `timeout 1800 codex exec ${shellQuote(input.prompt)}`;
  },
});
