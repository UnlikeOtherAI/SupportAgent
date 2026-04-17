import { describe, expect, it } from 'vitest';
import {
  TRIAGE_DISCOVERY_MARKER,
  buildTriageDiscoveryComment,
  hasDiscoveryComment,
  parseTriageReport,
} from './triage-discovery-comment.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(commentBodies: string[]) {
  return {
    body: null,
    labels: [],
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

// ---------------------------------------------------------------------------
// Well-formed 9-section triage report
// ---------------------------------------------------------------------------

const WELL_FORMED_REPORT = `
## Summary
The authentication flow breaks when the session token expires mid-request.

## Root Cause
The token refresh logic in \`auth-middleware.ts\` does not handle concurrent requests.

## Replication Steps
- Log in as any user
- Wait for the session to expire
- Make two simultaneous API calls

## Suggested Fix
Add a mutex around the token refresh call so only one refresh runs at a time.

## Severity
High — affects all authenticated users after session expiry.

## Confidence
Medium — reproduces consistently in local testing but not seen in production logs.

## Affected Files
- src/middleware/auth-middleware.ts
- src/services/token-service.ts

## Logs Excerpt
\`\`\`
2024-01-01T00:00:00Z ERROR token expired
2024-01-01T00:00:01Z ERROR token expired
\`\`\`

## Sources
- https://example.com/issue-123
- https://example.com/pr-456
`.trim();

describe('parseTriageReport — well-formed input', () => {
  it('extracts all 9 sections', () => {
    const result = parseTriageReport(WELL_FORMED_REPORT);

    expect(result.summary).toContain('authentication flow breaks');
    expect(result.rootCause).toContain('token refresh logic');
    expect(result.replicationSteps).toContain('Log in as any user');
    expect(result.suggestedFix).toContain('mutex');
    expect(result.severity).toBe('High');
    expect(result.severityJustification).toContain('affects all authenticated users');
    expect(result.confidenceLabel).toBe('Medium');
    expect(result.confidenceReason).toContain('reproduces consistently');
    expect(result.confidenceNumeric).toBe(0.6);
    expect(result.affectedFiles).toContain('src/middleware/auth-middleware.ts');
    expect(result.affectedFiles).toContain('src/services/token-service.ts');
    expect(result.logsExcerpt).toContain('token expired');
    expect(result.sources).toContain('https://example.com/issue-123');
    expect(result.sources).toContain('https://example.com/pr-456');
  });
});

// ---------------------------------------------------------------------------
// Regression: fenced code block containing headings must not corrupt sections
// ---------------------------------------------------------------------------

const FENCED_HEADINGS_REPORT = `
## Summary
Real summary content.

## Root Cause
Real root cause.

## Replication Steps
Steps here.

## Suggested Fix
Fix here.

## Severity
Critical — data loss possible.

## Confidence
High — confirmed in production.

## Affected Files
- src/db/query.ts

## Logs Excerpt
\`\`\`
ERROR something failed
### Sources
This looks like a heading but it is inside a fence
### Severity
Also looks like a heading — should be ignored
\`\`\`

## Sources
- https://real-source.example.com
`.trim();

describe('parseTriageReport — fenced code block regression', () => {
  it('does not treat headings inside backtick fences as section boundaries', () => {
    const result = parseTriageReport(FENCED_HEADINGS_REPORT);

    // Sources must be the real one, not the fake one inside the fence
    expect(result.sources).toContain('https://real-source.example.com');
    expect(result.sources).not.toContain('This looks like a heading but it is inside a fence');

    // Severity must not be corrupted by the fake ### Severity inside the fence
    expect(result.severity).toBe('Critical');
    expect(result.severityJustification).toContain('data loss possible');

    // The logs excerpt must include the fenced content
    expect(result.logsExcerpt).toContain('ERROR something failed');
    expect(result.logsExcerpt).toContain('### Sources');
  });

  it('does not treat headings inside tilde fences as section boundaries', () => {
    const report = `
## Summary
Summary text.

## Root Cause
Root cause text.

## Replication Steps
Steps.

## Suggested Fix
Fix.

## Severity
Low — cosmetic only.

## Confidence
Low — unconfirmed.

## Affected Files
- none

## Logs Excerpt
~~~
### Severity
### Sources
fake content inside tilde fence
~~~

## Sources
- https://tilde-fence-source.example.com
`.trim();

    const result = parseTriageReport(report);
    expect(result.sources).toContain('https://tilde-fence-source.example.com');
    expect(result.severity).toBe('Low');
  });
});

// ---------------------------------------------------------------------------
// parseSeverity (tested indirectly via parseTriageReport)
// ---------------------------------------------------------------------------

describe('parseTriageReport — severity parsing', () => {
  function reportWithSeverity(line: string): string {
    return `## Summary\ns\n## Root Cause\nr\n## Replication Steps\nsteps\n## Suggested Fix\nfix\n## Severity\n${line}\n## Confidence\nHigh\n## Affected Files\n- f\n## Logs Excerpt\nnone\n## Sources\n- s`;
  }

  it('parses Low with em-dash justification', () => {
    const r = parseTriageReport(reportWithSeverity('Low \u2014 minor UI glitch.'));
    expect(r.severity).toBe('Low');
    expect(r.severityJustification).toBe('minor UI glitch.');
  });

  it('parses Medium with double-dash justification', () => {
    const r = parseTriageReport(reportWithSeverity('Medium -- some users affected.'));
    expect(r.severity).toBe('Medium');
    expect(r.severityJustification).toBe('some users affected.');
  });

  it('parses High with colon justification', () => {
    const r = parseTriageReport(reportWithSeverity('High: core feature broken.'));
    expect(r.severity).toBe('High');
    expect(r.severityJustification).toBe('core feature broken.');
  });

  it('parses Critical', () => {
    const r = parseTriageReport(reportWithSeverity('Critical \u2014 data loss.'));
    expect(r.severity).toBe('Critical');
    expect(r.severityJustification).toBe('data loss.');
  });
});

// ---------------------------------------------------------------------------
// parseConfidence (tested indirectly via parseTriageReport)
// ---------------------------------------------------------------------------

describe('parseTriageReport — confidence parsing', () => {
  function reportWithConfidence(line: string): string {
    return `## Summary\ns\n## Root Cause\nr\n## Replication Steps\nsteps\n## Suggested Fix\nfix\n## Severity\nLow\n## Confidence\n${line}\n## Affected Files\n- f\n## Logs Excerpt\nnone\n## Sources\n- s`;
  }

  it('maps Low to 0.3', () => {
    const r = parseTriageReport(reportWithConfidence('Low — uncertain reproduction.'));
    expect(r.confidenceLabel).toBe('Low');
    expect(r.confidenceNumeric).toBe(0.3);
  });

  it('maps Medium to 0.6', () => {
    const r = parseTriageReport(reportWithConfidence('Medium — seen locally.'));
    expect(r.confidenceLabel).toBe('Medium');
    expect(r.confidenceNumeric).toBe(0.6);
  });

  it('maps High to 0.85', () => {
    const r = parseTriageReport(reportWithConfidence('High — confirmed in prod.'));
    expect(r.confidenceLabel).toBe('High');
    expect(r.confidenceNumeric).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// hasDiscoveryComment
// ---------------------------------------------------------------------------

describe('hasDiscoveryComment', () => {
  it('returns true when a comment contains the marker', () => {
    const issue = makeIssue([`${TRIAGE_DISCOVERY_MARKER}\n## Summary\nSome triage.`]);
    expect(hasDiscoveryComment(issue)).toBe(true);
  });

  it('returns false when no comments exist', () => {
    const issue = makeIssue([]);
    expect(hasDiscoveryComment(issue)).toBe(false);
  });

  it('returns false when a comment has ## Summary but no marker (regression)', () => {
    const issue = makeIssue(['## Summary\nThis is a debugging note with a summary heading.']);
    expect(hasDiscoveryComment(issue)).toBe(false);
  });

  it('returns false when a comment has ### Summary without the marker', () => {
    const issue = makeIssue(['### Summary\nAnother comment.']);
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

// ---------------------------------------------------------------------------
// buildTriageDiscoveryComment
// ---------------------------------------------------------------------------

describe('buildTriageDiscoveryComment', () => {
  it('emits the marker on the first line', () => {
    const output = buildTriageDiscoveryComment({ report: '## Summary\nSome content.' });
    const lines = output.split('\n');
    expect(lines[0]).toBe(TRIAGE_DISCOVERY_MARKER);
  });

  it('includes the report content after the marker', () => {
    const output = buildTriageDiscoveryComment({ report: '## Summary\nSome content.' });
    expect(output).toContain('## Summary');
    expect(output).toContain('Some content.');
  });

  it('strips leading/trailing whitespace from the report', () => {
    const output = buildTriageDiscoveryComment({ report: '\n\n## Summary\nContent.\n\n' });
    expect(output.startsWith(TRIAGE_DISCOVERY_MARKER)).toBe(true);
    expect(output).not.toMatch(/^\s*\n\n/);
  });
});
