import { PrismaClient } from '@prisma/client';
import { PLATFORM_TYPE_CATALOG } from '../src/lib/platform-type-catalog.ts';

const prisma = new PrismaClient();

async function main() {
  // Seed platform types from the shared catalog used by API startup sync.
  for (const pt of PLATFORM_TYPE_CATALOG) {
    await prisma.platformType.upsert({
      where: { key: pt.key },
      update: pt,
      create: pt,
    });
  }
  console.log(`Seeded ${PLATFORM_TYPE_CATALOG.length} platform types`);

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
