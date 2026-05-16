/**
 * Strict validator for `repositoryUrl` fields that flow into a `git clone`
 * subprocess. Combined with the sibling shell-injection migration (which
 * removes the shell hop from worker git invocations), this is defense in
 * depth: even if a future regression reintroduces a shell hop, the URL
 * cannot carry shell metacharacters past this point.
 *
 * Allowed shapes:
 *   - https://<host>/<owner>/<repo>(.git)?
 *   - ssh://git@<host>/<owner>/<repo>(.git)?
 *   - git@<host>:<owner>/<repo>(.git)?   (scp-style ssh)
 *
 * Allowed hosts come from a small allowlist of public code-hosting
 * providers, plus any enterprise hosts supplied via env at startup
 * (`REPOSITORY_URL_ALLOWED_HOSTS=git.acme.example,gh.acme.example`).
 */

import { z } from 'zod';

const DEFAULT_HOSTS: readonly string[] = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
];

// Percent-encodings of shell-meaningful characters. We refuse any of these
// in the raw string — there is no legitimate need for them in a code-host
// URL, and they are the standard bypass for any naive character filter.
const PERCENT_ENCODED_METACHARS = [
  '%20', '%09', '%0a', '%0d', // whitespace
  '%24', // $
  '%26', // &
  '%27', // '
  '%28', '%29', // ( )
  '%3b', // ;
  '%3c', '%3e', // < >
  '%5c', // backslash
  '%60', // backtick
  '%7c', // |
];

// Raw shell metacharacters. A code-host URL never legitimately contains
// these (the GitHub/GitLab path is `[A-Za-z0-9._/-]+`).
const SHELL_METACHARS = /[\s;&|<>(){}$`\\'"!*?#\u0000-\u001f]/;

const SAFE_OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;

function allowedHosts(): readonly string[] {
  const fromEnv = process.env.REPOSITORY_URL_ALLOWED_HOSTS;
  if (!fromEnv) return DEFAULT_HOSTS;
  const extra = fromEnv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9.-]+$/.test(s));
  return Array.from(new Set([...DEFAULT_HOSTS, ...extra]));
}

function hostMatches(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return allowedHosts().some((h) => lower === h || lower.endsWith(`.${h}`));
}

function refuseMetacharacters(value: string): void {
  if (SHELL_METACHARS.test(value)) {
    throw new Error('repositoryUrl contains forbidden characters');
  }
  const lower = value.toLowerCase();
  for (const encoded of PERCENT_ENCODED_METACHARS) {
    if (lower.includes(encoded)) {
      throw new Error('repositoryUrl contains percent-encoded forbidden characters');
    }
  }
}

function parseScpStyle(value: string): { host: string; ownerRepo: string } | null {
  // git@github.com:owner/repo.git
  const m = value.match(/^git@([A-Za-z0-9.-]+):([A-Za-z0-9._/-]+)$/);
  if (!m) return null;
  return { host: m[1], ownerRepo: m[2] };
}

export function validateRepositoryUrl(rawInput: string): string {
  const value = rawInput.trim();
  if (!value) throw new Error('repositoryUrl is required');
  refuseMetacharacters(value);

  const scp = parseScpStyle(value);
  if (scp) {
    if (!hostMatches(scp.host)) {
      throw new Error(`repositoryUrl host not in allowlist: ${scp.host}`);
    }
    if (!SAFE_OWNER_REPO.test(scp.ownerRepo)) {
      throw new Error('repositoryUrl owner/repo path is not valid');
    }
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('repositoryUrl is not a valid URL');
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'ssh:') {
    throw new Error(`repositoryUrl scheme not allowed: ${scheme}`);
  }

  if (parsed.username && parsed.username !== 'git') {
    throw new Error('repositoryUrl userinfo is not allowed');
  }
  if (parsed.password) {
    throw new Error('repositoryUrl password is not allowed');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('repositoryUrl must not include a query string or fragment');
  }

  if (!hostMatches(parsed.hostname)) {
    throw new Error(`repositoryUrl host not in allowlist: ${parsed.hostname}`);
  }

  // Strip the leading "/" and validate the path is a clean owner/repo.
  const path = parsed.pathname.replace(/^\/+/, '');
  if (!SAFE_OWNER_REPO.test(path)) {
    throw new Error('repositoryUrl path must be <owner>/<repo>(.git)?');
  }

  return value;
}

/**
 * Zod helper. Refuse unknown URL shapes early, surface a clear Zod error to
 * the API client.
 */
export const RepositoryUrlSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, ctx) => {
    try {
      validateRepositoryUrl(value);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : 'invalid repositoryUrl',
      });
    }
  });
