import { describe, expect, it } from 'vitest';
import {
  TRIAGE_DISCOVERY_MARKER,
  TRIAGE_OUTPUT_TEMPLATE,
  type TriageOutput,
  buildTriageDiscoveryComment,
  confidenceNumeric,
  hasDiscoveryComment,
  hasTriagedLabel,
  renderTriageReportMarkdown,
} from './triage-discovery-comment.js';

function makeIssue(commentBodies: string[], labels: string[] = []) {
  return {
    body: null,
    labels,
    number: 1,
    state: 'open',
    title: 'Test issue',
    url: 'https://github.com/test/repo/issues/1',
    comments: commentBodies.map((body, i) => ({
      author: 'user',
      body,
      createdAt: '2024-01-01T00:00:00Z',
      id: String(i),
    })),
  };
}

const SAMPLE_OUTPUT: TriageOutput = {
  summary: 'Auth flow breaks when the session token expires mid-request.',
  rootCause: 'Token refresh in `auth-middleware.ts` does not handle concurrent requests.',
  replicationSteps: '- Log in\n- Wait for the session to expire\n- Make two simultaneous calls',
  suggestedFix: 'Add a mutex around token refresh.',
  severity: { level: 'High', justification: 'affects all authenticated users.' },
  confidence: { label: 'Medium', reason: 'reproduces consistently in local testing.' },
  affectedFiles: ['src/middleware/auth-middleware.ts', 'src/services/token-service.ts'],
  logsExcerpt: '2024-01-01T00:00:00Z ERROR token expired',
  sources: ['https://example.com/issue-123', 'https://example.com/pr-456'],
};

describe('renderTriageReportMarkdown', () => {
  it('emits all 9 canonical sections in order', () => {
    const md = renderTriageReportMarkdown(SAMPLE_OUTPUT);
    const headings = md.match(/^## .+$/gm) ?? [];
    expect(headings).toEqual([
      '## Summary',
      '## Root Cause',
      '## Replication Steps',
      '## Suggested Fix',
      '## Severity',
      '## Confidence',
      '## Affected Files',
      '## Logs Excerpt',
      '## Sources',
    ]);
  });

  it('renders severity as "<level> — <justification>" when justification is present', () => {
    const md = renderTriageReportMarkdown(SAMPLE_OUTPUT);
    expect(md).toContain('High — affects all authenticated users.');
  });

  it('renders severity as just "<level>" when justification is empty', () => {
    const md = renderTriageReportMarkdown({
      ...SAMPLE_OUTPUT,
      severity: { level: 'Low', justification: '' },
    });
    expect(md).toMatch(/## Severity\nLow\n/);
  });

  it('renders confidence as "<label> — <reason>" when reason is present', () => {
    const md = renderTriageReportMarkdown(SAMPLE_OUTPUT);
    expect(md).toContain('Medium — reproduces consistently in local testing.');
  });

  it('renders affected files as a bullet list', () => {
    const md = renderTriageReportMarkdown(SAMPLE_OUTPUT);
    expect(md).toContain('- src/middleware/auth-middleware.ts');
    expect(md).toContain('- src/services/token-service.ts');
  });

  it('renders an empty affectedFiles list as "None available."', () => {
    const md = renderTriageReportMarkdown({ ...SAMPLE_OUTPUT, affectedFiles: [] });
    expect(md).toMatch(/## Affected Files\nNone available\./);
  });

  it('wraps logsExcerpt in a fenced code block when present', () => {
    const md = renderTriageReportMarkdown(SAMPLE_OUTPUT);
    expect(md).toMatch(/## Logs Excerpt\n```\n2024-01-01T00:00:00Z ERROR token expired\n```/);
  });

  it('renders an empty logsExcerpt as "None available." (not an empty fence)', () => {
    const md = renderTriageReportMarkdown({ ...SAMPLE_OUTPUT, logsExcerpt: '' });
    expect(md).toMatch(/## Logs Excerpt\nNone available\./);
    expect(md).not.toMatch(/```\n```/);
  });
});

describe('confidenceNumeric', () => {
  it('maps Low to 0.3', () => expect(confidenceNumeric('Low')).toBe(0.3));
  it('maps Medium to 0.6', () => expect(confidenceNumeric('Medium')).toBe(0.6));
  it('maps High to 0.85', () => expect(confidenceNumeric('High')).toBe(0.85));
});

describe('hasDiscoveryComment', () => {
  it('returns true when a comment contains the marker', () => {
    const issue = makeIssue([`${TRIAGE_DISCOVERY_MARKER}\n## Summary\nSome triage.`]);
    expect(hasDiscoveryComment(issue)).toBe(true);
  });

  it('returns false when no comments exist', () => {
    expect(hasDiscoveryComment(makeIssue([]))).toBe(false);
  });

  it('returns false when a comment has ## Summary but no marker (regression)', () => {
    const issue = makeIssue(['## Summary\nThis is a debugging note with a summary heading.']);
    expect(hasDiscoveryComment(issue)).toBe(false);
  });

  it('returns true only for the comment that has the marker, ignoring others', () => {
    const issue = makeIssue([
      '## Summary\nJust a note.',
      `${TRIAGE_DISCOVERY_MARKER}\n## Summary\nActual triage.`,
    ]);
    expect(hasDiscoveryComment(issue)).toBe(true);
  });
});

describe('hasTriagedLabel', () => {
  it('returns true when "triaged" label is present', () => {
    expect(hasTriagedLabel(makeIssue([], ['triaged']))).toBe(true);
  });

  it('returns true regardless of label case', () => {
    expect(hasTriagedLabel(makeIssue([], ['Triaged']))).toBe(true);
  });

  it('returns false when no triaged label is present', () => {
    expect(hasTriagedLabel(makeIssue([], ['bug']))).toBe(false);
  });
});

describe('buildTriageDiscoveryComment', () => {
  it('emits the marker on the first line', () => {
    const output = buildTriageDiscoveryComment({ output: SAMPLE_OUTPUT });
    expect(output.split('\n')[0]).toBe(TRIAGE_DISCOVERY_MARKER);
  });

  it('includes the rendered markdown after the marker', () => {
    const output = buildTriageDiscoveryComment({ output: SAMPLE_OUTPUT });
    expect(output).toContain('## Summary');
    expect(output).toContain(SAMPLE_OUTPUT.summary);
  });

  it('renders cleanly from the empty TRIAGE_OUTPUT_TEMPLATE', () => {
    const output = buildTriageDiscoveryComment({ output: TRIAGE_OUTPUT_TEMPLATE });
    expect(output).toContain(TRIAGE_DISCOVERY_MARKER);
    expect(output).toContain('## Summary');
    expect(output).toContain('## Sources');
  });
});
