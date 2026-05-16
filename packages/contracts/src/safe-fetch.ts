/**
 * SSRF-resistant fetch helper.
 *
 * Single source of truth for outbound HTTP calls whose target host is
 * operator-controlled (Jira / Respond.io baseUrl, outbound delivery
 * destinations). Designed to defeat both TOCTOU DNS-rebinding and the
 * "substring filter on hostname" trap.
 *
 * Approach:
 *   1. Parse the URL strictly and reject anything that is not https://
 *      (http:// is allowed only when explicitly opted in via options).
 *   2. Resolve the hostname ONCE up front, against the real OS resolver.
 *   3. Validate every resolved address against an explicit CIDR blocklist
 *      (private, link-local, metadata, loopback, CGNAT, IPv6 ULA, IPv4
 *      embedded in v6, etc.).
 *   4. Construct an undici `Agent` whose `connect.lookup` ALWAYS returns
 *      one of the pre-validated addresses. The HTTP request will therefore
 *      never reach an unvalidated IP, even if the OS resolver returns a
 *      different address a few ms later (DNS rebinding defeated).
 *   5. Disable HTTP redirect-following at the dispatcher level. Callers
 *      that need redirects must use `safeFetchFollowRedirects`, which
 *      re-runs the full validation loop on every hop.
 *
 * NOTE: there is exactly one implementation of this guard in the repo. Do
 * not copy/paste these checks into per-client modules.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';

export interface SafeFetchOptions {
  /** Allow plaintext http:// (default false; only enable in development). */
  allowHttp?: boolean;
  /**
   * Per-call host allowlist. Hostname must match exactly or be a subdomain
   * of one of these entries. Use this for SaaS clients (Jira: atlassian.net,
   * Respond.io: respond.io).
   */
  allowedHostSuffixes?: readonly string[];
  /** Maximum redirects to follow (default 0 = no following). */
  maxRedirects?: number;
  /** Optional fetch override for testing. */
  fetchImpl?: typeof fetch;
  /** Optional DNS resolver override for testing. */
  resolveImpl?: (hostname: string) => Promise<LookupAddress[]>;
}

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_url'
      | 'forbidden_scheme'
      | 'forbidden_host'
      | 'unresolvable'
      | 'private_address'
      | 'too_many_redirects'
      | 'redirect_invalid',
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

function normalizeAddress(address: string): string {
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) — unwrap to v4 for CIDR check.
  const v4Embedded = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Embedded) return v4Embedded[1];
  return address.toLowerCase();
}

/**
 * Returns true when the given address is in a range we must never reach.
 *
 * IPv4 blocks: 0.0.0.0/8 (this-network), 10/8, 100.64/10 (CGNAT),
 *   127/8 (loopback), 169.254/16 (link-local + metadata), 172.16/12,
 *   192.0.0/24 (IETF), 192.168/16, 198.18/15 (benchmarking),
 *   224/4 (multicast), 240/4 (reserved).
 *
 * IPv6 blocks: ::, ::1, ::ffff:0:0/96 (handled via normalization),
 *   64:ff9b::/96 (NAT64), fc00::/7 (ULA), fe80::/10 (link-local),
 *   ff00::/8 (multicast).
 */
export function isBlockedAddress(rawAddress: string): boolean {
  const address = normalizeAddress(rawAddress);
  const version = isIP(address);

  if (version === 4) {
    const octets = address.split('.').map(Number);
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = octets;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0 && octets[2] === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    if (address === '::' || address === '::1') return true;
    // ULA fc00::/7
    if (/^f[cd][0-9a-f]{2}:/i.test(address)) return true;
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/i.test(address)) return true;
    // Multicast ff00::/8
    if (address.startsWith('ff')) return true;
    // NAT64 64:ff9b::/96
    if (address.startsWith('64:ff9b:')) return true;
    return false;
  }

  // Not a valid IP literal — treat as blocked; resolver gave us something we
  // can't classify.
  return true;
}

function matchesAllowlist(hostname: string, suffixes?: readonly string[]): boolean {
  if (!suffixes || suffixes.length === 0) return true;
  const lower = hostname.toLowerCase();
  return suffixes.some((suffix) => {
    const s = suffix.toLowerCase().replace(/^\.+/, '');
    return lower === s || lower.endsWith(`.${s}`);
  });
}

