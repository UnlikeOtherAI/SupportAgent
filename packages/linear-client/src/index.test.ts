import { describe, it, expect } from 'vitest';
import * as api from './index.js';

describe('linear-client public API surface', () => {
  it('exports expected functions', () => {
    expect(typeof api.getIssue).toBe('function');
    expect(typeof api.createIssue).toBe('function');
    expect(typeof api.postComment).toBe('function');
    expect(typeof api.updateIssueState).toBe('function');
    expect(typeof api.updateIssuePriority).toBe('function');
    expect(typeof api.addLabels).toBe('function');
    expect(typeof api.findStateByName).toBe('function');
    expect(typeof api.findOrCreateLabel).toBe('function');
  });
});
