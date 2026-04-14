import { type PrismaClient } from '@prisma/client';

/**
 * Workflow chain service — orchestrates the triage → build → merge pipeline.
 *
 * The chain works like this:
 * 1. Triage run completes (succeeded) → create a "build" run for the same work item
 * 2. Build run completes with PR reference → create a "merge" run for that PR
 * 3. Merge run completes → chain halts; PR either merged or needs human review
 */
export function createWorkflowChainService(prisma: PrismaClient) {
  /**
   * After a triage run succeeds, trigger a build run for the same work item.
   */
  async function chainTriageToBuild(triageRunId: string): Promise<{ buildRunId: string } | null> {
    const triageRun = await prisma.workflowRun.findUnique({
      where: { id: triageRunId },
      include: { workItem: { include: { repositoryMapping: true } } },
    });

    if (!triageRun) return null;
    if (triageRun.workflowType !== 'triage') return null;
    if (triageRun.status !== 'succeeded') return null;

    // Check if build already exists for this work item
    const existingBuild = await prisma.workflowRun.findFirst({
      where: {
        workItemId: triageRun.workItemId,
        workflowType: 'build',
        status: { in: ['queued', 'dispatched', 'running'] },
      },
    });
    if (existingBuild) return { buildRunId: existingBuild.id };

    if (!triageRun.workItem.repositoryMappingId) return null;

    const buildRun = await prisma.workflowRun.create({
      data: {
        tenantId: triageRun.tenantId,
        workflowType: 'build',
        workItemId: triageRun.workItemId,
        repositoryMappingId: triageRun.workItem.repositoryMappingId,
        status: 'queued',
        parentWorkflowRunId: triageRunId,
        // Pass issue context through providerExecutionRef or a separate mechanism
        // Store the triage run ID so build can look up findings
        providerExecutionRef: triageRun.providerExecutionRef ?? undefined,
      },
    });

    return { buildRunId: buildRun.id };
  }

  /**
   * After a build run succeeds, trigger a merge run for the created PR.
   * The PR reference is stored in buildRun.providerExecutionRef as "pr:owner/repo#123"
   */
  async function chainBuildToMerge(buildRunId: string): Promise<{ mergeRunId: string } | null> {
    const buildRun = await prisma.workflowRun.findUnique({
      where: { id: buildRunId },
      include: { workItem: { include: { repositoryMapping: true } } },
    });

    if (!buildRun) return null;
    if (buildRun.workflowType !== 'build') return null;
    if (buildRun.status !== 'succeeded') return null;

    const prRef = buildRun.providerExecutionRef ?? '';
    if (!prRef.startsWith('pr:')) {
      // No PR was created — nothing to merge
      return null;
    }

    // Check if merge already exists for this build
    const existingMerge = await prisma.workflowRun.findFirst({
      where: {
        parentWorkflowRunId: buildRunId,
        workflowType: 'merge',
        status: { in: ['queued', 'dispatched', 'running'] },
      },
    });
    if (existingMerge) return { mergeRunId: existingMerge.id };

    if (!buildRun.workItem.repositoryMappingId) return null;

    const mergeRun = await prisma.workflowRun.create({
      data: {
        tenantId: buildRun.tenantId,
        workflowType: 'merge',
        workItemId: buildRun.workItemId,
        repositoryMappingId: buildRun.workItem.repositoryMappingId,
        status: 'queued',
        parentWorkflowRunId: buildRunId,
        providerExecutionRef: prRef,
      },
    });

    return { mergeRunId: mergeRun.id };
  }

  /**
   * Scan all completed triage and build runs and chain the next steps.
   * Returns counts of runs chained.
   */
  async function chainAll(): Promise<{ triageChained: number; buildChained: number }> {
    let triageChained = 0;
    let buildChained = 0;

    // Chain triage → build
    const triageRuns = await prisma.workflowRun.findMany({
      where: {
        workflowType: 'triage',
        status: 'succeeded',
        childWorkflowRuns: { none: {} },
      },
    });

    for (const run of triageRuns) {
      const result = await chainTriageToBuild(run.id);
      if (result) triageChained++;
    }

    // Chain build → merge
    const buildRuns = await prisma.workflowRun.findMany({
      where: {
        workflowType: 'build',
        status: 'succeeded',
        childWorkflowRuns: { none: {} },
        providerExecutionRef: { startsWith: 'pr:' },
      },
    });

    for (const run of buildRuns) {
      const result = await chainBuildToMerge(run.id);
      if (result) buildChained++;
    }

    return { triageChained, buildChained };
  }

  return { chainTriageToBuild, chainBuildToMerge, chainAll };
}

export type WorkflowChainService = ReturnType<typeof createWorkflowChainService>;
