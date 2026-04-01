import { type OutboundDestinationRepository } from '../repositories/outbound-destination-repository.js';
import { type DeliveryAttemptRepository } from '../repositories/delivery-attempt-repository.js';
import { type PrismaClient, type Prisma } from '@prisma/client';

export function createOutboundDeliveryService(
  destRepo: OutboundDestinationRepository,
  attemptRepo: DeliveryAttemptRepository,
  prisma: PrismaClient,
) {
  return {
    async listDestinations(tenantId: string) {
      return destRepo.list(tenantId);
    },

    async getDestination(id: string, tenantId: string) {
      const dest = await destRepo.getById(id, tenantId);
      if (!dest)
        throw Object.assign(new Error('Outbound destination not found'), { statusCode: 404 });
      return dest;
    },

    async createDestination(
      tenantId: string,
      input: {
        name: string;
        destinationType: string;
        connectorId?: string;
        config: Record<string, unknown>;
        isActive?: boolean;
      },
    ) {
      return destRepo.create({
        tenantId,
        name: input.name,
        destinationType: input.destinationType,
        config: input.config as Prisma.InputJsonValue,
        isActive: input.isActive ?? true,
        ...(input.connectorId && { connector: { connect: { id: input.connectorId } } }),
      });
    },

    async updateDestination(
      id: string,
      tenantId: string,
      input: {
        name?: string;
        destinationType?: string;
        config?: Record<string, unknown>;
        isActive?: boolean;
      },
    ) {
      await this.getDestination(id, tenantId);
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.destinationType !== undefined) data.destinationType = input.destinationType;
      if (input.config !== undefined) data.config = input.config;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      await destRepo.update(id, tenantId, data);
      return this.getDestination(id, tenantId);
    },

    async deleteDestination(id: string, tenantId: string) {
      await this.getDestination(id, tenantId);
      await destRepo.delete(id, tenantId);
    },

    async deliverFinding(
      destinationId: string,
      tenantId: string,
      input: { workflowRunId: string; findingId: string },
    ) {
      const dest = await this.getDestination(destinationId, tenantId);

      const run = await prisma.workflowRun.findFirst({
        where: { id: input.workflowRunId, tenantId },
      });
      if (!run)
        throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });

      const finding = await prisma.finding.findFirst({
        where: { id: input.findingId, workflowRunId: input.workflowRunId },
      });
      if (!finding) throw Object.assign(new Error('Finding not found'), { statusCode: 404 });

      const payload = {
        findingId: finding.id,
        summary: finding.summary,
        rootCauseHypothesis: finding.rootCauseHypothesis,
        confidence: finding.confidence,
        reproductionStatus: finding.reproductionStatus,
        outboundSummary: finding.outboundSummary,
        affectedAreas: finding.affectedAreas,
        suspectCommits: finding.suspectCommits,
        suspectFiles: finding.suspectFiles,
        userVisibleImpact: finding.userVisibleImpact,
      };

      const attempt = await attemptRepo.create({
        status: 'pending',
        payload,
        outboundDestination: { connect: { id: destinationId } },
        workflowRun: { connect: { id: input.workflowRunId } },
        finding: { connect: { id: input.findingId } },
      });

      const config = dest.config as Record<string, unknown>;
      const url = config.url as string | undefined;

      if (!url) {
        await attemptRepo.updateStatus(attempt.id, 'failed', {
          errorMessage: 'No URL configured on destination',
        });
        return attemptRepo.updateStatus(attempt.id, 'failed', {
          errorMessage: 'No URL configured on destination',
        });
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const responseBody = await res.text();
        let responseParsed: unknown;
        try {
          responseParsed = JSON.parse(responseBody);
        } catch {
          responseParsed = { raw: responseBody };
        }

        if (res.ok) {
          return attemptRepo.updateStatus(attempt.id, 'sent', {
            response: responseParsed as any,
          });
        }
        return attemptRepo.updateStatus(attempt.id, 'failed', {
          response: responseParsed as any,
          errorMessage: `HTTP ${res.status}`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return attemptRepo.updateStatus(attempt.id, 'failed', {
          errorMessage: message,
        });
      }
    },

    async listDeliveryAttempts(workflowRunId: string, tenantId: string) {
      const run = await prisma.workflowRun.findFirst({
        where: { id: workflowRunId, tenantId },
      });
      if (!run)
        throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
      return attemptRepo.listByRunId(workflowRunId);
    },
  };
}

export type OutboundDeliveryService = ReturnType<typeof createOutboundDeliveryService>;
