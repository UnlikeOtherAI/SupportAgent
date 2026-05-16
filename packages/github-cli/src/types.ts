export interface GitHubRepositoryOption {
  defaultBranch: string;
  isPrivate: boolean;
  nameWithOwner: string;
  owner: string;
  url: string;
}

export interface GitHubRepositoryOwnerOption {
  login: string;
  type: 'organization' | 'user';
}

export interface GitHubIssueComment {
  author: string;
  body: string;
  createdAt: string;
  id: string;
  url?: string;
}

export interface GitHubCommentReference {
  body?: string;
  id: string;
  url: string;
}

export interface GitHubIssueSummary {
  body: string | null;
  comments: GitHubIssueComment[];
  labels: string[];
  number: number;
  state: string;
  title: string;
  updatedAt?: string;
  url: string;
}

export interface GitHubPrComment {
  author: string;
  body: string;
  createdAt: string;
  id: string;
  url?: string;
}

export const GITHUB_HOST = 'github.com';
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_LABEL_COLOR = '1D76DB';

export const LABEL_DEFINITIONS: Record<string, { color: string; description: string }> = {
  triaged: {
    color: '0E8A16',
    description: 'Processed by SupportAgent triage',
  },
  'severity-low': {
    color: '1D76DB',
    description: 'Severity: low — assigned by SupportAgent triage',
  },
  'severity-medium': {
    color: 'FBCA04',
    description: 'Severity: medium — assigned by SupportAgent triage',
  },
  'severity-high': {
    color: 'D93F0B',
    description: 'Severity: high — assigned by SupportAgent triage',
  },
  'severity-critical': {
    color: 'B60205',
    description: 'Severity: critical — assigned by SupportAgent triage',
  },
  'severity-unknown': {
    color: 'BFBFBF',
    description: 'Severity could not be determined',
  },
};
