import { type PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { type ExecutionProvider, type WorkerDispatchJob } from './execution-provider.js';

class NoProviderAvailableError extends Error {
  constructor(readonly workflowType: string) {
    super(`No provider available for workflow type: ${workflowType}`);
  }
}

export function createDispatcherService(
  prisma: PrismaClient,
  providers: ExecutionProvider[],
  apiBaseUrl: string,
) {
  async function selectProvider(
    workflowType: string,
    executionProfileKey?: string,
  ): Promise<ExecutionProvider | null> {
    for (const provider of providers) {
      const supported = await provider.supports({ workflowType, executionProfileKey });
      if (supported) return provider;
    }
    return null;
  }

  return {
    /**
     * Claim and dispatch a single queued run.
     * Returns the dispatch record or null if nothing to dispatch.
     */
    async dispatchNext(): Promise<{ dispatchId: string; workflowRunId: string } | null> {
      const claimed = await prisma
        .$transaction(async (tx) => {
          const claimedRuns = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT "id"
             FROM "workflow_runs"
             WHERE "status" = 'queued'
             ORDER BY "createdAt" ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
          );
          const claimedRun = claimedRuns[0];
          if (!claimedRun) return null;

          await tx.workflowRun.update({
            where: { id: claimedRun.id },
            data: { status: 'dispatched' },
          });

          const run = await tx.workflowRun.findUnique({
            where: { id: claimedRun.id },
            include: { repositoryMapping: true },
          });
          if (!run) {
            throw Object.assign(new Error('Claimed run not found'), { statusCode: 404 });
          }

          const provider = await selectProvider(run.workflowType);
          if (!provider) {
            throw new NoProviderAvailableError(run.workflowType);
          }

          let providerRecord = await tx.executionProvider.findFirst({
            where: {
              providerType: provider.key,
              isEnabled: true,
              tenantId: run.tenantId,
            },
          });
          if (!providerRecord) {
            providerRecord = await tx.executionProvider.create({
              data: {
                tenantId: run.tenantId,
                providerType: provider.key,
                name: provider.key,
                isEnabled: true,
                connectionMode: 'direct',
                maxConcurrency: 5,
              },
            });
          }

          const rawSecret = randomBytes(32).toString('hex');
          const hashedSecret = createHash('sha256').update(rawSecret).digest('hex');

          const job: WorkerDispatchJob = {
            jobId: '', // Will be set after dispatch record is created
            workflowRunId: run.id,
            workflowType: run.workflowType,
            apiBaseUrl,
            workerSharedSecret: rawSecret,
            targetRepo: run.repositoryMapping?.repositoryUrl ?? '',
            targetBranch: run.repositoryMapping?.defaultBranch ?? 'main',
            executionProfile: 'analysis-only',
            timeoutSeconds: 3600,
          };

          const dispatch = await tx.workerDispatch.create({
            data: {
              workflowRunId: run.id,
              executionProviderId: providerRecord.id,
              workerSharedSecret: hashedSecret,
              jobPayload: job as any,
              status: 'pending',
              attemptNumber: run.attemptNumber,
            },
          });

          job.jobId = dispatch.id;
          await tx.workerDispatch.update({
            where: { id: dispatch.id },
            data: { jobPayload: job as any },
          });

          await tx.workflowRun.update({
            where: { id: run.id },
            data: {
              acceptedDispatchAttempt: dispatch.id,
            },
          });

          return {
            dispatchId: dispatch.id,
            workflowRunId: run.id,
            job,
            provider,
          };
        })
        .catch((error) => {
          if (error instanceof NoProviderAvailableError) {
            console.warn(
              `[dispatcher] No provider available for workflow type: ${error.workflowType}`,
            );
            return null;
          }

          throw error;
        });

      if (!claimed) return null;

      try {
        const result = await claimed.provider.dispatch(claimed.job);
        await prisma.workerDispatch.update({
          where: { id: claimed.dispatchId },
          data: {
            providerJobId: result.providerJobId,
            providerExecutionUrl: result.providerExecutionUrl,
            status: 'running',
            startedAt: result.startedAt,
          },
        });

        await prisma.workflowRun.updateMany({
          where: { id: claimed.workflowRunId, status: 'dispatched' },
          data: {
            status: 'running',
            startedAt: new Date(),
            providerExecutionRef: result.providerJobId,
          },
        });
      } catch (err) {
        await prisma.workerDispatch.update({
          where: { id: claimed.dispatchId },
          data: { status: 'failed' },
        });
        await prisma.workflowRun.updateMany({
          where: { id: claimed.workflowRunId, status: 'dispatched' },
          data: { status: 'failed', completedAt: new Date() },
        });
        throw err;
      }

      return { dispatchId: claimed.dispatchId, workflowRunId: claimed.workflowRunId };
    },

    /**
     * Poll for queued runs and dispatch them.
     * Returns count dispatched.
     */
    async dispatchAll(): Promise<number> {
      let count = 0;
      let result = await this.dispatchNext();
      while (result) {
        count++;
        result = await this.dispatchNext();
      }
      return count;
    },
  };
}

export type DispatcherService = ReturnType<typeof createDispatcherService>;
