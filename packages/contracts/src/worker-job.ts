import { z } from 'zod';
import { WorkflowType } from './enums.js';

const ResolvedSkillManifestEntrySchema = z.object({
  name: z.string(),
  contentHash: z.string(),
});

export const WorkerJobSchema = z.object({
  jobId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  workflowType: WorkflowType,
  apiBaseUrl: z.string().url(),
  workerSharedSecret: z.string(),
  sourceConnectorKey: z.string(),
  sourcePayloadRef: z.string().optional(),
  targetRepo: z.string(),
  targetCommit: z.string().optional(),
  targetBranch: z.string().optional(),
  executionProfile: z.string(),
  reviewProfileId: z.string().uuid().optional(),
  orchestrationProfileId: z.string().uuid().optional(),
  preferredModelRouting: z.enum(['proxy', 'tenant_provider']).optional(),
  promptManifestRef: z.string().optional(),
  scenarioInstructionRef: z.string().optional(),
  reproductionPolicy: z.enum(['always', 'when_supported', 'never']).default('when_supported'),
  authRefs: z.record(z.string()).optional(),
  artifactUploadMode: z.enum(['api', 'gcs_direct']).default('api'),
  timeoutSeconds: z.number().int().default(3600),
  attachedInputRefs: z.array(z.string()).optional(),
  providerHints: z.record(z.unknown()).optional(),
  runtimeCapabilities: z.array(z.string()).optional(),
  networkRequirements: z.array(z.string()).optional(),
  executorKey: z.string().optional(),
  executorRevisionHash: z.string().optional(),
  resolvedSkillManifest: z.array(ResolvedSkillManifestEntrySchema).optional(),
});

export type WorkerJob = z.infer<typeof WorkerJobSchema>;
