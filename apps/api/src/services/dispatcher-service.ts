import { type PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { type ExecutionProvider, type WorkerDispatchJob } from './execution-provider.js';

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
      // 1. Find oldest queued run
      const run = await prisma.workflowRun.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        include: { repositoryMapping: true },
      });
      if (!run) return null;

      // 2. Select provider
      const provider = await selectProvider(run.workflowType);
      if (!provider) {
        console.warn(
          `[dispatcher] No provider available for workflow type: ${run.workflowType}`,
        );
        return null;
      }

      // 3. Find or create the execution provider record
      let providerRecord = await prisma.executionProvider.findFirst({
        where: { providerType: provider.key, isEnabled: true },
      });
      if (!providerRecord) {
        providerRecord = await prisma.executionProvider.create({
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

      // 4. Generate per-dispatch secret
      const workerSharedSecret = randomBytes(32).toString('hex');

      // 5. Build dispatch job
      const job: WorkerDispatchJob = {
        jobId: '', // Will be set after dispatch record is created
        workflowRunId: run.id,
        workflowType: run.workflowType,
        apiBaseUrl,
        workerSharedSecret,
        targetRepo: run.repositoryMapping?.repositoryUrl ?? '',
        targetBranch: run.repositoryMapping?.defaultBranch ?? 'main',
        executionProfile: 'analysis-only',
        timeoutSeconds: 3600,
      };

      // 6. Create dispatch record
      const dispatch = await prisma.workerDispatch.create({
        data: {
          workflowRunId: run.id,
          executionProviderId: providerRecord.id,
          workerSharedSecret,
          jobPayload: job as any,
          status: 'pending',
          attemptNumber: run.attemptNumber,
        },
      });

      // 7. Update job with dispatch ID
      job.jobId = dispatch.id;
      await prisma.workerDispatch.update({
        where: { id: dispatch.id },
        data: { jobPayload: job as any },
      });

      // 8. Transition run to dispatched
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'dispatched',
          acceptedDispatchAttempt: dispatch.id,
        },
      });

      // 9. Dispatch to provider
      try {
        const result = await provider.dispatch(job);
        await prisma.workerDispatch.update({
          where: { id: dispatch.id },
          data: {
            providerJobId: result.providerJobId,
            providerExecutionUrl: result.providerExecutionUrl,
            status: 'running',
            startedAt: result.startedAt,
          },
        });

        await prisma.workflowRun.update({
          where: { id: run.id },
          data: {
            status: 'running',
            startedAt: new Date(),
            providerExecutionRef: result.providerJobId,
          },
        });
      } catch (err) {
        await prisma.workerDispatch.update({
          where: { id: dispatch.id },
          data: { status: 'failed' },
        });
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { status: 'failed', completedAt: new Date() },
        });
        throw err;
      }

      return { dispatchId: dispatch.id, workflowRunId: run.id };
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
