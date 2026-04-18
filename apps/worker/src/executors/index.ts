import type { Executor } from './types.js';
import { claudeHaikuExecutor, claudeSonnetExecutor } from './claude-executor.js';
import { codexExecutor } from './codex-executor.js';
import { maxExecutor } from './max-executor.js';

export type { Executor, ExecutorRunInput, ExecutorRunResult } from './types.js';
export { claudeHaikuExecutor, claudeSonnetExecutor } from './claude-executor.js';
export { codexExecutor } from './codex-executor.js';
export { maxExecutor } from './max-executor.js';
export {
  runWithJsonOutput,
  ExecutorOutputError,
  type JsonOutputRunInput,
} from './json-output.js';

const registry: Record<string, Executor> = {
  [claudeHaikuExecutor.key]: claudeHaikuExecutor,
  [claudeSonnetExecutor.key]: claudeSonnetExecutor,
  [codexExecutor.key]: codexExecutor,
  [maxExecutor.key]: maxExecutor,
};

/** Returns the executor selected by SUPPORT_AGENT_EXECUTOR env (default: 'max'). */
export function getDefaultExecutor(): Executor {
  const key = process.env.SUPPORT_AGENT_EXECUTOR ?? 'max';
  const executor = registry[key];
  if (!executor) {
    throw new Error(
      `Unknown executor "${key}". Registered: ${Object.keys(registry).join(', ')}`,
    );
  }
  return executor;
}

export function getExecutorByKey(key: string): Executor {
  const executor = registry[key];
  if (!executor) {
    throw new Error(
      `Unknown executor "${key}". Registered: ${Object.keys(registry).join(', ')}`,
    );
  }

  return executor;
}
