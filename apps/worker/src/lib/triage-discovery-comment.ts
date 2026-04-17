import { z } from 'zod';
import { type GitHubIssueSummary } from '@support-agent/github-cli';

export const TRIAGE_DISCOVERY_MARKER = '<!-- support-agent:triage-discovery -->';

export const TriageSeveritySchema = z.enum(['Low', 'Medium', 'High', 'Critical', 'Unknown']);
export const TriageConfidenceSchema = z.enum(['Low', 'Medium', 'High']);

export const TriageOutputSchema = z.object({
  summary: z.string(),
  rootCause: z.string(),
  replicationSteps: z.string(),
  suggestedFix: z.string(),
  severity: z.object({
    level: TriageSeveritySchema,
    justification: z.string(),
  }),
  confidence: z.object({
    label: TriageConfidenceSchema,
    reason: z.string(),
  }),
  affectedFiles: z.array(z.string()),
  logsExcerpt: z.string(),
  sources: z.array(z.string()),
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const TRIAGE_OUTPUT_TEMPLATE: TriageOutput = {
  summary: '',
  rootCause: '',
  replicationSteps: '',
  suggestedFix: '',
  severity: { level: 'Unknown', justification: '' },
  confidence: { label: 'Low', reason: '' },
  affectedFiles: [],
  logsExcerpt: '',
  sources: [],
};

const CONFIDENCE_NUMERIC: Record<z.infer<typeof TriageConfidenceSchema>, number> = {
  Low: 0.3,
  Medium: 0.6,
  High: 0.85,
};

export function confidenceNumeric(label: TriageOutput['confidence']['label']): number {
  return CONFIDENCE_NUMERIC[label];
}

export function hasDiscoveryComment(issue: GitHubIssueSummary): boolean {
  return issue.comments.some((comment) =>
    comment.body.includes(TRIAGE_DISCOVERY_MARKER),
  );
}

export function hasTriagedLabel(issue: GitHubIssueSummary): boolean {
  return issue.labels.some((label) => label.toLowerCase() === 'triaged');
}

function renderBulletList(items: string[]): string {
  if (items.length === 0) return 'None available.';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderSeverityLine(severity: TriageOutput['severity']): string {
  return severity.justification.length > 0
    ? `${severity.level} — ${severity.justification}`
    : severity.level;
}

function renderConfidenceLine(confidence: TriageOutput['confidence']): string {
  return confidence.reason.length > 0
    ? `${confidence.label} — ${confidence.reason}`
    : confidence.label;
}

function renderLogsExcerpt(text: string): string {
  if (!text.trim()) return 'None available.';
  return ['```', text, '```'].join('\n');
}

/**
 * Render a TriageOutput object as the canonical 9-section markdown report.
 * The exact heading order and section names are part of the contract — other
 * tooling reads this comment.
 */
export function renderTriageReportMarkdown(output: TriageOutput): string {
  return [
    '## Summary',
    output.summary || '_(no summary)_',
    '',
    '## Root Cause',
    output.rootCause || '_(no root cause identified)_',
    '',
    '## Replication Steps',
    output.replicationSteps || '_(no replication steps)_',
    '',
    '## Suggested Fix',
    output.suggestedFix || '_(no fix suggested)_',
    '',
    '## Severity',
    renderSeverityLine(output.severity),
    '',
    '## Confidence',
    renderConfidenceLine(output.confidence),
    '',
    '## Affected Files',
    renderBulletList(output.affectedFiles),
    '',
    '## Logs Excerpt',
    renderLogsExcerpt(output.logsExcerpt),
    '',
    '## Sources',
    renderBulletList(output.sources),
  ].join('\n');
}

export function buildTriageDiscoveryComment(input: { output: TriageOutput }): string {
  return `${TRIAGE_DISCOVERY_MARKER}\n${renderTriageReportMarkdown(input.output)}`;
}
