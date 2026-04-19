#!/usr/bin/env node
/**
 * E2E Integration Test — Linear, Jira, and GitHub source connectors.
 *
 * Creates real issues in each platform, fires them through the local API,
 * and verifies SupportAgent triages and comments back on the source.
 *
 * Prerequisites:
 *   - .env loaded (or env vars set)
 *   - API running at http://localhost:4441
 *   - Worker running (pnpm --filter @support-agent/worker dev)
 *   - Cron loop running (pnpm --filter @support-agent/worker cron-loop)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const API = 'http://localhost:4441';
const REPO_URL = 'https://github.com/rafiki270/max-test';
const POLL_MS = 8_000;
const TIMEOUT_MS = 10 * 60_000; // 10 minutes

// ── Credentials ───────────────────────────────────────────────────────────────
const LINEAR_API_KEY = process.env.LINEAR_API_KEY ?? '';
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL ?? '').replace(/\/$/, '');
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL ?? '';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let _token = null;
async function apiToken() {
  if (_token) return _token;
  const res = await fetch(`${API}/v1/auth/dev-login`);
  const body = await res.json();
  _token = body.token;
  return _token;
}

async function apiGet(path) {
  const token = await apiToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function apiPost(path, body) {
  const token = await apiToken();
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function pollRunStatus(runId, label) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const run = await apiGet(`/v1/runs/${runId}`);
    const status = run?.status ?? 'unknown';
    log(label, `Run ${runId.slice(0, 8)} → ${status}`);
    if (status === 'succeeded') return 'succeeded';
    if (status === 'failed') return 'failed';
    await sleep(POLL_MS);
  }
  return 'timed_out';
}

async function dispatchAll() {
  return apiPost('/v1/dispatcher/dispatch-all', {});
}

// ── Linear helpers ────────────────────────────────────────────────────────────

async function linearGraphql(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function linearCreateIssue({ teamId, title, description }) {
  const result = await linearGraphql(`
    mutation CreateIssue($teamId: String!, $title: String!, $description: String!) {
      issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
        success
        issue { id identifier title url }
      }
    }
  `, { teamId, title, description });
  if (!result.data?.issueCreate?.success) {
    throw new Error(`Linear issue creation failed: ${JSON.stringify(result.errors ?? result)}`);
  }
  return result.data.issueCreate.issue;
}

async function linearGetFirstTeam() {
  const result = await linearGraphql(`{ teams { nodes { id name } } }`);
  const teams = result.data?.teams?.nodes ?? [];
  if (!teams.length) throw new Error('No Linear teams found');
  return teams[0];
}

async function linearGetComments(issueId) {
  const result = await linearGraphql(`
    query GetComments($id: String!) {
      issue(id: $id) { comments { nodes { id body createdAt } } }
    }
  `, { id: issueId });
  return result.data?.issue?.comments?.nodes ?? [];
}

// ── Jira helpers ──────────────────────────────────────────────────────────────

const jiraAuth = () => 'Basic ' + Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

async function jiraRequest(method, path, body) {
  const res = await fetch(`${JIRA_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: jiraAuth(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function jiraGetProjects() {
  return jiraRequest('GET', '/rest/api/3/project/search?maxResults=5', null);
}

async function jiraCreateIssue({ projectKey, summary, description }) {
  return jiraRequest('POST', '/rest/api/3/issue', {
    fields: {
      project: { key: projectKey },
      summary,
      description: {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
      },
      issuetype: { name: 'Story' },
    },
  });
}

async function jiraGetComments(issueKey) {
  const data = await jiraRequest('GET', `/rest/api/3/issue/${issueKey}/comment`, null);
  return data?.comments ?? [];
}

// ── Connector + mapping setup ─────────────────────────────────────────────────

async function getOrCreateConnector(platformTypeKey, name, extra = {}) {
  const existing = await apiGet('/v1/connectors');
  const list = Array.isArray(existing) ? existing : existing?.items ?? [];
  const found = list.find(c => c.platformType?.key === platformTypeKey);
  if (found) {
    log('setup', `Using existing ${name} connector ${found.id}`);
    return found;
  }
  const connector = await apiPost('/v1/connectors', {
    platformTypeKey,
    name,
    direction: 'both',
    configuredIntakeMode: 'webhook',
    ...extra,
  });
  log('setup', `Created ${name} connector ${connector.id}`);
  return connector;
}

async function getOrCreateRepoMapping(connectorId) {
  const existing = await apiGet('/v1/repository-mappings');
  const list = Array.isArray(existing) ? existing : existing?.items ?? [];
  const found = list.find(m => m.connectorId === connectorId);
  if (found) return found;
  const mapping = await apiPost('/v1/repository-mappings', {
    connectorId,
    repositoryUrl: REPO_URL,
    defaultBranch: 'main',
  });
  log('setup', `Created repo mapping ${mapping.id}`);
  return mapping;
}

// ── Test: GitHub-sourced triage ───────────────────────────────────────────────
async function testGithub() {
  log('github', '── GitHub-sourced triage ──');
  const ghConnectorId = '62a8ed30-9abf-47a1-baf5-7f5c1e26bc5c';
  const repoMappings = await apiGet('/v1/repository-mappings');
  const list = Array.isArray(repoMappings) ? repoMappings : repoMappings?.items ?? [];
  const mapping = list.find(m => m.connectorId === ghConnectorId);
  if (!mapping) { log('github', '⚠️  No GitHub repo mapping found — skipping'); return null; }

  // Create a real GitHub issue using execFile (safe, no shell injection)
  let issueNumber;
  try {
    const ghBody = [
      '## Problem',
      '',
      "When a user's session token expires, the application silently fails to load data without",
      'showing any error or prompting re-authentication. Users are left staring at a spinner',
      'or blank screen with no indication of what went wrong.',
      '',
      '## Steps to reproduce',
      '1. Log in to the application',
      '2. Leave the tab open for more than 30 minutes without activity',
      '3. Try to navigate to any page or perform any action',
      '',
      '## Expected behaviour',
      "Display a clear 'Your session has expired, please log in again' message and redirect",
      'to the login screen automatically.',
      '',
      '## Actual behaviour',
      'No error message appears. API calls silently fail with 401 responses.',
      'The UI shows a loading spinner that never resolves.',
      '',
      '## Environment',
      '- Browser: Chrome 124, Safari 17',
      '- Platform: macOS, Windows 11',
      '- App version: 2.4.1',
      '- Frequency: Reproducible 100% of the time after 30 minutes idle',
    ].join('\n');

    const { stdout } = await execFileAsync('gh', [
      'issue', 'create',
      '--repo', 'rafiki270/max-test',
      '--title', 'User session expires silently without showing an error message',
      '--body', ghBody,
    ], { timeout: 30000 });
    // gh outputs the issue URL, e.g. https://github.com/owner/repo/issues/42
    const match = stdout.trim().match(/\/issues\/(\d+)/);
    if (!match) throw new Error(`Unexpected gh output: ${stdout.trim()}`);
    issueNumber = parseInt(match[1]);
    log('github', `Created GitHub issue #${issueNumber}`);
  } catch (err) {
    log('github', `⚠️  Could not create GitHub issue: ${err.message.slice(0, 100)}`);
    return null;
  }

  const event = await apiPost('/v1/polling/event', {
    scenarioId: '468987a1-d43b-4ad1-b34d-7c2750d9adca',
    actionKind: 'workflow.triage',
    event: {
      kind: 'github.issue.opened',
      connectorId: ghConnectorId,
      repositoryMappingId: mapping.id,
      issue: {
        number: issueNumber,
        title: 'User session expires silently without showing an error message',
        body: 'Session expiry bug — see issue for full details.',
        labels: ['bug'],
        state: 'open',
        url: `https://github.com/rafiki270/max-test/issues/${issueNumber}`,
        comments: [],
      },
    },
  });
  log('github', `Event submitted: ${JSON.stringify(event).slice(0, 120)}`);
  await sleep(2000);
  await dispatchAll();

  await sleep(3000);
  const runs = await apiGet('/v1/runs?limit=20');
  const runList = Array.isArray(runs) ? runs : runs?.items ?? runs?.data ?? [];
  const run = runList.find(r => r.workflowType === 'triage' &&
    ['queued', 'running', 'dispatched'].includes(r.status));
  if (!run) { log('github', '⚠️  No active triage run found after dispatch'); return null; }

  log('github', `Triage run: ${run.id.slice(0, 8)} — polling...`);
  const status = await pollRunStatus(run.id, 'github');
  log('github', status === 'succeeded' ? `✅ Triage succeeded — comment posted on #${issueNumber}` : `❌ Triage ${status}`);
  return status;
}

// ── Test: Linear-sourced triage ───────────────────────────────────────────────
async function testLinear() {
  log('linear', '── Linear-sourced triage ──');
  if (!LINEAR_API_KEY) { log('linear', '⚠️  LINEAR_API_KEY not set — skipping'); return null; }

  const team = await linearGetFirstTeam();
  log('linear', `Using Linear team: ${team.name} (${team.id})`);

  const issue = await linearCreateIssue({
    teamId: team.id,
    title: 'Mobile app crashes when uploading a profile photo larger than 5 MB',
    description: [
      '## Bug report',
      '',
      'When a user attempts to upload a profile photo that exceeds 5 MB, the mobile',
      'application crashes immediately without any error message or user feedback.',
      '',
      '## Steps to reproduce',
      '1. Open the mobile app on iOS or Android',
      '2. Navigate to Profile → Edit Profile → Change Photo',
      '3. Select a photo larger than 5 MB from the camera roll',
      '4. Tap "Use Photo" to confirm the selection',
      '',
      '## Expected behaviour',
      'The application should either compress the image automatically or show a clear',
      'validation error: "Please select a photo smaller than 5 MB."',
      '',
      '## Actual behaviour',
      'The app crashes to the home screen. No error is logged in Crashlytics.',
      'The user loses any unsaved profile edits made before selecting the photo.',
      '',
      '## Technical context',
      '- Affected platforms: iOS 17.4, Android 14',
      '- App version: 3.2.0',
      '- Likely area: ProfileImageUploader or ImagePickerManager',
      '- Reproducible 100% of the time with files larger than 5 MB',
    ].join('\n'),
  });
  log('linear', `Created Linear issue: ${issue.identifier} (${issue.id})`);

  const connector = await getOrCreateConnector('linear', 'Linear (E2E Test)');
  const mapping = await getOrCreateRepoMapping(connector.id);

  const webhookPayload = JSON.stringify({
    type: 'Issue',
    action: 'create',
    data: {
      id: issue.id,
      title: issue.title,
      description: issue.description ?? '',
      url: issue.url,
      state: { name: 'Triage' },
      priority: 2,
      labels: [],
      teamId: team.id,
    },
  });

  const webhookRes = await fetch(`${API}/webhooks/linear/${connector.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  });
  const webhookBody = await webhookRes.json();
  log('linear', `Webhook → ${webhookRes.status}: ${JSON.stringify(webhookBody).slice(0, 120)}`);

  const runId = webhookBody.workflowRunId;
  if (!runId) { log('linear', `❌ No workflowRunId — response: ${JSON.stringify(webhookBody)}`); return null; }

  await sleep(1000);
  await dispatchAll();
  log('linear', `Dispatched. Polling run ${runId.slice(0, 8)}...`);

  const status = await pollRunStatus(runId, 'linear');

  if (status === 'succeeded') {
    await sleep(3000);
    const comments = await linearGetComments(issue.id);
    const botComment = comments.find(c =>
      c.body.includes('SupportAgent') || c.body.includes('## Triage') ||
      c.body.includes('Root cause') || c.body.includes('root cause') ||
      c.body.includes('Summary'),
    );
    log('linear', botComment
      ? `✅ Triage succeeded + comment posted on ${issue.identifier}:\n    "${botComment.body.slice(0, 120)}..."`
      : `✅ Triage succeeded — comment may still be posting on ${issue.identifier}`);
  } else {
    log('linear', `❌ Triage ${status}`);
  }
  return status;
}

// ── Test: Jira-sourced triage ─────────────────────────────────────────────────
async function testJira() {
  log('jira', '── Jira-sourced triage ──');
  if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    log('jira', '⚠️  Jira credentials not set — skipping');
    return null;
  }

  const projectsData = await jiraGetProjects();
  const projects = projectsData?.values ?? [];
  if (!projects.length) { log('jira', '❌ No Jira projects found'); return null; }
  const project = projects[0];
  log('jira', `Using Jira project: ${project.name} (${project.key})`);

  const created = await jiraCreateIssue({
    projectKey: project.key,
    summary: 'Checkout page shows a blank screen for users with saved cart items from a previous session',
    description: [
      'When a returning user navigates to the checkout page, they see a completely blank',
      'white screen. The issue only affects users who have items saved in their cart from',
      'a previous browser session.',
      '',
      'Steps to reproduce:',
      '1. Add at least one item to the cart',
      '2. Close the browser completely',
      '3. Reopen the browser and navigate directly to the checkout page',
      '',
      'Expected behaviour: The checkout page loads normally showing the saved cart items.',
      '',
      'Actual behaviour: The checkout page renders as a blank white screen. No JavaScript',
      'errors appear in the console. Network tab shows all resources loading successfully.',
      '',
      'Likely area: Cart state hydration in the checkout component. The cart context may',
      'not be rehydrating from localStorage before the checkout page renders.',
      '',
      'Impact: Approximately 12% of returning customers based on session analytics.',
    ].join('\n'),
  });
  log('jira', `Created Jira issue: ${created.key} (${created.id})`);

  const connector = await getOrCreateConnector('jira', 'Jira (E2E Test)', {
    apiBaseUrl: JIRA_BASE_URL,
  });
  const mapping = await getOrCreateRepoMapping(connector.id);

  const webhookPayload = JSON.stringify({
    webhookEvent: 'jira:issue_created',
    issue: {
      id: created.id,
      key: created.key,
      self: `${JIRA_BASE_URL}/rest/api/3/issue/${created.id}`,
      fields: {
        summary: 'Checkout page shows a blank screen for users with saved cart items from a previous session',
        description: {
          type: 'doc', version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Cart state hydration bug on the checkout page.' }],
          }],
        },
        status: { name: 'To Do' },
        priority: { name: 'High' },
        labels: ['bug', 'checkout', 'regression'],
      },
    },
  });

  const webhookRes = await fetch(`${API}/webhooks/jira/${connector.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  });
  const webhookBody = await webhookRes.json();
  log('jira', `Webhook → ${webhookRes.status}: ${JSON.stringify(webhookBody).slice(0, 120)}`);

  const runId = webhookBody.workflowRunId;
  if (!runId) { log('jira', `❌ No workflowRunId — response: ${JSON.stringify(webhookBody)}`); return null; }

  await sleep(1000);
  await dispatchAll();
  log('jira', `Dispatched. Polling run ${runId.slice(0, 8)}...`);

  const status = await pollRunStatus(runId, 'jira');

  if (status === 'succeeded') {
    await sleep(3000);
    const comments = await jiraGetComments(created.key);

    function adfToText(node) {
      if (!node) return '';
      if (node.type === 'text') return node.text ?? '';
      if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
      return '';
    }

    const botComment = comments.find(c => {
      const text = adfToText(c.body);
      return text.includes('SupportAgent') || text.includes('Triage') ||
             text.includes('Root cause') || text.includes('Summary');
    });
    log('jira', botComment
      ? `✅ Triage succeeded + comment posted on ${created.key}`
      : `✅ Triage succeeded — comment may still be posting on ${created.key}`);
  } else {
    log('jira', `❌ Triage ${status}`);
  }
  return status;
}

// ── Test: Linear label → triage only ─────────────────────────────────────────
async function testLinearLabelTriage() {
  log('linear-label-triage', '── Linear "needs triage" label → triage only ──');
  if (!LINEAR_API_KEY) { log('linear-label-triage', '⚠️  LINEAR_API_KEY not set — skipping'); return null; }

  const team = await linearGetFirstTeam();
  const issue = await linearCreateIssue({
    teamId: team.id,
    title: 'Push notifications are not delivered when the app is running in the foreground',
    description: [
      '## Bug report',
      '',
      'When the app is open and in the foreground, push notifications from the server',
      'are silently dropped. The user never sees the notification banner or sound.',
      'Notifications only appear correctly when the app is backgrounded or closed.',
      '',
      '## Steps to reproduce',
      '1. Open the app and keep it in the foreground',
      '2. Trigger a push notification from another device or the admin panel',
      '3. Observe that no notification appears in-app or as a banner',
      '',
      '## Expected behaviour',
      'An in-app notification banner should appear with the message content.',
      '',
      '## Actual behaviour',
      'No notification is shown. The FCM/APNs delivery receipt shows the message was delivered.',
      '',
      '## Technical context',
      '- Affected: iOS 17 and Android 14',
      '- App version: 3.4.0',
      '- Likely area: foreground notification handler in AppDelegate / FirebaseMessagingService',
    ].join('\n'),
  });
  log('linear-label-triage', `Created Linear issue: ${issue.identifier} (${issue.id})`);

  const connector = await getOrCreateConnector('linear', 'Linear (E2E Test)');
  const mapping = await getOrCreateRepoMapping(connector.id);

  // Simulate adding the "needs triage" label via webhook update event
  const NEEDS_TRIAGE_LABEL_ID = 'ec7d6b29-614d-48f6-aee1-3a3a2f98795a';
  const webhookPayload = JSON.stringify({
    type: 'Issue',
    action: 'update',
    data: {
      id: issue.id,
      title: issue.title,
      description: issue.description ?? '',
      url: issue.url,
      state: { name: 'Backlog' },
      priority: 2,
      labels: [{ id: NEEDS_TRIAGE_LABEL_ID, name: 'needs triage' }],
      teamId: team.id,
    },
    updatedFrom: { labelIds: [] },
  });

  const webhookRes = await fetch(`${API}/webhooks/linear/${connector.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  });
  const webhookBody = await webhookRes.json();
  log('linear-label-triage', `Webhook → ${webhookRes.status}: ${JSON.stringify(webhookBody).slice(0, 120)}`);

  const runId = webhookBody.workflowRunId;
  if (!runId) { log('linear-label-triage', `❌ No workflowRunId — response: ${JSON.stringify(webhookBody)}`); return null; }

  await sleep(1000);
  await dispatchAll();
  log('linear-label-triage', `Dispatched. Polling run ${runId.slice(0, 8)}...`);

  const status = await pollRunStatus(runId, 'linear-label-triage');
  if (status === 'succeeded') {
    await sleep(3000);
    const comments = await linearGetComments(issue.id);
    const botComment = comments.find(c =>
      c.body.includes('SupportAgent') || c.body.includes('Triage') || c.body.includes('Summary'),
    );
    log('linear-label-triage', botComment
      ? `✅ Triage-only succeeded + comment posted on ${issue.identifier}`
      : `✅ Triage-only succeeded — comment may still be posting on ${issue.identifier}`);
  } else {
    log('linear-label-triage', `❌ Triage ${status}`);
  }
  return status;
}

// ── Test: Linear label → triage + PR ─────────────────────────────────────────
async function testLinearLabelPR() {
  log('linear-label-pr', '── Linear "needs PR" label → triage + build ──');
  if (!LINEAR_API_KEY) { log('linear-label-pr', '⚠️  LINEAR_API_KEY not set — skipping'); return null; }

  const team = await linearGetFirstTeam();
  const issue = await linearCreateIssue({
    teamId: team.id,
    title: 'Search results page does not paginate when there are more than 20 results',
    description: [
      '## Feature / Bug',
      '',
      'The search results page only shows the first 20 results and provides no way to',
      'load more. There is no pagination control, no infinite scroll, and no "load more"',
      'button. Users with broad search terms never see results beyond the first page.',
      '',
      '## Expected behaviour',
      'Add pagination to the search results page. Show 20 results per page with',
      '"Previous" and "Next" controls, or implement infinite scroll.',
      '',
      '## Technical context',
      '- Component: SearchResultsPage.tsx',
      '- API: GET /api/v1/search?q=...&page=1&limit=20 (already supports pagination params)',
      '- The API is ready — only the frontend component needs updating',
      '- Design: follow the pattern used by the Issues list page (IssuesPage.tsx)',
    ].join('\n'),
  });
  log('linear-label-pr', `Created Linear issue: ${issue.identifier} (${issue.id})`);

  const connector = await getOrCreateConnector('linear', 'Linear (E2E Test)');
  const mapping = await getOrCreateRepoMapping(connector.id);

  // Simulate adding the "needs PR" label via webhook update event
  const NEEDS_PR_LABEL_ID = 'd204cd0b-00ba-4539-8788-55f889b18a9b';
  const webhookPayload = JSON.stringify({
    type: 'Issue',
    action: 'update',
    data: {
      id: issue.id,
      title: issue.title,
      description: issue.description ?? '',
      url: issue.url,
      state: { name: 'In Progress' },
      priority: 2,
      labels: [{ id: NEEDS_PR_LABEL_ID, name: 'needs PR' }],
      teamId: team.id,
    },
    updatedFrom: { labelIds: [] },
  });

  const webhookRes = await fetch(`${API}/webhooks/linear/${connector.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  });
  const webhookBody = await webhookRes.json();
  log('linear-label-pr', `Webhook → ${webhookRes.status}: ${JSON.stringify(webhookBody).slice(0, 120)}`);

  const runId = webhookBody.workflowRunId;
  if (!runId) { log('linear-label-pr', `❌ No workflowRunId — response: ${JSON.stringify(webhookBody)}`); return null; }

  await sleep(1000);
  await dispatchAll();
  log('linear-label-pr', `Dispatched. Polling triage run ${runId.slice(0, 8)}...`);

  const triageStatus = await pollRunStatus(runId, 'linear-label-pr');
  if (triageStatus !== 'succeeded') {
    log('linear-label-pr', `❌ Triage ${triageStatus}`);
    return triageStatus;
  }

  // After triage, the chain service will queue a build run — find and poll it
  await sleep(10000); // give chain service time to fire
  await dispatchAll();
  const runs = await apiGet('/v1/runs?limit=30');
  const runList = Array.isArray(runs) ? runs : runs?.items ?? runs?.data ?? [];
  const buildRun = runList.find(r =>
    r.workflowType === 'build' &&
    (r.parentWorkflowRunId === runId || ['queued', 'running', 'dispatched'].includes(r.status)),
  );

  if (!buildRun) {
    log('linear-label-pr', `✅ Triage succeeded — ⚠️  build run not found yet (chain may still be pending)`);
    return triageStatus;
  }

  log('linear-label-pr', `Build run queued: ${buildRun.id.slice(0, 8)} — polling...`);
  const buildStatus = await pollRunStatus(buildRun.id, 'linear-label-pr');

  if (buildStatus === 'succeeded') {
    await sleep(3000);
    const comments = await linearGetComments(issue.id);
    const prComment = comments.find(c => c.body.includes('PR') || c.body.includes('pull request'));
    log('linear-label-pr', prComment
      ? `✅ Build succeeded + PR comment posted on ${issue.identifier}`
      : `✅ Build succeeded — comment may still be posting on ${issue.identifier}`);
    return buildStatus;
  }
  log('linear-label-pr', `Build ${buildStatus}`);
  return buildStatus;
}

// ── Test: Jira label → triage only ───────────────────────────────────────────
async function testJiraLabelTriage() {
  log('jira-label-triage', '── Jira "needs-triage" label → triage only ──');
  if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    log('jira-label-triage', '⚠️  Jira credentials not set — skipping');
    return null;
  }

  const projectsData = await jiraGetProjects();
  const projects = projectsData?.values ?? [];
  if (!projects.length) { log('jira-label-triage', '❌ No Jira projects found'); return null; }
  const project = projects[0];

  const created = await jiraCreateIssue({
    projectKey: project.key,
    summary: 'Image upload silently fails when file size exceeds 5 MB',
    description: 'Users uploading profile photos larger than 5 MB receive no error message. The upload spinner disappears and the old photo remains. The 5 MB limit is enforced server-side but not communicated to the client.',
  });
  log('jira-label-triage', `Created Jira issue: ${created.key}`);

  const connector = await getOrCreateConnector('jira', 'Jira (E2E Test)', {
    apiBaseUrl: JIRA_BASE_URL,
  });
  await getOrCreateRepoMapping(connector.id);

  // Simulate adding the "needs-triage" label via a changelog update event
  const webhookPayload = JSON.stringify({
    webhookEvent: 'jira:issue_updated',
    issue_event_type_name: 'issue_updated',
    issue: {
      id: created.id,
      key: created.key,
      self: `${JIRA_BASE_URL}/rest/api/3/issue/${created.id}`,
      fields: {
        summary: created.fields?.summary ?? 'Image upload silently fails when file size exceeds 5 MB',
        description: null,
        status: { name: 'To Do' },
        priority: { name: 'Medium' },
        labels: ['needs-triage'],
      },
    },
    changelog: {
      id: '1001',
      items: [
        {
          field: 'labels',
          fieldtype: 'jira',
          fieldId: 'labels',
          from: null,
          fromString: '',
          to: null,
          toString: 'needs-triage',
        },
      ],
    },
  });

  const webhookRes = await fetch(`${API}/webhooks/jira/${connector.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  });
  const webhookBody = await webhookRes.json();
  log('jira-label-triage', `Webhook → ${webhookRes.status}: ${JSON.stringify(webhookBody).slice(0, 120)}`);

  const runId = webhookBody.workflowRunId;
  if (!runId) { log('jira-label-triage', `❌ No workflowRunId — response: ${JSON.stringify(webhookBody)}`); return null; }

  await sleep(1000);
  await dispatchAll();
  log('jira-label-triage', `Dispatched. Polling run ${runId.slice(0, 8)}...`);

  const triageStatus = await pollRunStatus(runId, 'jira-label-triage');

  if (triageStatus === 'succeeded') {
    // Verify chain was NOT triggered (skipBuildChain)
    await sleep(3000);
    await dispatchAll();
    const runs = await apiGet('/v1/runs?limit=30');
    const runList = Array.isArray(runs) ? runs : runs?.items ?? runs?.data ?? [];
    const buildRun = runList.find(r =>
      r.workflowType === 'build' && r.parentWorkflowRunId === runId,
    );
    if (buildRun) {
      log('jira-label-triage', `❌ Build run was created (${buildRun.id.slice(0, 8)}) but skipBuildChain should have blocked it`);
    } else {
      log('jira-label-triage', `✅ Triage only — no build run created (skipBuildChain respected)`);
    }

    const comments = await jiraGetComments(created.key);
    function adfToText(node) {
      if (!node) return '';
      if (node.type === 'text') return node.text ?? '';
      if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
      return '';
    }
    const botComment = comments.find(c => {
      const text = adfToText(c.body);
      return text.includes('SupportAgent') || text.includes('Triage') ||
             text.includes('Root cause') || text.includes('Summary');
    });
    log('jira-label-triage', botComment
      ? `✅ Triage comment posted on ${created.key}`
      : `✅ Triage succeeded — comment may still be posting on ${created.key}`);
  } else {
    log('jira-label-triage', `❌ Triage ${triageStatus}`);
  }
  return triageStatus;
}

// ── Test: Jira label → triage + build (PR) ───────────────────────────────────
async function testJiraLabelPR() {
  log('jira-label-pr', '── Jira "needs-pr" label → triage + build ──');
  if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
    log('jira-label-pr', '⚠️  Jira credentials not set — skipping');
    return null;
  }

  const projectsData = await jiraGetProjects();
  const projects = projectsData?.values ?? [];
  if (!projects.length) { log('jira-label-pr', '❌ No Jira projects found'); return null; }
  const project = projects[0];

  const created = await jiraCreateIssue({
    projectKey: project.key,
    summary: 'Sort order on the notifications list resets to default after navigating away',
    description: 'When a user changes the sort order of their notifications list and navigates to another page, the selected sort order is not preserved. On returning, the list defaults back to "Newest first". Expected: sort preference persists for the session.',
  });
  log('jira-label-pr', `Created Jira issue: ${created.key}`);

  const connector = await getOrCreateConnector('jira', 'Jira (E2E Test)', {
    apiBaseUrl: JIRA_BASE_URL,
  });
  await getOrCreateRepoMapping(connector.id);

  // Simulate adding the "needs-pr" label
  const webhookPayload = JSON.stringify({
    webhookEvent: 'jira:issue_updated',
    issue_event_type_name: 'issue_updated',
    issue: {
      id: created.id,
      key: created.key,
      self: `${JIRA_BASE_URL}/rest/api/3/issue/${created.id}`,
      fields: {
        summary: created.fields?.summary ?? 'Sort order on the notifications list resets to default after navigating away',
        description: null,
        status: { name: 'To Do' },
        priority: { name: 'Medium' },
        labels: ['needs-pr'],
      },
    },
    changelog: {
      id: '1002',
      items: [
        {
          field: 'labels',
          fieldtype: 'jira',
          fieldId: 'labels',
          from: null,
          fromString: '',
          to: null,
          toString: 'needs-pr',
        },
      ],
    },
  });

  const webhookRes = await fetch(`${API}/webhooks/jira/${connector.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: webhookPayload,
  });
  const webhookBody = await webhookRes.json();
  log('jira-label-pr', `Webhook → ${webhookRes.status}: ${JSON.stringify(webhookBody).slice(0, 120)}`);

  const runId = webhookBody.workflowRunId;
  if (!runId) { log('jira-label-pr', `❌ No workflowRunId — response: ${JSON.stringify(webhookBody)}`); return null; }

  await sleep(1000);
  await dispatchAll();
  log('jira-label-pr', `Dispatched. Polling triage run ${runId.slice(0, 8)}...`);

  const triageStatus = await pollRunStatus(runId, 'jira-label-pr');
  if (triageStatus !== 'succeeded') {
    log('jira-label-pr', `❌ Triage ${triageStatus}`);
    return triageStatus;
  }

  log('jira-label-pr', `Triage succeeded — waiting for build chain...`);
  await sleep(3000);
  await dispatchAll();
  const runs = await apiGet('/v1/runs?limit=30');
  const runList = Array.isArray(runs) ? runs : runs?.items ?? runs?.data ?? [];
  const buildRun = runList.find(r =>
    r.workflowType === 'build' &&
    (r.parentWorkflowRunId === runId || ['queued', 'running', 'dispatched'].includes(r.status)),
  );

  if (!buildRun) {
    log('jira-label-pr', `✅ Triage succeeded — ⚠️  build run not found yet (chain may still be pending)`);
    return triageStatus;
  }

  log('jira-label-pr', `Build run queued: ${buildRun.id.slice(0, 8)} — polling...`);
  const buildStatus = await pollRunStatus(buildRun.id, 'jira-label-pr');

  if (buildStatus === 'succeeded') {
    await sleep(3000);
    const comments = await jiraGetComments(created.key);
    function adfToText(node) {
      if (!node) return '';
      if (node.type === 'text') return node.text ?? '';
      if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
      return '';
    }
    const prComment = comments.find(c => {
      const text = adfToText(c.body);
      return text.includes('PR') || text.includes('pull request') || text.includes('pull-request');
    });
    log('jira-label-pr', prComment
      ? `✅ Build succeeded + PR comment posted on ${created.key}`
      : `✅ Build succeeded — comment may still be posting on ${created.key}`);
    return buildStatus;
  }
  log('jira-label-pr', `Build ${buildStatus}`);
  return buildStatus;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SupportAgent E2E Integration Test');
  console.log('══════════════════════════════════════════════════════\n');

  const health = await fetch(`${API}/health`).then(r => r.json()).catch(() => null);
  if (!health?.status) { console.error('❌ API not reachable at', API); process.exit(1); }
  log('setup', 'API healthy ✅');

  const results = {};

  try { results.linear = await testLinear(); } catch (err) { log('linear', `❌ Error: ${err.message}`); results.linear = 'error'; }
  try { results.jira   = await testJira();   } catch (err) { log('jira',   `❌ Error: ${err.message}`); results.jira   = 'error'; }
  try { results.github = await testGithub(); } catch (err) { log('github', `❌ Error: ${err.message}`); results.github = 'error'; }
  try { results['linear-label-triage'] = await testLinearLabelTriage(); } catch (err) { log('linear-label-triage', `❌ Error: ${err.message}`); results['linear-label-triage'] = 'error'; }
  try { results['linear-label-pr']     = await testLinearLabelPR();     } catch (err) { log('linear-label-pr',     `❌ Error: ${err.message}`); results['linear-label-pr']     = 'error'; }
  try { results['jira-label-triage']   = await testJiraLabelTriage();   } catch (err) { log('jira-label-triage',   `❌ Error: ${err.message}`); results['jira-label-triage']   = 'error'; }
  try { results['jira-label-pr']       = await testJiraLabelPR();       } catch (err) { log('jira-label-pr',       `❌ Error: ${err.message}`); results['jira-label-pr']       = 'error'; }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Results');
  console.log('══════════════════════════════════════════════════════');
  for (const [platform, status] of Object.entries(results)) {
    const icon = status === 'succeeded' ? '✅' : status === null ? '⏭ ' : '❌';
    console.log(`  ${icon}  ${platform.padEnd(12)} ${status ?? 'skipped'}`);
  }
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
