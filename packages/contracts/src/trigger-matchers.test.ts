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

const defaultInput = { body: '', author: 'alice' };

describe('matchesPrCommentTrigger', () => {
  it('returns false when trigger kind is not github.pull_request.comment', () => {
    const scenario = {
      trigger: { kind: 'github.issue.opened' as string, config: { keyword: '/sa review' } },
    };
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'alice' })).toBe(false);
  });

  it('returns false when keyword is empty', () => {
    const scenario = makeScenario({ keyword: '' });
    expect(matchesPrCommentTrigger(scenario, { body: 'anything', author: 'alice' })).toBe(false);
  });

  it('returns false when keyword config is absent', () => {
    const scenario = makeScenario({});
    expect(matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'alice' })).toBe(false);
  });

  it('returns true when keyword is present as a word-boundary token', () => {
    const scenario = makeScenario({ keyword: '/sa review' });
    expect(
      matchesPrCommentTrigger(scenario, { body: 'hey /sa review please', author: 'alice' }),
    ).toBe(true);
  });

  it('returns false when keyword appears only as a substring inside another word', () => {
    // "/sa review" is a prefix of "/sa reviewbot" — no trailing word boundary after "review"
    const scenario = makeScenario({ keyword: '/sa review' });
    expect(
      matchesPrCommentTrigger(scenario, { body: 'do not /sa reviewbot here', author: 'alice' }),
    ).toBe(false);
  });

  it('does not throw and matches literally when keyword contains regex meta-characters', () => {
    const scenario = makeScenario({ keyword: 'deploy.now' });
    expect(
      matchesPrCommentTrigger(scenario, { body: 'please deploy.now', author: 'alice' }),
    ).toBe(true);
    // The dot must match literally, not as a wildcard
    expect(
      matchesPrCommentTrigger(scenario, { body: 'please deploynow', author: 'alice' }),
    ).toBe(false);
  });

  it('matches when botName is empty regardless of body mention', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: '' });
    expect(
      matchesPrCommentTrigger(scenario, { body: '/sa review no mention here', author: 'alice' }),
    ).toBe(true);
  });

  it('matches when botName is set and body contains @botName case-insensitively', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'BotName' });
    expect(
      matchesPrCommentTrigger(scenario, {
        body: '/sa review hey @botname please look',
        author: 'alice',
      }),
    ).toBe(true);
  });

  it('returns false when botName is set but body does not contain @botName', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'SupportAgent' });
    expect(
      matchesPrCommentTrigger(scenario, { body: '/sa review', author: 'alice' }),
    ).toBe(false);
  });

  it('returns false when body contains botName without @ prefix', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'supportagentbot' });
    expect(
      matchesPrCommentTrigger(scenario, {
        body: '/sa review supportagentbot please',
        author: 'alice',
      }),
    ).toBe(false);
  });

  it('returns false when body contains @botName with a longer suffix (no trailing word boundary)', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'supportagentbot' });
    expect(
      matchesPrCommentTrigger(scenario, {
        body: '/sa review @supportagentbotextra',
        author: 'alice',
      }),
    ).toBe(false);
  });

  it('author parameter is ignored — same result with different authors', () => {
    const scenario = makeScenario({ keyword: '/sa review', botName: 'SupportAgent' });
    const body = '/sa review @SupportAgent';
    const resultA = matchesPrCommentTrigger(scenario, { body, author: 'alice' });
    const resultB = matchesPrCommentTrigger(scenario, { body, author: 'completely-different-person' });
    expect(resultA).toBe(true);
    expect(resultB).toBe(resultA);
  });
});
