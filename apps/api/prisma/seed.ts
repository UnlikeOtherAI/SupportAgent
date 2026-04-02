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
      description:
        'Monitor production errors and ingest Sentry issues through a shared connector contract.',
      category: 'error-monitoring',
    },
    {
      key: 'crashlytics',
      displayName: 'Firebase Crashlytics',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: false,
      description: 'Receive mobile crash reports from Firebase Crashlytics.',
      category: 'error-monitoring',
    },
    {
      key: 'linear',
      displayName: 'Linear',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Sync issues and comments with Linear for inbound intake and outbound follow-up.',
      category: 'issue-tracker',
    },
    {
      key: 'github',
      displayName: 'GitHub',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Connect repositories and pull request events from GitHub or GitHub Enterprise.',
      category: 'version-control',
    },
    {
      key: 'github_issues',
      displayName: 'GitHub Issues',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Use GitHub Issues as an issue tracker for intake, comment sync, and outbound updates.',
      category: 'issue-tracker',
    },
    {
      key: 'jira',
      displayName: 'Jira',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Integrate Atlassian Jira projects for issue intake, updates, and workflow routing.',
      category: 'issue-tracker',
    },
    {
      key: 'trello',
      displayName: 'Trello',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Connect Trello boards for card-based intake, routing, and outbound status updates.',
      category: 'project-management',
    },
    {
      key: 'gitlab',
      displayName: 'GitLab',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Connect GitLab repositories and merge request events from cloud or self-managed instances.',
      category: 'version-control',
    },
    {
      key: 'bitbucket',
      displayName: 'Bitbucket',
      supportsWebhook: true,
      supportsPolling: true,
      supportsInbound: true,
      supportsOutbound: true,
      description:
        'Integrate Bitbucket repositories and pull request activity from cloud or self-hosted setups.',
      category: 'version-control',
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
