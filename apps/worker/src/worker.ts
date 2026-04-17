import { type WorkerJob } from '@support-agent/contracts';
import { createWorkerApiClient } from './lib/api-client.js';
import { handleTriageJob } from './handlers/triage-handler.js';
import { handleBuildJob } from './handlers/build-handler.js';
import { handleMergeJob } from './handlers/merge-handler.js';
import { handlePrReviewJob } from './handlers/pr-review-handler.js';

const handlers: Record<string, (job: WorkerJob, api: ReturnType<typeof createWorkerApiClient>) => Promise<void>> = {
  triage: handleTriageJob,
  build: handleBuildJob,
  merge: handleMergeJob,
  review: handlePrReviewJob,
};

export async function processJob(jobPayload: WorkerJob): Promise<void> {
  const api = createWorkerApiClient(jobPayload.apiBaseUrl, jobPayload.workerSharedSecret);
  const handler = handlers[jobPayload.workflowType];
  if (!handler) {
    throw new Error(`Unknown workflow type: ${jobPayload.workflowType}`);
  }
  await handler(jobPayload, api);
}
