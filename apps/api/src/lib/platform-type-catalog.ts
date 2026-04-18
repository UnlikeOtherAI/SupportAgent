import { PLATFORM_REGISTRY } from '@support-agent/contracts';

type PlatformSupportDefinition = {
  key: keyof typeof PLATFORM_REGISTRY;
  supportsWebhook: boolean;
  supportsPolling: boolean;
  supportsInbound: boolean;
  supportsOutbound: boolean;
};

const PLATFORM_SUPPORT_DEFINITIONS: PlatformSupportDefinition[] = [
  {
    key: 'sentry',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: false,
  },
  {
    key: 'crashlytics',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: false,
  },
  {
    key: 'linear',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'github',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'github_issues',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'jira',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'trello',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'gitlab',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'bitbucket',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
  {
    key: 'respondio',
    supportsWebhook: true,
    supportsPolling: true,
    supportsInbound: true,
    supportsOutbound: true,
  },
];

export const PLATFORM_TYPE_CATALOG = PLATFORM_SUPPORT_DEFINITIONS.map((definition) => {
  const registry = PLATFORM_REGISTRY[definition.key];

  return {
    key: definition.key,
    displayName: registry.displayName,
    description: registry.description,
    category: registry.category,
    supportsWebhook: definition.supportsWebhook,
    supportsPolling: definition.supportsPolling,
    supportsInbound: definition.supportsInbound,
    supportsOutbound: definition.supportsOutbound,
  };
});
