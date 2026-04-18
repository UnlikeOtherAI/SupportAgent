-- CreateEnum
CREATE TYPE "SkillRole" AS ENUM ('SYSTEM', 'COMPLEMENTARY');

-- CreateEnum
CREATE TYPE "SkillSource" AS ENUM ('BUILTIN', 'USER');

-- CreateEnum
CREATE TYPE "ExecutorSource" AS ENUM ('BUILTIN', 'USER');

-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN     "resolvedExecutorRevision" TEXT,
ADD COLUMN     "resolvedSkillRevisions" JSONB;

-- CreateTable
CREATE TABLE "dispatch_attempt_checkpoints" (
    "id" TEXT NOT NULL,
    "dispatchAttemptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "iteration" INTEGER,
    "stageId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_attempt_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "role" "SkillRole" NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "outputSchema" JSONB,
    "contentHash" TEXT NOT NULL,
    "source" "SkillSource" NOT NULL,
    "parentSkillId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Executor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "yaml" TEXT NOT NULL,
    "parsed" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" "ExecutorSource" NOT NULL,
    "parentExecutorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Executor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispatch_attempt_checkpoints_dispatchAttemptId_kind_idx" ON "dispatch_attempt_checkpoints"("dispatchAttemptId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_tenantId_name_source_key" ON "Skill"("tenantId", "name", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Executor_tenantId_key_source_key" ON "Executor"("tenantId", "key", "source");

-- AddForeignKey
ALTER TABLE "dispatch_attempt_checkpoints" ADD CONSTRAINT "dispatch_attempt_checkpoints_dispatchAttemptId_fkey" FOREIGN KEY ("dispatchAttemptId") REFERENCES "worker_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
