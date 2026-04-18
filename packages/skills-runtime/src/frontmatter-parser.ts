import { parse as parseYaml } from 'yaml';

export type SkillFrontmatterRole = 'system' | 'complementary';

export interface ParsedSkillFrontmatter {
  name: string;
  description: string;
  role: SkillFrontmatterRole;
  outputSchemaPath?: string;
}

export interface ParsedSkillMarkdown {
  frontmatter: ParsedSkillFrontmatter;
  body: string;
}

export function parseSkillFrontmatter(markdown: string, sourceLabel = 'SKILL.md'): ParsedSkillMarkdown {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${sourceLabel} must start with YAML frontmatter delimited by ---`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML frontmatter in ${sourceLabel}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Frontmatter in ${sourceLabel} must be a YAML object`);
  }

  const frontmatterRecord = parsed as Record<string, unknown>;
  const name = readRequiredString(frontmatterRecord.name, 'name', sourceLabel);
  const description = readRequiredString(frontmatterRecord.description, 'description', sourceLabel);
  const role = readRole(frontmatterRecord.role, sourceLabel);
  const outputSchemaValue = frontmatterRecord.output_schema;

  if (role === 'system') {
    const outputSchemaPath = readRequiredString(outputSchemaValue, 'output_schema', sourceLabel);
    return {
      frontmatter: {
        name,
        description,
        role,
        outputSchemaPath,
      },
      body: match[2],
    };
  }

  if (outputSchemaValue !== undefined) {
    throw new Error(`${sourceLabel} cannot declare output_schema when role is complementary`);
  }

  return {
    frontmatter: {
      name,
      description,
      role,
    },
    body: match[2],
  };
}

function readRequiredString(value: unknown, fieldName: string, sourceLabel: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${sourceLabel} frontmatter field "${fieldName}" must be a non-empty string`);
  }

  return value;
}

function readRole(value: unknown, sourceLabel: string): SkillFrontmatterRole {
  if (value === 'system' || value === 'complementary') {
    return value;
  }

  throw new Error(
    `${sourceLabel} frontmatter field "role" must be "system" or "complementary"`,
  );
}
