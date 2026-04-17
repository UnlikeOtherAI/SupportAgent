import type { DesignerNodeTheme, DesignerPaletteItem } from './workflow-designer-types'

export const DESIGNER_NODE_WIDTH = 244
export const DESIGNER_NODE_HEIGHT = 96

export const nodeThemes: Record<DesignerPaletteItem['type'], DesignerNodeTheme> = {
  trigger: {
    accent: '#d97706',
    badge: '#fff1df',
    border: '#d97706',
    fill: '#fffaf2',
    label: 'Trigger',
  },
  action: {
    accent: '#2b8ac6',
    badge: '#e8f6ff',
    border: '#2b8ac6',
    fill: '#f8fcff',
    label: 'Executor',
  },
  output: {
    accent: '#059669',
    badge: '#e8fff6',
    border: '#059669',
    fill: '#f7fffb',
    label: 'Output',
  },
}

export const triggerItems: DesignerPaletteItem[] = [
  {
    key: 'github.issue.opened',
    label: 'GitHub issue opened',
    description: 'Start when a monitored repository receives a new issue.',
    type: 'trigger',
    config: { event: 'github.issue.opened' },
  },
  {
    key: 'github.issue.labeled',
    label: 'GitHub issue labeled',
    description: 'Start when a specific label is applied to an issue.',
    type: 'trigger',
    config: { event: 'github.issue.labeled', labelName: 'needs-triage' },
  },
  {
    key: 'github.pull_request.opened',
    label: 'Pull request opened',
    description: 'Start review or validation for incoming pull requests.',
    type: 'trigger',
    config: { event: 'github.pull_request.opened' },
  },
  {
    key: 'github.pull_request.comment',
    label: 'PR comment keyword',
    description: 'Start when a PR comment mentions a configured keyword (e.g. /sa review).',
    type: 'trigger',
    config: {
      event: 'github.pull_request.comment',
      keyword: '/sa review',
      botName: 'SupportAgent',
    },
  },
  {
    key: 'schedule.interval',
    label: 'Scheduled poll',
    description: 'Run on a configured interval such as every five minutes.',
    type: 'trigger',
    config: { intervalMinutes: 5 },
  },
]

export const actionItems: DesignerPaletteItem[] = [
  {
    key: 'workflow.triage',
    label: 'Run triage',
    description: 'Create a bounded triage workflow run.',
    type: 'action',
    config: { workflowType: 'triage' },
  },
  {
    key: 'agent.respond',
    label: 'Agent response',
    description: 'Let an agent draft a support or operator response.',
    type: 'action',
    config: { action: 'agent.respond' },
  },
  {
    key: 'workflow.build',
    label: 'Build PR candidate',
    description: 'Create a build workflow run for code changes.',
    type: 'action',
    config: { workflowType: 'build', issueLinkMode: 'fixes' },
  },
  {
    key: 'workflow.review',
    label: 'Review PR',
    description: 'Clone the PR branch, read the diff, and generate a review.',
    type: 'action',
    config: { workflowType: 'review' },
  },
  {
    key: 'approval.request',
    label: 'Request approval',
    description: 'Pause for approval before customer-visible or risky work.',
    type: 'action',
    config: { action: 'approval.request' },
  },
]

export const outputItems: DesignerPaletteItem[] = [
  {
    key: 'github.issue.comment',
    label: 'GitHub issue comment',
    description: 'Post findings, PR link, or review back to a GitHub issue.',
    type: 'output',
    config: { destinationType: 'github.issue.comment', template: 'findings' },
  },
  {
    key: 'github.pr.comment',
    label: 'GitHub PR comment',
    description: 'Post review notes back onto a GitHub pull request.',
    type: 'output',
    config: { destinationType: 'github.pr.comment', template: 'review' },
  },
  {
    key: 'github.issue.label',
    label: 'Apply GitHub label',
    description: 'Set triaged, complexity, or handoff labels.',
    type: 'output',
    config: { destinationType: 'github.issue.label', labels: 'triaged' },
  },
  {
    key: 'linear.issue.create',
    label: 'Create Linear issue',
    description: 'Create or update downstream product work.',
    type: 'output',
    config: { destinationType: 'linear.issue.create' },
  },
  {
    key: 'slack.notify',
    label: 'Notify channel',
    description: 'Send an update to Slack, Teams, or WhatsApp.',
    type: 'output',
    config: { destinationType: 'communication_channel' },
  },
]

export const paletteSections = [
  { key: 'triggers', label: 'Triggers', items: triggerItems },
  { key: 'executors', label: 'Executors', items: actionItems },
  { key: 'outputs', label: 'Outputs', items: outputItems },
]

export const paletteItems = [...triggerItems, ...actionItems, ...outputItems]
