import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';

export async function handleBuildJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
  const { jobId } = job;

  await api.postProgress(jobId, 'context_fetch', 'Fetching build context');
  await api.postProgress(jobId, 'repository_setup', 'Setting up repository');
  await api.postProgress(jobId, 'implementation', 'Implementing changes');
  await api.postProgress(jobId, 'validation', 'Validating changes');

  await api.submitReport(jobId, {
    workflowRunId: job.workflowRunId,
    workflowType: 'build',
    status: 'succeeded',
    summary: 'Build completed (skeleton)',
    stageResults: [
      { stage: 'context_fetch', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'implementation', status: 'passed' },
      { stage: 'validation', status: 'passed' },
    ],
  });
}
