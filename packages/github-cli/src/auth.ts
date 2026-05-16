import { runArgv } from './run.js';
import type { GitHubRepositoryOwnerOption } from './types.js';
import { ghCanListReposForOwner } from './repos.js';

export async function ghGetViewerLogin(): Promise<string> {
  return runArgv('gh', ['api', '/user', '--jq', '.login']);
}

export async function ghGetAuthenticatedLogin(): Promise<string> {
  return ghGetViewerLogin();
}

export async function ghGetOrganizations(): Promise<string[]> {
  const result = await runArgv('gh', ['api', '/user/orgs', '--jq', '.[].login']);
  return result
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function ghCheckAuth(): Promise<boolean> {
  try {
    await runArgv('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

export async function ghListAccessibleOwners(): Promise<GitHubRepositoryOwnerOption[]> {
  const viewer = await ghGetViewerLogin();
  const organizations = await ghGetOrganizations();
  const owners: GitHubRepositoryOwnerOption[] = [
    { login: viewer, type: 'user' },
    ...organizations.map((login): GitHubRepositoryOwnerOption => ({
      login,
      type: 'organization',
    })),
  ];
  const accessChecks = await Promise.all(
    owners.map(async (owner) => ({
      ...owner,
      canListRepos: await ghCanListReposForOwner(owner.login),
    })),
  );

  return accessChecks
    .filter((owner) => owner.canListRepos)
    .map((owner) => ({ login: owner.login, type: owner.type }))
    .sort((left, right) => left.login.localeCompare(right.login));
}
