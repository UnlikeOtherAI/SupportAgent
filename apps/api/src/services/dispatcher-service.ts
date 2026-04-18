import { ExecutorSource, SkillSource, type PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { parseExecutorYaml } from '@support-agent/executors-runtime';
import { ghGetAuthenticatedLogin } from '@support-agent/github-cli';
import { type ExecutionProvider, type TriggerComment, type WorkerDispatchJob } from './execution-provider.js';
import { createProgressCommentService } from './progress-comment-service.js';

function readTriggerComment(raw: unknown): TriggerComment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.commentId === 'string' ? r.commentId : null;
  const author = typeof r.author === 'string' ? r.author : null;
  const body = typeof r.body === 'string' ? r.body : null;
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : null;
  if (!id || !author || !body || !createdAt) {
    if (Object.keys(r).length > 0) {
      console.warn('[dispatcher] readTriggerComment: comment object missing required fields', {
        presentKeys: Object.keys(r),
      });
    }
    return null;
  }
  const comment: TriggerComment = { id, author, body, createdAt };
  if (typeof r.url === 'string') comment.url = r.url;
  return comment;
}

class NoProviderAvailableError extends Error {
  constructor(readonly workflowType: string) {
    super(`No provider available for workflow type: ${workflowType}`);
  }
}

interface ScenarioContext {
  scenarioId: string | null;
  scenarioKey: string | null;
  actionConfig: Record<string, unknown>;
  outputConfigs: Array<{ kind: string; config: Record<string, unknown> }>;
}

interface ResolvedDispatchSkill {
  name: string;
  contentHash: string;
}

interface ResolvedSkillDispatchConfig {
  executorKey: string;
  executorRevisionHash: string;
  resolvedSkillManifest: ResolvedDispatchSkill[];
  noSelfRetrigger: boolean;
}

function readDesignerStepConfig(rawConfig: unknown) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return null;
  const record = rawConfig as Record<string, unknown>;
  const designer = record.designer;
  if (!designer || typeof designer !== 'object' || Array.isArray(designer)) return null;
  const designerRecord = designer as Record<string, unknown>;
  const sourceKey = typeof designerRecord.sourceKey === 'string' ? designerRecord.sourceKey : null;
  if (!sourceKey) return null;
  const runtimeConfig: Record<string, unknown> = { ...record };
  delete runtimeConfig.designer;
  return { sourceKey, runtimeConfig };
}

function extractScenarioContext(
  scenario: { id: string; key: string; steps: { stepType: string; config: unknown; stepOrder: number }[] } | null,
): ScenarioContext {
  if (!scenario) {
    return { scenarioId: null, scenarioKey: null, actionConfig: {}, outputConfigs: [] };
  }

  const orderedSteps = [...scenario.steps].sort((left, right) => left.stepOrder - right.stepOrder);
  const actionStep = orderedSteps.find((step) => step.stepType === 'action');
  const outputSteps = orderedSteps.filter((step) => step.stepType === 'output');

  const actionInfo = actionStep ? readDesignerStepConfig(actionStep.config) : null;
  const outputs = outputSteps
    .map((step) => readDesignerStepConfig(step.config))
    .filter((info): info is { sourceKey: string; runtimeConfig: Record<string, unknown> } => info !== null)
    .map((info) => ({ kind: info.sourceKey, config: info.runtimeConfig }));

  return {
    scenarioId: scenario.id,
    scenarioKey: scenario.key,
    actionConfig: actionInfo?.runtimeConfig ?? {},
    outputConfigs: outputs,
  };
}

function readExecutorKey(actionConfig: Record<string, unknown>): string | null {
  const executorKey = actionConfig.executorKey;
  if (typeof executorKey !== 'string' || executorKey.trim() === '') {
    return null;
  }

  return executorKey;
}

