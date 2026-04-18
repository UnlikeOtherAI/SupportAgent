import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDispatchControl,
  registerActiveChildProcess,
  requestDispatchCancel,
} from './dispatch-control.js';

describe('dispatch-control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDispatchControl('dispatch-1');
  });

  afterEach(() => {
    clearDispatchControl('dispatch-1');
    vi.useRealTimers();
  });

  it('sends SIGTERM immediately and SIGKILL after the timeout for force cancels', () => {
    const child = {
      killed: false,
      kill: vi.fn((signal: string) => {
        if (signal === 'SIGKILL') {
          child.killed = true;
        }
      }),
      once: vi.fn(),
    };

    registerActiveChildProcess('dispatch-1', child as never);
    requestDispatchCancel('dispatch-1', 'force');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    vi.advanceTimersByTime(5_000);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
