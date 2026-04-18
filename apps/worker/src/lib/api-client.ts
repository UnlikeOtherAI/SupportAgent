import { type FinalReport, type WorkerJob } from '@support-agent/contracts';
import { type SkillRunResult } from '@support-agent/contracts';

export interface WorkerApiClient {
  baseUrl: string;
  secret: string;
  fetchJobContext(jobId: string): Promise<WorkerJob>;
  getRunStatus(workflowRunId: string): Promise<string>;
  postProgress(jobId: string, stage: string, message: string): Promise<void>;
  postLog(jobId: string, streamType: string, message: string): Promise<void>;
  postCheckpoint(
    dispatchAttemptId: string,
    payload: {
      kind: 'stage_complete' | 'iteration_complete';
      stageId?: string;
      iteration?: number;
      payload: SkillRunResult[];
    },
  ): Promise<void>;
  uploadArtifact(jobId: string, name: string, data: Uint8Array): Promise<string>;
  submitReport(jobId: string, report: FinalReport): Promise<void>;
}

export function createWorkerApiClient(baseUrl: string, workerSharedSecret: string): WorkerApiClient {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${workerSharedSecret}`,
  };

  return {
    baseUrl,
    secret: workerSharedSecret,
    async fetchJobContext(jobId) {
      const res = await fetch(`${baseUrl}/worker/jobs/${jobId}/context`, { headers });
      if (!res.ok) throw new Error(`Failed to fetch job context: ${res.status}`);
      return res.json() as Promise<WorkerJob>;
    },
    async getRunStatus(workflowRunId) {
      const res = await fetch(`${baseUrl}/worker/jobs/run/${workflowRunId}`, { headers });
      if (!res.ok) throw new Error(`Failed to fetch run status: ${res.status}`);
      const run = await res.json() as { status?: string };
      if (!run.status) {
        throw new Error(`Run ${workflowRunId} did not include a status`);
      }
      return run.status;
    },
    async postProgress(jobId, stage, message) {
      const res = await fetch(`${baseUrl}/worker/jobs/${jobId}/progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ stage, message, timestamp: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`Failed to post progress: ${res.status}`);
    },
    async postLog(jobId, streamType, message) {
      const res = await fetch(`${baseUrl}/worker/jobs/${jobId}/logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ streamType, message, timestamp: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`Failed to post log: ${res.status}`);
    },
    async postCheckpoint(dispatchAttemptId, payload) {
      const res = await fetch(`${baseUrl}/v1/dispatch-attempts/${dispatchAttemptId}/checkpoints`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to post checkpoint: ${res.status}`);
    },
    async uploadArtifact(jobId, name, data) {
      const res = await fetch(`${baseUrl}/worker/jobs/${jobId}/artifacts`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-Artifact-Name': name },
        body: data as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`Failed to upload artifact: ${res.status}`);
      const result = await res.json() as { artifactRef: string };
      return result.artifactRef;
    },
    async submitReport(jobId, report) {
      const res = await fetch(`${baseUrl}/worker/jobs/${jobId}/report`, {
        method: 'POST',
        headers,
        body: JSON.stringify(report),
      });
      if (!res.ok) throw new Error(`Failed to submit report: ${res.status}`);
    },
  };
}
