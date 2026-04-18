import { type PrismaClient } from '@prisma/client';
import {
  ghAddIssueComment,
  ghAddPRComment,
  ghEditComment,
  ghGetComment,
  parseGitHubRef,
} from '@support-agent/github-cli';

const PROGRESS_THROTTLE_MS = 30_000;

type SourceTarget =
  | { kind: 'issue'; number: number; owner: string; repo: string }
  | { kind: 'pr'; number: number; owner: string; repo: string };

type ProgressContext =
  | { isGitHub: false }
  | { isGitHub: true; target: SourceTarget };

function isTerminalStatus(status: string) {
  return ['succeeded', 'failed', 'canceled', 'lost'].includes(status);
}

function isStaleCommentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return ['404', '403', '410', 'Not Found'].some((token) => message.includes(token));
}

function buildPlaceholderBody(body: string) {
  return `🤖 SupportAgent is working on this...\n\n${body}`;
}

function buildDefaultPlaceholder() {
  return buildPlaceholderBody(`Last update: ${new Date().toISOString()}`);
}

async function resolveProgressContext(
  prisma: PrismaClient,
  workflowRunId: string,
): Promise<ProgressContext> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: {
      workItem: true,
      repositoryMapping: {
        include: {
          connector: {
            include: {
              platformType: true,
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
  }

  const platformKey = run.repositoryMapping.connector.platformType.key;
  if (platformKey !== 'github' && platformKey !== 'github_issues') {
    return { isGitHub: false };
  }

  const mappingRef = run.repositoryMapping.repositoryUrl;
  const { owner, repo } = parseGitHubRef(mappingRef);
  const itemNumber = run.workItem.reviewTargetNumber ?? Number.parseInt(run.workItem.externalItemId, 10);

  if (!Number.isFinite(itemNumber)) {
    throw new Error(`Workflow run ${workflowRunId} is missing a numeric source item reference`);
  }

  if (run.workItem.workItemKind === 'review_target' || run.workItem.reviewTargetType === 'pull_request') {
    return { isGitHub: true, target: { kind: 'pr', number: itemNumber, owner, repo } };
  }

  return { isGitHub: true, target: { kind: 'issue', number: itemNumber, owner, repo } };
}

async function createComment(target: SourceTarget, body: string) {
  if (target.kind === 'pr') {
    return ghAddPRComment(target.owner, target.repo, target.number, body);
  }

  return ghAddIssueComment(target.owner, target.repo, target.number, body);
}

export function createProgressCommentService(prisma: PrismaClient) {
  return {
    async postPlaceholder(workflowRunId: string): Promise<{ commentId: string; commentUrl: string }> {
      const context = await resolveProgressContext(prisma, workflowRunId);
      if (!context.isGitHub) {
        return { commentId: '', commentUrl: '' };
      }
      const target = context.target;
      const created = await createComment(target, buildDefaultPlaceholder());

      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          progressCommentId: created.id,
          lastProgressEditAt: new Date(),
        },
      });

      return {
        commentId: created.id,
        commentUrl: created.url,
      };
    },

    async updateProgress(workflowRunId: string, body: string): Promise<void> {
      const run = await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
        select: {
          completedAt: true,
          id: true,
          lastProgressEditAt: true,
          progressCommentId: true,
          status: true,
        },
      });

      if (!run) {
        throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
      }

      if (run.completedAt || isTerminalStatus(run.status)) {
        return;
      }

      const now = new Date();
      if (
        run.lastProgressEditAt &&
        now.getTime() - run.lastProgressEditAt.getTime() < PROGRESS_THROTTLE_MS
      ) {
        return;
      }

      const context = await resolveProgressContext(prisma, workflowRunId);
      if (!context.isGitHub) {
        return;
      }
      const target = context.target;
      const nextBody = buildPlaceholderBody(body);

      if (!run.progressCommentId) {
        const created = await createComment(target, nextBody);
        await prisma.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            progressCommentId: created.id,
            lastProgressEditAt: now,
          },
        });
        return;
      }

      try {
        await ghGetComment(target.owner, target.repo, run.progressCommentId);
        await ghEditComment(target.owner, target.repo, run.progressCommentId, nextBody);
        await prisma.workflowRun.update({
          where: { id: workflowRunId },
          data: { lastProgressEditAt: now },
        });
      } catch (error) {
        if (!isStaleCommentError(error)) {
          throw error;
        }

        const created = await createComment(target, nextBody);
        await prisma.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            progressCommentId: created.id,
            lastProgressEditAt: now,
          },
        });
      }
    },

    async finalize(workflowRunId: string, finalBody: string): Promise<void> {
      const run = await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
        select: {
          id: true,
          progressCommentId: true,
        },
      });

      if (!run) {
        throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
      }

      const context = await resolveProgressContext(prisma, workflowRunId);
      if (!context.isGitHub) {
        return;
      }
      const target = context.target;
      const now = new Date();

      if (!run.progressCommentId) {
        const created = await createComment(target, finalBody);
        await prisma.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            progressCommentId: created.id,
            lastProgressEditAt: now,
          },
        });
        return;
      }

      try {
        await ghGetComment(target.owner, target.repo, run.progressCommentId);
        await ghEditComment(target.owner, target.repo, run.progressCommentId, finalBody);
      } catch (error) {
        if (!isStaleCommentError(error)) {
          throw error;
        }

        const created = await createComment(target, finalBody);
        await prisma.workflowRun.update({
          where: { id: workflowRunId },
          data: { progressCommentId: created.id },
        });
      }

      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: { lastProgressEditAt: now },
      });
    },
  };
}

export type ProgressCommentService = ReturnType<typeof createProgressCommentService>;
