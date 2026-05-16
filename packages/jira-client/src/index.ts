/**
 * Jira Cloud REST v3 client.
 *
 * Uses raw fetch (no SDK dep). Basic auth:
 *   Authorization: Basic base64(userEmail:apiToken)
 *
 * Comment and description bodies use Atlassian Document Format (ADF).
 * A minimal helper wraps plain text into a single-paragraph ADF document.
 *
 * SSRF: the operator-supplied `baseUrl` is funnelled through the shared
 * `safeFetchFollowRedirects` helper (single source of truth) which pins the
 * resolved IP, blocks private/link-local/metadata ranges, and re-validates
 * every redirect hop. Hostnames are also pinned to the Atlassian Cloud
 * suffix.
 */

import { safeFetchFollowRedirects } from '@support-agent/contracts';
import type { LookupAddress } from 'node:dns';

const JIRA_ALLOWED_HOST_SUFFIXES = ['atlassian.net', 'jira.com'] as const;

export interface JiraClientOptions {
  baseUrl: string;
  userEmail: string;
  apiToken: string;
  /** Override fetch (testing). */
  fetchImpl?: typeof fetch;
  /** Override DNS resolution (testing only). */
  resolveImpl?: (hostname: string) => Promise<LookupAddress[]>;
}

export interface JiraIssueSummary {
  /** Jira issue id (numeric). */
  id: string;
  /** Issue key such as "PROJ-123". */
  key: string;
  /** Summary field (one-line title). */
  summary: string;
  /** Plain-text description extracted from ADF. */
  description: string | null;
  /** Canonical browse URL. */
  url: string;
  /** Status name e.g. "To Do", "In Progress". */
  status: string;
  /** Priority name or null if unset. */
  priority: string | null;
  /** Label names. */
  labels: string[];
  /** Assignee displayName or null. */
  assignee: string | null;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'JiraApiError';
  }
}

function authHeader(options: JiraClientOptions): string {
  const raw = `${options.userEmail}:${options.apiToken}`;
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function buildUrl(options: JiraClientOptions, path: string): string {
  const base = options.baseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function request<T>(
  options: JiraClientOptions,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = buildUrl(options, path);
  const headers: Record<string, string> = {
    Authorization: authHeader(options),
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await safeFetchFollowRedirects(
    url,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    {
      allowedHostSuffixes: JIRA_ALLOWED_HOST_SUFFIXES,
      fetchImpl: options.fetchImpl,
      resolveImpl: options.resolveImpl,
      maxRedirects: 3,
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new JiraApiError(
      `Jira ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  [key: string]: unknown;
}

/** Wraps a plain-text string into a minimal ADF doc. */
export function plainTextToAdf(text: string): AdfNode {
  const lines = text.split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line.length > 0 ? [{ type: 'text', text: line }] : [],
    })),
  };
}

/** Best-effort plain-text extraction from an ADF node tree. */
export function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as AdfNode;
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map((child) => adfToPlainText(child));
    if (n.type === 'paragraph' || n.type === 'heading') {
      return parts.join('') + '\n';
    }
    return parts.join('');
  }
  return '';
}

interface RawJiraIssueResponse {
  id: string;
  key: string;
  self: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string } | null;
    priority?: { name?: string } | null;
    labels?: string[];
    assignee?: { displayName?: string; emailAddress?: string } | null;
  };
}

function buildBrowseUrl(options: JiraClientOptions, key: string): string {
  return `${options.baseUrl.replace(/\/+$/, '')}/browse/${key}`;
}

function mapIssue(options: JiraClientOptions, raw: RawJiraIssueResponse): JiraIssueSummary {
  const fields = raw.fields ?? {};
  const description = fields.description
    ? adfToPlainText(fields.description).trim() || null
    : null;
  return {
    id: raw.id,
    key: raw.key,
    summary: fields.summary ?? '',
    description,
    url: buildBrowseUrl(options, raw.key),
    status: fields.status?.name ?? 'Unknown',
    priority: fields.priority?.name ?? null,
    labels: fields.labels ?? [],
    assignee: fields.assignee?.displayName ?? null,
  };
}

export async function getIssue(
  options: JiraClientOptions,
  issueKeyOrId: string,
): Promise<JiraIssueSummary> {
  const raw = await request<RawJiraIssueResponse>(
    options,
    'GET',
    `/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}`,
  );
  return mapIssue(options, raw);
}

export interface PostCommentInput {
  issueKeyOrId: string;
  body: string;
}

interface RawJiraCommentResponse {
  id: string;
  self?: string;
}

export async function postComment(
  options: JiraClientOptions,
  input: PostCommentInput,
): Promise<{ id: string }> {
  const payload = { body: plainTextToAdf(input.body) };
  const raw = await request<RawJiraCommentResponse>(
    options,
    'POST',
    `/rest/api/3/issue/${encodeURIComponent(input.issueKeyOrId)}/comment`,
    payload,
  );
  return { id: raw.id };
}
