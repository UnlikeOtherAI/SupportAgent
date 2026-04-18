import { createHash } from 'node:crypto';

export function hashExecutorContent(yaml: string): string {
  return createHash('sha256').update(yaml).digest('hex');
}
