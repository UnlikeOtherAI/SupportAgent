import { createCliExecutor } from './cli-executor.js';

const PROMPT_STDIN_THRESHOLD = 64 * 1024;

export const maxExecutor = createCliExecutor({
  key: 'max',
  buildArgv(input) {
    if (input.prompt.length > PROMPT_STDIN_THRESHOLD) {
      return {
        command: 'max',
        args: ['-p', '-'],
        stdin: input.prompt,
      };
    }
    return {
      command: 'max',
      args: ['-p', input.prompt],
    };
  },
});
