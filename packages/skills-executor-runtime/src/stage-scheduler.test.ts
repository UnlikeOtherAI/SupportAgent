import { describe, expect, it, vi } from 'vitest';
import { runStageDag } from './stage-scheduler.js';
import {
  AbortError,
  CanceledError,
  FanOutFailureError,
  MultiLeafSafetyViolation,
  SchemaValidationError,
} from './types.js';

function buildExecutor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ast: {
      key: 'test-executor',
      preamble: 'SupportAgent preamble',
      guardrails: {},
      loop: { enabled: false, max_iterations: 1, until_done: false },
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
    ...overrides,
  };
}

describe('runStageDag', () => {
  it('runs a linear dag in topological order', async () => {
    const calls: string[] = [];

    const result = await runStageDag({
      executor: buildExecutor() as never,
      buildStagePrompt: (stage) => `${stage.id} prompt`,
      runStage: vi.fn(async (stage) => {
        calls.push(stage.id);
        return { delivery: [{ kind: 'comment', body: stage.id }] };
      }),
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(['root', 'leaf']);
    expect(result.outputsByStage.get('root')).toHaveLength(1);
    expect(result.leafOutputs).toEqual([{ delivery: [{ kind: 'comment', body: 'leaf' }] }]);
  });

  it('runs fan-out stages and retries consolidator schema failures', async () => {
    let consolidatorAttempts = 0;

    const executor = buildExecutor({
      ast: {
        key: 'fan-out',
        preamble: 'SupportAgent preamble',
        guardrails: { fan_out_min_success_rate: 0.5, consolidator_max_retries: 2 },
        loop: { enabled: false, max_iterations: 1, until_done: false },
      },
      leafStageId: 'consolidator',
      stages: [
        {
          id: 'workers',
          parallel: 3,
          executor: 'max',
          after: [],
        },
        {
          id: 'consolidator',
          parallel: 1,
          executor: 'codex',
          after: ['workers'],
        },
      ],
    });

    const result = await runStageDag({
      executor: executor as never,
      buildStagePrompt: (stage) => `${stage.id} prompt`,
      runStage: vi.fn(async (stage) => {
        if (stage.id === 'workers') {
          return { delivery: [{ kind: 'comment', body: 'worker ok' }] };
        }

        consolidatorAttempts += 1;
        if (consolidatorAttempts < 3) {
          throw new SchemaValidationError('invalid schema');
        }

        return { delivery: [{ kind: 'comment', body: 'consolidated' }] };
      }),
      signal: new AbortController().signal,
    });

    expect(consolidatorAttempts).toBe(3);
    expect(result.leafOutputs).toEqual([{ delivery: [{ kind: 'comment', body: 'consolidated' }] }]);
  });

  it('throws when fan-out success rate is below the guardrail threshold', async () => {
    await expect(
      runStageDag({
        executor: buildExecutor({
          ast: {
            key: 'fan-out',
            preamble: 'SupportAgent preamble',
            guardrails: { fan_out_min_success_rate: 0.75 },
            loop: { enabled: false, max_iterations: 1, until_done: false },
          },
          stages: [
            {
              id: 'workers',
              parallel: 4,
              executor: 'max',
              after: [],
            },
          ],
          leafStageId: 'workers',
        }) as never,
        buildStagePrompt: (stage) => `${stage.id} prompt`,
        runStage: vi
          .fn()
          .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'ok-1' }] })
          .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'ok-2' }] })
          .mockRejectedValueOnce(new Error('spawn failed'))
          .mockRejectedValueOnce(new Error('spawn failed')),
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(FanOutFailureError);
  });

  it('honors abort signals before running remaining stages', async () => {
    const controller = new AbortController();
    const runStage = vi.fn(async (stage: { id: string }) => {
      if (stage.id === 'root') {
        controller.abort();
      }

      return { delivery: [{ kind: 'comment', body: stage.id }] };
    });

    await expect(
      runStageDag({
        executor: buildExecutor() as never,
        buildStagePrompt: (stage) => `${stage.id} prompt`,
        runStage,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AbortError);

    expect(runStage).toHaveBeenCalledTimes(1);
  });

  it('preserves completed stage outputs when canceled between stages', async () => {
    await expect(
      runStageDag({
        executor: buildExecutor() as never,
        buildStagePrompt: (stage) => `${stage.id} prompt`,
        runStage: vi.fn(async (stage) => ({
          delivery: [{ kind: 'comment', body: stage.id }],
        })),
        signal: new AbortController().signal,
        cancelChecker: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      }),
    ).rejects.toMatchObject({
      name: 'CanceledError',
    });

    try {
      await runStageDag({
        executor: buildExecutor() as never,
        buildStagePrompt: (stage) => `${stage.id} prompt`,
        runStage: vi.fn(async (stage) => ({
          delivery: [{ kind: 'comment', body: stage.id }],
        })),
        signal: new AbortController().signal,
        cancelChecker: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CanceledError);
      const canceled = error as CanceledError;
      expect(canceled.outputsByStage.get('root')).toEqual([
        { delivery: [{ kind: 'comment', body: 'root' }] },
      ]);
      expect(canceled.outputsByStage.has('leaf')).toBe(false);
    }
  });

  it('writes stage checkpoints in completion order', async () => {
    const writeCheckpoint = vi.fn().mockResolvedValue(undefined);

    await runStageDag({
      executor: buildExecutor() as never,
      buildStagePrompt: (stage) => `${stage.id} prompt`,
      runStage: vi.fn(async (stage) => ({
        delivery: [{ kind: 'comment', body: stage.id }],
      })),
      signal: new AbortController().signal,
      checkpointWriter: { writeCheckpoint },
    });

    expect(writeCheckpoint.mock.calls).toEqual([
      [
        {
          kind: 'stage_complete',
          stageId: 'root',
          payload: [{ delivery: [{ kind: 'comment', body: 'root' }] }],
        },
      ],
      [
        {
          kind: 'stage_complete',
          stageId: 'leaf',
          payload: [{ delivery: [{ kind: 'comment', body: 'leaf' }] }],
        },
      ],
    ]);
  });

  it('rejects multi-leaf stages when any spawn emits a non-comment delivery op', async () => {
    const runStage = vi
      .fn()
      .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'spawn-0' }] })
      .mockResolvedValueOnce({ delivery: [{ kind: 'state', change: 'close' }] })
      .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'spawn-2' }] });

    await expect(
      runStageDag({
        executor: buildExecutor({
          stages: [
            {
              id: 'leaf',
              parallel: 3,
              executor: 'codex',
              after: [],
            },
          ],
          leafStageId: 'leaf',
        }) as never,
        buildStagePrompt: (stage) => `${stage.id} prompt`,
        runStage,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: 'MultiLeafSafetyViolation',
      message: expect.stringContaining('spawn 1'),
    });
  });

  it('accepts multi-leaf stages when every spawn emits comment-only delivery', async () => {
    const result = await runStageDag({
      executor: buildExecutor({
        stages: [
          {
            id: 'leaf',
            parallel: 3,
            executor: 'codex',
            after: [],
          },
        ],
        leafStageId: 'leaf',
      }) as never,
      buildStagePrompt: (stage) => `${stage.id} prompt`,
      runStage: vi
        .fn()
        .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'spawn-0' }] })
        .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'spawn-1' }] })
        .mockResolvedValueOnce({ delivery: [{ kind: 'comment', body: 'spawn-2' }] }),
      signal: new AbortController().signal,
    });

    expect(result.leafOutputs).toEqual([
      { delivery: [{ kind: 'comment', body: 'spawn-0' }] },
      { delivery: [{ kind: 'comment', body: 'spawn-1' }] },
      { delivery: [{ kind: 'comment', body: 'spawn-2' }] },
    ]);
  });

  it('allows single-leaf stages to emit non-comment delivery ops', async () => {
    const result = await runStageDag({
      executor: buildExecutor({
        stages: [
          {
            id: 'leaf',
            parallel: 1,
            executor: 'codex',
            after: [],
          },
        ],
        leafStageId: 'leaf',
      }) as never,
      buildStagePrompt: (stage) => `${stage.id} prompt`,
      runStage: vi.fn().mockResolvedValue({
        delivery: [{ kind: 'state', change: 'close' }],
      }),
      signal: new AbortController().signal,
    });

    expect(result.leafOutputs).toEqual([{ delivery: [{ kind: 'state', change: 'close' }] }]);
  });
});
