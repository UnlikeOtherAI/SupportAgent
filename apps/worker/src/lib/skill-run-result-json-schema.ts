import { z, type ZodType } from 'zod';
import { SkillRunResultSchema, type SkillRunResult } from '@support-agent/contracts';

type JsonObject = Record<string, unknown>;

interface ValidationIssue {
  path: string;
  message: string;
}

export function createSkillRunResultSchema(
  schema: Record<string, unknown>,
): ZodType<SkillRunResult> {
  return SkillRunResultSchema.superRefine((value, ctx) => {
    const issues = validateSchema(schema, value, schema, '$');
    for (const issue of issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${issue.path}: ${issue.message}`,
      });
    }
  });
}

export function createTemplateFromJsonSchema(schema: Record<string, unknown>): SkillRunResult {
  const value = materializeTemplate(schema, schema);
  return SkillRunResultSchema.parse(value);
}

function validateSchema(
  schema: unknown,
  value: unknown,
  rootSchema: Record<string, unknown>,
  path: string,
): ValidationIssue[] {
  const resolvedSchema = resolveSchema(schema, rootSchema);
  if (!isObject(resolvedSchema)) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  if (resolvedSchema.const !== undefined && value !== resolvedSchema.const) {
    return [{ path, message: `must equal ${JSON.stringify(resolvedSchema.const)}` }];
  }

  if (Array.isArray(resolvedSchema.enum) && !resolvedSchema.enum.includes(value)) {
    return [{ path, message: `must be one of ${JSON.stringify(resolvedSchema.enum)}` }];
  }

  if (Array.isArray(resolvedSchema.oneOf)) {
    const branches = resolvedSchema.oneOf.map((branch) =>
      validateSchema(branch, value, rootSchema, path),
    );
    if (!branches.some((branchIssues) => branchIssues.length === 0)) {
      return branches[0] ?? [{ path, message: 'did not satisfy any allowed schema branch' }];
    }
    return [];
  }

  if (Array.isArray(resolvedSchema.anyOf)) {
    const branches = resolvedSchema.anyOf.map((branch) =>
      validateSchema(branch, value, rootSchema, path),
    );
    if (!branches.some((branchIssues) => branchIssues.length === 0)) {
      return branches[0] ?? [{ path, message: 'did not satisfy any allowed schema branch' }];
    }
  }

  if (Array.isArray(resolvedSchema.allOf)) {
    for (const branch of resolvedSchema.allOf) {
      issues.push(...validateSchema(branch, value, rootSchema, path));
    }
  }

  if (resolvedSchema.type === 'object') {
    if (!isObject(value)) {
      return [{ path, message: 'must be an object' }];
    }

    const required = Array.isArray(resolvedSchema.required)
      ? resolvedSchema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];
    for (const propertyName of required) {
      if (!(propertyName in value)) {
        issues.push({ path: joinPath(path, propertyName), message: 'is required' });
      }
    }

    if (isObject(resolvedSchema.properties)) {
      for (const [propertyName, propertySchema] of Object.entries(resolvedSchema.properties)) {
        if (propertyName in value) {
          issues.push(
            ...validateSchema(
              propertySchema,
              value[propertyName],
              rootSchema,
              joinPath(path, propertyName),
            ),
          );
        }
      }
    }
  }

  if (resolvedSchema.type === 'array') {
    if (!Array.isArray(value)) {
      return [{ path, message: 'must be an array' }];
    }

    if (typeof resolvedSchema.minItems === 'number' && value.length < resolvedSchema.minItems) {
      issues.push({ path, message: `must contain at least ${resolvedSchema.minItems} item(s)` });
    }

    if (typeof resolvedSchema.maxItems === 'number' && value.length > resolvedSchema.maxItems) {
      issues.push({ path, message: `must contain at most ${resolvedSchema.maxItems} item(s)` });
    }

    if (Array.isArray(resolvedSchema.prefixItems)) {
      resolvedSchema.prefixItems.forEach((itemSchema, index) => {
        if (index < value.length) {
          issues.push(
            ...validateSchema(itemSchema, value[index], rootSchema, `${path}[${index}]`),
          );
        }
      });
    }

    if (resolvedSchema.items !== undefined) {
      value.forEach((entry, index) => {
        issues.push(...validateSchema(resolvedSchema.items, entry, rootSchema, `${path}[${index}]`));
      });
    }
  }

  if (resolvedSchema.type === 'string' && typeof value !== 'string') {
    issues.push({ path, message: 'must be a string' });
  }

  if (resolvedSchema.type === 'boolean' && typeof value !== 'boolean') {
    issues.push({ path, message: 'must be a boolean' });
  }

  return issues;
}

function materializeTemplate(schema: unknown, rootSchema: Record<string, unknown>): unknown {
  const resolvedSchema = resolveSchema(schema, rootSchema);
  if (!isObject(resolvedSchema)) {
    return null;
  }

  if (resolvedSchema.const !== undefined) {
    return resolvedSchema.const;
  }

  if (Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length > 0) {
    return resolvedSchema.enum[0];
  }

  if (Array.isArray(resolvedSchema.oneOf) && resolvedSchema.oneOf.length > 0) {
    return materializeTemplate(resolvedSchema.oneOf[0], rootSchema);
  }

  if (resolvedSchema.type === 'object') {
    const result: JsonObject = {};
    const properties = isObject(resolvedSchema.properties) ? resolvedSchema.properties : {};
    const required = new Set(
      Array.isArray(resolvedSchema.required)
        ? resolvedSchema.required.filter((entry): entry is string => typeof entry === 'string')
        : [],
    );

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (required.has(propertyName)) {
        result[propertyName] = materializeTemplate(propertySchema, rootSchema);
      }
    }

    return result;
  }

  if (resolvedSchema.type === 'array') {
    if (Array.isArray(resolvedSchema.prefixItems) && resolvedSchema.prefixItems.length > 0) {
      return resolvedSchema.prefixItems.map((itemSchema) => materializeTemplate(itemSchema, rootSchema));
    }

    return [];
  }

  if (resolvedSchema.type === 'string') {
    return '';
  }

  if (resolvedSchema.type === 'boolean') {
    return false;
  }

  return null;
}

function resolveSchema(schema: unknown, rootSchema: Record<string, unknown>): JsonObject {
  if (!isObject(schema)) {
    return {};
  }

  if (typeof schema.$ref === 'string') {
    return resolveRef(schema.$ref, rootSchema);
  }

  return schema;
}

function resolveRef(ref: string, rootSchema: Record<string, unknown>): JsonObject {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported JSON schema ref: ${ref}`);
  }

  const parts = ref.slice(2).split('/');
  let current: unknown = rootSchema;
  for (const part of parts) {
    if (!isObject(current) || !(part in current)) {
      throw new Error(`Could not resolve JSON schema ref: ${ref}`);
    }
    current = current[part];
  }

  if (!isObject(current)) {
    throw new Error(`Resolved JSON schema ref is not an object: ${ref}`);
  }

  return current;
}

function joinPath(path: string, propertyName: string): string {
  return path === '$' ? `$.${propertyName}` : `${path}.${propertyName}`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
