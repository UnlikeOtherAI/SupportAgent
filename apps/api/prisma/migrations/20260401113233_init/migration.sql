-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('triage', 'build', 'merge');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('queued', 'blocked', 'dispatched', 'running', 'awaiting_review', 'awaiting_human', 'succeeded', 'failed', 'canceled', 'lost');

-- CreateEnum
CREATE TYPE "WorkItemKind" AS ENUM ('issue', 'review_target');

-- CreateEnum
CREATE TYPE "OutputVisibility" AS ENUM ('full', 'redacted', 'metadata_only');

-- CreateEnum
CREATE TYPE "ConnectorDirection" AS ENUM ('inbound', 'outbound', 'both');

-- CreateEnum
CREATE TYPE "IntakeMode" AS ENUM ('webhook', 'polling', 'manual');

-- CreateEnum
CREATE TYPE "ConnectionMode" AS ENUM ('direct', 'reverse_connected');

-- CreateEnum
CREATE TYPE "RuntimeMode" AS ENUM ('worker', 'gateway');

-- CreateEnum
CREATE TYPE "TriggerActionType" AS ENUM ('create_workflow_run', 'notify', 'block');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('approved', 'rejected', 'needs_revision', 'inconclusive');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('created', 'updated', 'deleted', 'triggered', 'dispatched', 'completed', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "platform_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "supportsWebhook" BOOLEAN NOT NULL,
    "supportsPolling" BOOLEAN NOT NULL,
    "supportsInbound" BOOLEAN NOT NULL,
    "supportsOutbound" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platformTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "ConnectorDirection" NOT NULL,
    "configuredIntakeMode" "IntakeMode" NOT NULL,
    "effectiveIntakeMode" "IntakeMode" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookSecret" TEXT,
    "pollingIntervalSeconds" INTEGER,
    "apiBaseUrl" TEXT,
    "capabilities" JSONB,
    "taxonomyConfig" JSONB,
    "imageDescriptionPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_endpoints" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "endpointType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_capabilities" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "isSupported" BOOLEAN NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "connector_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_taxonomy_caches" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "taxonomyType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,
    "metadata" JSONB,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_taxonomy_caches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_scope_mappings" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "externalScopeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_scope_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_secrets" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "secretType" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "maskedHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "connection_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "executionProfileId" TEXT,
    "orchestrationProfileId" TEXT,
    "reviewProfileId" TEXT,
    "dependencyPolicy" JSONB,
    "notificationBindings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT,
    "repositoryMappingId" TEXT,
    "priority" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_targets" (
    "id" TEXT NOT NULL,
    "routingRuleId" TEXT NOT NULL,
    "outboundDestinationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trigger_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_conditions" (
    "id" TEXT NOT NULL,
    "triggerPolicyId" TEXT NOT NULL,
    "conditionType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trigger_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_actions" (
    "id" TEXT NOT NULL,
    "triggerPolicyId" TEXT NOT NULL,
    "actionType" "TriggerActionType" NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trigger_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_scenarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerPolicyId" TEXT,
    "dependencyPolicyConfig" JSONB,
    "executionProfileId" TEXT,
    "orchestrationProfileId" TEXT,
    "reviewProfileId" TEXT,
    "prAllowed" BOOLEAN NOT NULL DEFAULT false,
    "prIntent" TEXT,
    "mergeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "notificationConfig" JSONB,
    "distributionConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_scenario_bindings" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "connectorId" TEXT,
    "repositoryMappingId" TEXT,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_scenario_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_scenario_steps" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_scenario_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_work_items" (
    "id" TEXT NOT NULL,
    "connectorInstanceId" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "workItemKind" "WorkItemKind" NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "priority" TEXT,
    "severity" TEXT,
    "status" TEXT,
    "taxonomy" JSONB,
    "attachments" JSONB,
    "comments" JSONB,
    "dependencyRefs" JSONB,
    "sourcePayloadRef" TEXT,
    "repositoryMappingId" TEXT,
    "dedupeKey" TEXT,
    "repositoryRef" TEXT,
    "baseRef" TEXT,
    "headRef" TEXT,
    "commitRange" TEXT,
    "diffRef" TEXT,
    "reviewTargetType" TEXT,
    "reviewTargetNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "workItemId" TEXT NOT NULL,
    "repositoryMappingId" TEXT NOT NULL,
    "executionProfileId" TEXT,
    "orchestrationProfileId" TEXT,
    "reviewProfileId" TEXT,
    "workflowScenarioId" TEXT,
    "parentWorkflowRunId" TEXT,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'queued',
    "currentStage" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "blockedReason" TEXT,
    "providerExecutionRef" TEXT,
    "acceptedDispatchAttempt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_log_events" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "streamType" TEXT NOT NULL,
    "stage" TEXT,
    "message" TEXT NOT NULL,
    "hostMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_log_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rootCauseHypothesis" TEXT,
    "confidence" DOUBLE PRECISION,
    "reproductionStatus" TEXT,
    "affectedAreas" JSONB,
    "evidenceRefs" JSONB,
    "recommendedNextAction" TEXT,
    "outboundSummary" TEXT,
    "suspectCommits" JSONB,
    "suspectFiles" JSONB,
    "userVisibleImpact" TEXT,
    "designNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_destinations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT,
    "name" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_delivery_attempts" (
    "id" TEXT NOT NULL,
    "outboundDestinationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "findingId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "response" JSONB,
    "errorMessage" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "os" TEXT,
    "browserRequired" BOOLEAN NOT NULL DEFAULT false,
    "dockerRequired" BOOLEAN NOT NULL DEFAULT false,
    "androidRequired" BOOLEAN NOT NULL DEFAULT false,
    "macRequired" BOOLEAN NOT NULL DEFAULT false,
    "networkRequirements" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_profiles" (
    "id" TEXT NOT NULL,
    "executionProfileId" TEXT NOT NULL,
    "imageRef" TEXT,
    "toolchainConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_providers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "connectionMode" "ConnectionMode" NOT NULL,
    "supportedProfiles" JSONB,
    "maxConcurrency" INTEGER NOT NULL,
    "networkZone" TEXT,
    "secretRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_provider_hosts" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os" TEXT,
    "capabilities" JSONB,
    "runtimeMode" "RuntimeMode" NOT NULL,
    "maxConcurrency" INTEGER NOT NULL,
    "currentLoad" INTEGER NOT NULL DEFAULT 0,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_provider_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_host_sessions" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,

    CONSTRAINT "execution_host_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "runtimeMode" "RuntimeMode",
    "allowedProfiles" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_api_key_audit_events" (
    "id" TEXT NOT NULL,
    "runtimeApiKeyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_api_key_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_dispatches" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "executionProviderId" TEXT NOT NULL,
    "hostId" TEXT,
    "workerSharedSecret" TEXT NOT NULL,
    "jobPayload" JSONB NOT NULL,
    "providerJobId" TEXT,
    "providerExecutionUrl" TEXT,
    "status" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "worker_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelRoutingMode" TEXT,
    "claudeRequired" BOOLEAN NOT NULL DEFAULT false,
    "codexRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orchestration_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_profile_versions" (
    "id" TEXT NOT NULL,
    "orchestrationProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestration_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_manifests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "reviewGoal" TEXT,
    "maxRounds" INTEGER NOT NULL DEFAULT 3,
    "passThreshold" DOUBLE PRECISION,
    "requiresSecondModel" BOOLEAN NOT NULL DEFAULT false,
    "requiredArtifacts" JSONB,
    "outputSchema" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_profile_versions" (
    "id" TEXT NOT NULL,
    "reviewProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_prompt_sets" (
    "id" TEXT NOT NULL,
    "reviewProfileId" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "promptTemplate" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_prompt_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_run_reviews" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "reviewProfileId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "decision" "ReviewDecision",
    "operatorOverride" BOOLEAN NOT NULL DEFAULT false,
    "operatorOverrideReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_run_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_round_outputs" (
    "id" TEXT NOT NULL,
    "workflowRunReviewId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "findings" JSONB,
    "decision" "ReviewDecision",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_round_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_evaluations" (
    "id" TEXT NOT NULL,
    "workflowRunReviewId" TEXT NOT NULL,
    "evaluationType" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_comments" (
    "id" TEXT NOT NULL,
    "workflowRunReviewId" TEXT NOT NULL,
    "roundNumber" INTEGER,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item_dependencies" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "dependsOnWorkItemId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependency_snapshots" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dependency_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependency_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dependency_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependency_overrides" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "overriddenBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dependency_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_delivery_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "epicRef" TEXT,
    "epicTitle" TEXT,
    "repositoryMappingId" TEXT NOT NULL,
    "branchStrategy" TEXT,
    "parallelExecution" BOOLEAN NOT NULL DEFAULT false,
    "distributionTarget" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_delivery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_delivery_work_items" (
    "id" TEXT NOT NULL,
    "featureDeliveryRunId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_delivery_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_delivery_batches" (
    "id" TEXT NOT NULL,
    "featureDeliveryRunId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "feature_delivery_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_delivery_assets" (
    "id" TEXT NOT NULL,
    "featureDeliveryRunId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_delivery_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_comment_threads" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "workItemId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_comment_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_comment_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isBotMention" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_comment_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_mentions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mentionedEntity" TEXT NOT NULL,
    "mentionType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_channel_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_channel_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_channel_pairings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "externalConversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_channel_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_channel_memberships" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_channel_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_channel_policies" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "allowedActions" JSONB NOT NULL,
    "notificationPreferences" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_channel_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "externalThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_action_requests" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "requestedAction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_action_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_subscriptions" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "subscriberRef" TEXT NOT NULL,
    "eventTypes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_identity_links" (
    "id" TEXT NOT NULL,
    "identityProviderId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "internalUserId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "federated_identity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "signingPublicKey" TEXT,
    "jwksUrl" TEXT,
    "config" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_session_links" (
    "id" TEXT NOT NULL,
    "serviceIntegrationId" TEXT NOT NULL,
    "upstreamSessionId" TEXT NOT NULL,
    "internalSessionId" TEXT NOT NULL,
    "userId" TEXT,
    "tenantId" TEXT,
    "scopes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "integration_session_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_event_subscriptions" (
    "id" TEXT NOT NULL,
    "repositoryMappingId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_event_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT,
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_types_key_key" ON "platform_types"("key");

-- CreateIndex
CREATE INDEX "connectors_tenantId_idx" ON "connectors"("tenantId");

-- CreateIndex
CREATE INDEX "connectors_platformTypeId_idx" ON "connectors"("platformTypeId");

-- CreateIndex
CREATE INDEX "connector_endpoints_connectorId_idx" ON "connector_endpoints"("connectorId");

-- CreateIndex
CREATE INDEX "connector_capabilities_connectorId_idx" ON "connector_capabilities"("connectorId");

-- CreateIndex
CREATE INDEX "connector_taxonomy_caches_connectorId_idx" ON "connector_taxonomy_caches"("connectorId");

-- CreateIndex
CREATE INDEX "connector_scope_mappings_connectorId_idx" ON "connector_scope_mappings"("connectorId");

-- CreateIndex
CREATE INDEX "connection_secrets_connectorId_idx" ON "connection_secrets"("connectorId");

-- CreateIndex
CREATE INDEX "repository_mappings_tenantId_idx" ON "repository_mappings"("tenantId");

-- CreateIndex
CREATE INDEX "repository_mappings_connectorId_idx" ON "repository_mappings"("connectorId");

-- CreateIndex
CREATE INDEX "repository_mappings_executionProfileId_idx" ON "repository_mappings"("executionProfileId");

-- CreateIndex
CREATE INDEX "routing_rules_tenantId_idx" ON "routing_rules"("tenantId");

-- CreateIndex
CREATE INDEX "routing_rules_connectorId_idx" ON "routing_rules"("connectorId");

-- CreateIndex
CREATE INDEX "routing_rules_repositoryMappingId_idx" ON "routing_rules"("repositoryMappingId");

-- CreateIndex
CREATE INDEX "routing_targets_routingRuleId_idx" ON "routing_targets"("routingRuleId");

-- CreateIndex
CREATE INDEX "routing_targets_outboundDestinationId_idx" ON "routing_targets"("outboundDestinationId");

-- CreateIndex
CREATE INDEX "trigger_policies_tenantId_idx" ON "trigger_policies"("tenantId");

-- CreateIndex
CREATE INDEX "trigger_conditions_triggerPolicyId_idx" ON "trigger_conditions"("triggerPolicyId");

-- CreateIndex
CREATE INDEX "trigger_actions_triggerPolicyId_idx" ON "trigger_actions"("triggerPolicyId");

-- CreateIndex
CREATE INDEX "workflow_scenarios_tenantId_idx" ON "workflow_scenarios"("tenantId");

-- CreateIndex
CREATE INDEX "workflow_scenarios_triggerPolicyId_idx" ON "workflow_scenarios"("triggerPolicyId");

-- CreateIndex
CREATE INDEX "workflow_scenarios_executionProfileId_idx" ON "workflow_scenarios"("executionProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_scenarios_tenantId_key_key" ON "workflow_scenarios"("tenantId", "key");

-- CreateIndex
CREATE INDEX "workflow_scenario_bindings_scenarioId_idx" ON "workflow_scenario_bindings"("scenarioId");

-- CreateIndex
CREATE INDEX "workflow_scenario_bindings_connectorId_idx" ON "workflow_scenario_bindings"("connectorId");

-- CreateIndex
CREATE INDEX "workflow_scenario_bindings_repositoryMappingId_idx" ON "workflow_scenario_bindings"("repositoryMappingId");

-- CreateIndex
CREATE INDEX "workflow_scenario_steps_scenarioId_idx" ON "workflow_scenario_steps"("scenarioId");

-- CreateIndex
CREATE INDEX "inbound_work_items_connectorInstanceId_idx" ON "inbound_work_items"("connectorInstanceId");

-- CreateIndex
CREATE INDEX "inbound_work_items_repositoryMappingId_idx" ON "inbound_work_items"("repositoryMappingId");

-- CreateIndex
CREATE INDEX "inbound_work_items_dedupeKey_idx" ON "inbound_work_items"("dedupeKey");

-- CreateIndex
CREATE INDEX "workflow_runs_tenantId_idx" ON "workflow_runs"("tenantId");

-- CreateIndex
CREATE INDEX "workflow_runs_workItemId_idx" ON "workflow_runs"("workItemId");

-- CreateIndex
CREATE INDEX "workflow_runs_repositoryMappingId_idx" ON "workflow_runs"("repositoryMappingId");

-- CreateIndex
CREATE INDEX "workflow_runs_executionProfileId_idx" ON "workflow_runs"("executionProfileId");

-- CreateIndex
CREATE INDEX "workflow_runs_workflowScenarioId_idx" ON "workflow_runs"("workflowScenarioId");

-- CreateIndex
CREATE INDEX "workflow_runs_parentWorkflowRunId_idx" ON "workflow_runs"("parentWorkflowRunId");

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "workflow_log_events_workflowRunId_idx" ON "workflow_log_events"("workflowRunId");

-- CreateIndex
CREATE INDEX "findings_workflowRunId_idx" ON "findings"("workflowRunId");

-- CreateIndex
CREATE INDEX "outbound_destinations_tenantId_idx" ON "outbound_destinations"("tenantId");

-- CreateIndex
CREATE INDEX "outbound_destinations_connectorId_idx" ON "outbound_destinations"("connectorId");

-- CreateIndex
CREATE INDEX "outbound_delivery_attempts_outboundDestinationId_idx" ON "outbound_delivery_attempts"("outboundDestinationId");

-- CreateIndex
CREATE INDEX "outbound_delivery_attempts_workflowRunId_idx" ON "outbound_delivery_attempts"("workflowRunId");

-- CreateIndex
CREATE INDEX "outbound_delivery_attempts_findingId_idx" ON "outbound_delivery_attempts"("findingId");

-- CreateIndex
CREATE INDEX "execution_profiles_tenantId_idx" ON "execution_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "runtime_profiles_executionProfileId_idx" ON "runtime_profiles"("executionProfileId");

-- CreateIndex
CREATE INDEX "execution_providers_tenantId_idx" ON "execution_providers"("tenantId");

-- CreateIndex
CREATE INDEX "execution_provider_hosts_providerId_idx" ON "execution_provider_hosts"("providerId");

-- CreateIndex
CREATE INDEX "execution_host_sessions_hostId_idx" ON "execution_host_sessions"("hostId");

-- CreateIndex
CREATE INDEX "runtime_api_keys_tenantId_idx" ON "runtime_api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "runtime_api_key_audit_events_runtimeApiKeyId_idx" ON "runtime_api_key_audit_events"("runtimeApiKeyId");

-- CreateIndex
CREATE INDEX "worker_dispatches_workflowRunId_idx" ON "worker_dispatches"("workflowRunId");

-- CreateIndex
CREATE INDEX "worker_dispatches_executionProviderId_idx" ON "worker_dispatches"("executionProviderId");

-- CreateIndex
CREATE INDEX "worker_dispatches_hostId_idx" ON "worker_dispatches"("hostId");

-- CreateIndex
CREATE INDEX "orchestration_profiles_tenantId_idx" ON "orchestration_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "orchestration_profile_versions_orchestrationProfileId_idx" ON "orchestration_profile_versions"("orchestrationProfileId");

-- CreateIndex
CREATE INDEX "prompt_manifests_tenantId_idx" ON "prompt_manifests"("tenantId");

-- CreateIndex
CREATE INDEX "review_profiles_tenantId_idx" ON "review_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "review_profile_versions_reviewProfileId_idx" ON "review_profile_versions"("reviewProfileId");

-- CreateIndex
CREATE INDEX "review_prompt_sets_reviewProfileId_idx" ON "review_prompt_sets"("reviewProfileId");

-- CreateIndex
CREATE INDEX "workflow_run_reviews_workflowRunId_idx" ON "workflow_run_reviews"("workflowRunId");

-- CreateIndex
CREATE INDEX "workflow_run_reviews_reviewProfileId_idx" ON "workflow_run_reviews"("reviewProfileId");

-- CreateIndex
CREATE INDEX "review_round_outputs_workflowRunReviewId_idx" ON "review_round_outputs"("workflowRunReviewId");

-- CreateIndex
CREATE INDEX "review_evaluations_workflowRunReviewId_idx" ON "review_evaluations"("workflowRunReviewId");

-- CreateIndex
CREATE INDEX "review_comments_workflowRunReviewId_idx" ON "review_comments"("workflowRunReviewId");

-- CreateIndex
CREATE INDEX "work_item_dependencies_workItemId_idx" ON "work_item_dependencies"("workItemId");

-- CreateIndex
CREATE INDEX "work_item_dependencies_dependsOnWorkItemId_idx" ON "work_item_dependencies"("dependsOnWorkItemId");

-- CreateIndex
CREATE INDEX "dependency_snapshots_workItemId_idx" ON "dependency_snapshots"("workItemId");

-- CreateIndex
CREATE INDEX "dependency_policies_tenantId_idx" ON "dependency_policies"("tenantId");

-- CreateIndex
CREATE INDEX "dependency_overrides_workItemId_idx" ON "dependency_overrides"("workItemId");

-- CreateIndex
CREATE INDEX "feature_delivery_runs_tenantId_idx" ON "feature_delivery_runs"("tenantId");

-- CreateIndex
CREATE INDEX "feature_delivery_runs_repositoryMappingId_idx" ON "feature_delivery_runs"("repositoryMappingId");

-- CreateIndex
CREATE INDEX "feature_delivery_work_items_featureDeliveryRunId_idx" ON "feature_delivery_work_items"("featureDeliveryRunId");

-- CreateIndex
CREATE INDEX "feature_delivery_work_items_workItemId_idx" ON "feature_delivery_work_items"("workItemId");

-- CreateIndex
CREATE INDEX "feature_delivery_batches_featureDeliveryRunId_idx" ON "feature_delivery_batches"("featureDeliveryRunId");

-- CreateIndex
CREATE INDEX "feature_delivery_assets_featureDeliveryRunId_idx" ON "feature_delivery_assets"("featureDeliveryRunId");

-- CreateIndex
CREATE INDEX "connector_comment_threads_connectorId_idx" ON "connector_comment_threads"("connectorId");

-- CreateIndex
CREATE INDEX "connector_comment_threads_workItemId_idx" ON "connector_comment_threads"("workItemId");

-- CreateIndex
CREATE INDEX "connector_comment_messages_threadId_idx" ON "connector_comment_messages"("threadId");

-- CreateIndex
CREATE INDEX "connector_mentions_messageId_idx" ON "connector_mentions"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_channel_types_key_key" ON "communication_channel_types"("key");

-- CreateIndex
CREATE INDEX "communication_channels_tenantId_idx" ON "communication_channels"("tenantId");

-- CreateIndex
CREATE INDEX "communication_channels_channelTypeId_idx" ON "communication_channels"("channelTypeId");

-- CreateIndex
CREATE INDEX "communication_channel_pairings_channelId_idx" ON "communication_channel_pairings"("channelId");

-- CreateIndex
CREATE INDEX "communication_channel_memberships_channelId_idx" ON "communication_channel_memberships"("channelId");

-- CreateIndex
CREATE INDEX "communication_channel_policies_channelId_idx" ON "communication_channel_policies"("channelId");

-- CreateIndex
CREATE INDEX "conversation_threads_channelId_idx" ON "conversation_threads"("channelId");

-- CreateIndex
CREATE INDEX "conversation_threads_workflowRunId_idx" ON "conversation_threads"("workflowRunId");

-- CreateIndex
CREATE INDEX "conversation_messages_threadId_idx" ON "conversation_messages"("threadId");

-- CreateIndex
CREATE INDEX "conversation_action_requests_threadId_idx" ON "conversation_action_requests"("threadId");

-- CreateIndex
CREATE INDEX "conversation_subscriptions_channelId_idx" ON "conversation_subscriptions"("channelId");

-- CreateIndex
CREATE INDEX "identity_providers_tenantId_idx" ON "identity_providers"("tenantId");

-- CreateIndex
CREATE INDEX "federated_identity_links_identityProviderId_idx" ON "federated_identity_links"("identityProviderId");

-- CreateIndex
CREATE INDEX "federated_identity_links_internalUserId_idx" ON "federated_identity_links"("internalUserId");

-- CreateIndex
CREATE INDEX "service_integrations_tenantId_idx" ON "service_integrations"("tenantId");

-- CreateIndex
CREATE INDEX "integration_session_links_serviceIntegrationId_idx" ON "integration_session_links"("serviceIntegrationId");

-- CreateIndex
CREATE INDEX "repository_event_subscriptions_repositoryMappingId_idx" ON "repository_event_subscriptions"("repositoryMappingId");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_idx" ON "audit_events"("tenantId");

-- CreateIndex
CREATE INDEX "audit_events_resourceType_resourceId_idx" ON "audit_events"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_platformTypeId_fkey" FOREIGN KEY ("platformTypeId") REFERENCES "platform_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_endpoints" ADD CONSTRAINT "connector_endpoints_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_capabilities" ADD CONSTRAINT "connector_capabilities_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_taxonomy_caches" ADD CONSTRAINT "connector_taxonomy_caches_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_scope_mappings" ADD CONSTRAINT "connector_scope_mappings_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_secrets" ADD CONSTRAINT "connection_secrets_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_mappings" ADD CONSTRAINT "repository_mappings_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_mappings" ADD CONSTRAINT "repository_mappings_executionProfileId_fkey" FOREIGN KEY ("executionProfileId") REFERENCES "execution_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_repositoryMappingId_fkey" FOREIGN KEY ("repositoryMappingId") REFERENCES "repository_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_targets" ADD CONSTRAINT "routing_targets_routingRuleId_fkey" FOREIGN KEY ("routingRuleId") REFERENCES "routing_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_targets" ADD CONSTRAINT "routing_targets_outboundDestinationId_fkey" FOREIGN KEY ("outboundDestinationId") REFERENCES "outbound_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_conditions" ADD CONSTRAINT "trigger_conditions_triggerPolicyId_fkey" FOREIGN KEY ("triggerPolicyId") REFERENCES "trigger_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_actions" ADD CONSTRAINT "trigger_actions_triggerPolicyId_fkey" FOREIGN KEY ("triggerPolicyId") REFERENCES "trigger_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_scenarios" ADD CONSTRAINT "workflow_scenarios_triggerPolicyId_fkey" FOREIGN KEY ("triggerPolicyId") REFERENCES "trigger_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_scenarios" ADD CONSTRAINT "workflow_scenarios_executionProfileId_fkey" FOREIGN KEY ("executionProfileId") REFERENCES "execution_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_scenario_bindings" ADD CONSTRAINT "workflow_scenario_bindings_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "workflow_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_scenario_bindings" ADD CONSTRAINT "workflow_scenario_bindings_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_scenario_bindings" ADD CONSTRAINT "workflow_scenario_bindings_repositoryMappingId_fkey" FOREIGN KEY ("repositoryMappingId") REFERENCES "repository_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_scenario_steps" ADD CONSTRAINT "workflow_scenario_steps_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "workflow_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_work_items" ADD CONSTRAINT "inbound_work_items_connectorInstanceId_fkey" FOREIGN KEY ("connectorInstanceId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_work_items" ADD CONSTRAINT "inbound_work_items_repositoryMappingId_fkey" FOREIGN KEY ("repositoryMappingId") REFERENCES "repository_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "inbound_work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_repositoryMappingId_fkey" FOREIGN KEY ("repositoryMappingId") REFERENCES "repository_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_executionProfileId_fkey" FOREIGN KEY ("executionProfileId") REFERENCES "execution_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflowScenarioId_fkey" FOREIGN KEY ("workflowScenarioId") REFERENCES "workflow_scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_parentWorkflowRunId_fkey" FOREIGN KEY ("parentWorkflowRunId") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_log_events" ADD CONSTRAINT "workflow_log_events_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_destinations" ADD CONSTRAINT "outbound_destinations_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_delivery_attempts" ADD CONSTRAINT "outbound_delivery_attempts_outboundDestinationId_fkey" FOREIGN KEY ("outboundDestinationId") REFERENCES "outbound_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_delivery_attempts" ADD CONSTRAINT "outbound_delivery_attempts_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_delivery_attempts" ADD CONSTRAINT "outbound_delivery_attempts_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_profiles" ADD CONSTRAINT "runtime_profiles_executionProfileId_fkey" FOREIGN KEY ("executionProfileId") REFERENCES "execution_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_provider_hosts" ADD CONSTRAINT "execution_provider_hosts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "execution_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_host_sessions" ADD CONSTRAINT "execution_host_sessions_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "execution_provider_hosts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_api_key_audit_events" ADD CONSTRAINT "runtime_api_key_audit_events_runtimeApiKeyId_fkey" FOREIGN KEY ("runtimeApiKeyId") REFERENCES "runtime_api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_dispatches" ADD CONSTRAINT "worker_dispatches_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_dispatches" ADD CONSTRAINT "worker_dispatches_executionProviderId_fkey" FOREIGN KEY ("executionProviderId") REFERENCES "execution_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_dispatches" ADD CONSTRAINT "worker_dispatches_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "execution_provider_hosts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_profile_versions" ADD CONSTRAINT "orchestration_profile_versions_orchestrationProfileId_fkey" FOREIGN KEY ("orchestrationProfileId") REFERENCES "orchestration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_profile_versions" ADD CONSTRAINT "review_profile_versions_reviewProfileId_fkey" FOREIGN KEY ("reviewProfileId") REFERENCES "review_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_prompt_sets" ADD CONSTRAINT "review_prompt_sets_reviewProfileId_fkey" FOREIGN KEY ("reviewProfileId") REFERENCES "review_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_reviews" ADD CONSTRAINT "workflow_run_reviews_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_reviews" ADD CONSTRAINT "workflow_run_reviews_reviewProfileId_fkey" FOREIGN KEY ("reviewProfileId") REFERENCES "review_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_round_outputs" ADD CONSTRAINT "review_round_outputs_workflowRunReviewId_fkey" FOREIGN KEY ("workflowRunReviewId") REFERENCES "workflow_run_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_evaluations" ADD CONSTRAINT "review_evaluations_workflowRunReviewId_fkey" FOREIGN KEY ("workflowRunReviewId") REFERENCES "workflow_run_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_workflowRunReviewId_fkey" FOREIGN KEY ("workflowRunReviewId") REFERENCES "workflow_run_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "inbound_work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_dependsOnWorkItemId_fkey" FOREIGN KEY ("dependsOnWorkItemId") REFERENCES "inbound_work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency_snapshots" ADD CONSTRAINT "dependency_snapshots_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "inbound_work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency_overrides" ADD CONSTRAINT "dependency_overrides_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "inbound_work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_delivery_runs" ADD CONSTRAINT "feature_delivery_runs_repositoryMappingId_fkey" FOREIGN KEY ("repositoryMappingId") REFERENCES "repository_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_delivery_work_items" ADD CONSTRAINT "feature_delivery_work_items_featureDeliveryRunId_fkey" FOREIGN KEY ("featureDeliveryRunId") REFERENCES "feature_delivery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_delivery_work_items" ADD CONSTRAINT "feature_delivery_work_items_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "inbound_work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_delivery_batches" ADD CONSTRAINT "feature_delivery_batches_featureDeliveryRunId_fkey" FOREIGN KEY ("featureDeliveryRunId") REFERENCES "feature_delivery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_delivery_assets" ADD CONSTRAINT "feature_delivery_assets_featureDeliveryRunId_fkey" FOREIGN KEY ("featureDeliveryRunId") REFERENCES "feature_delivery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_comment_threads" ADD CONSTRAINT "connector_comment_threads_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_comment_threads" ADD CONSTRAINT "connector_comment_threads_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "inbound_work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_comment_messages" ADD CONSTRAINT "connector_comment_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "connector_comment_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_mentions" ADD CONSTRAINT "connector_mentions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "connector_comment_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_channels" ADD CONSTRAINT "communication_channels_channelTypeId_fkey" FOREIGN KEY ("channelTypeId") REFERENCES "communication_channel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_channel_pairings" ADD CONSTRAINT "communication_channel_pairings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "communication_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_channel_memberships" ADD CONSTRAINT "communication_channel_memberships_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "communication_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_channel_policies" ADD CONSTRAINT "communication_channel_policies_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "communication_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "communication_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_action_requests" ADD CONSTRAINT "conversation_action_requests_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_subscriptions" ADD CONSTRAINT "conversation_subscriptions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "communication_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_identity_links" ADD CONSTRAINT "federated_identity_links_identityProviderId_fkey" FOREIGN KEY ("identityProviderId") REFERENCES "identity_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_session_links" ADD CONSTRAINT "integration_session_links_serviceIntegrationId_fkey" FOREIGN KEY ("serviceIntegrationId") REFERENCES "service_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_event_subscriptions" ADD CONSTRAINT "repository_event_subscriptions_repositoryMappingId_fkey" FOREIGN KEY ("repositoryMappingId") REFERENCES "repository_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
