import { z } from 'zod';

export const GitHubAuthModeSchema = z.enum(['oauth', 'token', 'local_gh']);

export const GitHubConnectorConfigSchema = z.object({
  auth_mode: GitHubAuthModeSchema.optional(),
  repo_name: z.string().min(1).optional(),
  repo_owner: z.string().min(1).optional(),
});

export type GitHubAuthMode = z.infer<typeof GitHubAuthModeSchema>;
export type GitHubConnectorConfig = z.infer<typeof GitHubConnectorConfigSchema>;
