import { createHash } from 'node:crypto';

export interface SkillContentHashInput {
  role: 'system' | 'complementary';
  description: string;
  body: string;
  outputSchema: Record<string, unknown> | null;
}

export function hashSkillContent(input: SkillContentHashInput): string {
  const canonicalPayload = JSON.stringify({
    role: input.role,
    description: input.description,
    body: input.body,
    outputSchema: canonicalizeValue(input.outputSchema),
  });

  return createHash('sha256').update(canonicalPayload).digest('hex');
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
}
