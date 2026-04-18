import type { StructuredFindings } from '@support-agent/contracts';

type SupportedConnector = 'github';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderOptionalText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function renderList(
  value: unknown,
  fallback: string,
): string {
  if (Array.isArray(value) && value.length > 0) {
    return value.map((entry) => `- ${String(entry)}`).join('\n');
  }
  return fallback;
}

function renderLogsExcerpt(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return ['```', value, '```'].join('\n');
  }
  return 'None available.';
}

function readCustomField(
  findings: StructuredFindings,
  key: string,
): unknown {
  return findings.custom && key in findings.custom ? findings.custom[key] : undefined;
}

export function renderFindingsToComment(
  findings: StructuredFindings,
  connector: SupportedConnector,
): string {
  if (connector !== 'github') {
    throw new Error(`Unsupported findings renderer connector: ${connector}`);
  }

  const severity = findings.severity
    ? titleCase(findings.severity)
    : 'Unknown';
  const severityJustification = readCustomField(findings, 'severityJustification');
  const confidence = findings.confidence
    ? titleCase(findings.confidence)
    : 'Unknown';
  const confidenceReason = readCustomField(findings, 'confidenceReason');
  const replicationSteps = readCustomField(findings, 'replicationSteps');
  const logsExcerpt = readCustomField(findings, 'logsExcerpt');
  const sources = readCustomField(findings, 'sources');

  return [
    '## Summary',
    renderOptionalText(findings.summary, '_(no summary provided)_'),
    '',
    '## Root Cause',
    renderOptionalText(findings.rootCause, '_(no root cause identified)_'),
    '',
    '## Replication Steps',
    renderOptionalText(
      findings.reproductionSteps ?? replicationSteps,
      '_(no replication steps provided)_',
    ),
    '',
    '## Suggested Fix',
    renderOptionalText(findings.proposedFix, '_(no suggested fix provided)_'),
    '',
    '## Severity',
    typeof severityJustification === 'string' && severityJustification.trim()
      ? `${severity} - ${severityJustification}`
      : severity,
    '',
    '## Confidence',
    typeof confidenceReason === 'string' && confidenceReason.trim()
      ? `${confidence} - ${confidenceReason}`
      : confidence,
    '',
    '## Affected Files',
    renderList(findings.affectedAreas, 'None available.'),
    '',
    '## Logs Excerpt',
    renderLogsExcerpt(logsExcerpt),
    '',
    '## Sources',
    renderList(sources, 'None available.'),
  ].join('\n');
}
