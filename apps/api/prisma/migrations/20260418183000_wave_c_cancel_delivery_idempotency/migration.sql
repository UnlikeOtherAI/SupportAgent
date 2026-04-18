ALTER TABLE "workflow_runs"
ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);

ALTER TABLE "action_outputs"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "action_outputs_idempotencyKey_key"
ON "action_outputs"("idempotencyKey");
