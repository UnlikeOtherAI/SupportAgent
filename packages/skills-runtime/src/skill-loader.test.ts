import { SkillRole, type Skill } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { loadSkillFromRow } from './skill-loader.js';

describe('loadSkillFromRow', () => {
  it('builds a loaded skill from a system Skill row', () => {
    const row: Pick<Skill, 'name' | 'description' | 'role' | 'body' | 'outputSchema'> = {
      name: 'triage-issue',
      description: 'Investigate a newly opened issue.',
      role: SkillRole.SYSTEM,
      body: '# Triage Issue\nReturn JSON only.\n',
      outputSchema: {
        type: 'object',
        properties: {
          delivery: { type: 'array' },
        },
      },
    };

    expect(loadSkillFromRow(row)).toEqual({
      name: 'triage-issue',
      description: 'Investigate a newly opened issue.',
      role: 'system',
      body: '# Triage Issue\nReturn JSON only.\n',
      outputSchema: {
        type: 'object',
        properties: {
          delivery: { type: 'array' },
        },
      },
    });
  });
});
