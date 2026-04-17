export interface ExecutorRunInput {
  /** Full prompt — must already include any output-file instructions. */
  prompt: string;
  cwd?: string;
  /** Absolute path the executor's prompt asks the LLM to write its result to. */
  outputPath: string;
  timeoutMs: number;
}

export interface ExecutorRunResult {
  /** Captured stdout for logging. The structured result lives in outputContent. */
  stdout: string;
  /** Contents of outputPath after the executor finished, or '' if the file is missing. */
  outputContent: string;
}

export interface Executor {
  /** Stable identifier — 'max', 'codex', 'claude', etc. */
  key: string;
  run(input: ExecutorRunInput): Promise<ExecutorRunResult>;
}