async function resolveSkillDispatchConfig(args: {
  prisma: Pick<PrismaClient, 'executor' | 'skill'>;
  tenantId: string;
  executorKey: string;
}): Promise<ResolvedSkillDispatchConfig> {
  const executor =
    await args.prisma.executor.findFirst({
      where: {
        key: args.executorKey,
        tenantId: args.tenantId,
        source: ExecutorSource.USER,
      },
      select: {
        key: true,
        yaml: true,
        contentHash: true,
      },
    })
    ?? await args.prisma.executor.findFirst({
      where: {
        key: args.executorKey,
        tenantId: null,
        source: ExecutorSource.BUILTIN,
      },
      select: {
        key: true,
        yaml: true,
        contentHash: true,
      },
    });

  if (!executor) {
    throw new Error(`Executor "${args.executorKey}" not found for dispatch`);
  }

  const ast = parseExecutorYaml(executor.yaml, {
    sourceName: `${executor.key}@${executor.contentHash}`,
  });

  const skillNames = Array.from(
    new Set(
      ast.stages.flatMap((stage) => [stage.system_skill, ...stage.complementary]),
    ),
  );

  const skillByName = new Map<string, ResolvedDispatchSkill>();
  for (const skillName of skillNames) {
    const skill =
      await args.prisma.skill.findFirst({
        where: {
          name: skillName,
          tenantId: args.tenantId,
          source: SkillSource.USER,
        },
        select: {
          name: true,
          contentHash: true,
        },
      })
      ?? await args.prisma.skill.findFirst({
        where: {
          name: skillName,
          tenantId: null,
          source: SkillSource.BUILTIN,
        },
        select: {
          name: true,
          contentHash: true,
        },
      });

    if (!skill) {
      throw new Error(`Skill "${skillName}" referenced by executor "${executor.key}" was not found`);
    }

    skillByName.set(skillName, {
      name: skill.name,
      contentHash: skill.contentHash,
    });
  }

  return {
    executorKey: executor.key,
    executorRevisionHash: executor.contentHash,
    resolvedSkillManifest: skillNames.map((skillName) => skillByName.get(skillName)!),
    noSelfRetrigger: ast.guardrails?.loop_safety?.no_self_retrigger ?? true,
  };
}

function buildExecutorFetchUrl(apiBaseUrl: string, executorKey: string, contentHash: string): string {
  return `${apiBaseUrl}/v1/executors/${encodeURIComponent(executorKey)}/by-hash/${encodeURIComponent(contentHash)}`;
}

function buildSkillFetchUrl(apiBaseUrl: string, skillName: string, contentHash: string): string {
  return `${apiBaseUrl}/v1/skills/${encodeURIComponent(skillName)}/by-hash/${encodeURIComponent(contentHash)}`;
}

