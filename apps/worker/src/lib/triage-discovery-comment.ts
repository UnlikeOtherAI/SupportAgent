import { type GitHubIssueSummary } from '@support-agent/github-cli';

export const TRIAGE_DISCOVERY_MARKER = '<!-- support-agent:triage-discovery -->';

export function hasDiscoveryComment(issue: GitHubIssueSummary): boolean {
  return issue.comments.some((comment) =>
    comment.body.includes(TRIAGE_DISCOVERY_MARKER) || /(^|\n)## Discovery\b/i.test(comment.body),
  );
}

export function hasTriagedLabel(issue: GitHubIssueSummary): boolean {
  return issue.labels.some((label) => label.toLowerCase() === 'triaged');
}

export function buildTriageDiscoveryComment(input: {
  confidence: number;
  recommendedFix: string;
  rootCause: string;
  suspectFiles: string[];
}): string {
  const confidencePercent = Math.round(input.confidence * 100);
  const suspectFiles = input.suspectFiles.length > 0
    ? input.suspectFiles.map((file) => `- ${file}`).join('\n')
    : '- Not identified yet';

  return [
    TRIAGE_DISCOVERY_MARKER,
    '## Discovery',
    '',
    `Root cause: ${input.rootCause}`,
    '',
    'Likely files:',
    suspectFiles,
    '',
    `Suggested fix: ${input.recommendedFix}`,
    '',
    `Confidence: ${confidencePercent}%`,
  ].join('\n');
}
