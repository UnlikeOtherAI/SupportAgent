-- CreateEnum
CREATE TYPE "ActionDeliveryStatus" AS ENUM ('pending', 'succeeded', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN     "lastProgressEditAt" TIMESTAMP(3),
ADD COLUMN     "progressCommentId" TEXT;

-- CreateTable
CREATE TABLE "action_outputs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT,
    "visibilityLevel" "OutputVisibility" NOT NULL DEFAULT 'full',
    "payloadRef" TEXT,
    "redactionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_delivery_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "actionOutputId" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destinationId" TEXT,
    "status" "ActionDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "externalRef" TEXT,
    "placeholderRef" TEXT,
    "placeholderRefStatus" TEXT,
    "response" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "action_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "action_outputs_tenantId_idx" ON "action_outputs"("tenantId");

-- CreateIndex
CREATE INDEX "action_outputs_workflowRunId_idx" ON "action_outputs"("workflowRunId");

-- CreateIndex
CREATE INDEX "action_outputs_outputType_idx" ON "action_outputs"("outputType");

-- CreateIndex
CREATE INDEX "action_delivery_attempts_tenantId_idx" ON "action_delivery_attempts"("tenantId");

-- CreateIndex
CREATE INDEX "action_delivery_attempts_workflowRunId_idx" ON "action_delivery_attempts"("workflowRunId");

-- CreateIndex
CREATE INDEX "action_delivery_attempts_actionOutputId_idx" ON "action_delivery_attempts"("actionOutputId");

-- CreateIndex
CREATE INDEX "action_delivery_attempts_status_idx" ON "action_delivery_attempts"("status");

-- AddForeignKey
ALTER TABLE "action_outputs" ADD CONSTRAINT "action_outputs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_delivery_attempts" ADD CONSTRAINT "action_delivery_attempts_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_delivery_attempts" ADD CONSTRAINT "action_delivery_attempts_actionOutputId_fkey" FOREIGN KEY ("actionOutputId") REFERENCES "action_outputs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
