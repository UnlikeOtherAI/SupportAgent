import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillRunResult } from '@support-agent/contracts';

const ghAddIssueComment = vi.fn();
const ghAddPRComment = vi.fn();
const ghApprovePR = vi.fn();
const ghCloseIssue = vi.fn();
const ghCreatePR = vi.fn();
const ghEditIssueLabels = vi.fn();
const ghListOpenPRsForBranch = vi.fn();
const ghMergePR = vi.fn();
const ghReopenIssue = vi.fn();
const ghRequestChangesPR = vi.fn();

vi.mock('@support-agent/github-cli', () => ({
  ghAddIssueComment,
  ghAddPRComment,
  ghApprovePR,
  ghCloseIssue,
  ghCreatePR,
  ghEditIssueLabels,
  ghListOpenPRsForBranch,
  ghMergePR,
  ghReopenIssue,
  ghRequestChangesPR,
  parseGitHubRef: (ref: string) => {
    const cleaned = ref.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const [owner, repo] = cleaned.split('/');
    return { owner, repo };
  },
}));

type WorkflowRunRecord = {
  id: string;
  progressCommentId: string | null;
  repositoryMapping: {
    connector: {
      platformType: {
        key: string;
      };
    };
    connectorId: string;
    repositoryUrl: string;
  };
  tenantId: string;
  workItem: {
    connectorInstanceId: string;
    externalItemId: string;
    reviewTargetNumber: number | null;
    reviewTargetType: string | null;
    workItemKind: string;
  };
};

function createPrisma(run: WorkflowRunRecord) {
  const outputs: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];

  return {
    actionAttempts: attempts,
    actionOutputs: outputs,
    prisma: {
      workflowRun: {
        findUnique: vi.fn(async () => run),
      },
      actionOutput: {
        findUnique: vi.fn(async ({ where }: { where: { idempotencyKey?: string } }) => {
          if (!where.idempotencyKey) {
            return null;
          }

          const row = outputs.find((output) => output.idempotencyKey === where.idempotencyKey);
          if (!row) {
            return null;
          }

          return {
            ...row,
            deliveryAttempts: attempts
              .filter((attempt) => attempt.actionOutputId === row.id)
              .sort((left, right) => {
                const leftValue = String(left.createdAt ?? '');
                const rightValue = String(right.createdAt ?? '');
                return rightValue.localeCompare(leftValue);
              })
              .slice(0, 1),
          };
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `output-${outputs.length + 1}`, ...data };
          outputs.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = outputs.find((output) => output.id === where.id);
          if (!row) throw new Error(`Missing output ${where.id}`);
          Object.assign(row, data);
          return row;
        }),
      },
      actionDeliveryAttempt: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `attempt-${attempts.length + 1}`,
            createdAt: new Date(attempts.length + 1).toISOString(),
            ...data,
          };
          attempts.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = attempts.find((attempt) => attempt.id === where.id);
          if (!row) throw new Error(`Missing attempt ${where.id}`);
          Object.assign(row, data);
          return row;
        }),
      },
    },
  };
}

