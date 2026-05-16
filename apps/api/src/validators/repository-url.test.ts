import { describe, expect, it } from 'vitest';
import { validateRepositoryUrl, RepositoryUrlSchema } from './repository-url.js';

describe('validateRepositoryUrl', () => {
  it('accepts canonical https://github.com URLs', () => {
    expect(validateRepositoryUrl('https://github.com/test-org/test-repo')).toBe(
      'https://github.com/test-org/test-repo',
    );
    expect(validateRepositoryUrl('https://github.com/test-org/test-repo.git')).toBe(
      'https://github.com/test-org/test-repo.git',
    );
  });

  it('accepts ssh://git@github.com URLs', () => {
    expect(validateRepositoryUrl('ssh://git@github.com/foo/bar.git')).toBe(
      'ssh://git@github.com/foo/bar.git',
    );
  });

  it('accepts scp-style git@github.com:owner/repo', () => {
    expect(validateRepositoryUrl('git@github.com:foo/bar.git')).toBe('git@github.com:foo/bar.git');
  });

  it('accepts gitlab.com and bitbucket.org', () => {
    expect(validateRepositoryUrl('https://gitlab.com/owner/repo')).toBeTruthy();
    expect(validateRepositoryUrl('https://bitbucket.org/owner/repo')).toBeTruthy();
  });

  it('rejects unsupported schemes', () => {
    expect(() => validateRepositoryUrl('http://github.com/foo/bar')).toThrow(/scheme/);
    expect(() => validateRepositoryUrl('file:///etc/passwd')).toThrow();
    expect(() => validateRepositoryUrl('javascript:alert(1)')).toThrow();
  });

  it('rejects hosts not in the allowlist', () => {
    expect(() => validateRepositoryUrl('https://evil.example.com/foo/bar')).toThrow(/allowlist/);
  });

  it('rejects shell metacharacters', () => {
    expect(() => validateRepositoryUrl('https://github.com/foo/bar;rm -rf /')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar`whoami`')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar$(id)')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar|cat')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar\nrm')).toThrow();
    expect(() => validateRepositoryUrl('git@github.com:foo/bar.git;rm')).toThrow();
  });

  it('rejects percent-encoded shell metacharacters', () => {
    expect(() => validateRepositoryUrl('https://github.com/foo/bar%20%3brm')).toThrow(
      /percent-encoded/,
    );
    expect(() => validateRepositoryUrl('https://github.com/foo/bar%60whoami%60')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar%24%28id%29')).toThrow();
  });

  it('rejects userinfo other than git', () => {
    expect(() => validateRepositoryUrl('https://attacker@github.com/foo/bar')).toThrow(
      /userinfo/,
    );
    expect(() => validateRepositoryUrl('https://x:y@github.com/foo/bar')).toThrow();
  });

  it('rejects query strings and fragments', () => {
    expect(() => validateRepositoryUrl('https://github.com/foo/bar?x=1')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar#x')).toThrow();
  });

  it('rejects paths that are not owner/repo', () => {
    expect(() => validateRepositoryUrl('https://github.com/foo')).toThrow(/owner/);
    expect(() => validateRepositoryUrl('https://github.com/foo/bar/baz')).toThrow();
  });

  it('rejects paths with invalid characters that survive URL normalization', () => {
    // URL parser normalizes ".." segments, but a literal "@" or ":" survives.
    expect(() => validateRepositoryUrl('https://github.com/foo/bar@evil')).toThrow();
    expect(() => validateRepositoryUrl('https://github.com/foo/bar:branch')).toThrow();
  });
});

describe('RepositoryUrlSchema (zod)', () => {
  it('parses a clean URL', () => {
    expect(RepositoryUrlSchema.parse('https://github.com/foo/bar')).toBe(
      'https://github.com/foo/bar',
    );
  });

  it('produces a zod issue for a metacharacter URL', () => {
    const result = RepositoryUrlSchema.safeParse('https://github.com/foo/bar;rm');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/forbidden/);
    }
  });
});
