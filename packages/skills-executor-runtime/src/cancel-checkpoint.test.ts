import { describe, expect, it, vi } from 'vitest';
import { runWithLoop } from './loop-wrapper.js';
import { CanceledError } from './types.js';

function buildExecutor() {
  return {
    ast: {
      key: 'cancel-checkpoint',
      preamble: 'SupportAgent preamble',
      guardrails: {},
      loop: {
        enabled: true,
        max_iterations: 3,
        until_done: false,
      },
    },
    leafStageId: 'leaf',
    stages: [
      {
        id: 'root',
        parallel: 1,
        executor: 'max',
        after: [],
      },
      {
        id: 'leaf',
        parallel: 1,
        executor: 'codex',
        after: ['root'],
      },
    ],
  };
}

describe('cancel checkpoint integration', () => {
  it('preserves completed outputs and writes checkpoints before surfacing cancellation', async () => {
    const writeCheckpoint = vi.fn().mockResolvedValue(undefined);

    try {
      await runWithLoop({
        executor: buildExecutor() as never,
        buildStagePrompt: (stage, outputsByStage, iteration) =>
          `${stage.id}:${iteration ?? 1}:${outputsByStage.size}`,
        runStage: vi
          .fn()
          .mockImplementation(async (stage: { id: string }) => ({
            delivery: [{ kind: 'comment', body: `${stage.id}-output` }],
            loop: stage.id === 'leaf' ? { done: false } : undefined,
          })),
        signal: new AbortController().signal,
        persistIteration: vi.fn().mockResolvedValue(undefined),
        checkpointWriter: { writeCheckpoint },
        cancelChecker: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CanceledError);
      const canceled = error as CanceledError;
      expect(canceled.outputsByStage.get('root')).toEqual([
        { delivery: [{ kind: 'comment', body: 'root-output' }] },
      ]);
      expect(canceled.outputsByStage.get('leaf')).toEqual([
        { delivery: [{ kind: 'comment', body: 'leaf-output' }], loop: { done: false } },
      ]);
      expect(canceled.preservedOutputs).toEqual([
        { delivery: [{ kind: 'comment', body: 'leaf-output' }], loop: { done: false } },
      ]);
    }

    expect(writeCheckpoint.mock.calls).toEqual([
      [
        {
          kind: 'stage_complete',
          stageId: 'root',
          payload: [{ delivery: [{ kind: 'comment', body: 'root-output' }] }],
        },
      ],
      [
        {
          kind: 'stage_complete',
          stageId: 'leaf',
          payload: [{ delivery: [{ kind: 'comment', body: 'leaf-output' }], loop: { done: false } }],
        },
      ],
      [
        {
          kind: 'iteration_complete',
          iteration: 1,
          payload: [{ delivery: [{ kind: 'comment', body: 'leaf-output' }], loop: { done: false } }],
        },
      ],
    ]);
  });
});
