import type { WorkerJob } from '@support-agent/contracts';
import type { createWorkerApiClient } from '../lib/api-client.js';

export async function handleSkillJob(
  _job: WorkerJob,
  _api: ReturnType<typeof createWorkerApiClient>,
): Promise<void> {
  // TODO(B.5): replace this stub with the skill-driven executor pipeline.
  throw new Error('skill handler not implemented');
}
