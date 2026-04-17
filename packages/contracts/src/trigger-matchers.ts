export interface PrCommentTriggerScenario {
  trigger: {
    kind: string;
    config: Record<string, unknown>;
  };
}

/** Escape all regex meta-characters in a string for use in `new RegExp(...)`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true when the given PR comment event matches the scenario's
 * `github.pull_request.comment` trigger.
 *
 * Rules:
 * - The trigger kind must be `github.pull_request.comment`.
 * - A non-empty `keyword` must appear in the comment body as a token: not
 *   preceded or followed by a word character (handles keywords that start or
 *   end with non-word characters such as `/sa review`).
 * - If `botName` is configured (non-empty string after trim), the body must
 *   contain a mention of the form `@<botName>` (case-insensitive, the name
 *   must end at a word boundary or end of string).
 *
 * Note: `input.author` is accepted on the input shape but is currently unused
 * and reserved for future use.
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
  if (keyword === '') return false;

  // Use lookaround-based boundaries so keywords that begin or end with
  // non-word characters (e.g. "/sa review") are handled correctly.
  const keywordRe = new RegExp(`(?<!\\w)${escapeRegExp(keyword)}(?!\\w)`);
  if (!keywordRe.test(input.body)) return false;

  const botName =
    typeof scenario.trigger.config.botName === 'string'
      ? scenario.trigger.config.botName.trim()
      : '';
  if (botName !== '') {
    const mentionRe = new RegExp(`@${escapeRegExp(botName)}\\b`, 'i');
    if (!mentionRe.test(input.body)) return false;
  }

  return true;
}
