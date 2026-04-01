import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed platform types
  const platformTypes = [
    {
      key: 'sentry',
      displayName: 'Sentry',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: false,
    },
    {
      key: 'crashlytics',
      displayName: 'Firebase Crashlytics',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: false,
    },
    {
      key: 'linear',
      displayName: 'Linear',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
    {
      key: 'github',
      displayName: 'GitHub',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
    {
      key: 'github_issues',
      displayName: 'GitHub Issues',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
    {
      key: 'jira',
      displayName: 'Jira',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
    {
      key: 'trello',
      displayName: 'Trello',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
    {
      key: 'gitlab',
      displayName: 'GitLab',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
    {
      key: 'bitbucket',
      displayName: 'Bitbucket',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
    },
  ];

  for (const pt of platformTypes) {
    await prisma.platformType.upsert({
      where: { key: pt.key },
      update: pt,
      create: pt,
    });
  }
  console.log(`Seeded ${platformTypes.length} platform types`);

  // Seed default execution profiles
  const defaultTenantId = '00000000-0000-0000-0000-000000000000';
  const executionProfiles = [
    {
      key: 'analysis-only',
      displayName: 'Analysis Only',
      os: 'linux',
      browserRequired: false,
      dockerRequired: false,
      androidRequired: false,
      macRequired: false,
    },
    {
      key: 'web-repro',
      displayName: 'Web Reproduction',
      os: 'linux',
      browserRequired: true,
      dockerRequired: false,
      androidRequired: false,
      macRequired: false,
    },
    {
      key: 'android-repro',
      displayName: 'Android Reproduction',
      os: 'linux',
      browserRequired: false,
      dockerRequired: true,
      androidRequired: true,
      macRequired: false,
    },
    {
      key: 'repo-ci',
      displayName: 'Repository CI',
      os: 'linux',
      browserRequired: false,
      dockerRequired: false,
      androidRequired: false,
      macRequired: false,
    },
    {
      key: 'mac-required',
      displayName: 'Mac Required',
      os: 'macos',
      browserRequired: false,
      dockerRequired: false,
      androidRequired: false,
      macRequired: true,
    },
  ];

  for (const ep of executionProfiles) {
    const id = `${defaultTenantId}-${ep.key}`;
    await prisma.executionProfile.upsert({
      where: { id },
      update: { ...ep, tenantId: defaultTenantId },
      create: { id, ...ep, tenantId: defaultTenantId },
    });
  }
  console.log(`Seeded ${executionProfiles.length} execution profiles`);

  // Seed communication channel types
  const channelTypes = [
    { key: 'slack', displayName: 'Slack' },
    { key: 'teams', displayName: 'Microsoft Teams' },
    { key: 'whatsapp', displayName: 'WhatsApp Business' },
  ];

  for (const ct of channelTypes) {
    await prisma.communicationChannelType.upsert({
      where: { key: ct.key },
      update: ct,
      create: ct,
    });
  }
  console.log(`Seeded ${channelTypes.length} communication channel types`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
