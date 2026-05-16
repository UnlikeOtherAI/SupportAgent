import { runArgv } from './run.js';
import { withJsonBodyFile } from './temp.js';
import type { GitHubCommentReference, GitHubPrComment } from './types.js';

export async function ghAddPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  comment: string,
): Promise<GitHubCommentReference> {
  return withJsonBodyFile('pr-comment', { body: comment }, async (bodyFile) => {
    const out = await runArgv('gh', [
      'api', `repos/${owner}/${repo}/issues/${prNumber}/comments`,
      '--method', 'POST',
      '--input', bodyFile,
    ]);
    const data = JSON.parse(out) as { body?: string; html_url: string; id: number | string };
    return {
      id: String(data.id),
      url: data.html_url,
      body: data.body,
    };
  });
}

export async function ghAddIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  comment: string,
): Promise<GitHubCommentReference> {
  return withJsonBodyFile('issue-comment', { body: comment }, async (bodyFile) => {
    const out = await runArgv('gh', [
      'api', `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      '--method', 'POST',
      '--input', bodyFile,
    ]);
    const data = JSON.parse(out) as { body?: string; html_url: string; id: number | string };
    return {
      id: String(data.id),
      url: data.html_url,
      body: data.body,
    };
  });
}

export async function ghGetComment(
  owner: string,
  repo: string,
  commentId: string,
): Promise<GitHubCommentReference> {
  const out = await runArgv('gh', [
    'api', `repos/${owner}/${repo}/issues/comments/${commentId}`,
  ]);
  const data = JSON.parse(out) as { body?: string; html_url: string; id: number | string };
  return {
    id: String(data.id),
    url: data.html_url,
    body: data.body,
  };
}

export async function ghEditComment(
  owner: string,
  repo: string,
  commentId: string,
  body: string,
): Promise<GitHubCommentReference> {
  return withJsonBodyFile('comment-edit', { body }, async (bodyFile) => {
    const out = await runArgv('gh', [
      'api', `repos/${owner}/${repo}/issues/comments/${commentId}`,
      '--method', 'PATCH',
      '--input', bodyFile,
    ]);
    const data = JSON.parse(out) as { body?: string; html_url: string; id: number | string };
    return {
      id: String(data.id),
      url: data.html_url,
      body: data.body,
    };
  });
}

export async function ghListPrComments(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubPrComment[]> {
  const out = await runArgv('gh', [
    'pr', 'view', String(prNumber),
    '--repo', `${owner}/${repo}`,
    '--json', 'comments',
  ]);
  const data = JSON.parse(out) as { comments?: Array<any> };
  const comments = data.comments ?? [];
  return comments.map((comment, index) => ({
    id: String(comment.id ?? `${prNumber}-${index}`),
    author: comment.author?.login ?? 'unknown',
    body: comment.body ?? '',
    createdAt: comment.createdAt ?? new Date().toISOString(),
    url: comment.url,
  }));
}
