import { createCliExecutor } from './cli-executor.js';

const PROMPT_STDIN_THRESHOLD = 64 * 1024;

export const codexExecutor = createCliExecutor({
  key: 'codex',
  buildArgv(input) {
    if (input.prompt.length > PROMPT_STDIN_THRESHOLD) {
      return {
        command: 'timeout',
        args: ['1800', 'codex', 'exec', '-'],
        stdin: input.prompt,
      };
    }
    return {
      command: 'timeout',
      args: ['1800', 'codex', 'exec', input.prompt],
    };
  },
});
