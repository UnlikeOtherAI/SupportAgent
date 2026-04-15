interface BuildPromptInput {
  owner: string;
  repo: string;
  targetBranch: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  triageSummary: string;
}

export function buildBuildPrompt({
  owner,
  repo,
  targetBranch,
  issueNumber,
  issueTitle,
  issueBody,
  triageSummary,
}: BuildPromptInput): string {
  return `You are a senior software engineer implementing the requested change for a GitHub issue.

Repository: ${owner}/${repo}
Target Branch: ${targetBranch || 'main'}
Issue #${issueNumber}: ${issueTitle || '(untitled issue)'}
Issue Description:
${issueBody || '(no description)'}

Triage Summary:
${triageSummary || '(no triage summary provided; inspect the repository and infer the required change from the issue context)'}

Your task:
1. Inspect the repository to understand the relevant code paths before changing anything.
2. Implement the requested change with the smallest correct edit.
3. Update or add the relevant tests for the new behavior and regressions.
4. Run the most appropriate test command for the changed area using the repository's existing tooling.
5. Verify the change passes the relevant tests before you finish.

Keep the solution generic, maintainable, and grounded in the issue plus triage context. Do not assume a specific language, file name, or bug shape.

After making changes, output a brief summary.

Format your response as:
## Changes Made
[What files you modified and what you changed]

## Verification
[The test command you ran and the important result]`;
}
