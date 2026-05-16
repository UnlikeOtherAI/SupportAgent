import type { GitHubIssueComment } from './types.js';

export function parseLabels(
  labels: Array<string | { name?: string }> | undefined,
): string[] {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name ?? '',
  ).filter(Boolean);
}

export function parseComments(
  comments: Array<any> | undefined,
): GitHubIssueComment[] {
  return (comments ?? []).map((comment) => ({
    id: String(comment.id),
    author: comment.author?.login ?? 'unknown',
    body: comment.body ?? '',
    createdAt: comment.createdAt ?? '',
    url: comment.url,
  }));
}

export function parseGitHubRef(ref: string): { owner: string; repo: string } {
  if (!ref.includes('/')) {
    throw new Error(`Invalid GitHub ref: ${ref}`);
  }

  const [owner, repo] = ref
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .split('/');
  return { owner, repo };
}
