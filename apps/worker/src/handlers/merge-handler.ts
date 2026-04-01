import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';

export async function handleMergeJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
  const { jobId } = job;

  await api.postProgress(jobId, 'context_fetch', 'Fetching merge context');
  await api.postProgress(jobId, 'repository_setup', 'Setting up repository');
  await api.postProgress(jobId, 'base_sync', 'Syncing with base branch');
  await api.postProgress(jobId, 'conflict_resolution', 'Checking for conflicts');
  await api.postProgress(jobId, 'validation', 'Running validation');

  await api.submitReport(jobId, {
    workflowRunId: job.workflowRunId,
    workflowType: 'merge',
    status: 'succeeded',
    summary: 'Merge completed (skeleton)',
    stageResults: [
      { stage: 'context_fetch', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'base_sync', status: 'passed' },
      { stage: 'conflict_resolution', status: 'passed' },
      { stage: 'validation', status: 'passed' },
    ],
  });
}
