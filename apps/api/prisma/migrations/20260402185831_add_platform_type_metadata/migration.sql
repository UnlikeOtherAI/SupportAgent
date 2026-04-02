/*
  Warnings:

  - A unique constraint covering the columns `[connectorId,capabilityKey]` on the table `connector_capabilities` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "platform_types" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'issue-tracker',
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "connector_capabilities_connectorId_capabilityKey_key" ON "connector_capabilities"("connectorId", "capabilityKey");
