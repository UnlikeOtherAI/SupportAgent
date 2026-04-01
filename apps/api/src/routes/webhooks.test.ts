import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

const TEST_TENANT_ID = 'c0000000-0000-0000-0000-000000000001';

describe('Webhook intake routes', () => {
  let app: FastifyInstance;
  let platformTypeId: string;
  let connectorId: string;
  let disabledConnectorId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();

    // Create platform type
    const pt = await app.prisma.platformType.upsert({
      where: { key: 'test-webhook' },
      update: {},
      create: {
        key: 'test-webhook',
        displayName: 'Test Webhook Platform',
        supportsWebhook: true,
        supportsPolling: false,
        supportsInbound: true,
        supportsOutbound: false,
      },
    });
    platformTypeId = pt.id;

    // Create enabled connector (no webhookSecret for easier testing)
    const connector = await app.prisma.connector.create({
      data: {
        tenantId: TEST_TENANT_ID,
        platformTypeId,
        name: 'Test Webhook Connector',
        direction: 'inbound',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
        webhookSecret: null,
      },
    });
    connectorId = connector.id;

    // Create repository mapping for this connector
    await app.prisma.repositoryMapping.create({
      data: {
        tenantId: TEST_TENANT_ID,
        connectorId,
        repositoryUrl: 'https://github.com/test/webhook-repo',
      },
    });

    // Create disabled connector
    const disabled = await app.prisma.connector.create({
      data: {
        tenantId: TEST_TENANT_ID,
        platformTypeId,
        name: 'Disabled Webhook Connector',
        direction: 'inbound',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
        isEnabled: false,
      },
    });
    disabledConnectorId = disabled.id;
  });

  afterAll(async () => {
    // Find all connectors tied to the test-webhook platform type (including
    // orphans left by previous failed runs).
    const allConnectorIds = (
      await app.prisma.connector.findMany({
        where: { platformTypeId },
        select: { id: true },
      })
    ).map((c) => c.id);

    // Delete workflow runs that reference work items on these connectors
    const workItemIds = (
      await app.prisma.inboundWorkItem.findMany({
        where: { connectorInstanceId: { in: allConnectorIds } },
        select: { id: true },
      })
    ).map((w) => w.id);

    if (workItemIds.length > 0) {
      await app.prisma.workflowRun.deleteMany({
        where: { workItemId: { in: workItemIds } },
      });
    }

    await app.prisma.inboundWorkItem.deleteMany({
      where: { connectorInstanceId: { in: allConnectorIds } },
    });
    await app.prisma.repositoryMapping.deleteMany({
      where: { connectorId: { in: allConnectorIds } },
    });
    await app.prisma.connector.deleteMany({
      where: { id: { in: allConnectorIds } },
    });
    await app.prisma.platformType.deleteMany({ where: { key: 'test-webhook' } });
    await app.close();
  });

  it('GitHub issue webhook creates work item', async () => {
    const payload = {
      action: 'opened',
      issue: {
        number: 42,
        html_url: 'https://github.com/test/webhook-repo/issues/42',
        title: 'Bug: something is broken',
        body: 'Steps to reproduce...',
        state: 'open',
        labels: [{ name: 'bug' }],
      },
      repository: { full_name: 'test/webhook-repo' },
    };

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/github/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('created');
    expect(body.workItemId).toBeDefined();
    expect(body.workflowRunId).toBeDefined();
  });

  it('GitHub PR webhook creates review_target work item', async () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 99,
        html_url: 'https://github.com/test/webhook-repo/pull/99',
        title: 'feat: add new feature',
        body: 'This PR adds...',
        state: 'open',
        labels: [{ name: 'enhancement' }],
        base: { ref: 'main' },
        head: { ref: 'feat/new-feature' },
      },
      repository: { full_name: 'test/webhook-repo' },
    };

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/github/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('created');
    expect(body.workItemId).toBeDefined();
    expect(body.workflowRunId).toBeDefined();

    // Verify the created work item has review_target kind
    const workItem = await app.prisma.inboundWorkItem.findUnique({
      where: { id: body.workItemId },
    });
    expect(workItem?.workItemKind).toBe('review_target');
    expect(workItem?.repositoryRef).toBe('test/webhook-repo');
    expect(workItem?.baseRef).toBe('main');
    expect(workItem?.headRef).toBe('feat/new-feature');
    expect(workItem?.reviewTargetType).toBe('pull_request');
    expect(workItem?.reviewTargetNumber).toBe(99);
  });

  it('Duplicate webhook returns duplicate status', async () => {
    const payload = {
      action: 'opened',
      issue: {
        number: 200,
        html_url: 'https://github.com/test/webhook-repo/issues/200',
        title: 'Duplicate test issue',
        body: 'body',
        state: 'open',
        labels: [],
      },
      repository: { full_name: 'test/webhook-repo' },
    };

    // First call creates the item
    const first = await app.inject({
      method: 'POST',
      url: `/webhooks/github/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe('created');

    // Second call is a duplicate
    const second = await app.inject({
      method: 'POST',
      url: `/webhooks/github/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('duplicate');
    expect(second.json().workItemId).toBe(first.json().workItemId);
  });

  it('Invalid connector ID returns 404', async () => {
    const payload = {
      action: 'opened',
      issue: { number: 1, title: 'test', state: 'open', labels: [] },
      repository: { full_name: 'test/repo' },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github/00000000-0000-0000-0000-000000000000',
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('Disabled connector returns 403', async () => {
    const payload = {
      action: 'opened',
      issue: { number: 1, title: 'test', state: 'open', labels: [] },
      repository: { full_name: 'test/repo' },
    };

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/github/${disabledConnectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('Unknown platform returns 400', async () => {
    const payload = { action: 'opened', data: {} };

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/unknown_platform/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('Sentry webhook creates work item', async () => {
    const payload = {
      action: 'created',
      data: {
        issue: {
          id: 'sentry-issue-123',
          permalink: 'https://sentry.io/issues/123',
          title: 'TypeError: Cannot read properties of null',
          culprit: 'app.js in handleRequest',
          priority: 'high',
          level: 'error',
          status: 'unresolved',
        },
        project: { slug: 'my-project' },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/sentry/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('created');
    expect(body.workItemId).toBeDefined();

    const workItem = await app.prisma.inboundWorkItem.findUnique({
      where: { id: body.workItemId },
    });
    expect(workItem?.platformType).toBe('sentry');
    expect(workItem?.title).toBe('TypeError: Cannot read properties of null');
    expect(workItem?.severity).toBe('error');
  });

  it('Linear webhook creates work item', async () => {
    const payload = {
      type: 'Issue',
      action: 'create',
      data: {
        id: 'linear-issue-456',
        url: 'https://linear.app/team/issue/LIN-456',
        title: 'Implement search feature',
        description: 'We need full-text search',
        priority: 2,
        state: { name: 'Todo' },
        labels: [{ name: 'feature' }],
        teamId: 'team-1',
        projectId: 'proj-1',
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/linear/${connectorId}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('created');
    expect(body.workItemId).toBeDefined();

    const workItem = await app.prisma.inboundWorkItem.findUnique({
      where: { id: body.workItemId },
    });
    expect(workItem?.platformType).toBe('linear');
    expect(workItem?.title).toBe('Implement search feature');
    expect(workItem?.priority).toBe('2');
    expect(workItem?.status).toBe('Todo');
  });
});
