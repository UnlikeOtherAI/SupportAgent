import { ZodError, type ZodIssue } from 'zod';
import type {
  ExecutorAst,
  ResolvedExecutor,
  ResolvedSkillMetadata,
  ResolvedStageAst,
  SkillResolver,
  ValidateExecutorOptions,
} from './types.js';

const BANNED_MULTI_STAGE_DELIVERY_KINDS = ['labels', 'state', 'pr'] as const;

function makeIssue(path: Array<string | number>, message: string): ZodIssue {
  return {
    code: 'custom',
    message,
    path,
  };
}

function normalizeRole(role: string): 'SYSTEM' | 'COMPLEMENTARY' | null {
  if (role === 'SYSTEM' || role === 'system') {
    return 'SYSTEM';
  }

  if (role === 'COMPLEMENTARY' || role === 'complementary') {
    return 'COMPLEMENTARY';
  }

  return null;
}

function getLeafStage(ast: ExecutorAst): ExecutorAst['stages'][number] {
  return ast.stages.find((candidate) => !ast.stages.some((stage) => stage.after.includes(candidate.id)))!;
}

function findRequiredPropertyNames(schema: unknown): Set<string> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return new Set();
  }

  const required = (schema as { required?: unknown }).required;
  if (!Array.isArray(required)) {
    return new Set();
  }

  return new Set(required.filter((value): value is string => typeof value === 'string'));
}

function getObjectProperty(schema: unknown, propertyName: string): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return undefined;
  }

  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return undefined;
  }

  return (properties as Record<string, unknown>)[propertyName];
}

function resolveLocalRef(rootSchema: unknown, ref: string): unknown | null {
  if (!ref.startsWith('#/')) {
    return null;
  }

  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = rootSchema;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function schemaRequiresLoopDone(schema: unknown): boolean {
  const rootRequired = findRequiredPropertyNames(schema);
  if (!rootRequired.has('loop')) {
    return false;
  }

  const loopSchema = getObjectProperty(schema, 'loop');
  const loopRequired = findRequiredPropertyNames(loopSchema);
  if (!loopRequired.has('done')) {
    return false;
  }

  const doneSchema = getObjectProperty(loopSchema, 'done');
  return (
    !!doneSchema &&
    typeof doneSchema === 'object' &&
    !Array.isArray(doneSchema) &&
    (doneSchema as { type?: unknown }).type === 'boolean'
  );
}

function extractAllowedKindsFromSchema(
  schema: unknown,
  allowedKinds: Set<string>,
  rootSchema: unknown,
): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return true;
  }

  const typedSchema = schema as {
    const?: unknown;
    enum?: unknown;
    oneOf?: unknown;
    anyOf?: unknown;
    allOf?: unknown;
    items?: unknown;
    prefixItems?: unknown;
    properties?: unknown;
    $ref?: unknown;
  };

  if (typeof typedSchema.$ref === 'string') {
    const resolved = resolveLocalRef(rootSchema, typedSchema.$ref);
    if (resolved === null) {
      return false;
    }

    return extractAllowedKindsFromSchema(resolved, allowedKinds, rootSchema);
  }

  if (typeof typedSchema.const === 'string') {
    allowedKinds.add(typedSchema.const);
  }

  if (Array.isArray(typedSchema.enum)) {
    for (const value of typedSchema.enum) {
      if (typeof value === 'string') {
        allowedKinds.add(value);
      }
    }
  }

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branch = typedSchema[key];
    if (Array.isArray(branch)) {
      for (const item of branch) {
        if (!extractAllowedKindsFromSchema(item, allowedKinds, rootSchema)) {
          return false;
        }
      }
    }
  }

  if (
    typedSchema.properties &&
    typeof typedSchema.properties === 'object' &&
    !Array.isArray(typedSchema.properties)
  ) {
    const kindSchema = (typedSchema.properties as Record<string, unknown>).kind;
    if (kindSchema) {
      if (!extractAllowedKindsFromSchema(kindSchema, allowedKinds, rootSchema)) {
        return false;
      }
    }
  }

  if (typedSchema.items) {
    if (!extractAllowedKindsFromSchema(typedSchema.items, allowedKinds, rootSchema)) {
      return false;
    }
  }

  if (Array.isArray(typedSchema.prefixItems)) {
    for (const item of typedSchema.prefixItems) {
      if (!extractAllowedKindsFromSchema(item, allowedKinds, rootSchema)) {
        return false;
      }
    }
  }

  return true;
}

