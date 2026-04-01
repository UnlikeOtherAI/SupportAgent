import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';

export async function handleTriageJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
  const { jobId } = job;

  await api.postProgress(jobId, 'intake', 'Received triage job');
  await api.postLog(jobId, 'stdout', `Starting triage for ${job.targetRepo}`);

  await api.postProgress(jobId, 'context_fetch', 'Fetching context');
  // TODO: Fetch full context from API

  await api.postProgress(jobId, 'repository_setup', 'Cloning repository');
  // TODO: Clone target repo

  await api.postProgress(jobId, 'investigation', 'Investigating issue');
  // TODO: Run investigation with Claude/Codex via local orchestrator

  await api.postProgress(jobId, 'findings', 'Generating findings');
  // TODO: Generate real findings

  await api.submitReport(jobId, {
    workflowRunId: job.workflowRunId,
    workflowType: 'triage',
    status: 'succeeded',
    summary: 'Triage completed (skeleton)',
    stageResults: [
      { stage: 'intake', status: 'passed' },
      { stage: 'context_fetch', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'investigation', status: 'passed' },
      { stage: 'findings', status: 'passed' },
    ],
  });

  await api.postProgress(jobId, 'delivery', 'Triage complete');
}
