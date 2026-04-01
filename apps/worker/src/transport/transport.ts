import { type WorkerJob } from '@support-agent/contracts';

export interface JobTransport {
  start(handler: (job: WorkerJob) => Promise<void>): void;
  stop(): Promise<void>;
}
