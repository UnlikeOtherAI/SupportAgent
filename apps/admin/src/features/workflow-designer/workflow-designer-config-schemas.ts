import type { DesignerNode } from './workflow-designer-types'

export type DesignerFieldKind = 'text' | 'select' | 'number' | 'textarea'

export interface DesignerFieldSchema {
  key: string
  label: string
  kind: DesignerFieldKind
  description?: string
  placeholder?: string
  defaultValue?: string | number
  options?: Array<{ value: string; label: string }>
}

export interface DesignerNodeConfigSchema {
  fields: DesignerFieldSchema[]
}

const schemasBySourceKey: Record<string, DesignerNodeConfigSchema> = {
  'github.issue.opened': { fields: [] },
  'github.issue.labeled': {
    fields: [
      {
        key: 'labelName',
        label: 'Trigger label',
        kind: 'text',
        description: 'Run this scenario when the label is applied to an issue.',
        placeholder: 'needs-triage',
        defaultValue: 'needs-triage',
      },
    ],
  },
  'github.pull_request.opened': { fields: [] },
  'github.pull_request.comment': {
    fields: [
      {
        key: 'keyword',
        label: 'Command keyword',
        kind: 'text',
        description: 'Comment must contain this exact token to trigger the scenario.',
        placeholder: '/sa review',
        defaultValue: '/sa review',
      },
      {
        key: 'botName',
        label: 'Bot name',
        kind: 'text',
        description: 'Optional. Restrict to comments mentioning @botName.',
        placeholder: 'SupportAgent',
        defaultValue: 'SupportAgent',
      },
    ],
  },
  'schedule.interval': {
    fields: [
      {
        key: 'intervalMinutes',
        label: 'Interval (minutes)',
        kind: 'number',
        defaultValue: 5,
      },
    ],
  },
  'workflow.triage': {
    fields: [
      {
        key: 'executorKey',
        label: 'Executor',
        kind: 'select',
        description: 'Choose which executor should handle this action node.',
      },
      {
        key: 'taskPrompt',
        label: 'Task prompt',
        kind: 'textarea',
        description: 'Instruction prompt passed into the executor for this action.',
        placeholder: 'Investigate the issue and return a structured triage result.',
      },
    ],
  },
  'workflow.build': {
    fields: [
      {
        key: 'executorKey',
        label: 'Executor',
        kind: 'select',
        description: 'Choose which executor should handle this action node.',
      },
      {
        key: 'taskPrompt',
        label: 'Task prompt',
        kind: 'textarea',
        description: 'Instruction prompt passed into the executor for this action.',
        placeholder: 'Build a pull request candidate based on the trigger context.',
      },
      {
        key: 'issueLinkMode',
        label: 'Issue link mode',
        kind: 'select',
        description: 'How the opened PR should reference the source issue.',
        defaultValue: 'fixes',
        options: [
          { value: 'fixes', label: 'Fixes #N (auto-close on merge)' },
          { value: 'mentions', label: 'Mentions #N (no auto-close)' },
        ],
      },
    ],
  },
  'workflow.review': {
    fields: [
      {
        key: 'executorKey',
        label: 'Executor',
        kind: 'select',
        description: 'Choose which executor should handle this action node.',
      },
      {
        key: 'taskPrompt',
        label: 'Task prompt',
        kind: 'textarea',
        description: 'Instruction prompt passed into the executor for this action.',
        placeholder: 'Review the pull request for correctness and risk.',
      },
    ],
  },
  'agent.respond': {
    fields: [
      {
        key: 'executorKey',
        label: 'Executor',
        kind: 'select',
        description: 'Choose which executor should handle this action node.',
      },
      {
        key: 'taskPrompt',
        label: 'Task prompt',
        kind: 'textarea',
        description: 'Instruction prompt passed into the executor for this action.',
        placeholder: 'Draft a reply that is safe to send back to the source thread.',
      },
    ],
  },
  'approval.request': {
    fields: [
      {
        key: 'executorKey',
        label: 'Executor',
        kind: 'select',
        description: 'Choose which executor should handle this action node.',
      },
      {
        key: 'taskPrompt',
        label: 'Task prompt',
        kind: 'textarea',
        description: 'Instruction prompt passed into the executor for this action.',
        placeholder: 'Summarize what needs approval and why it is blocked.',
      },
    ],
  },
  'github.issue.comment': {
    fields: [
      {
        key: 'template',
        label: 'Comment template',
        kind: 'select',
        description: 'Which generated payload to post back to GitHub.',
        defaultValue: 'findings',
        options: [
          { value: 'findings', label: 'Triage findings' },
          { value: 'pr_link', label: 'PR link notice' },
          { value: 'review', label: 'PR review notes' },
        ],
      },
    ],
  },
  'github.issue.label': {
    fields: [
      {
        key: 'labels',
        label: 'Labels to apply (comma separated)',
        kind: 'text',
        description: 'Example: triaged, severity-medium.',
        placeholder: 'triaged',
      },
    ],
  },
  'github.pr.comment': {
    fields: [
      {
        key: 'template',
        label: 'Comment template',
        kind: 'select',
        defaultValue: 'review',
        options: [
          { value: 'review', label: 'PR review notes' },
          { value: 'findings', label: 'Triage findings' },
        ],
      },
    ],
  },
  'linear.issue.create': { fields: [] },
  'slack.notify': { fields: [] },
}

export function getNodeConfigSchema(node: DesignerNode): DesignerNodeConfigSchema | null {
  return schemasBySourceKey[node.sourceKey] ?? null
}
