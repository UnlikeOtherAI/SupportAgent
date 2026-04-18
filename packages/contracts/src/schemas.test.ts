import { describe, it, expect } from 'vitest';
import {
  WorkflowType,
  WorkflowRunStatus,
  WorkItemKind,
  ReviewTargetType,
  OutputVisibility,
  TriageStage,
  BuildStage,
  MergeStage,
  ReproductionStatus,
  WorkItemSchema,
  WorkflowRunSchema,
  FindingSchema,
  FinalReportSchema,
  WorkerJobSchema,
  ApiErrorSchema,
  GitHubAuthModeSchema,
  GitHubConnectorConfigSchema,
} from './index.js';

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

const now = new Date().toISOString();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe('WorkflowType', () => {
  it('accepts valid values', () => {
    expect(WorkflowType.parse('triage')).toBe('triage');
    expect(WorkflowType.parse('build')).toBe('build');
    expect(WorkflowType.parse('merge')).toBe('merge');
  });

  it('rejects invalid values', () => {
    expect(() => WorkflowType.parse('deploy')).toThrow();
    expect(() => WorkflowType.parse('')).toThrow();
    expect(() => WorkflowType.parse(123)).toThrow();
  });
});

describe('WorkflowRunStatus', () => {
  it('accepts all valid statuses', () => {
    const statuses = [
      'queued', 'blocked', 'dispatched', 'running', 'cancel_requested',
      'awaiting_review', 'awaiting_human',
      'succeeded', 'failed', 'canceled', 'lost',
    ];
    for (const s of statuses) {
      expect(WorkflowRunStatus.parse(s)).toBe(s);
    }
  });

  it('rejects invalid status', () => {
    expect(() => WorkflowRunStatus.parse('pending')).toThrow();
  });
});

describe('WorkItemKind', () => {
  it('accepts valid values', () => {
    expect(WorkItemKind.parse('issue')).toBe('issue');
    expect(WorkItemKind.parse('review_target')).toBe('review_target');
  });

  it('rejects invalid values', () => {
    expect(() => WorkItemKind.parse('bug')).toThrow();
  });
});

describe('ReviewTargetType', () => {
  it('accepts valid values', () => {
    expect(ReviewTargetType.parse('pull_request')).toBe('pull_request');
    expect(ReviewTargetType.parse('merge_request')).toBe('merge_request');
  });

  it('rejects invalid values', () => {
    expect(() => ReviewTargetType.parse('commit')).toThrow();
  });
});

describe('OutputVisibility', () => {
  it('accepts valid values', () => {
    expect(OutputVisibility.parse('full')).toBe('full');
    expect(OutputVisibility.parse('redacted')).toBe('redacted');
    expect(OutputVisibility.parse('metadata_only')).toBe('metadata_only');
  });

  it('rejects invalid values', () => {
    expect(() => OutputVisibility.parse('hidden')).toThrow();
  });
});

describe('GitHubAuthModeSchema', () => {
  it('accepts supported auth modes', () => {
    expect(GitHubAuthModeSchema.parse('oauth')).toBe('oauth');
    expect(GitHubAuthModeSchema.parse('token')).toBe('token');
    expect(GitHubAuthModeSchema.parse('local_gh')).toBe('local_gh');
  });

  it('rejects unsupported auth modes', () => {
    expect(() => GitHubAuthModeSchema.parse('local')).toThrow();
  });
});

describe('GitHubConnectorConfigSchema', () => {
  it('accepts an empty config', () => {
    expect(GitHubConnectorConfigSchema.parse({})).toEqual({});
  });

  it('accepts local gh defaults', () => {
    expect(
      GitHubConnectorConfigSchema.parse({
        auth_mode: 'local_gh',
        repo_owner: 'UnlikeOtherAI',
        repo_name: 'SupportAgent',
      }),
    ).toEqual({
      auth_mode: 'local_gh',
      repo_owner: 'UnlikeOtherAI',
      repo_name: 'SupportAgent',
    });
  });

  it('rejects empty owner and repo values', () => {
    expect(() => GitHubConnectorConfigSchema.parse({ repo_owner: '' })).toThrow();
    expect(() => GitHubConnectorConfigSchema.parse({ repo_name: '' })).toThrow();
  });
});