export function createDispatcherService(
  prisma: PrismaClient,
  providers: ExecutionProvider[],
  apiBaseUrl: string,
) {
  const progressCommentService = createProgressCommentService(prisma);
  let botLoginPromise: Promise<string | null> | null = null;

  async function getBotLogin(): Promise<string | null> {
    if (!botLoginPromise) {
      botLoginPromise = ghGetAuthenticatedLogin().catch((error) => {
        console.warn('[dispatcher] Failed to resolve bot identity for no_self_retrigger', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    }

    return botLoginPromise;
  }

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
      await getBotLogin();
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
            include: {
              repositoryMapping: true,
              workItem: { include: { repositoryMapping: true } },
              workflowScenario: {
                include: { steps: true, bindings: true },
              },
            },
          });
          if (!run) {
            throw Object.assign(new Error('Claimed run not found'), { statusCode: 404 });
          }

          const scenarioContext = extractScenarioContext(run.workflowScenario);
          const executorKey = readExecutorKey(scenarioContext.actionConfig);
          const skillDispatchConfig = executorKey
            ? await resolveSkillDispatchConfig({
              prisma: tx,
              tenantId: run.tenantId,
              executorKey,
            })
            : null;
          const rawComments = run.workItem.comments;
          const firstComment = Array.isArray(rawComments) && rawComments.length > 0
            ? readTriggerComment(rawComments[0])
            : null;

          if (
            skillDispatchConfig?.noSelfRetrigger !== false
            && run.workflowType === 'review'
            && firstComment
          ) {
            const botLogin = await getBotLogin();
            if (botLogin && firstComment.author.localeCompare(botLogin, undefined, { sensitivity: 'accent' }) === 0) {
              await tx.workflowRun.update({
                where: { id: run.id },
                data: {
                  status: 'canceled',
                  completedAt: new Date(),
                },
              });
              await tx.workflowLogEvent.create({
                data: {
                  workflowRunId: run.id,
                  timestamp: new Date(),
                  streamType: 'dispatcher',
                  stage: 'dispatch',
                  message: 'self-retrigger prevented',
                },
              });
              return null;
            }
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

          const repoUrl = run.repositoryMapping?.repositoryUrl ?? '';
          const issueRef = run.workItem.externalUrl
            ?? `${repoUrl.replace('.git', '')}/issues/${run.workItem.externalItemId}`;

          const job: WorkerDispatchJob = {
            jobId: '', // Will be set after dispatch record is created
            workflowRunId: run.id,
            workflowType: run.workflowType,
            apiBaseUrl,
            workerSharedSecret: rawSecret,
            sourceConnectorKey: 'github',
            targetRepo: repoUrl,
            targetBranch: run.repositoryMapping?.defaultBranch ?? 'main',
            executionProfile: 'analysis-only',
            timeoutSeconds: 3600,
            ...(skillDispatchConfig && {
              executorKey: skillDispatchConfig.executorKey,
              executorRevisionHash: skillDispatchConfig.executorRevisionHash,
              resolvedSkillManifest: skillDispatchConfig.resolvedSkillManifest,
              executorFetch: {
                url: buildExecutorFetchUrl(
                  apiBaseUrl,
                  skillDispatchConfig.executorKey,
                  skillDispatchConfig.executorRevisionHash,
                ),
                contentHash: skillDispatchConfig.executorRevisionHash,
              },
              skillFetches: skillDispatchConfig.resolvedSkillManifest.map((skill) => ({
                name: skill.name,
                contentHash: skill.contentHash,
                url: buildSkillFetchUrl(apiBaseUrl, skill.name, skill.contentHash),
              })),
            }),
            providerHints: {
              workItemId: run.workItemId,
              scenarioId: scenarioContext.scenarioId,
              scenarioKey: scenarioContext.scenarioKey,
              actionConfig: scenarioContext.actionConfig,
              outputConfigs: scenarioContext.outputConfigs,
              // Pass issue/PR context based on workflow type
              ...(run.workflowType === 'triage' && {
                issueRef,
                issueNumber: parseInt(run.workItem.externalItemId),
              }),
              ...(run.workflowType === 'build' && {
                workItemId: run.workItemId,
                parentTriageRunId: run.parentWorkflowRunId,
                issueRef,
                issueNumber: run.workItem.workItemKind === 'issue'
                  ? parseInt(run.workItem.externalItemId)
                  : undefined,
              }),
              ...(run.workflowType === 'merge' && {
                parentBuildRunId: run.parentWorkflowRunId,
                prRef: run.providerExecutionRef ?? '',
              }),
              ...(run.workflowType === 'review' && (() => {
                return {
                  prNumber: run.workItem.reviewTargetNumber ?? undefined,
                  prRef: run.workItem.externalUrl ?? issueRef,
                  ...(firstComment && {
                    triggerContext: {
                      kind: 'github.pull_request.comment' as const,
                      comment: firstComment,
                    },
                  }),
                };
              })()),
            },
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
              ...(skillDispatchConfig && {
                resolvedExecutorRevision: skillDispatchConfig.executorRevisionHash,
                resolvedSkillRevisions: Object.fromEntries(
                  skillDispatchConfig.resolvedSkillManifest.map((skill) => [
                    skill.name,
                    skill.contentHash,
                  ]),
                ),
              }),
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

        try {
          await progressCommentService.postPlaceholder(claimed.workflowRunId);
        } catch (error) {
          console.warn('[dispatcher] Failed to post progress placeholder', {
            workflowRunId: claimed.workflowRunId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
