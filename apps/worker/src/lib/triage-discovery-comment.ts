import { type GitHubIssueSummary } from '@support-agent/github-cli';

export const TRIAGE_DISCOVERY_MARKER = '<!-- support-agent:triage-discovery -->';

const CANONICAL_SECTIONS = [
  'Summary',
  'Root Cause',
  'Replication Steps',
  'Suggested Fix',
  'Severity',
  'Confidence',
  'Affected Files',
  'Logs Excerpt',
  'Sources',
] as const;

type SectionName = (typeof CANONICAL_SECTIONS)[number];

export interface ParsedTriageReport {
  summary: string;
  rootCause: string;
  replicationSteps: string;
  suggestedFix: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical' | null;
  severityJustification: string;
  confidenceLabel: 'Low' | 'Medium' | 'High' | null;
  confidenceReason: string;
  confidenceNumeric: number;
  affectedFiles: string[];
  logsExcerpt: string;
  sources: string[];
  sectionMap: Record<SectionName, string>;
}

export function hasDiscoveryComment(issue: GitHubIssueSummary): boolean {
  return issue.comments.some((comment) =>
    comment.body.includes(TRIAGE_DISCOVERY_MARKER) || /(^|\n)#{1,3}\s*Summary\b/i.test(comment.body),
  );
}

export function hasTriagedLabel(issue: GitHubIssueSummary): boolean {
  return issue.labels.some((label) => label.toLowerCase() === 'triaged');
}

function extractSections(report: string): Record<SectionName, string> {
  const map: Record<string, string> = {};
  for (const name of CANONICAL_SECTIONS) map[name] = '';

  const headingRegex = /^\s{0,3}#{1,4}\s+(.+?)\s*$/gm;
  const matches: Array<{ name: SectionName; contentStart: number; headingEnd: number }> = [];

  let found: RegExpExecArray | null;
  while ((found = headingRegex.exec(report)) !== null) {
    const raw = found[1].trim();
    const canonical = CANONICAL_SECTIONS.find(
      (s) => s.toLowerCase() === raw.toLowerCase(),
    );
    if (canonical) {
      matches.push({
        name: canonical,
        contentStart: found.index + found[0].length,
        headingEnd: found.index,
      });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const end = next ? next.headingEnd : report.length;
    map[current.name] = report.slice(current.contentStart, end).trim();
  }

  return map as Record<SectionName, string>;
}

function parseSeverity(line: string): {
  level: ParsedTriageReport['severity'];
  justification: string;
} {
  const trimmed = line.trim();
  const levels: NonNullable<ParsedTriageReport['severity']>[] = ['Critical', 'High', 'Medium', 'Low'];
  for (const lvl of levels) {
    const re = new RegExp(`^${lvl}\\b`, 'i');
    if (re.test(trimmed)) {
      const rest = trimmed.slice(lvl.length).replace(/^[\s\u2014\u2013\-:]+/, '').trim();
      return { level: lvl, justification: rest };
    }
  }
  return { level: null, justification: trimmed };
}

function parseConfidence(line: string): {
  label: ParsedTriageReport['confidenceLabel'];
  reason: string;
  numeric: number;
} {
  const trimmed = line.trim();
  const levels: Array<{ label: NonNullable<ParsedTriageReport['confidenceLabel']>; numeric: number }> = [
    { label: 'High', numeric: 0.85 },
    { label: 'Medium', numeric: 0.6 },
    { label: 'Low', numeric: 0.3 },
  ];
  for (const lvl of levels) {
    const re = new RegExp(`^${lvl.label}\\b`, 'i');
    if (re.test(trimmed)) {
      const rest = trimmed.slice(lvl.label.length).replace(/^[\s\u2014\u2013\-:]+/, '').trim();
      return { label: lvl.label, reason: rest, numeric: lvl.numeric };
    }
  }
  return { label: null, reason: trimmed, numeric: 0.5 };
}

function parseBulletList(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line.length > 0 && !/^none available\.?$/i.test(line));
}

function firstMeaningfulLine(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith('```')) return line;
  }
  return '';
}

export function parseTriageReport(report: string): ParsedTriageReport {
  const sections = extractSections(report);

  const severityInfo = parseSeverity(firstMeaningfulLine(sections.Severity));
  const confidenceInfo = parseConfidence(firstMeaningfulLine(sections.Confidence));

  return {
    summary: sections.Summary.trim(),
    rootCause: sections['Root Cause'].trim(),
    replicationSteps: sections['Replication Steps'].trim(),
    suggestedFix: sections['Suggested Fix'].trim(),
    severity: severityInfo.level,
    severityJustification: severityInfo.justification,
    confidenceLabel: confidenceInfo.label,
    confidenceReason: confidenceInfo.reason,
    confidenceNumeric: confidenceInfo.numeric,
    affectedFiles: parseBulletList(sections['Affected Files']),
    logsExcerpt: sections['Logs Excerpt'].trim(),
    sources: parseBulletList(sections.Sources),
    sectionMap: sections,
  };
}

export function buildTriageDiscoveryComment(input: { report: string }): string {
  const report = input.report.trim();
  return `${TRIAGE_DISCOVERY_MARKER}\n${report}`;
}
