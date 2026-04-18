import { beforeEach, describe, expect, it, vi } from 'vitest';

const ghAddIssueComment = vi.fn();
const ghAddPRComment = vi.fn();
const ghEditComment = vi.fn();
const ghGetComment = vi.fn();

vi.mock('@support-agent/github-cli', () => ({
  ghAddIssueComment,
  ghAddPRComment,
  ghEditComment,
  ghGetComment,
  parseGitHubRef: (ref: string) => {
    const cleaned = ref.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const [owner, repo] = cleaned.split('/');
    return { owner, repo };
  },
}));

type RunRecord = {
  completedAt: Date | null;
  id: string;
  lastProgressEditAt: Date | null;
  progressCommentId: string | null;
  repositoryMapping: {
    connector: {
      platformType: {
        key: string;
      };
    };
    repositoryUrl: string;
  };
  status: string;
  workItem: {
    externalItemId: string;
    reviewTargetNumber: number | null;
    reviewTargetType: string | null;
    workItemKind: string;
  };
};

function createPrisma(run: RunRecord) {
  return {
    workflowRun: {
      findUnique: vi.fn(async ({ select }: { select?: Record<string, boolean> }) => {
        if (select) {
          return Object.fromEntries(
            Object.keys(select).map((key) => [key, run[key as keyof RunRecord]]),
          );
        }
        return run;
      }),
      update: vi.fn(async ({ data }: { data: Partial<RunRecord> }) => {
        Object.assign(run, data);
        return run;
      }),
    },
  };
}

describe('ProgressCommentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the second progress update within 30 seconds', async () => {
    const run: RunRecord = {
      completedAt: null,
      id: 'run-1',
      lastProgressEditAt: null,
      progressCommentId: 'comment-1',
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        repositoryUrl: 'https://github.com/test/repo',
      },
      status: 'running',
      workItem: {
        externalItemId: '42',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const prisma = createPrisma(run);
    ghGetComment.mockResolvedValue({ id: 'comment-1', url: 'https://github.com/test/repo/issues/42#issuecomment-1' });
    ghEditComment.mockResolvedValue({ id: 'comment-1', url: 'https://github.com/test/repo/issues/42#issuecomment-1' });

    const { createProgressCommentService } = await import('./progress-comment-service.js');
    const service = createProgressCommentService(prisma as never);

    await service.updateProgress(run.id, 'First update');
    await service.updateProgress(run.id, 'Second update');

    expect(ghEditComment).toHaveBeenCalledTimes(1);
    expect(run.lastProgressEditAt).toBeInstanceOf(Date);
  });

  it('recreates a deleted placeholder during progress updates', async () => {
    const run: RunRecord = {
      completedAt: null,
      id: 'run-2',
      lastProgressEditAt: new Date(Date.now() - 31_000),
      progressCommentId: 'comment-stale',
      repositoryMapping: {
        connector: { platformType: { key: 'github' } },
        repositoryUrl: 'https://github.com/test/repo',
      },
      status: 'running',
      workItem: {
        externalItemId: '77',
        reviewTargetNumber: null,
        reviewTargetType: null,
        workItemKind: 'issue',
      },
    };
    const prisma = createPrisma(run);
    ghGetComment.mockRejectedValue(new Error('404 Not Found'));
    ghAddIssueComment.mockResolvedValue({
      id: 'comment-new',
      url: 'https://github.com/test/repo/issues/77#issuecomment-new',
    });

    const { createProgressCommentService } = await import('./progress-comment-service.js');
    const service = createProgressCommentService(prisma as never);

    await service.updateProgress(run.id, 'Recovered progress');

    expect(ghAddIssueComment).toHaveBeenCalledTimes(1);
    expect(ghEditComment).not.toHaveBeenCalled();
    expect(run.progressCommentId).toBe('comment-new');
  });
});
