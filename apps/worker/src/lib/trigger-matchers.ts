// Re-exported from @support-agent/contracts so both the api and worker packages
// can share the same implementation without a cross-app dependency.
export {
  matchesPrCommentTrigger,
  type PrCommentTriggerScenario,
  matchesIssueOpenedTrigger,
  matchesIssueLabeledTrigger,
  type CompiledScenario,
  type TriggerKind,
  type ActionKind,
  type OutputKind,
  type CompiledStep,
} from '@support-agent/contracts';