describe('DeliveryResolverService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ghAddIssueComment.mockResolvedValue({ id: 'comment-1', url: 'https://github.com/test/repo/issues/10#issuecomment-1' });
    ghAddPRComment.mockResolvedValue({ id: 'comment-pr-1', url: 'https://github.com/test/repo/pull/12#issuecomment-1' });
    ghListOpenPRsForBranch.mockResolvedValue([]);
    ghCreatePR.mockResolvedValue({ number: 88, url: 'https://github.com/test/repo/pull/88' });
  });

  it('routes issue comments to ghAddIssueComment', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-issue-comment',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '10',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    const result = await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [{ delivery: [{ kind: 'comment', body: 'hello issue' }] }],
    });

    expect(result).toEqual({ persisted: 1, dispatched: 1 });
    expect(ghAddIssueComment).toHaveBeenCalledWith('test', 'repo', 10, 'hello issue');
    expect(ghAddPRComment).not.toHaveBeenCalled();
    expect(fake.actionAttempts[0]?.status).toBe('succeeded');
  });

  it('routes PR comments and review states to PR helpers', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-pr',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '12',
        reviewTargetNumber: 12,
        reviewTargetType: 'pull_request',
        workItemKind: 'review_target',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    const result = await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [
        {
          delivery: [
            { kind: 'comment', body: 'hello pr' },
            { kind: 'state', change: 'approve' },
            { kind: 'state', change: 'request_changes' },
            { kind: 'state', change: 'merge' },
          ],
        },
      ],
    });

    expect(result).toEqual({ persisted: 4, dispatched: 4 });
    expect(ghAddPRComment).toHaveBeenCalledWith('test', 'repo', 12, 'hello pr');
    expect(ghApprovePR).toHaveBeenCalledWith('test', 'repo', 12);
    expect(ghRequestChangesPR).toHaveBeenCalledWith('test', 'repo', 12);
    expect(ghMergePR).toHaveBeenCalledWith('test', 'repo', 12);
  });

  it('routes labels and close or reopen states through issue helpers', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-issue-state',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '33',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    const result = await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [
        {
          delivery: [
            { kind: 'labels', add: ['triaged'], remove: ['needs-triage'] },
            { kind: 'state', change: 'close' },
            { kind: 'state', change: 'reopen' },
          ],
        },
      ],
    });

    expect(result).toEqual({ persisted: 3, dispatched: 3 });
    expect(ghEditIssueLabels).toHaveBeenCalledWith('test', 'repo', 33, {
      add: ['triaged'],
      remove: ['needs-triage'],
    });
    expect(ghCloseIssue).toHaveBeenCalledWith('test', 'repo', 33);
    expect(ghReopenIssue).toHaveBeenCalledWith('test', 'repo', 33);
  });

  it('routes pr ops to ghCreatePR on the code host connector', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-create-pr',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '55',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    const result = await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [
        {
          delivery: [
            {
              kind: 'pr',
              spec: {
                base: 'main',
                body: 'Fix body',
                branch: 'sa/fix-55',
                draft: true,
                title: 'Fix issue 55',
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({ persisted: 1, dispatched: 1 });
    expect(ghCreatePR).toHaveBeenCalledWith(
      'test',
      'repo',
      'Fix issue 55',
      'Fix body',
      'sa/fix-55',
      'main',
      { draft: true },
    );
    expect(fake.actionAttempts[0]?.destinationType).toBe('repository_provider');
  });

  it('marks the first comment as delivered by the progress comment lifecycle when present', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-progress-comment',
      progressCommentId: 'existing-progress-comment',
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '99',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [{ delivery: [{ kind: 'comment', body: 'final body' }] satisfies SkillRunResult['delivery'] }],
    });

    expect(ghAddIssueComment).not.toHaveBeenCalled();
    expect(fake.actionAttempts[0]?.externalRef).toBe('existing-progress-comment');
    expect(fake.actionAttempts[0]?.status).toBe('succeeded');
  });

  it('suppresses internal delivery ops while keeping the action output audit row', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-internal-comment',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '77',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    const result = await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [
        {
          delivery: [
            {
              kind: 'comment',
              body: 'internal_diagnostic',
              visibility: 'internal',
            },
          ],
        },
      ],
    });

    expect(result).toEqual({ persisted: 1, dispatched: 0 });
    expect(fake.actionOutputs[0]?.deliveryStatus).toBe('suppressed_internal');
    expect(fake.actionAttempts).toHaveLength(0);
    expect(ghAddIssueComment).not.toHaveBeenCalled();
  });

  it('marks later ops in a leaf as skipped_after_failure after the first dispatch failure', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-failure-sequencing',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '88',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);
    ghAddIssueComment.mockRejectedValueOnce(new Error('comment failed'));

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);

    await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs: [
        {
          delivery: [
            { kind: 'comment', body: 'first comment' },
            { kind: 'labels', add: ['triaged'] },
            { kind: 'state', change: 'close' },
          ],
        },
      ],
    });

    expect(fake.actionOutputs.map((output) => output.deliveryStatus)).toEqual([
      'failed',
      'skipped_after_failure',
      'skipped_after_failure',
    ]);
    expect(fake.actionAttempts).toHaveLength(1);
    expect(fake.actionAttempts[0]?.status).toBe('failed');
    expect(ghEditIssueLabels).not.toHaveBeenCalled();
    expect(ghCloseIssue).not.toHaveBeenCalled();
  });

  it('does not redispatch delivery ops that already succeeded for the same run leaf/op idempotency key', async () => {
    const run: WorkflowRunRecord = {
      id: 'run-idempotent',
      progressCommentId: null,
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        connectorId: 'repo-connector',
        repositoryUrl: 'https://github.com/test/repo',
      },
      tenantId: 'tenant-1',
      workItem: {
        connectorInstanceId: 'source-connector',
        externalItemId: '101',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const fake = createPrisma(run);

    const { createDeliveryResolverService } = await import('./delivery-resolver-service.js');
    const service = createDeliveryResolverService(fake.prisma as never);
    const leafOutputs: SkillRunResult[] = [
      {
        delivery: [
          { kind: 'comment', body: 'comment once' },
          {
            kind: 'pr',
            spec: {
              base: 'main',
              body: 'Fix body',
              branch: 'sa/fix-101',
              title: 'Fix issue 101',
            },
          },
        ],
      },
    ];

    await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs,
    });
    await service.resolveDelivery({
      workflowRunId: run.id,
      leafOutputs,
    });

    expect(ghAddIssueComment).toHaveBeenCalledTimes(1);
    expect(ghCreatePR).toHaveBeenCalledTimes(1);
    expect(fake.actionOutputs).toHaveLength(2);
  });
});