describe('TriageStage', () => {
  it('accepts valid values', () => {
    const stages = [
      'intake', 'context_fetch', 'repository_setup',
      'investigation', 'reproduction', 'findings', 'delivery',
    ];
    for (const s of stages) {
      expect(TriageStage.parse(s)).toBe(s);
    }
  });

  it('rejects invalid values', () => {
    expect(() => TriageStage.parse('deploy')).toThrow();
  });
});

describe('BuildStage', () => {
  it('accepts valid values', () => {
    const stages = [
      'context_fetch', 'repository_setup', 'implementation',
      'validation', 'internal_review', 'branch_push', 'pr_open',
    ];
    for (const s of stages) {
      expect(BuildStage.parse(s)).toBe(s);
    }
  });

  it('rejects invalid values', () => {
    expect(() => BuildStage.parse('deploy')).toThrow();
  });
});

describe('MergeStage', () => {
  it('accepts valid values', () => {
    const stages = [
      'context_fetch', 'repository_setup', 'base_sync',
      'conflict_resolution', 'validation', 'internal_review', 'merge_execute',
    ];
    for (const s of stages) {
      expect(MergeStage.parse(s)).toBe(s);
    }
  });

  it('rejects invalid values', () => {
    expect(() => MergeStage.parse('deploy')).toThrow();
  });
});

