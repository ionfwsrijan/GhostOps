import { z } from 'zod';
import { RiskLevel } from '../database/types.js';

/**
 * Every tool is defined by:
 *  - a strict Zod input schema (NO free-form params),
 *  - a risk level (read-only vs destructive),
 *  - an executor that receives validated input + execution context.
 *
 * The agent can only invoke tools in the allowlist and only with
 * schema-validated arguments.
 */
export interface ToolResult {
  success: boolean;
  summary: string;
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  incidentId: string;
  db: import('../database/adapter.js').DatabaseAdapter;
  integrations: import('../integrations/index.js').IntegrationHub;
}

export interface ToolDefinition {
  name: string;
  description: string;
  args: z.ZodTypeAny;
  risk: RiskLevel;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ExecutableTool extends ToolDefinition {}

/**
 * Type-safe tool definition helper. The executor's `input` is inferred from
 * the OUTPUT type of the Zod schema, so parsed tool inputs are correctly
 * typed (defaults are applied by `.parse`/`.default` before execution).
 */
export function defineTool<TArgs extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  args: TArgs;
  risk: RiskLevel;
  execute: (input: z.infer<TArgs>, ctx: ToolContext) => Promise<ToolResult>;
}): ExecutableTool {
  return def as ExecutableTool;
}