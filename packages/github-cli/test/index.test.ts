import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.fn();
const execPromisifyMock = vi.fn();

vi.mock('node:child_process', () => ({
  exec: Object.assign(execMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execPromisifyMock,
  }),
}));

describe('ghListAccessibleRepos', () => {
  beforeEach(() => {
    execMock.mockReset();
    execPromisifyMock.mockReset();
  });

  it('lists repos without using an unsupported visibility flag', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return {
        stdout: JSON.stringify([
          {
            nameWithOwner: 'rafiki270/max-test',
            url: 'https://github.com/rafiki270/max-test',
            defaultBranchRef: { name: 'main' },
            isPrivate: false,
          },
        ]),
        stderr: '',
      };
    });

    const { ghListAccessibleRepos } = await import('../src/index.ts');
    const repositories = await ghListAccessibleRepos('rafiki270');

    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0]?.[0]).toContain('gh repo list rafiki270');
    expect(execMock.mock.calls[0]?.[0]).not.toContain('--visibility');
    expect(repositories).toEqual([
      {
        defaultBranch: 'main',
        isPrivate: false,
        nameWithOwner: 'rafiki270/max-test',
        owner: 'rafiki270',
        url: 'https://github.com/rafiki270/max-test',
      },
    ]);
  });

  it('creates required labels before editing the issue', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return { stdout: '', stderr: '' };
    });

    const { ghAddIssueLabels } = await import('../src/index.ts');
    await ghAddIssueLabels('rafiki270', 'max-test', 32, ['triaged', 'severity-medium']);

    expect(execMock.mock.calls.map((call) => call[0])).toEqual([
      'gh label create "triaged" --repo rafiki270/max-test --force --color 0E8A16 --description "Processed by SupportAgent triage"',
      'gh label create "severity-medium" --repo rafiki270/max-test --force --color FBCA04 --description "Severity: medium — assigned by SupportAgent triage"',
      'gh issue edit 32 --repo rafiki270/max-test --add-label "triaged,severity-medium"',
    ]);
  });

  it('ghListMergedPRs runs the correct gh command', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return { stdout: JSON.stringify([]), stderr: '' };
    });

    const { ghListMergedPRs } = await import('../src/index.ts');
    await ghListMergedPRs('rafiki270', 'max-test');

    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0]?.[0]).toContain('gh pr list --repo rafiki270/max-test --state merged');
    expect(execMock.mock.calls[0]?.[0]).toContain('--limit 30');
  });

  it('ghListMergedPRs respects a custom limit', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return { stdout: JSON.stringify([]), stderr: '' };
    });

    const { ghListMergedPRs } = await import('../src/index.ts');
    await ghListMergedPRs('rafiki270', 'max-test', { limit: 10 });

    expect(execMock.mock.calls[0]?.[0]).toContain('--limit 10');
  });

  it('ghListClosedIssues runs the correct gh command', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return { stdout: JSON.stringify([]), stderr: '' };
    });

    const { ghListClosedIssues } = await import('../src/index.ts');
    await ghListClosedIssues('rafiki270', 'max-test');

    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0]?.[0]).toContain('gh issue list --repo rafiki270/max-test --state closed');
    expect(execMock.mock.calls[0]?.[0]).toContain('--limit 30');
  });

  it('ghListClosedIssues respects a custom limit', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return { stdout: JSON.stringify([]), stderr: '' };
    });

    const { ghListClosedIssues } = await import('../src/index.ts');
    await ghListClosedIssues('rafiki270', 'max-test', { limit: 5 });

    expect(execMock.mock.calls[0]?.[0]).toContain('--limit 5');
  });

  it('defines severity-critical with the expected color', async () => {
    execPromisifyMock.mockImplementation(async (command: string) => {
      execMock(command);
      return { stdout: '', stderr: '' };
    });

    const { ghAddIssueLabels } = await import('../src/index.ts');
    await ghAddIssueLabels('rafiki270', 'max-test', 99, ['severity-critical']);

    expect(execMock.mock.calls.map((call) => call[0])).toContain(
      'gh label create "severity-critical" --repo rafiki270/max-test --force --color B60205 --description "Severity: critical — assigned by SupportAgent triage"',
    );
  });
});
