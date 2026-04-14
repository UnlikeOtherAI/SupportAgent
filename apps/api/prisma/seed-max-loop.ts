/**
 * Seed script for the max integration loop test.
 *
 * Creates:
 * 1. GitHub repo rafiki270/max-test (if it doesn't exist)
 * 2. An issue in the repo describing a bug
 * 3. DB records: platform type, connector, repo mapping, work item, triage run
 *
 * Run with: cd apps/api && pnpm seed:max-loop
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PrismaClient } from '@prisma/client';

const execAsync = promisify(exec);

const REPO_OWNER = 'rafiki270';
const REPO_NAME = 'max-test';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}.git`;
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000002';

const prisma = new PrismaClient();

const BUGGY_CODE = `"""calculator.py - a simple calculator with intentional bugs."""

def divide(a, b):
    """Divide a by b."""
    return a / b  # BUG: no check for division by zero

def calculate_average(numbers):
    """Calculate the average of a list of numbers."""
    total = sum(numbers)
    count = len(numbers)
    return total / count  # BUG: crashes if list is empty

def safe_divide(a, b):
    """Safely divide a by b, returning None on division by zero."""
    if b == 0:
        return None
    return a / b

def process_numbers(numbers):
    """Process a list of numbers and return stats."""
    if not numbers:
        return {}
    avg = calculate_average(numbers)
    return {
        "average": avg,
        "sum": sum(numbers),
        "count": len(numbers),
        "max": max(numbers),  # BUG: max() on empty list crashes
        "min": min(numbers),  # BUG: min() on empty list crashes
    }
`;

const BUGGY_TESTS = `"""tests.py - tests for calculator."""

from calculator import calculate_average, process_numbers, divide

def test_average():
    result = calculate_average([1, 2, 3, 4, 5])
    assert result == 3.0

def test_process_numbers():
    result = process_numbers([1, 2, 3])
    assert result["average"] == 2.0
    assert result["sum"] == 6
    assert result["count"] == 3

def test_divide():
    assert divide(10, 2) == 5.0
`;

const ISSUE_BODY = `The calculator module has several bugs:

1. divide() crashes with ZeroDivisionError when b=0
2. calculate_average() crashes on empty list
3. process_numbers() crashes on empty list (calls max/min without guard)
4. tests.py does not test edge cases like empty list or division by zero

Please fix all bugs and add proper error handling and tests.`;

// Write a temp file and use --body-file to avoid escaping issues
async function writeIssueBodyFile(): Promise<string> {
  const fp = path.join(os.tmpdir(), `gh-issue-body-${Date.now()}.txt`);
  await fs.writeFile(fp, ISSUE_BODY, 'utf-8');
  return fp;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run(cmd: string, opts?: { cwd?: string }): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, { timeout: 60_000, ...opts });
  if (stderr) console.warn('[seed]', stderr.trim());
  return stdout.trim();
}

async function writeFile(fp: string, content: string): Promise<void> {
  await fs.writeFile(fp, content, 'utf-8');
}

async function setupGitHubRepo(): Promise<void> {
  console.log('[seed] Checking GitHub repo...');

  let repoExists = false;
  try {
    await run(`gh repo view ${REPO_OWNER}/${REPO_NAME}`);
    repoExists = true;
  } catch {
    repoExists = false;
  }

  if (repoExists) {
    console.log('[seed] Repo exists, using existing repo...');
  } else {
    console.log('[seed] Repo does not exist, creating...');
    try {
      await run(
        `gh repo create ${REPO_OWNER}/${REPO_NAME} --public --description "SupportAgent max integration loop test repo"`,
      );
      console.log('[seed] Created repo');
    } catch (err) {
      // Repo might have been created in the meantime
      try {
        await run(`gh repo view ${REPO_OWNER}/${REPO_NAME}`);
        console.log('[seed] Repo was created by another process, using it');
      } catch {
        console.error('[seed] Could not create repo:', err);
        throw err;
      }
    }
    // GitHub async delete can take time — wait a moment
    await sleep(3_000);
  }

  // Clone using SSH URL (gh is configured for SSH)
  const tmpDir = path.join(os.tmpdir(), `max-test-seed-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await run(`git clone git@github.com:${REPO_OWNER}/${REPO_NAME}.git .`, { cwd: tmpDir });
  } catch (err) {
    console.error('[seed] Clone failed (repo might still be deleting):', err);
    console.log('[seed] Waiting 5 seconds and retrying...');
    await sleep(5_000);
    await run(`git clone git@github.com:${REPO_OWNER}/${REPO_NAME}.git .`, { cwd: tmpDir });
  }

  // Write buggy code files
  await writeFile(path.join(tmpDir, 'calculator.py'), BUGGY_CODE);
  await writeFile(path.join(tmpDir, 'tests.py'), BUGGY_TESTS);
  await writeFile(
    path.join(tmpDir, 'README.md'),
    `# max-test\n\nTest repo for SupportAgent max integration loop.\n\n## Bugs\n\nThis repo intentionally contains bugs that the AI agent should find and fix.\n`,
  );

  await run('git add .', { cwd: tmpDir });
  // Skip commit if nothing to commit (repo already seeded)
  try {
    const commitOut = await run('git commit -m "Initial commit with buggy code"', { cwd: tmpDir });
    if (commitOut.includes('nothing to commit')) {
      console.log('[seed] Repo already seeded, skipping commit');
    } else {
      await run('git push origin main', { cwd: tmpDir });
      console.log('[seed] Pushed initial buggy code to repo');
    }
  } catch (err: any) {
    if (err.stdout && err.stdout.includes('nothing to commit')) {
      console.log('[seed] Repo already seeded, skipping commit');
    } else {
      throw err;
    }
  }

  // Create the issue using body file to avoid escaping issues
  const bodyFile = await writeIssueBodyFile();
  try {
    await run(
      `gh issue create --repo ${REPO_OWNER}/${REPO_NAME} --title "Fix bugs in calculator.py and tests.py" --body-file "${bodyFile}"`,
    );
    console.log('[seed] Created GitHub issue');
  } catch (err: any) {
    if (err.message && (err.message.includes('already exists') || err.message.includes('already have an issue'))) {
      console.log('[seed] Issue already exists, skipping');
    } else {
      console.error('[seed] Could not create issue:', err);
      throw err;
    }
  } finally {
    await fs.unlink(bodyFile).catch(() => {});
  }

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

async function seedDatabase(): Promise<void> {
  console.log('[seed] Seeding database...');

  // Ensure github platform type
  const githubPT = await prisma.platformType.upsert({
    where: { key: 'github' },
    update: {},
    create: {
      key: 'github',
      displayName: 'GitHub',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description: 'GitHub version control',
      category: 'version-control',
    },
  });

  // Ensure github_issues platform type
  await prisma.platformType.upsert({
    where: { key: 'github_issues' },
    update: {},
    create: {
      key: 'github_issues',
      displayName: 'GitHub Issues',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description: 'GitHub Issues tracker',
      category: 'issue-tracker',
    },
  });

  console.log('[seed] Platform types ready');

  // Create connector
  const connector = await prisma.connector.upsert({
    where: { id: 'github-max-loop-connector' },
    update: {},
    create: {
      id: 'github-max-loop-connector',
      tenantId: DEFAULT_TENANT_ID,
      platformTypeId: githubPT.id,
      name: 'GitHub Max Loop Test',
      direction: 'inbound',
      configuredIntakeMode: 'manual',
      effectiveIntakeMode: 'manual',
      isEnabled: true,
    },
  });

  console.log('[seed] Connector ready');

  // Create repository mapping
  const repoMapping = await prisma.repositoryMapping.upsert({
    where: { id: 'max-loop-repo-mapping' },
    update: {},
    create: {
      id: 'max-loop-repo-mapping',
      tenantId: DEFAULT_TENANT_ID,
      connectorId: connector.id,
      repositoryUrl: REPO_URL,
      defaultBranch: 'main',
    },
  });

  console.log('[seed] Repository mapping ready');

  // Get the issue number (last created issue in the repo)
  let issueNumber = 1;
  try {
    const out = await run(
      `gh issue list --repo ${REPO_OWNER}/${REPO_NAME} --json number --jq '.[0].number'`,
    );
    issueNumber = parseInt(out) || 1;
  } catch {
    console.warn('[seed] Could not get issue number, defaulting to 1');
  }

  // Create inbound work item
  const workItem = await prisma.inboundWorkItem.upsert({
    where: { id: `max-loop-workitem-${issueNumber}` },
    update: {},
    create: {
      id: `max-loop-workitem-${issueNumber}`,
      connectorInstanceId: connector.id,
      platformType: 'github',
      workItemKind: 'issue',
      externalItemId: String(issueNumber),
      externalUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}`,
      title: 'Fix bugs in calculator.py and tests.py',
      body: 'See GitHub issue for details.',
      status: 'open',
      repositoryMappingId: repoMapping.id,
      repositoryRef: `${REPO_OWNER}/${REPO_NAME}`,
      dedupeKey: `github:issue:${REPO_OWNER}/${REPO_NAME}:${issueNumber}`,
    },
  });

  console.log(`[seed] Work item ready (issue #${issueNumber})`);

  // Check if triage run already exists
  const existingRun = await prisma.workflowRun.findFirst({
    where: {
      workItemId: workItem.id,
      workflowType: 'triage',
    },
  });

  if (existingRun) {
    console.log('[seed] Triage run already exists, skipping...');
    console.log(`[seed] Run ID: ${existingRun.id}`);
    return;
  }

  // Create triage workflow run
  const triageRun = await prisma.workflowRun.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      workflowType: 'triage',
      workItemId: workItem.id,
      repositoryMappingId: repoMapping.id,
      status: 'queued',
    },
  });

  console.log(`[seed] Created triage run: ${triageRun.id}`);
  console.log('[seed] Database seeded successfully!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Start the API: cd apps/api && pnpm dev');
  console.log('2. Start the worker: cd apps/worker && pnpm dev');
  console.log('3. Start the cron loop: cd apps/worker && pnpm cron-loop');
  console.log('4. Monitor at: http://localhost:4440');
}

async function main() {
  try {
    await setupGitHubRepo();
    await seedDatabase();
  } catch (err) {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
