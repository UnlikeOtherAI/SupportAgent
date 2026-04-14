export interface ProviderSelectionInput {
  workflowType: string;
  executionProfileKey?: string;
  os?: string;
  browserRequired?: boolean;
  androidRequired?: boolean;
  macRequired?: boolean;
}

export interface WorkerDispatchJob {
  jobId: string;
  workflowRunId: string;
  workflowType: string;
  apiBaseUrl: string;
  workerSharedSecret: string;
  sourceConnectorKey: string;
  targetRepo: string;
  targetBranch: string;
  executionProfile: string;
  timeoutSeconds: number;
  /** Extra context for the worker: issue numbers, PR refs, parent run IDs, etc. */
  providerHints?: Record<string, unknown>;
}

export interface ProviderDispatchResult {
  providerJobId: string;
  providerExecutionUrl?: string;
  providerHost?: string;
  startedAt: Date;
}

export interface ProviderJobStatus {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExecutionProvider {
  key: string;
  supports(input: ProviderSelectionInput): Promise<boolean>;
  dispatch(job: WorkerDispatchJob): Promise<ProviderDispatchResult>;
  getStatus(providerJobId: string): Promise<ProviderJobStatus>;
  cancel(providerJobId: string): Promise<void>;
}

/**
 * Local host provider — dispatches to the local BullMQ queue
 * for the worker process to pick up. Used in development.
 */
export function createLocalHostProvider(
  enqueue: (queueName: string, payload: unknown) => Promise<string>,
): ExecutionProvider {
  return {
    key: 'local-host',

    async supports(_input) {
      return true; // Local host supports everything in dev
    },

    async dispatch(job) {
      const providerJobId = await enqueue('workflow-jobs', job);
      return {
        providerJobId,
        providerHost: 'localhost',
        startedAt: new Date(),
      };
    },

    async getStatus(_providerJobId) {
      // In local mode, status comes from the worker via API callbacks
      return { status: 'running' };
    },

    async cancel(_providerJobId) {
      // TODO: BullMQ job cancellation
    },
  };
}
