import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd?: string; shell?: boolean; stdio?: unknown };
}

const spawnCalls: SpawnCall[] = [];
let nextStdout = '';
let nextStderr = '';
let nextExitCode = 0;

class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void };
  stderr = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void };
  stdin = {
    end: vi.fn(),
  } as { end: ReturnType<typeof vi.fn> };

  constructor() {
    super();
    (this.stdout as any).setEncoding = () => undefined;
    (this.stderr as any).setEncoding = () => undefined;
  }

  kill(_signal?: string): void {
    /* noop for tests */
  }
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((command: string, args: string[], options: any) => {
    spawnCalls.push({ command, args, options });
    const child = new FakeChild();
    queueMicrotask(() => {
      if (nextStdout) child.stdout.emit('data', nextStdout);
      if (nextStderr) child.stderr.emit('data', nextStderr);
      child.emit('close', nextExitCode, null);
    });
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
  }),
}));

beforeEach(() => {
  spawnCalls.length = 0;
  nextStdout = '';
  nextStderr = '';
  nextExitCode = 0;
});

describe('runArgv passes argv without a shell', () => {
  it('lists repos via gh argv (no string concat into shell)', async () => {
    nextStdout = JSON.stringify([
      {
        nameWithOwner: 'rafiki270/max-test',
        url: 'https://github.com/rafiki270/max-test',
        defaultBranchRef: { name: 'main' },
        isPrivate: false,
      },
    ]);
    const { ghListAccessibleRepos } = await import('../src/index.js');
    const repos = await ghListAccessibleRepos('rafiki270');

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('gh');
    expect(spawnCalls[0].args.slice(0, 3)).toEqual(['repo', 'list', 'rafiki270']);
    expect(spawnCalls[0].options.shell).toBe(false);
    expect(repos).toEqual([
      {
        defaultBranch: 'main',
        isPrivate: false,
        nameWithOwner: 'rafiki270/max-test',
        owner: 'rafiki270',
        url: 'https://github.com/rafiki270/max-test',
      },
    ]);
  });

  it('creates labels then edits the issue with argv flags', async () => {
    const { ghAddIssueLabels } = await import('../src/index.js');
    await ghAddIssueLabels('rafiki270', 'max-test', 32, ['triaged', 'severity-medium']);

    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[0]).toMatchObject({
      command: 'gh',
      args: [
        'label', 'create', 'triaged',
        '--repo', 'rafiki270/max-test',
        '--force',
        '--color', '0E8A16',
        '--description', 'Processed by SupportAgent triage',
      ],
    });
    expect(spawnCalls[2]).toMatchObject({
      command: 'gh',
      args: [
        'issue', 'edit', '32',
        '--repo', 'rafiki270/max-test',
        '--add-label', 'triaged,severity-medium',
      ],
    });
  });

  it('ghListMergedPRs respects custom limit via argv', async () => {
    nextStdout = JSON.stringify([]);
    const { ghListMergedPRs } = await import('../src/index.js');
    await ghListMergedPRs('rafiki270', 'max-test', { limit: 10 });
    expect(spawnCalls[0].args).toContain('--limit');
    expect(spawnCalls[0].args).toContain('10');
  });

  it('ghListClosedIssues default limit', async () => {
    nextStdout = JSON.stringify([]);
    const { ghListClosedIssues } = await import('../src/index.js');
    await ghListClosedIssues('rafiki270', 'max-test');
    expect(spawnCalls[0].args).toContain('--state');
    expect(spawnCalls[0].args).toContain('closed');
    expect(spawnCalls[0].args).toContain('30');
  });
});

