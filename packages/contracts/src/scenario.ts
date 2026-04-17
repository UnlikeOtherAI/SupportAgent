export type TriggerKind =
  | 'github.issue.opened'
  | 'github.issue.labeled'
  | 'github.pull_request.opened'
  | 'github.pull_request.comment'
  | 'schedule.interval';

export type ActionKind =
  | 'workflow.triage'
  | 'workflow.build'
  | 'workflow.review'
  | 'agent.respond'
  | 'approval.request';

export type OutputKind =
  | 'github.issue.comment'
  | 'github.pr.comment'
  | 'github.issue.label'
  | 'linear.issue.create'
  | 'slack.notify';

export interface CompiledStep<TKind extends string> {
  kind: TKind;
  label: string;
  config: Record<string, unknown>;
}

export interface CompiledScenario {
  scenarioId: string;
  scenarioKey: string;
  displayName: string;
  workflowType: 'triage' | 'build' | 'merge' | 'review';
  connectorIds: string[];
  trigger: CompiledStep<TriggerKind>;
  action: CompiledStep<ActionKind> | null;
  outputs: CompiledStep<OutputKind>[];
}

/** Returns true when the scenario's trigger fires on a github.issue.opened event. */
export function matchesIssueOpenedTrigger(scenario: CompiledScenario): boolean {
  return scenario.trigger.kind === 'github.issue.opened';
}

/**
 * Returns true when the scenario's trigger fires for the given label on a
 * github.issue.labeled event.  Both sides are trimmed and lower-cased before
 * comparison so case and surrounding whitespace are irrelevant.
 */
export function matchesIssueLabeledTrigger(scenario: CompiledScenario, label: string): boolean {
  if (scenario.trigger.kind !== 'github.issue.labeled') return false;
  const expected =
    typeof scenario.trigger.config.labelName === 'string'
      ? scenario.trigger.config.labelName.trim().toLowerCase()
      : '';
  return expected !== '' && expected === label.trim().toLowerCase();
}
