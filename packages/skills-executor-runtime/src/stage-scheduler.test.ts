import { describe, expect, it, vi } from 'vitest';
import { runStageDag } from './stage-scheduler.js';
import { AbortError, FanOutFailureError, SchemaValidationError } from './types.js';

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
      taskPromptByStageId: { root: 'root prompt', leaf: 'leaf prompt' },
      runStage: vi.fn(async (stageId) => {
        calls.push(stageId);
        return { delivery: [{ kind: 'comment', body: stageId }] };
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
      taskPromptByStageId: { workers: 'worker prompt', consolidator: 'consolidator prompt' },
      runStage: vi.fn(async (stageId) => {
        if (stageId === 'workers') {
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
        taskPromptByStageId: { workers: 'worker prompt' },
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
    const runStage = vi.fn(async (stageId: string) => {
      if (stageId === 'root') {
        controller.abort();
      }

      return { delivery: [{ kind: 'comment', body: stageId }] };
    });

    await expect(
      runStageDag({
        executor: buildExecutor() as never,
        taskPromptByStageId: { root: 'root prompt', leaf: 'leaf prompt' },
        runStage,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AbortError);

    expect(runStage).toHaveBeenCalledTimes(1);
  });
});