describe('adversarial inputs flow through argv without shell side effects', () => {
  it('issueTitle with shell metacharacters is passed verbatim to argv', async () => {
    nextStdout = 'https://github.com/o/r/pull/42';
    const adversarial = `x'; touch /tmp/pwn; #`;
    const { ghCreatePR } = await import('../src/index.js');
    const out = await ghCreatePR('o', 'r', adversarial, 'body', 'feature/x', 'main');

    // Title argument is passed exactly as-is, separate from the flag.
    const titleIdx = spawnCalls[0].args.indexOf('--title');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(spawnCalls[0].args[titleIdx + 1]).toBe(adversarial);
    // No shell is in the call path.
    expect(spawnCalls[0].options.shell).toBe(false);
    expect(out.url).toContain('/pull/42');
  });

  it('rejects branch names with shell metacharacters or newlines', async () => {
    const { ghCreatePR } = await import('../src/index.js');
    await expect(
      ghCreatePR('o', 'r', 'title', 'body', 'feature/x;rm -rf /', 'main'),
    ).rejects.toThrow(/disallowed characters/);
    await expect(
      ghCreatePR('o', 'r', 'title', 'body', 'feature\nrm', 'main'),
    ).rejects.toThrow(/disallowed characters/);
    await expect(
      ghCreatePR('o', 'r', 'title', 'body', '-rf', 'main'),
    ).rejects.toThrow(/must not start with/);
    // No spawn was attempted.
    expect(spawnCalls).toHaveLength(0);
  });

  it('rejects branch names with shell metacharacters in ghCreateBranch', async () => {
    const { ghCreateBranch } = await import('../src/index.js');
    await expect(ghCreateBranch('/tmp', `main; touch /tmp/pwn`)).rejects.toThrow();
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('ghCommitFiles enforces path containment', () => {
  let workDir = '';

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'gh-files-'));
  });

  it('writes files under workDir and uses `git add -- <path>`', async () => {
    const { ghCommitFiles } = await import('../src/index.js');
    await ghCommitFiles(
      workDir,
      [{ path: 'src/safe.txt', content: 'hello' }],
      'commit message',
    );

    const written = await readFile(join(workDir, 'src', 'safe.txt'), 'utf8');
    expect(written).toBe('hello');

    const addCall = spawnCalls.find(
      (call) => call.command === 'git' && call.args[0] === 'add',
    );
    expect(addCall?.args).toEqual(['add', '--', 'src/safe.txt']);

    const commitCall = spawnCalls.find(
      (call) => call.command === 'git' && call.args[0] === 'commit',
    );
    expect(commitCall?.args).toEqual(['commit', '-m', 'commit message']);

    await rm(workDir, { recursive: true, force: true });
  });

  it('rejects path traversal (`../../../etc/passwd`)', async () => {
    const { ghCommitFiles } = await import('../src/index.js');
    await expect(
      ghCommitFiles(
        workDir,
        [{ path: '../../../etc/passwd', content: 'pwn' }],
        'msg',
      ),
    ).rejects.toThrow(/Path traversal rejected/);

    expect(spawnCalls).toHaveLength(0);

    // Nothing was written outside workDir.
    const entries = await readdir(workDir);
    expect(entries).toEqual([]);

    await rm(workDir, { recursive: true, force: true });
  });

  it('rejects absolute file paths', async () => {
    const { ghCommitFiles } = await import('../src/index.js');
    await expect(
      ghCommitFiles(
        workDir,
        [{ path: '/etc/passwd', content: 'pwn' }],
        'msg',
      ),
    ).rejects.toThrow(/Absolute paths are not allowed/);
    expect(spawnCalls).toHaveLength(0);

    await rm(workDir, { recursive: true, force: true });
  });

  it('rejects NUL byte in file path', async () => {
    const { ghCommitFiles } = await import('../src/index.js');
    await expect(
      ghCommitFiles(
        workDir,
        [{ path: 'src/safe\0.txt', content: 'x' }],
        'msg',
      ),
    ).rejects.toThrow(/NUL byte/);
    expect(spawnCalls).toHaveLength(0);

    await rm(workDir, { recursive: true, force: true });
  });

  it('ghCommitFiles preserves the literal commit message in argv', async () => {
    const adversarial = `release "v1.0"; rm -rf /`;
    const target = join(workDir, 'note.txt');
    await writeFile(target, '');

    const { ghCommitFiles } = await import('../src/index.js');
    await ghCommitFiles(
      workDir,
      [{ path: 'note.txt', content: 'x' }],
      adversarial,
    );

    const commitCall = spawnCalls.find(
      (call) => call.command === 'git' && call.args[0] === 'commit',
    );
    expect(commitCall?.args).toEqual(['commit', '-m', adversarial]);

    await rm(workDir, { recursive: true, force: true });
  });
});
