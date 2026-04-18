/**
 * Respond.io REST v2 client.
 *
 * Uses raw fetch (no SDK dep). Identifier format follows the API spec:
 *   - "id:12345"          (numeric contact id)
 *   - "email:foo@bar.com" (email)
 *   - "phone:+60123456"   (E.164 phone)
 *
 * Bearer token authenticates against the entire workspace.
 */

const DEFAULT_BASE_URL = 'https://api.respond.io/v2';

export interface RespondIoClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Override fetch (testing). */
  fetchImpl?: typeof fetch;
}

export interface RespondIoContact {
  id: number;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
  countryCode: string | null;
  tags: string[];
  lifecycle: string | null;
  status: 'open' | 'close' | null;
  assignee: { id: number; firstName: string; lastName: string; email: string } | null;
  customFields: { name: string; value: string | number | boolean | null }[];
  createdAt: number;
}

export interface RespondIoMessageSummary {
  messageId: number;
  channelId: number | null;
  channelSource: string | null;
  type: string;
  text: string | null;
  traffic: 'incoming' | 'outgoing';
  senderSource: 'user' | 'api' | 'workflow' | 'ai_agent' | 'broadcast' | 'echo' | string;
  createdAt: number;
}

export interface RespondIoConversationSummary {
  contact: RespondIoContact;
  recentMessages: RespondIoMessageSummary[];
}

export class RespondIoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'RespondIoApiError';
  }
}

function buildUrl(options: RespondIoClientOptions, path: string): string {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function request<T>(
  options: RespondIoClientOptions,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildUrl(options, path);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new RespondIoApiError(
      `Respond.io ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`,
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

function normalizeIdentifier(idOrIdentifier: string | number): string {
  if (typeof idOrIdentifier === 'number') return `id:${idOrIdentifier}`;
  if (idOrIdentifier.includes(':')) return idOrIdentifier;
  if (/^\d+$/.test(idOrIdentifier)) return `id:${idOrIdentifier}`;
  if (idOrIdentifier.includes('@')) return `email:${idOrIdentifier}`;
  if (idOrIdentifier.startsWith('+')) return `phone:${idOrIdentifier}`;
  // Fallback: assume the caller already supplied a usable identifier.
  return idOrIdentifier;
}

interface RawContactResponse {
  id: number;
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  countryCode?: string | null;
  tags?: string[];
  lifecycle?: string | null;
  status?: 'open' | 'close' | null;
  assignee?: { id: number; firstName: string; lastName: string; email: string } | null;
  custom_fields?: { name: string; value: string | number | boolean | null }[] | null;
  created_at?: number;
}

function mapContact(raw: RawContactResponse): RespondIoContact {
  return {
    id: raw.id,
    firstName: raw.firstName ?? '',
    lastName: raw.lastName ?? null,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    language: raw.language ?? null,
    countryCode: raw.countryCode ?? null,
    tags: raw.tags ?? [],
    lifecycle: raw.lifecycle ?? null,
    status: raw.status ?? null,
    assignee: raw.assignee ?? null,
    customFields: raw.custom_fields ?? [],
    createdAt: raw.created_at ?? 0,
  };
}

interface RawMessageListResponse {
  items?: Array<{
    message_id: number;
    channel_id?: number | null;
    channel?: { source?: string } | null;
    type?: string;
    text?: string | null;
    traffic?: 'incoming' | 'outgoing';
    sender?: { source?: string } | null;
    timestamp?: number;
  }>;
}

export async function getContact(
  options: RespondIoClientOptions,
  idOrIdentifier: string | number,
): Promise<RespondIoContact> {
  const identifier = normalizeIdentifier(idOrIdentifier);
  const raw = await request<RawContactResponse>(options, 'GET', `/contact/${identifier}`);
  return mapContact(raw);
}

export async function listMessages(
  options: RespondIoClientOptions,
  idOrIdentifier: string | number,
  limit = 20,
): Promise<RespondIoMessageSummary[]> {
  const identifier = normalizeIdentifier(idOrIdentifier);
  const raw = await request<RawMessageListResponse>(
    options,
    'GET',
    `/contact/${identifier}/message/list?limit=${Math.min(Math.max(limit, 1), 100)}`,
  );
  return (raw.items ?? []).map((m) => ({
    messageId: m.message_id,
    channelId: m.channel_id ?? null,
    channelSource: m.channel?.source ?? null,
    type: m.type ?? 'text',
    text: m.text ?? null,
    traffic: m.traffic ?? 'incoming',
    senderSource: m.sender?.source ?? 'user',
    createdAt: m.timestamp ?? 0,
  }));
}

export async function getConversationSummary(
  options: RespondIoClientOptions,
  idOrIdentifier: string | number,
  recentMessageLimit = 20,
): Promise<RespondIoConversationSummary> {
  const [contact, recentMessages] = await Promise.all([
    getContact(options, idOrIdentifier),
    listMessages(options, idOrIdentifier, recentMessageLimit),
  ]);
  return { contact, recentMessages };
}

export interface PostCommentInput {
  /** Numeric contact id, e-mail, phone, or already-formed identifier ("id:123"). */
  contact: string | number;
  text: string;
}

export async function postComment(
  options: RespondIoClientOptions,
  input: PostCommentInput,
): Promise<{ commentId?: number }> {
  const identifier = normalizeIdentifier(input.contact);
  return request<{ commentId?: number }>(
    options,
    'POST',
    `/contact/${identifier}/comment`,
    { text: input.text },
  );
}

export interface SendMessageInput {
  contact: string | number;
  text: string;
  channelId?: number;
}

export async function sendTextMessage(
  options: RespondIoClientOptions,
  input: SendMessageInput,
): Promise<{ messageId: number }> {
  const identifier = normalizeIdentifier(input.contact);
  return request<{ messageId: number }>(options, 'POST', `/contact/${identifier}/message`, {
    channelId: input.channelId,
    message: { type: 'text', text: input.text },
  });
}

export interface AddTagsInput {
  contact: string | number;
  tags: string[];
}

export async function addTags(
  options: RespondIoClientOptions,
  input: AddTagsInput,
): Promise<void> {
  const identifier = normalizeIdentifier(input.contact);
  await request(options, 'POST', `/contact/${identifier}/tag`, input.tags);
}

export interface UpdateConversationStatusInput {
  contact: string | number;
  status: 'open' | 'close';
  category?: string;
  summary?: string;
}

export async function updateConversationStatus(
  options: RespondIoClientOptions,
  input: UpdateConversationStatusInput,
): Promise<void> {
  const identifier = normalizeIdentifier(input.contact);
  await request(options, 'POST', `/contact/${identifier}/conversation/status`, {
    status: input.status,
    category: input.category,
    summary: input.summary,
  });
}

export { normalizeIdentifier };
