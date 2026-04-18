import {
  getIssue,
  postComment,
  type JiraClientOptions,
  type JiraIssueSummary,
} from '@support-agent/jira-client';

function clientOptions(): JiraClientOptions {
  const baseUrl = process.env.JIRA_BASE_URL;
  const userEmail = process.env.JIRA_USER_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !userEmail || !apiToken) {
    throw new Error(
      'Jira credentials missing. Set JIRA_BASE_URL, JIRA_USER_EMAIL, and JIRA_API_TOKEN on the worker process.',
    );
  }
  return { baseUrl, userEmail, apiToken };
}

export async function jiraGetIssue(issueKeyOrId: string): Promise<JiraIssueSummary> {
  return getIssue(clientOptions(), issueKeyOrId);
}

export async function jiraAddComment(issueKeyOrId: string, body: string): Promise<{ id: string }> {
  return postComment(clientOptions(), { issueKeyOrId, body });
}

export function jiraAuthAvailable(): boolean {
  return Boolean(
    process.env.JIRA_BASE_URL?.trim()
      && process.env.JIRA_USER_EMAIL?.trim()
      && process.env.JIRA_API_TOKEN?.trim(),
  );
}
