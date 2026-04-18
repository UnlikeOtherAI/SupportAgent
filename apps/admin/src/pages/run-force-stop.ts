import type { WorkflowRun } from '@/api/runs'

const FORCE_STOP_DELAY_MS = 30_000

export function isForceStopEnabled(run: WorkflowRun, now = Date.now()) {
  if (
    run.status !== 'cancel_requested'
    || !run.cancelRequestedAt
    || !!run.cancelForceRequestedAt
  ) {
    return false
  }

  return now - new Date(run.cancelRequestedAt).getTime() >= FORCE_STOP_DELAY_MS
}
