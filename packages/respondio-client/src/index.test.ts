import { describe, expect, it, vi } from 'vitest';
import {
  RespondIoApiError,
  addTags,
  getContact,
  getConversationSummary,
  listMessages,
  normalizeIdentifier,
  postComment,
  sendTextMessage,
  updateConversationStatus,
} from './index.js';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

const stubResolve = async () => [
  { address: '93.184.216.34', family: 4 as const },
];

describe('normalizeIdentifier', () => {
  it('passes through identifiers that already have a prefix', () => {
    expect(normalizeIdentifier('id:42')).toBe('id:42');
    expect(normalizeIdentifier('email:foo@bar.com')).toBe('email:foo@bar.com');
    expect(normalizeIdentifier('phone:+60123456')).toBe('phone:+60123456');
  });
  it('coerces numbers and bare numeric strings to id:', () => {
    expect(normalizeIdentifier(99)).toBe('id:99');
    expect(normalizeIdentifier('99')).toBe('id:99');
  });
  it('detects email and phone shapes', () => {
    expect(normalizeIdentifier('foo@bar.com')).toBe('email:foo@bar.com');
    expect(normalizeIdentifier('+60123456')).toBe('phone:+60123456');
  });
});

describe('respondio-client', () => {
  it('getContact maps the raw response to the public shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 12345,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        tags: ['vip'],
        custom_fields: [{ name: 'company', value: 'Acme' }],
        created_at: 1700000000,
      }),
    );
    const contact = await getContact({ apiKey: 'k', fetchImpl, resolveImpl: stubResolve }, 12345);
    expect(contact.id).toBe(12345);
    expect(contact.firstName).toBe('John');
    expect(contact.tags).toEqual(['vip']);
    expect(contact.customFields).toEqual([{ name: 'company', value: 'Acme' }]);

    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toBe('https://api.respond.io/v2/contact/id:12345');
    expect(call[1].method).toBe('GET');
    expect(call[1].headers.Authorization).toBe('Bearer k');
  });

  it('postComment posts the text payload to /comment', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ commentId: 7 }));
    const result = await postComment(
      { apiKey: 'k', fetchImpl, resolveImpl: stubResolve },
      { contact: 12345, text: 'internal note' },
    );
    expect(result.commentId).toBe(7);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.respond.io/v2/contact/id:12345/comment');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'internal note' });
  });

  it('sendTextMessage posts a message body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messageId: 99 }));
    await sendTextMessage(
      { apiKey: 'k', fetchImpl, resolveImpl: stubResolve },
      { contact: 'id:5', text: 'hello', channelId: 8 },
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      channelId: 8,
      message: { type: 'text', text: 'hello' },
    });
  });

  it('listMessages caps limit between 1 and 100', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await listMessages({ apiKey: 'k', fetchImpl, resolveImpl: stubResolve }, 5, 500);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('limit=100');
  });

  it('addTags posts an array of strings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null));
    await addTags({ apiKey: 'k', fetchImpl, resolveImpl: stubResolve }, { contact: 5, tags: ['triaged'] });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(['triaged']);
  });

  it('updateConversationStatus forwards close + category + summary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null));
    await updateConversationStatus(
      { apiKey: 'k', fetchImpl, resolveImpl: stubResolve },
      { contact: 5, status: 'close', category: 'Resolved', summary: 'fixed' },
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      status: 'close',
      category: 'Resolved',
      summary: 'fixed',
    });
  });

  it('getConversationSummary calls both endpoints in parallel', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/message/list?limit=10')) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }
      return Promise.resolve(
        jsonResponse({ id: 5, firstName: 'A', tags: [], custom_fields: [], created_at: 1 }),
      );
    });
    const summary = await getConversationSummary({ apiKey: 'k', fetchImpl, resolveImpl: stubResolve }, 5, 10);
    expect(summary.contact.id).toBe(5);
    expect(summary.recentMessages).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws RespondIoApiError on non-2xx', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('nope', { status: 401 })));
    const err = await getContact({ apiKey: 'k', fetchImpl, resolveImpl: stubResolve }, 1).catch((e) => e);
    expect(err).toBeInstanceOf(RespondIoApiError);
    expect(err.status).toBe(401);
    expect(err.body).toBe('nope');
  });
});