interface ParsedTarget {
  url: URL;
  hostname: string;
  port: number;
  addresses: readonly LookupAddress[];
}

async function resolveAndValidate(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<ParsedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError(`Invalid URL: ${rawUrl}`, 'invalid_url');
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'https:' && !(scheme === 'http:' && options.allowHttp)) {
    throw new SafeFetchError(`Scheme not allowed: ${scheme}`, 'forbidden_scheme');
  }

  if (url.username || url.password) {
    throw new SafeFetchError('Userinfo in URL is not allowed', 'invalid_url');
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw new SafeFetchError('Missing hostname', 'invalid_url');

  if (!matchesAllowlist(hostname, options.allowedHostSuffixes)) {
    throw new SafeFetchError(`Host not in allowlist: ${hostname}`, 'forbidden_host');
  }

  // If the URL embeds a literal IP, validate directly without DNS.
  const ipVersion = isIP(hostname.replace(/^\[|\]$/g, ''));
  let addresses: LookupAddress[];
  if (ipVersion) {
    const literal = hostname.replace(/^\[|\]$/g, '');
    addresses = [{ address: literal, family: ipVersion }];
  } else {
    const resolver = options.resolveImpl ?? ((h) => dnsLookup(h, { all: true, verbatim: true }));
    try {
      addresses = await resolver(hostname);
    } catch {
      throw new SafeFetchError(`Cannot resolve ${hostname}`, 'unresolvable');
    }
    if (addresses.length === 0) {
      throw new SafeFetchError(`No DNS answer for ${hostname}`, 'unresolvable');
    }
  }

  for (const a of addresses) {
    if (isBlockedAddress(a.address)) {
      throw new SafeFetchError(
        `${hostname} resolves to a blocked address (${a.address})`,
        'private_address',
      );
    }
  }

  const port = url.port ? Number(url.port) : scheme === 'https:' ? 443 : 80;
  return { url, hostname, port, addresses };
}

function buildPinnedAgent(addresses: readonly LookupAddress[]): Agent {
  // Round-robin among the pre-validated addresses. We override the DNS
  // lookup at the socket layer so even if the OS resolver flips, the
  // connection only ever lands on an IP we have already approved.
  let cursor = 0;
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _options: unknown,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string,
          family: number,
        ) => void,
      ) => {
        const next = addresses[cursor % addresses.length];
        cursor += 1;
        callback(null, next.address, next.family);
      },
    },
  });
}

export interface SafeFetchInit extends Omit<RequestInit, 'redirect'> {
  /** Forced to 'manual' to allow per-hop validation. */
  redirect?: never;
}

/**
 * Issue a single HTTP request whose resolved address has been verified
 * against the blocklist. Redirects are NOT followed.
 */
export async function safeFetch(
  rawUrl: string,
  init: SafeFetchInit,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const target = await resolveAndValidate(rawUrl, options);
  const dispatcher = buildPinnedAgent(target.addresses);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    // The `dispatcher` option is non-standard but recognised by Node's
    // built-in undici-backed fetch. Cast through `unknown` to keep the
    // public type stable.
    return await fetchImpl(target.url.toString(), {
      ...init,
      redirect: 'manual',
      // @ts-expect-error - dispatcher is supported by Node's fetch
      dispatcher,
    });
  } finally {
    await dispatcher.close().catch(() => {});
  }
}

/**
 * Issue a request and follow up to `maxRedirects` Location hops. Each hop
 * runs the full validation pipeline; an attempt to redirect to a private
 * or otherwise-blocked address is rejected.
 */
export async function safeFetchFollowRedirects(
  rawUrl: string,
  init: SafeFetchInit,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await safeFetch(current, init, options);
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new SafeFetchError(
        `Redirect to invalid URL: ${location}`,
        'redirect_invalid',
      );
    }
    current = next.toString();
  }
  throw new SafeFetchError(
    `Too many redirects (>${maxRedirects}) starting from ${rawUrl}`,
    'too_many_redirects',
  );
}

/**
 * Lightweight validator (no fetch). Use when you only need to assert that a
 * URL is safe to hand to another component (e.g. when persisting a connector
 * baseUrl).
 */
export async function assertSafeUrl(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<void> {
  await resolveAndValidate(rawUrl, options);
}
