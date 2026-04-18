CREATE TABLE "workflow_run_iterations" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "stages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_run_iterations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_run_iterations_workflowRunId_idx"
ON "workflow_run_iterations"("workflowRunId");

CREATE UNIQUE INDEX "workflow_run_iterations_workflowRunId_iteration_key"
ON "workflow_run_iterations"("workflowRunId", "iteration");

ALTER TABLE "workflow_run_iterations"
ADD CONSTRAINT "workflow_run_iterations_workflowRunId_fkey"
FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
