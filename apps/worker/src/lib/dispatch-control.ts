import type { ChildProcess } from 'node:child_process';

type CancelMode = 'requested' | 'force';

const cancelModes = new Map<string, CancelMode>();
const abortControllers = new Map<string, AbortController>();
const activeChildren = new Map<string, Set<ChildProcess>>();

const FORCE_KILL_DELAY_MS = 5_000;

function getChildren(dispatchAttemptId: string): Set<ChildProcess> {
  let children = activeChildren.get(dispatchAttemptId);
  if (!children) {
    children = new Set();
    activeChildren.set(dispatchAttemptId, children);
  }

  return children;
}

function terminateChildProcess(child: ChildProcess): void {
  if (child.killed) {
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, FORCE_KILL_DELAY_MS).unref();
}

export function registerDispatchAbortController(
  dispatchAttemptId: string,
  controller: AbortController,
): void {
  abortControllers.set(dispatchAttemptId, controller);
}

export function clearDispatchAbortController(dispatchAttemptId: string): void {
  abortControllers.delete(dispatchAttemptId);
}

export function registerActiveChildProcess(
  dispatchAttemptId: string,
  child: ChildProcess,
): void {
  const children = getChildren(dispatchAttemptId);
  children.add(child);

  const cleanup = () => {
    children.delete(child);
    if (children.size === 0) {
      activeChildren.delete(dispatchAttemptId);
    }
  };

  child.once('exit', cleanup);
  child.once('error', cleanup);

  if (cancelModes.get(dispatchAttemptId) === 'force') {
    terminateChildProcess(child);
  }
}

export function requestDispatchCancel(dispatchAttemptId: string, mode: CancelMode): void {
  const currentMode = cancelModes.get(dispatchAttemptId);
  if (currentMode === 'force' || currentMode === mode) {
    return;
  }

  cancelModes.set(dispatchAttemptId, mode);

  if (mode === 'force') {
    abortControllers.get(dispatchAttemptId)?.abort(new Error(`Force cancel requested for ${dispatchAttemptId}`));
    for (const child of activeChildren.get(dispatchAttemptId) ?? []) {
      terminateChildProcess(child);
    }
  }
}

export function isDispatchCancelRequested(dispatchAttemptId: string): boolean {
  return cancelModes.has(dispatchAttemptId);
}

export function isDispatchForceCanceled(dispatchAttemptId: string): boolean {
  return cancelModes.get(dispatchAttemptId) === 'force';
}

export function clearDispatchControl(dispatchAttemptId: string): void {
  cancelModes.delete(dispatchAttemptId);
  abortControllers.delete(dispatchAttemptId);
  activeChildren.delete(dispatchAttemptId);
}
