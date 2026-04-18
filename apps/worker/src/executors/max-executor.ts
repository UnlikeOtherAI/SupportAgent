import { createCliExecutor, shellQuote } from './cli-executor.js';

export const maxExecutor = createCliExecutor({
  key: 'max',
  buildCommand(input) {
    return `max -p ${shellQuote(input.prompt)}`;
  },
});
