import { LinearClient } from '@linear/sdk';

export interface LinearClientOptions {
  apiKey: string;
}

export interface LinearIssueSummary {
  id: string;
  identifier: string;
  title: string;
  body: string | null;
  url: string;
  state: string;
  priority: number | null;
  labels: string[];
  assignee: string | null;
  comments: LinearCommentSummary[];
}

export interface LinearCommentSummary {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
}

export interface CreateIssueOptions {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  labelIds?: string[];
  assigneeId?: string;
}

export interface PostCommentOptions {
  issueId: string;
  body: string;
  parentId?: string;
}

export interface UpdateIssueStateOptions {
  issueId: string;
  stateId: string;
}

export interface UpdateIssuePriorityOptions {
  issueId: string;
  priority: number;
}

export interface AddLabelOptions {
  issueId: string;
  labelIds: string[];
}

function newClient(options: LinearClientOptions): LinearClient {
  return new LinearClient({ apiKey: options.apiKey });
}

export async function getIssue(
  options: LinearClientOptions,
  issueIdOrIdentifier: string,
): Promise<LinearIssueSummary> {
  const client = newClient(options);
  const issue = await client.issue(issueIdOrIdentifier);
  const [stateNode, labelsConn, commentsConn, assigneeNode] = await Promise.all([
    issue.state,
    issue.labels(),
    issue.comments(),
    issue.assignee,
  ]);
  const comments: LinearCommentSummary[] = await Promise.all(
    commentsConn.nodes.map(async (c) => {
      const userNode = await c.user;
      return {
        id: c.id,
        author: userNode?.displayName ?? userNode?.name ?? 'unknown',
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        url: c.url,
      };
    }),
  );
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    body: issue.description ?? null,
    url: issue.url,
    state: stateNode?.name ?? 'unknown',
    priority: issue.priority ?? null,
    labels: labelsConn.nodes.map((l) => l.name),
    assignee: assigneeNode?.displayName ?? assigneeNode?.name ?? null,
    comments,
  };
}

export async function createIssue(
  options: LinearClientOptions,
  input: CreateIssueOptions,
): Promise<{ id: string; identifier: string; url: string }> {
  const client = newClient(options);
  const result = await client.createIssue({
    teamId: input.teamId,
    title: input.title,
    description: input.description,
    priority: input.priority,
    labelIds: input.labelIds,
    assigneeId: input.assigneeId,
  });
  if (!result.success || !result.issue) {
    throw new Error('Linear: createIssue failed');
  }
  const issue = await result.issue;
  return { id: issue.id, identifier: issue.identifier, url: issue.url };
}

export async function postComment(
  options: LinearClientOptions,
  input: PostCommentOptions,
): Promise<{ id: string; url?: string }> {
  const client = newClient(options);
  const result = await client.createComment({
    issueId: input.issueId,
    body: input.body,
    parentId: input.parentId,
  });
  if (!result.success || !result.comment) {
    throw new Error('Linear: createComment failed');
  }
  const comment = await result.comment;
  return { id: comment.id, url: comment.url };
}

export async function updateIssueState(
  options: LinearClientOptions,
  input: UpdateIssueStateOptions,
): Promise<void> {
  const client = newClient(options);
  const result = await client.updateIssue(input.issueId, { stateId: input.stateId });
  if (!result.success) {
    throw new Error('Linear: updateIssue (state) failed');
  }
}

export async function updateIssuePriority(
  options: LinearClientOptions,
  input: UpdateIssuePriorityOptions,
): Promise<void> {
  const client = newClient(options);
  const result = await client.updateIssue(input.issueId, { priority: input.priority });
  if (!result.success) {
    throw new Error('Linear: updateIssue (priority) failed');
  }
}

export async function addLabels(
  options: LinearClientOptions,
  input: AddLabelOptions,
): Promise<void> {
  const client = newClient(options);
  const issue = await client.issue(input.issueId);
  const existing = await issue.labels();
  const merged = Array.from(new Set([...existing.nodes.map((l) => l.id), ...input.labelIds]));
  const result = await client.updateIssue(input.issueId, { labelIds: merged });
  if (!result.success) {
    throw new Error('Linear: updateIssue (labels) failed');
  }
}

export async function findStateByName(
  options: LinearClientOptions,
  teamId: string,
  stateName: string,
): Promise<{ id: string; name: string } | null> {
  const client = newClient(options);
  const team = await client.team(teamId);
  const states = await team.states();
  const match = states.nodes.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
  return match ? { id: match.id, name: match.name } : null;
}

export async function findOrCreateLabel(
  options: LinearClientOptions,
  teamId: string,
  labelName: string,
  color?: string,
): Promise<{ id: string; name: string }> {
  const client = newClient(options);
  const team = await client.team(teamId);
  const labels = await team.labels();
  const existing = labels.nodes.find((l) => l.name.toLowerCase() === labelName.toLowerCase());
  if (existing) return { id: existing.id, name: existing.name };
  const created = await client.createIssueLabel({ teamId, name: labelName, color });
  if (!created.success || !created.issueLabel) {
    throw new Error(`Linear: createIssueLabel failed for "${labelName}"`);
  }
  const label = await created.issueLabel;
  return { id: label.id, name: label.name };
}
