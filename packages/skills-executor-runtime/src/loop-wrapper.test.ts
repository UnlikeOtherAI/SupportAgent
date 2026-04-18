import { describe, expect, it, vi } from 'vitest';
import { runWithLoop } from './loop-wrapper.js';
import { FanOutFailureError } from './types.js';

function buildExecutor(loopOverrides: Partial<Record<string, unknown>> = {}, guardrails = {}) {
  return {
    ast: {
      key: 'looping',
      preamble: 'SupportAgent preamble',
      guardrails,
      loop: {
        enabled: true,
        max_iterations: 3,
        until_done: true,
        ...loopOverrides,
      },
    },
    leafStageId: 'leaf',
    stages: [
      {
        id: 'leaf',
        parallel: 1,
        executor: 'max',
        after: [],
      },
    ],
  };
}

describe('runWithLoop', () => {
  it('runs once when looping is disabled', async () => {
    const persistIteration = vi.fn().mockResolvedValue(undefined);
    const result = await runWithLoop({
      executor: buildExecutor({ enabled: false, until_done: false, max_iterations: 1 }) as never,
      taskPromptByStageId: { leaf: 'prompt' },
      runStage: vi.fn().mockResolvedValue({ delivery: [{ kind: 'comment', body: 'once' }] }),
      signal: new AbortController().signal,
      persistIteration,
    });

    expect(result).toEqual({
      iterations: 1,
      finalOutputs: [{ delivery: [{ kind: 'comment', body: 'once' }] }],
    });
    expect(persistIteration).toHaveBeenCalledTimes(1);
  });

  it('stops when a leaf output reports done=true', async () => {
    const runStage = vi
      .fn()
      .mockResolvedValueOnce({
        delivery: [{ kind: 'comment', body: 'first' }],
        loop: { done: false },
      })
      .mockResolvedValueOnce({
        delivery: [{ kind: 'comment', body: 'second' }],
        loop: { done: true },
      });

    const result = await runWithLoop({
      executor: buildExecutor() as never,
      taskPromptByStageId: { leaf: 'prompt' },
      runStage,
      signal: new AbortController().signal,
      persistIteration: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.iterations).toBe(2);
    expect(result.finalOutputs).toEqual([
      { delivery: [{ kind: 'comment', body: 'second' }], loop: { done: true } },
    ]);
  });

  it('returns the last successful outputs at max_iterations', async () => {
    const result = await runWithLoop({
      executor: buildExecutor({ until_done: false, max_iterations: 2 }) as never,
      taskPromptByStageId: { leaf: 'prompt' },
      runStage: vi
        .fn()
        .mockResolvedValueOnce({
          delivery: [{ kind: 'comment', body: 'first' }],
          loop: { done: false },
        })
        .mockResolvedValueOnce({
          delivery: [{ kind: 'comment', body: 'second' }],
          loop: { done: false },
        }),
      signal: new AbortController().signal,
      persistIteration: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({
      iterations: 2,
      finalOutputs: [{ delivery: [{ kind: 'comment', body: 'second' }], loop: { done: false } }],
    });
  });

  it('throws when min_iteration_change is enabled and outputs repeat', async () => {
    await expect(
      runWithLoop({
        executor: buildExecutor({ until_done: false, max_iterations: 2 }, { loop_safety: { min_iteration_change: true } }) as never,
        taskPromptByStageId: { leaf: 'prompt' },
        runStage: vi.fn().mockResolvedValue({
          delivery: [{ kind: 'comment', body: 'same' }],
          loop: { done: false },
        }),
        signal: new AbortController().signal,
        persistIteration: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow(/no structural change/i);
  });

  it('preserves the prior done output when a later iteration fails', async () => {
    const runStage = vi
      .fn()
      .mockResolvedValueOnce({
        delivery: [{ kind: 'comment', body: 'stable result' }],
        loop: { done: true },
      })
      .mockRejectedValueOnce(new FanOutFailureError('leaf', 0, 1, 1));

    const result = await runWithLoop({
      executor: buildExecutor({ until_done: false, max_iterations: 2 }) as never,
      taskPromptByStageId: { leaf: 'prompt' },
      runStage,
      signal: new AbortController().signal,
      persistIteration: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({
      iterations: 1,
      finalOutputs: [{ delivery: [{ kind: 'comment', body: 'stable result' }], loop: { done: true } }],
    });
  });
});