function findAllowedDeliveryKinds(outputSchema: unknown): Set<string> | null {
  const deliverySchema = getObjectProperty(outputSchema, 'delivery');
  const allowedKinds = new Set<string>();
  if (!deliverySchema || typeof deliverySchema !== 'object' || Array.isArray(deliverySchema)) {
    return allowedKinds;
  }

  const typedDeliverySchema = deliverySchema as { items?: unknown; prefixItems?: unknown };

  if (typedDeliverySchema.items) {
    if (!extractAllowedKindsFromSchema(typedDeliverySchema.items, allowedKinds, outputSchema)) {
      return null;
    }
  }

  if (Array.isArray(typedDeliverySchema.prefixItems)) {
    for (const item of typedDeliverySchema.prefixItems) {
      if (!extractAllowedKindsFromSchema(item, allowedKinds, outputSchema)) {
        return null;
      }
    }
  }

  return allowedKinds;
}

async function resolveSkillRole(
  resolveSkill: SkillResolver,
  name: string,
  expectedRole: 'SYSTEM' | 'COMPLEMENTARY',
  path: Array<string | number>,
): Promise<ResolvedSkillMetadata & { name: string }> {
  const resolved = await resolveSkill(name);
  const normalizedRole = normalizeRole(resolved.role);

  if (normalizedRole !== expectedRole) {
    throw new ZodError([
      makeIssue(path, `Skill '${name}' must resolve to ${expectedRole}, got '${resolved.role}'`),
    ]);
  }

  return {
    name,
    contentHash: resolved.contentHash,
    role: normalizedRole,
    outputSchema: resolved.outputSchema,
  };
}

function validateLeafSafety(ast: ExecutorAst, stages: ResolvedStageAst[]): void {
  const leafStage = stages.find((stage) => stage.id === getLeafStage(ast).id)!;
  const leafSkill = leafStage.resolvedSystemSkill;

  if (ast.stages.length > 1) {
    const allowedKinds = findAllowedDeliveryKinds(leafSkill.outputSchema);
    const leafStageIndex = ast.stages.findIndex((stage) => stage.id === leafStage.id);

    if (allowedKinds === null) {
      throw new ZodError([
        makeIssue(
          ['stages', leafStageIndex, 'system_skill'],
          `Leaf stage '${leafStage.id}' uses skill '${leafSkill.name}' with external $ref not supported in multi-stage delivery validation`,
        ),
      ]);
    }

    for (const bannedKind of BANNED_MULTI_STAGE_DELIVERY_KINDS) {
      if (allowedKinds.has(bannedKind)) {
        throw new ZodError([
          makeIssue(
            ['stages', leafStageIndex, 'system_skill'],
            `Leaf stage '${leafStage.id}' uses skill '${leafSkill.name}' which allows banned delivery kind '${bannedKind}' in a multi-stage executor`,
          ),
        ]);
      }
    }
  }

  if (ast.loop.until_done && !schemaRequiresLoopDone(leafSkill.outputSchema)) {
    throw new ZodError([
      makeIssue(
        ['loop', 'until_done'],
        `Leaf stage '${leafStage.id}' skill '${leafSkill.name}' must require loop.done:boolean when until_done=true`,
      ),
    ]);
  }
}

export async function validateExecutor(
  ast: ExecutorAst,
  options: ValidateExecutorOptions,
): Promise<ResolvedExecutor> {
  const resolvedStages = await Promise.all(
    ast.stages.map(async (stage, stageIndex) => {
      const resolvedSystemSkill = await resolveSkillRole(
        options.resolveSkill,
        stage.system_skill,
        'SYSTEM',
        ['stages', stageIndex, 'system_skill'],
      );

      const resolvedComplementarySkills = await Promise.all(
        stage.complementary.map((name, complementaryIndex) =>
          resolveSkillRole(
            options.resolveSkill,
            name,
            'COMPLEMENTARY',
            ['stages', stageIndex, 'complementary', complementaryIndex],
          ),
        ),
      );

      return {
        ...stage,
        resolvedSystemSkill,
        resolvedComplementarySkills,
      };
    }),
  );

  validateLeafSafety(ast, resolvedStages);

  return {
    ast,
    stages: resolvedStages,
    leafStageId: getLeafStage(ast).id,
  };
}

export type { SkillResolver };
