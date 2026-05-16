import { runArgv } from './run.js';
import { DEFAULT_LABEL_COLOR, LABEL_DEFINITIONS } from './types.js';

export async function ghAddIssueLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
): Promise<void> {
  if (!labels.length) {
    return;
  }

  for (const label of labels) {
    const definition = LABEL_DEFINITIONS[label] ?? {
      color: DEFAULT_LABEL_COLOR,
      description: 'Managed by SupportAgent',
    };

    await runArgv('gh', [
      'label', 'create', label,
      '--repo', `${owner}/${repo}`,
      '--force',
      '--color', definition.color,
      '--description', definition.description,
    ]);
  }

  await runArgv('gh', [
    'issue', 'edit', String(issueNumber),
    '--repo', `${owner}/${repo}`,
    '--add-label', labels.join(','),
  ]);
}

export async function ghEditIssueLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  options: { add?: string[]; remove?: string[] },
): Promise<void> {
  if (options.add?.length) {
    await ghAddIssueLabels(owner, repo, issueNumber, options.add);
  }

  if (options.remove?.length) {
    await runArgv('gh', [
      'issue', 'edit', String(issueNumber),
      '--repo', `${owner}/${repo}`,
      '--remove-label', options.remove.join(','),
    ]);
  }
}