describe('ReproductionStatus', () => {
  it('accepts valid values', () => {
    const statuses = [
      'not_attempted', 'attempted', 'reproduced', 'not_reproduced', 'inconclusive',
    ];
    for (const s of statuses) {
      expect(ReproductionStatus.parse(s)).toBe(s);
    }
  });

  it('rejects invalid values', () => {
    expect(() => ReproductionStatus.parse('unknown')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkItemSchema
// ---------------------------------------------------------------------------

describe('WorkItemSchema', () => {
  function validWorkItem(overrides: Record<string, unknown> = {}) {
    return {
      workItemId: uuid(),
      connectorInstanceId: uuid(),
      platformType: 'github',
      workItemKind: 'issue' as const,
      externalItemId: '42',
      title: 'Something broke',
      dedupeKey: 'github:42',
      ...overrides,
    };
  }

  it('accepts a minimal valid work item', () => {
    const result = WorkItemSchema.parse(validWorkItem());
    expect(result.workItemKind).toBe('issue');
    expect(result.title).toBe('Something broke');
  });

  it('accepts a fully populated work item', () => {
    const full = validWorkItem({
      externalUrl: 'https://github.com/org/repo/issues/42',
      body: 'Detailed description',
      priority: 'high',
      severity: 'critical',
      status: 'open',
      taxonomy: { area: 'auth', component: 'login' },
      attachments: [{
        attachmentId: 'att-1',
        url: 'https://example.com/file.png',
        mimeType: 'image/png',
        filename: 'file.png',
        description: 'Screenshot',
      }],
      comments: [{
        commentId: 'c-1',
        author: 'user1',
        body: 'I can reproduce this',
        createdAt: now,
        isBotMention: false,
      }],
      dependencyRefs: ['dep-1'],
      sourcePayloadRef: 'ref-abc',
      repositoryMappingId: uuid(),
    });
    const result = WorkItemSchema.parse(full);
    expect(result.attachments).toHaveLength(1);
    expect(result.comments).toHaveLength(1);
  });

  it('accepts review_target kind with review-specific fields', () => {
    const reviewItem = validWorkItem({
      workItemKind: 'review_target',
      repositoryRef: 'org/repo',
      baseRef: 'main',
      headRef: 'feature-branch',
      commitRange: 'abc123..def456',
      diffRef: 'https://github.com/org/repo/pull/10.diff',
      reviewTargetType: 'pull_request',
      reviewTargetNumber: 10,
    });
    const result = WorkItemSchema.parse(reviewItem);
    expect(result.workItemKind).toBe('review_target');
    expect(result.reviewTargetType).toBe('pull_request');
    expect(result.reviewTargetNumber).toBe(10);
  });

  it('allows optional fields to be omitted', () => {
    const result = WorkItemSchema.parse(validWorkItem());
    expect(result.body).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.attachments).toBeUndefined();
    expect(result.comments).toBeUndefined();
    expect(result.repositoryRef).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() => WorkItemSchema.parse({})).toThrow();
    expect(() => WorkItemSchema.parse({ workItemId: uuid() })).toThrow();
  });

  it('rejects invalid workItemId (non-uuid)', () => {
    expect(() => WorkItemSchema.parse(validWorkItem({ workItemId: 'not-a-uuid' }))).toThrow();
  });

  it('rejects invalid externalUrl', () => {
    expect(() => WorkItemSchema.parse(validWorkItem({ externalUrl: 'not-a-url' }))).toThrow();
  });

  it('rejects invalid workItemKind', () => {
    expect(() => WorkItemSchema.parse(validWorkItem({ workItemKind: 'bug' }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkflowRunSchema
// ---------------------------------------------------------------------------

describe('WorkflowRunSchema', () => {
  function validRun(overrides: Record<string, unknown> = {}) {
    return {
      workflowRunId: uuid(),
      workflowType: 'triage' as const,
      workItemId: uuid(),
      repositoryMappingId: uuid(),
      status: 'queued' as const,
      createdAt: now,
      ...overrides,
    };
  }

  it('accepts a valid workflow run', () => {
    const result = WorkflowRunSchema.parse(validRun());
    expect(result.workflowType).toBe('triage');
    expect(result.status).toBe('queued');
  });

  it('applies default attemptNumber', () => {
    const result = WorkflowRunSchema.parse(validRun());
    expect(result.attemptNumber).toBe(1);
  });

  it('allows overriding attemptNumber', () => {
    const result = WorkflowRunSchema.parse(validRun({ attemptNumber: 3 }));
    expect(result.attemptNumber).toBe(3);
  });

  it('allows optional fields to be omitted', () => {
    const result = WorkflowRunSchema.parse(validRun());
    expect(result.executionProfileId).toBeUndefined();
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.blockedReason).toBeUndefined();
  });

  it('accepts a fully populated workflow run', () => {
    const full = validRun({
      executionProfileId: uuid(),
      orchestrationProfileId: uuid(),
      reviewProfileId: uuid(),
      workflowScenarioId: uuid(),
      parentWorkflowRunId: uuid(),
      currentStage: 'investigation',
      attemptNumber: 2,
      startedAt: now,
      completedAt: now,
      blockedReason: 'awaiting dependency',
      providerExecutionRef: 'exec-ref-123',
      acceptedDispatchAttempt: uuid(),
    });
    const result = WorkflowRunSchema.parse(full);
    expect(result.currentStage).toBe('investigation');
  });

  it('rejects missing required fields', () => {
    expect(() => WorkflowRunSchema.parse({})).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => WorkflowRunSchema.parse(validRun({ status: 'pending' }))).toThrow();
  });

  it('rejects invalid workflowType', () => {
    expect(() => WorkflowRunSchema.parse(validRun({ workflowType: 'deploy' }))).toThrow();
  });

  it('rejects invalid createdAt (non-datetime)', () => {
    expect(() => WorkflowRunSchema.parse(validRun({ createdAt: 'yesterday' }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FindingSchema
// ---------------------------------------------------------------------------

describe('FindingSchema', () => {
  function validFinding(overrides: Record<string, unknown> = {}) {
    return {
      findingId: uuid(),
      workflowRunId: uuid(),
      summary: 'The login endpoint returns 500 when email contains a plus sign',
      ...overrides,
    };
  }

  it('accepts a minimal valid finding', () => {
    const result = FindingSchema.parse(validFinding());
    expect(result.summary).toContain('login endpoint');
  });

  it('accepts a fully populated finding', () => {
    const full = validFinding({
      rootCauseHypothesis: 'URL encoding issue in email validation',
      confidence: 'high',
      reproductionStatus: 'reproduced',
      affectedAreas: ['auth', 'email-validation'],
      evidenceRefs: ['log-ref-1', 'screenshot-ref-2'],
      recommendedNextAction: 'Fix URL encoding in auth middleware',
      outboundSummary: 'We found a bug in email validation',
      suspectCommits: ['abc123'],
      suspectFiles: ['src/auth/validate.ts'],
      userVisibleImpact: 'Users with + in email cannot log in',
      designNotes: 'Consider using RFC 5322 compliant parser',
    });
    const result = FindingSchema.parse(full);
    expect(result.confidence).toBe('high');
    expect(result.reproductionStatus).toBe('reproduced');
  });

  it('allows optional fields to be omitted', () => {
    const result = FindingSchema.parse(validFinding());
    expect(result.rootCauseHypothesis).toBeUndefined();
    expect(result.confidence).toBeUndefined();
    expect(result.affectedAreas).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() => FindingSchema.parse({})).toThrow();
    expect(() => FindingSchema.parse({ findingId: uuid() })).toThrow();
  });

  it('rejects invalid confidence value', () => {
    expect(() => FindingSchema.parse(validFinding({ confidence: 'very_high' }))).toThrow();
  });

  it('rejects invalid reproductionStatus', () => {
    expect(() => FindingSchema.parse(validFinding({ reproductionStatus: 'unknown' }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FinalReportSchema
// ---------------------------------------------------------------------------

describe('FinalReportSchema', () => {
  function validReport(overrides: Record<string, unknown> = {}) {
    return {
      workflowRunId: uuid(),
      workflowType: 'triage' as const,
      status: 'succeeded' as const,
      summary: 'Triage completed successfully',
      stageResults: [
        { stage: 'intake', status: 'passed' as const, summary: 'OK', durationMs: 120 },
        { stage: 'investigation', status: 'passed' as const },
      ],
      ...overrides,
    };
  }

  it('accepts a valid final report', () => {
    const result = FinalReportSchema.parse(validReport());
    expect(result.stageResults).toHaveLength(2);
  });

  it('accepts a fully populated final report', () => {
    const full = validReport({
      artifactRefs: ['art-1'],
      logRef: 'log-ref-abc',
      findingsRef: 'findings-ref-def',
      reviewOutcome: 'approved',
      outboundActions: [{
        destinationId: 'dest-1',
        actionType: 'comment',
        status: 'delivered',
        externalRef: 'ext-ref-1',
      }],
      branchName: 'fix/login-bug',
      pullRequestRef: 'https://github.com/org/repo/pull/99',
      mergeRef: 'merge-sha-abc',
      distributionRefs: ['dist-1'],
    });
    const result = FinalReportSchema.parse(full);
    expect(result.outboundActions).toHaveLength(1);
    expect(result.branchName).toBe('fix/login-bug');
  });

  it('allows optional fields to be omitted', () => {
    const result = FinalReportSchema.parse(validReport());
    expect(result.artifactRefs).toBeUndefined();
    expect(result.outboundActions).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() => FinalReportSchema.parse({})).toThrow();
  });

  it('rejects invalid stageResults status', () => {
    expect(() => FinalReportSchema.parse(validReport({
      stageResults: [{ stage: 'intake', status: 'running' }],
    }))).toThrow();
  });

  it('rejects invalid workflowType', () => {
    expect(() => FinalReportSchema.parse(validReport({ workflowType: 'deploy' }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkerJobSchema
// ---------------------------------------------------------------------------

describe('WorkerJobSchema', () => {
  function validJob(overrides: Record<string, unknown> = {}) {
    return {
      jobId: uuid(),
      workflowRunId: uuid(),
      workflowType: 'triage' as const,
      apiBaseUrl: 'https://api.example.com',
      workerSharedSecret: 'secret-token-123',
      sourceConnectorKey: 'github-main',
      targetRepo: 'org/repo',
      executionProfile: 'standard',
      ...overrides,
    };
  }

  it('accepts a valid worker job', () => {
    const result = WorkerJobSchema.parse(validJob());
    expect(result.workflowType).toBe('triage');
  });

  it('applies default reproductionPolicy', () => {
    const result = WorkerJobSchema.parse(validJob());
    expect(result.reproductionPolicy).toBe('when_supported');
  });

  it('applies default artifactUploadMode', () => {
    const result = WorkerJobSchema.parse(validJob());
    expect(result.artifactUploadMode).toBe('api');
  });

  it('applies default timeoutSeconds', () => {
    const result = WorkerJobSchema.parse(validJob());
    expect(result.timeoutSeconds).toBe(3600);
  });

  it('allows overriding defaults', () => {
    const result = WorkerJobSchema.parse(validJob({
      reproductionPolicy: 'always',
      artifactUploadMode: 'gcs_direct',
      timeoutSeconds: 7200,
    }));
    expect(result.reproductionPolicy).toBe('always');
    expect(result.artifactUploadMode).toBe('gcs_direct');
    expect(result.timeoutSeconds).toBe(7200);
  });

  it('accepts a fully populated worker job', () => {
    const full = validJob({
      sourcePayloadRef: 'payload-ref-1',
      targetCommit: 'abc123',
      targetBranch: 'main',
      reviewProfileId: uuid(),
      orchestrationProfileId: uuid(),
      preferredModelRouting: 'proxy',
      promptManifestRef: 'manifest-ref',
      scenarioInstructionRef: 'scenario-ref',
      reproductionPolicy: 'always',
      authRefs: { github: 'token-ref-1' },
      artifactUploadMode: 'gcs_direct',
      timeoutSeconds: 1800,
      attachedInputRefs: ['input-1', 'input-2'],
      providerHints: { model: 'claude-opus-4-20250514' },
      runtimeCapabilities: ['docker', 'gpu'],
      networkRequirements: ['github.com'],
    });
    const result = WorkerJobSchema.parse(full);
    expect(result.preferredModelRouting).toBe('proxy');
    expect(result.runtimeCapabilities).toHaveLength(2);
  });

  it('allows optional fields to be omitted', () => {
    const result = WorkerJobSchema.parse(validJob());
    expect(result.sourcePayloadRef).toBeUndefined();
    expect(result.targetCommit).toBeUndefined();
    expect(result.authRefs).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() => WorkerJobSchema.parse({})).toThrow();
  });

  it('rejects invalid apiBaseUrl', () => {
    expect(() => WorkerJobSchema.parse(validJob({ apiBaseUrl: 'not-a-url' }))).toThrow();
  });

  it('rejects invalid reproductionPolicy', () => {
    expect(() => WorkerJobSchema.parse(validJob({ reproductionPolicy: 'sometimes' }))).toThrow();
  });

  it('rejects invalid preferredModelRouting', () => {
    expect(() => WorkerJobSchema.parse(validJob({ preferredModelRouting: 'direct' }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ApiErrorSchema
// ---------------------------------------------------------------------------

describe('ApiErrorSchema', () => {
  it('accepts a valid error', () => {
    const result = ApiErrorSchema.parse({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('accepts error with details', () => {
    const result = ApiErrorSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email', reason: 'invalid format' },
      },
    });
    expect(result.error.details).toEqual({ field: 'email', reason: 'invalid format' });
  });

  it('allows details to be omitted', () => {
    const result = ApiErrorSchema.parse({
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
    expect(result.error.details).toBeUndefined();
  });

  it('rejects missing error wrapper', () => {
    expect(() => ApiErrorSchema.parse({ code: 'X', message: 'Y' })).toThrow();
  });

  it('rejects missing code', () => {
    expect(() => ApiErrorSchema.parse({ error: { message: 'Y' } })).toThrow();
  });

  it('rejects missing message', () => {
    expect(() => ApiErrorSchema.parse({ error: { code: 'X' } })).toThrow();
  });
});
