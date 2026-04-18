import type { SkillRunResult } from '@support-agent/contracts';

export interface CheckpointWriter {
  writeCheckpoint(args: {
    kind: 'stage_complete' | 'iteration_complete';
    stageId?: string;
    iteration?: number;
    payload: SkillRunResult[];
  }): Promise<void>;
}
