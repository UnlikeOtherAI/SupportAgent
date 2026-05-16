import { describe, expect, it } from 'vitest';
import type { LookupAddress } from 'node:dns';
import {
  assertSafeUrl,
  isBlockedAddress,
  safeFetchFollowRedirects,
  SafeFetchError,
} from './safe-fetch.js';

const stubResolve = (addresses: LookupAddress[]) => async () => addresses;

describe('isBlockedAddress', () => {
  it('blocks IPv4 metadata, link-local, loopback, private', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('100.64.1.1')).toBe(true); // CGNAT
    expect(isBlockedAddress('224.0.0.1')).toBe(true); // multicast
  });

  it('blocks IPv6 loopback / ULA / link-local / multicast', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('ff02::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 to a private v4 range', () => {
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700::1')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('rejects non-https schemes by default', async () => {
    await expect(
      assertSafeUrl('http://example.com', {
        resolveImpl: stubResolve([{ address: '1.1.1.1', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'forbidden_scheme' });
    await expect(
      assertSafeUrl('file:///etc/passwd', {
        resolveImpl: stubResolve([{ address: '1.1.1.1', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'forbidden_scheme' });
  });

  it('rejects URLs with userinfo', async () => {
    await expect(
      assertSafeUrl('https://attacker@example.com', {
        resolveImpl: stubResolve([{ address: '1.1.1.1', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'invalid_url' });
  });

  it('rejects when DNS resolves to a private address', async () => {
    await expect(
      assertSafeUrl('https://evil.example.com', {
        resolveImpl: stubResolve([{ address: '169.254.169.254', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'private_address' });
  });

  it('rejects when any resolved address is private (mixed answer)', async () => {
    await expect(
      assertSafeUrl('https://evil.example.com', {
        resolveImpl: stubResolve([
          { address: '1.1.1.1', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'private_address' });
  });

  it('accepts a public address', async () => {
    await expect(
      assertSafeUrl('https://example.com', {
        resolveImpl: stubResolve([{ address: '93.184.216.34', family: 4 }]),
      }),
    ).resolves.toBeUndefined();
  });

  it('enforces host allowlist when supplied', async () => {
    await expect(
      assertSafeUrl('https://evil.example.com', {
        allowedHostSuffixes: ['atlassian.net'],
        resolveImpl: stubResolve([{ address: '1.1.1.1', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'forbidden_host' });

    await expect(
      assertSafeUrl('https://tenant.atlassian.net', {
        allowedHostSuffixes: ['atlassian.net'],
        resolveImpl: stubResolve([{ address: '1.1.1.1', family: 4 }]),
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks IP-literal URLs that point at metadata', async () => {
    await expect(
      assertSafeUrl('https://169.254.169.254/latest/meta-data/', {}),
    ).rejects.toMatchObject({ code: 'private_address' });
  });

  it('rejects "metadata.google.internal" via IP check, not substring', async () => {
    // Hostname contains neither "metadata" nor "internal" but resolves to the
    // metadata IP. The substring-on-hostname filter would miss this; the IP
    // check catches it.
    await expect(
      assertSafeUrl('https://innocent-name.example', {
        resolveImpl: stubResolve([{ address: '169.254.169.254', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'private_address' });
  });
});

describe('safeFetchFollowRedirects', () => {
  it('rejects when a redirect points at a private address', async () => {
    // The first call (to example.com) returns a 302 → http://internal/.
    // The second call must be re-validated and refused.
    const fetchImpl = (async (input: string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://public.example.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example' },
        });
      }
      // safeFetch should never let us reach here for attacker.example
      return new Response('leaked');
    }) as unknown as typeof fetch;

    const resolveImpl = async (hostname: string): Promise<LookupAddress[]> => {
      if (hostname === 'public.example.com') {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      if (hostname === 'attacker.example') {
        // DNS-rebinding: first response was public, second points internal.
        return [{ address: '169.254.169.254', family: 4 }];
      }
      throw new Error('unknown host');
    };

    await expect(
      safeFetchFollowRedirects(
        'https://public.example.com',
        { method: 'GET' },
        { fetchImpl, resolveImpl, maxRedirects: 3 },
      ),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('returns the final non-redirect response when redirects are clean', async () => {
    const fetchImpl = (async (input: string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://a.example')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://b.example' },
        });
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const resolveImpl = async (): Promise<LookupAddress[]> => [
      { address: '1.1.1.1', family: 4 },
    ];

    const res = await safeFetchFollowRedirects(
      'https://a.example',
      { method: 'GET' },
      { fetchImpl, resolveImpl, maxRedirects: 3 },
    );
    expect(res.status).toBe(200);
  });
});
