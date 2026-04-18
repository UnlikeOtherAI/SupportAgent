import { z } from 'zod';
import type { ExecutorAst } from './types.js';

const StageIdSchema = z
  .string({
    required_error: 'Stage id is required',
    invalid_type_error: 'Stage id must be a string',
  })
  .trim()
  .min(1, 'Stage id cannot be empty');

const OrderedInputsFromObjectSchema = z.record(
  z.enum(['this_iteration', 'previous_iteration']),
);

const InputsFromSchema = z
  .union([z.array(StageIdSchema), OrderedInputsFromObjectSchema])
  .optional()
  .transform((value) => {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.map((stageId) => ({ stageId, scope: 'this_iteration' as const }));
    }

    return Object.entries(value).map(([stageId, scope]) => ({ stageId, scope }));
  });

const StageSchema = z.object({
  id: StageIdSchema,
  parallel: z
    .number({
      required_error: 'parallel is required',
      invalid_type_error: 'parallel must be a number',
    })
    .int('parallel must be an integer')
    .positive('parallel must be greater than 0'),
  system_skill: z
    .string({
      required_error: 'system_skill is required',
      invalid_type_error: 'system_skill must be a string',
    })
    .trim()
    .min(1, 'system_skill cannot be empty'),
  complementary: z.array(z.string().trim().min(1)).default([]),
  executor: z
    .string({
      required_error: 'executor is required',
      invalid_type_error: 'executor must be a string',
    })
    .trim()
    .min(1, 'executor cannot be empty'),
  after: z.array(StageIdSchema).default([]),
  inputs_from: InputsFromSchema,
  task_prompt: z
    .string({
      required_error: 'task_prompt is required',
      invalid_type_error: 'task_prompt must be a string',
    })
    .min(1, 'task_prompt cannot be empty'),
});

const LoopSchema = z.object({
  enabled: z.boolean().default(false),
  max_iterations: z
    .number({
      invalid_type_error: 'max_iterations must be a number',
    })
    .int('max_iterations must be an integer')
    .positive('max_iterations must be greater than 0')
    .default(1),
  until_done: z.boolean().default(false),
});

export const ExecutorYamlSchema = z.object({
  version: z.literal(1, {
    errorMap: () => ({
      message: 'Executor version must be 1',
    }),
  }),
  key: z
    .string({
      required_error: 'key is required',
      invalid_type_error: 'key must be a string',
    })
    .trim()
    .min(1, 'key cannot be empty'),
  display_name: z
    .string({
      required_error: 'display_name is required',
      invalid_type_error: 'display_name must be a string',
    })
    .min(1, 'display_name cannot be empty'),
  preamble: z
    .string({
      required_error: 'preamble is required',
      invalid_type_error: 'preamble must be a string',
    })
    .default(''),
  guardrails: z
    .object({
      fan_out_min_success_rate: z
        .number()
        .min(0, 'fan_out_min_success_rate must be between 0 and 1')
        .max(1, 'fan_out_min_success_rate must be between 0 and 1')
        .optional(),
      consolidator_max_retries: z
        .number()
        .int('consolidator_max_retries must be an integer')
        .min(0, 'consolidator_max_retries cannot be negative')
        .optional(),
      loop_safety: z
        .object({
          min_iteration_change: z.boolean().optional(),
          no_self_retrigger: z.boolean().default(true),
        })
        .optional(),
    })
    .optional(),
  stages: z.array(StageSchema).min(1, 'At least one stage is required'),
  loop: LoopSchema.default({
    enabled: false,
    max_iterations: 1,
    until_done: false,
  }),
});

export type ExecutorYamlDocument = z.infer<typeof ExecutorYamlSchema>;
export type ExecutorYamlAst = ExecutorAst;
