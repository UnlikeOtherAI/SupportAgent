function readPlaceholderValue(
  context: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = context;

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function stringifyPlaceholderValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(value);
}

export function findTemplatePlaceholders(template: string): string[] {
  const placeholders = new Set<string>();
  const matches = template.matchAll(/{{\s*([^{}]+?)\s*}}/g);

  for (const match of matches) {
    const placeholder = match[1]?.trim();
    if (placeholder) {
      placeholders.add(placeholder);
    }
  }

  return Array.from(placeholders);
}

export function substitutePlaceholders(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (match, key: string) => {
    const value = readPlaceholderValue(context, key.trim());
    return value === undefined ? match : stringifyPlaceholderValue(value);
  });
}
