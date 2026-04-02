import { type ConnectorRepository } from '../repositories/connector-repository.js';
import { type PrismaClient } from '@prisma/client';

export function createConnectorService(repo: ConnectorRepository, prisma: PrismaClient) {
  return {
    async listConnectors(tenantId: string, opts?: { direction?: string; isEnabled?: boolean }) {
      return repo.list(tenantId, opts);
    },

    async getConnector(id: string, tenantId: string) {
      const connector = await repo.getById(id, tenantId);
      if (!connector) throw Object.assign(new Error('Connector not found'), { statusCode: 404 });
      return connector;
    },

    async createConnector(
      tenantId: string,
      input: {
        platformTypeKey?: string;
        platformTypeId?: string;
        name: string;
        direction: string;
        configuredIntakeMode: string;
        apiBaseUrl?: string;
        pollingIntervalSeconds?: number;
        config?: Record<string, string>;
        secrets?: Record<string, string>;
      },
    ) {
      const platformTypeId =
        input.platformTypeId ??
        (
          await prisma.platformType.findUnique({
            where: { key: input.platformTypeKey },
          })
        )?.id;

      if (!platformTypeId)
        throw Object.assign(new Error('Platform type not found'), { statusCode: 400 });

      const platformType = await prisma.platformType.findUnique({
        where: { id: platformTypeId },
      });
      if (!platformType)
        throw Object.assign(new Error('Platform type not found'), { statusCode: 400 });

      const connector = await repo.create({
        tenantId,
        name: input.name,
        direction: input.direction as 'inbound' | 'outbound' | 'both',
        configuredIntakeMode: input.configuredIntakeMode as 'webhook' | 'polling' | 'manual',
        effectiveIntakeMode: input.configuredIntakeMode as 'webhook' | 'polling' | 'manual',
        isEnabled: true,
        apiBaseUrl: input.apiBaseUrl,
        pollingIntervalSeconds: input.pollingIntervalSeconds,
        platformType: { connect: { id: platformTypeId } },
      });

      if (input.config) {
        await repo.update(connector.id, tenantId, { capabilities: input.config });
      }

      if (input.secrets) {
        for (const [secretType, value] of Object.entries(input.secrets)) {
          if (value.length === 0) continue;
          await this.setConnectorSecret(connector.id, tenantId, secretType, value);
        }
      }

      return this.getConnector(connector.id, tenantId);
    },

    async updateConnector(
      id: string,
      tenantId: string,
      input: {
        name?: string;
        direction?: string;
        configuredIntakeMode?: string;
        effectiveIntakeMode?: string;
        isEnabled?: boolean;
        apiBaseUrl?: string;
        pollingIntervalSeconds?: number;
        taxonomyConfig?: Record<string, unknown>;
        imageDescriptionPolicy?: string;
      },
    ) {
      await this.getConnector(id, tenantId);
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.direction !== undefined) data.direction = input.direction;
      if (input.configuredIntakeMode !== undefined)
        data.configuredIntakeMode = input.configuredIntakeMode;
      if (input.effectiveIntakeMode !== undefined)
        data.effectiveIntakeMode = input.effectiveIntakeMode;
      if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
      if (input.apiBaseUrl !== undefined) data.apiBaseUrl = input.apiBaseUrl;
      if (input.pollingIntervalSeconds !== undefined)
        data.pollingIntervalSeconds = input.pollingIntervalSeconds;
      if (input.taxonomyConfig !== undefined) data.taxonomyConfig = input.taxonomyConfig;
      if (input.imageDescriptionPolicy !== undefined)
        data.imageDescriptionPolicy = input.imageDescriptionPolicy;
      await repo.update(id, tenantId, data);
      return this.getConnector(id, tenantId);
    },

    async deleteConnector(id: string, tenantId: string) {
      await this.getConnector(id, tenantId);
      await repo.delete(id, tenantId);
    },

    async getConnectorSecrets(connectorId: string, tenantId: string) {
      await this.getConnector(connectorId, tenantId);
      return repo.listSecrets(connectorId);
    },

    async setConnectorSecret(
      connectorId: string,
      tenantId: string,
      secretType: string,
      value: string,
    ) {
      await this.getConnector(connectorId, tenantId);
      const maskedHint = `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
      await repo.upsertSecret(connectorId, secretType, value, maskedHint);
    },

    async discoverCapabilities(id: string, tenantId: string) {
      const connector = await this.getConnector(id, tenantId);
      const caps = [
        { key: 'webhook_intake', supported: connector.platformType.supportsWebhook },
        { key: 'polling_intake', supported: connector.platformType.supportsPolling },
        { key: 'inbound', supported: connector.platformType.supportsInbound },
        { key: 'outbound', supported: connector.platformType.supportsOutbound },
      ];
      for (const cap of caps) {
        await repo.upsertCapability(id, cap.key, cap.supported);
      }
      return repo.listCapabilities(id);
    },
  };
}

export type ConnectorService = ReturnType<typeof createConnectorService>;
