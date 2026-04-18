import {
  getIssue,
  postComment,
  type LinearIssueSummary,
} from '@support-agent/linear-client';

function apiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'LINEAR_API_KEY env var is not set. Set it on the worker process to enable Linear post-back.',
    );
  }
  return key;
}

export async function linearGetIssue(issueIdOrIdentifier: string): Promise<LinearIssueSummary> {
  return getIssue({ apiKey: apiKey() }, issueIdOrIdentifier);
}

export async function linearAddComment(
  issueId: string,
  body: string,
): Promise<{ id: string; url?: string }> {
  return postComment({ apiKey: apiKey() }, { issueId, body });
}

export function linearAuthAvailable(): boolean {
  return Boolean(process.env.LINEAR_API_KEY?.trim());
}
