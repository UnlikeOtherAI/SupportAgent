import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './frontmatter-parser.js';

describe('parseSkillFrontmatter', () => {
  it('parses a valid system skill', () => {
    const parsed = parseSkillFrontmatter(`---
name: triage-issue
description: |
  Investigate an issue.
role: system
output_schema: ./output.schema.json
---
# Body
`);

    expect(parsed).toEqual({
      frontmatter: {
        name: 'triage-issue',
        description: 'Investigate an issue.\n',
        role: 'system',
        outputSchemaPath: './output.schema.json',
      },
      body: '# Body\n',
    });
  });

  it('parses a valid complementary skill', () => {
    const parsed = parseSkillFrontmatter(`---
name: repo-rules
description: Reuse the local repository conventions.
role: complementary
---
Follow the repo rules.
`);

    expect(parsed).toEqual({
      frontmatter: {
        name: 'repo-rules',
        description: 'Reuse the local repository conventions.',
        role: 'complementary',
      },
      body: 'Follow the repo rules.\n',
    });
  });

  it('throws when a required field is missing', () => {
    expect(() =>
      parseSkillFrontmatter(`---
name: triage-issue
role: system
output_schema: ./output.schema.json
---
body
`),
    ).toThrow(/description/);
  });

  it('throws on an invalid role', () => {
    expect(() =>
      parseSkillFrontmatter(`---
name: triage-issue
description: Investigate an issue.
role: primary
output_schema: ./output.schema.json
---
body
`),
    ).toThrow(/must be "system" or "complementary"/);
  });

  it('throws when a complementary skill declares output_schema', () => {
    expect(() =>
      parseSkillFrontmatter(`---
name: repo-rules
description: Reuse the local repository conventions.
role: complementary
output_schema: ./output.schema.json
---
body
`),
    ).toThrow(/cannot declare output_schema/);
  });
});
