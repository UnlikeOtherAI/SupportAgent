import { describe, it, expect } from 'vitest';
import { matchesPrCommentTrigger } from './trigger-matchers.js';

function makeScenario(config: Record<string, unknown>) {
  return {
    trigger: {
      kind: 'github.pull_request.comment' as const,
      config,
    },
  };
}

describe('matchesPrCommentTrigger', () => {
  it('matches when keyword is present and no botName is configured', () => {
    const scenario = makeScenario({ keyword: '/sa review' });
    expect(matchesPrCommentTrigger(scenario, { body: 'please /sa review this', author: 'alice' })).toBe(true);
  });

  it('matches any author when botName is not configured', () => {
    const scenario = makeScenario({ keyword: '/sa review' });
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'random-bot' })).toBe(true);
  });

  it('matches when keyword is present and author matches botName (case-insensitive)', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'SupportAgent' });
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'supportagent' })).toBe(true);
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'SUPPORTAGENT' })).toBe(true);
  });

  it('does not match when keyword is present but author does not match botName', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'SupportAgent' });
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'alice' })).toBe(false);
  });

  it('does not match when keyword is missing from body', () => {
    const scenario = makeScenario({ keyword: '/sa review' });
    expect(matchesPrCommentTrigger(scenario, { body: 'looks good to me', author: 'alice' })).toBe(false);
  });

  it('does not match when keyword is not configured', () => {
    const scenario = makeScenario({});
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'alice' })).toBe(false);
  });

  it('does not match when trigger kind is not github.pull_request.comment', () => {
    const scenario = {
      trigger: {
        kind: 'github.issue.opened' as string,
        config: { keyword: '/sa review' },
      },
    };
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'alice' })).toBe(false);
  });
});
