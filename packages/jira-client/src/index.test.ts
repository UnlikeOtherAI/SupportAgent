import { describe, expect, it, vi } from 'vitest';
import {
  JiraApiError,
  adfToPlainText,
  getIssue,
  plainTextToAdf,
  postComment,
} from './index.js';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

const opts = {
  baseUrl: 'https://acme.atlassian.net',
  userEmail: 'bot@acme.com',
  apiToken: 'tok',
};

describe('plainTextToAdf / adfToPlainText', () => {
  it('wraps a single line into a doc with one paragraph', () => {
    const adf = plainTextToAdf('hello');
    expect(adf.type).toBe('doc');
    expect(Array.isArray(adf.content)).toBe(true);
    expect(adf.content?.[0]?.type).toBe('paragraph');
  });

  it('preserves blank lines as empty paragraphs', () => {
    const adf = plainTextToAdf('a\n\nb');
    expect(adf.content).toHaveLength(3);
    expect(adf.content?.[1]?.content).toEqual([]);
  });

  it('round-trips ADF paragraphs to plain text', () => {
    const adf = plainTextToAdf('line1\nline2');
    const text = adfToPlainText(adf).trimEnd();
    expect(text).toBe('line1\nline2');
  });
});

describe('jira-client', () => {
  it('getIssue sends Basic auth and maps the raw issue shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: '10001',
        key: 'PROJ-42',
        self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
        fields: {
          summary: 'Login broken',
          description: plainTextToAdf('Steps to reproduce:\n1. go\n2. boom'),
          status: { name: 'To Do' },
          priority: { name: 'High' },
          labels: ['bug', 'auth'],
          assignee: { displayName: 'Jane Doe' },
        },
      }),
    );
    const issue = await getIssue({ ...opts, fetchImpl }, 'PROJ-42');
    expect(issue.key).toBe('PROJ-42');
    expect(issue.summary).toBe('Login broken');
    expect(issue.description).toContain('Steps to reproduce');
    expect(issue.status).toBe('To Do');
    expect(issue.priority).toBe('High');
    expect(issue.labels).toEqual(['bug', 'auth']);
    expect(issue.assignee).toBe('Jane Doe');
    expect(issue.url).toBe('https://acme.atlassian.net/browse/PROJ-42');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue/PROJ-42');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(
      String(init.headers.Authorization).replace(/^Basic /, ''),
      'base64',
    ).toString('utf8');
    expect(decoded).toBe('bot@acme.com:tok');
  });

  it('getIssue handles missing optional fields gracefully', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: '1',
        key: 'PROJ-1',
        self: 'https://x',
        fields: { summary: 'Bare' },
      }),
    );
    const issue = await getIssue({ ...opts, fetchImpl }, 'PROJ-1');
    expect(issue.description).toBeNull();
    expect(issue.status).toBe('Unknown');
    expect(issue.priority).toBeNull();
    expect(issue.labels).toEqual([]);
    expect(issue.assignee).toBeNull();
  });

  it('postComment wraps the body as ADF and POSTs to the comment endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '98765' }));
    const res = await postComment(
      { ...opts, fetchImpl },
      { issueKeyOrId: 'PROJ-42', body: 'first line\nsecond line' },
    );
    expect(res.id).toBe('98765');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue/PROJ-42/comment');
    expect(init.method).toBe('POST');
    const parsed = JSON.parse(init.body);
    expect(parsed.body.type).toBe('doc');
    expect(parsed.body.content).toHaveLength(2);
    expect(parsed.body.content[0].content[0].text).toBe('first line');
  });

  it('trims trailing slashes from baseUrl before composing endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '1', key: 'K-1', self: '' }));
    await getIssue(
      { baseUrl: 'https://acme.atlassian.net/', userEmail: 'e', apiToken: 't', fetchImpl },
      'K-1',
    );
    expect(fetchImpl.mock.calls[0][0]).toBe('https://acme.atlassian.net/rest/api/3/issue/K-1');
  });

  it('throws JiraApiError on non-2xx responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('not found', { status: 404 })));
    const err = await getIssue({ ...opts, fetchImpl }, 'X-1').catch((e) => e);
    expect(err).toBeInstanceOf(JiraApiError);
    expect(err.status).toBe(404);
    expect(err.body).toBe('not found');
  });
});
