import { describe, expect, it, vi } from 'vitest';
import { normalizedLeafOutputsEqual, runWithLoop } from './loop-wrapper.js';
import { CanceledError, FanOutFailureError } from './types.js';

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
      buildStagePrompt: () => 'prompt',
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
      buildStagePrompt: () => 'prompt',
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
      buildStagePrompt: () => 'prompt',
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
        buildStagePrompt: () => 'prompt',
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
      buildStagePrompt: () => 'prompt',
      runStage,
      signal: new AbortController().signal,
      persistIteration: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({
      iterations: 1,
      finalOutputs: [{ delivery: [{ kind: 'comment', body: 'stable result' }], loop: { done: true } }],
    });
  });

  it('preserves the last completed iteration outputs when canceled between iterations', async () => {
    const persistIteration = vi.fn().mockResolvedValue(undefined);
    const writeCheckpoint = vi.fn().mockResolvedValue(undefined);

    try {
      await runWithLoop({
        executor: buildExecutor({ until_done: false, max_iterations: 3 }) as never,
        buildStagePrompt: () => 'prompt',
        runStage: vi.fn().mockResolvedValue({
          delivery: [{ kind: 'comment', body: 'iteration-one' }],
          loop: { done: false },
        }),
        signal: new AbortController().signal,
        persistIteration,
        checkpointWriter: { writeCheckpoint },
        cancelChecker: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CanceledError);
      const canceled = error as CanceledError;
      expect(canceled.preservedOutputs).toEqual([
        { delivery: [{ kind: 'comment', body: 'iteration-one' }], loop: { done: false } },
      ]);
      expect(canceled.schemaErrors).toEqual([]);
    }

    expect(persistIteration).toHaveBeenCalledTimes(1);
    expect(writeCheckpoint.mock.calls).toEqual([
      [
        {
          kind: 'stage_complete',
          stageId: 'leaf',
          payload: [{ delivery: [{ kind: 'comment', body: 'iteration-one' }], loop: { done: false } }],
        },
      ],
      [
        {
          kind: 'iteration_complete',
          iteration: 1,
          payload: [{ delivery: [{ kind: 'comment', body: 'iteration-one' }], loop: { done: false } }],
        },
      ],
    ]);
  });

  it('treats differing report summaries and next iteration focus as converged', () => {
    expect(
      normalizedLeafOutputsEqual(
        [
          {
            delivery: [{ kind: 'comment', body: 'same' }],
            reportSummary: 'summary one',
            loop: { done: false, next_iteration_focus: 'focus one' },
          },
        ],
        [
          {
            delivery: [{ kind: 'comment', body: 'same' }],
            reportSummary: 'summary two',
            loop: { done: false, next_iteration_focus: 'focus two' },
          },
        ],
      ),
    ).toBe(true);
  });

  it('treats findings changes as non-converged', () => {
    expect(
      normalizedLeafOutputsEqual(
        [{ delivery: [], findings: { summary: 'first' } }],
        [{ delivery: [], findings: { summary: 'second' } }],
      ),
    ).toBe(false);
  });

  it('ignores volatile extras keys during convergence checks', () => {
    expect(
      normalizedLeafOutputsEqual(
        [
          {
            delivery: [{ kind: 'comment', body: 'same' }],
            extras: {
              'x-loop-volatile-timestamp': '2026-04-18T12:00:00Z',
              stable: 'value',
            },
          },
        ],
        [
          {
            delivery: [{ kind: 'comment', body: 'same' }],
            extras: {
              'X-Loop-Volatile-Timestamp': '2026-04-18T12:00:01Z',
              stable: 'value',
            },
          },
        ],
      ),
    ).toBe(true);
  });
});
