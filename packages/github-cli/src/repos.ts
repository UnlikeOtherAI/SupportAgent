import { runArgv } from './run.js';
import type { GitHubRepositoryOption } from './types.js';
import { ghGetOrganizations, ghGetViewerLogin } from './auth.js';

export async function ghListReposForOwner(
  owner: string,
): Promise<GitHubRepositoryOption[]> {
  const out = await runArgv('gh', [
    'repo', 'list', owner,
    '--limit', '1000',
    '--source',
    '--json', 'nameWithOwner,url,defaultBranchRef,isPrivate',
  ]);
  const repositories = JSON.parse(out) as Array<{
    defaultBranchRef?: { name?: string } | null;
    isPrivate?: boolean;
    nameWithOwner: string;
    url: string;
  }>;

  return repositories.map((repository) => {
    const [repoOwner] = repository.nameWithOwner.split('/');
    return {
      nameWithOwner: repository.nameWithOwner,
      owner: repoOwner,
      url: repository.url,
      defaultBranch: repository.defaultBranchRef?.name ?? 'main',
      isPrivate: repository.isPrivate ?? false,
    };
  });
}

export async function ghCanListReposForOwner(owner: string): Promise<boolean> {
  try {
    await runArgv(
      'gh',
      ['repo', 'list', owner, '--limit', '1', '--source', '--json', 'nameWithOwner'],
      { timeoutMs: 30_000 },
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[github-cli] Skipping inaccessible owner ${owner}: ${message}`);
    return false;
  }
}

export async function ghListAccessibleRepos(
  owner?: string,
): Promise<GitHubRepositoryOption[]> {
  const owners = owner
    ? [owner]
    : [await ghGetViewerLogin(), ...(await ghGetOrganizations())];

  const repositoriesByName = new Map<string, GitHubRepositoryOption>();
  for (const currentOwner of owners) {
    let repositories: GitHubRepositoryOption[];
    try {
      repositories = await ghListReposForOwner(currentOwner);
    } catch (error) {
      if (owner) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[github-cli] Skipping inaccessible owner ${currentOwner}: ${message}`);
      continue;
    }
    for (const repository of repositories) {
      repositoriesByName.set(repository.nameWithOwner, repository);
    }
  }

  return [...repositoriesByName.values()].sort((left, right) =>
    left.nameWithOwner.localeCompare(right.nameWithOwner),
  );
}
