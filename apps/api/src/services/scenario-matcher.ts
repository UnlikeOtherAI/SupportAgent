import { type PrismaClient } from '@prisma/client';
import {
  matchesPrCommentTrigger,
  matchesIssueOpenedTrigger,
  matchesIssueLabeledTrigger,
  type TriggerKind,
  type ActionKind,
  type OutputKind,
  type CompiledStep,
  type CompiledScenario,
} from '@support-agent/contracts';

export type { TriggerKind, ActionKind, OutputKind, CompiledStep, CompiledScenario };

interface DesignerStepConfig {
  id: string;
  sourceKey: string;
  label: string;
  outgoingNodeIds: string[];
  stepType: 'trigger' | 'action' | 'output';
  runtimeConfig: Record<string, unknown>;
}

function readDesignerStep(stepType: string, config: unknown): DesignerStepConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  const designer = record.designer;
  if (!designer || typeof designer !== 'object' || Array.isArray(designer)) return null;
  const designerRecord = designer as Record<string, unknown>;

  const runtimeConfig: Record<string, unknown> = { ...record };
  delete runtimeConfig.designer;

  const sourceKey = typeof designerRecord.sourceKey === 'string' ? designerRecord.sourceKey : null;
  const id = typeof designerRecord.id === 'string' ? designerRecord.id : null;
  const label = typeof designerRecord.label === 'string' ? designerRecord.label : sourceKey ?? '';
  const outgoingNodeIds = Array.isArray(designerRecord.outgoingNodeIds)
    ? designerRecord.outgoingNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
    : [];

  if (!sourceKey || !id) return null;

  return {
    id,
    sourceKey,
    label,
    outgoingNodeIds,
    stepType: stepType as DesignerStepConfig['stepType'],
    runtimeConfig,
  };
}

function compileScenario(scenario: {
  id: string;
  key: string;
  displayName: string;
  workflowType: 'triage' | 'build' | 'merge' | 'review';
  bindings: { connectorId: string | null }[];
  steps: { stepType: string; config: unknown; stepOrder: number }[];
}): CompiledScenario | null {
  const decodedSteps = [...scenario.steps]
    .sort((left, right) => left.stepOrder - right.stepOrder)
    .flatMap((step) => {
      const decoded = readDesignerStep(step.stepType, step.config);
      return decoded ? [decoded] : [];
    });

  const triggerStep = decodedSteps.find((step) => step.stepType === 'trigger');
  if (!triggerStep) return null;

  const actionStep = decodedSteps.find((step) => step.stepType === 'action') ?? null;
  const outputSteps = decodedSteps.filter((step) => step.stepType === 'output');

  const connectorIds = scenario.bindings
    .map((binding) => binding.connectorId)
    .filter((connectorId): connectorId is string => !!connectorId);

  return {
    scenarioId: scenario.id,
    scenarioKey: scenario.key,
    displayName: scenario.displayName,
    workflowType: scenario.workflowType,
    connectorIds,
    trigger: {
      kind: triggerStep.sourceKey as TriggerKind,
      label: triggerStep.label,
      config: triggerStep.runtimeConfig,
    },
    action: actionStep
      ? {
          kind: actionStep.sourceKey as ActionKind,
          label: actionStep.label,
          config: actionStep.runtimeConfig,
        }
      : null,
    outputs: outputSteps.map((step) => ({
      kind: step.sourceKey as OutputKind,
      label: step.label,
      config: step.runtimeConfig,
    })),
  };
}

export function createScenarioMatcher(prisma: PrismaClient) {
  return {
    async listMatchable(tenantId: string, options?: { connectorId?: string }) {
      const scenarios = await prisma.workflowScenario.findMany({
        where: {
          tenantId,
          isEnabled: true,
          ...(options?.connectorId
            ? {
                bindings: {
                  some: { connectorId: options.connectorId },
                },
              }
            : {}),
        },
        include: { bindings: true, steps: true },
        orderBy: { createdAt: 'asc' },
      });

      return scenarios
        .map((scenario) =>
          compileScenario({
            id: scenario.id,
            key: scenario.key,
            displayName: scenario.displayName,
            workflowType: scenario.workflowType as 'triage' | 'build' | 'merge' | 'review',
            bindings: scenario.bindings,
            steps: scenario.steps,
          }),
        )
        .filter((scenario): scenario is CompiledScenario => scenario !== null);
    },

    matchesEvent(
      scenario: CompiledScenario,
      event:
        | { kind: 'github.issue.opened' }
        | { kind: 'github.issue.labeled'; label: string }
        | { kind: 'github.pull_request.opened' }
        | { kind: 'github.pull_request.comment'; body: string; author: string },
    ): boolean {
      if (scenario.trigger.kind !== event.kind) return false;

      if (event.kind === 'github.issue.opened') {
        return matchesIssueOpenedTrigger(scenario);
      }

      if (event.kind === 'github.issue.labeled') {
        return matchesIssueLabeledTrigger(scenario, event.label);
      }

      if (event.kind === 'github.pull_request.comment') {
        return matchesPrCommentTrigger(scenario, { body: event.body, author: event.author });
      }

      return true;
    },
  };
}

export type ScenarioMatcher = ReturnType<typeof createScenarioMatcher>;
