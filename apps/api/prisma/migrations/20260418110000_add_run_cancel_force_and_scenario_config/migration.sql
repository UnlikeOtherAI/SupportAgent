-- AlterEnum
ALTER TYPE "WorkflowRunStatus" ADD VALUE IF NOT EXISTS 'cancel_requested';

-- AlterTable
ALTER TABLE "workflow_runs"
ADD COLUMN IF NOT EXISTS "cancelForceRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workflow_scenarios"
ADD COLUMN IF NOT EXISTS "config" JSONB;
