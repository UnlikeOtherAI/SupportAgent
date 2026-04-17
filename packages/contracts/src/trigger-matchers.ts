export interface PrCommentTriggerScenario {
  trigger: {
    kind: string;
    config: Record<string, unknown>;
  };
}

/**
 * Returns true when the given PR comment event matches the scenario's
 * `github.pull_request.comment` trigger.
 *
 * Rules:
 * - The trigger kind must be `github.pull_request.comment`.
 * - A non-empty `keyword` must appear somewhere in the comment body.
 * - If `botName` is configured (non-empty string), the comment author must
 *   match it with a case-insensitive exact comparison.  When `botName` is
 *   absent or empty, any author is accepted.
 */
export function matchesPrCommentTrigger(
  scenario: PrCommentTriggerScenario,
  input: { body: string; author: string },
): boolean {
  if (scenario.trigger.kind !== 'github.pull_request.comment') return false;

  const keyword =
    typeof scenario.trigger.config.keyword === 'string'
      ? scenario.trigger.config.keyword.trim()
      : '';
  if (keyword === '' || !input.body.includes(keyword)) return false;

  const botName =
    typeof scenario.trigger.config.botName === 'string'
      ? scenario.trigger.config.botName.trim()
      : '';
  if (botName !== '' && input.author.toLowerCase() !== botName.toLowerCase()) return false;

  return true;
}
