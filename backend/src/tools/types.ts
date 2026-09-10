import { z } from 'zod';
import { RiskLevel, CustomerRow, IncidentRow } from '../db/types.js';

export interface ToolResult {
  success: boolean;
  summary: string;
  error?: string;
  data?: unknown;
}

export interface ToolContext {
  incidentId: string;
  incident?: IncidentRow | null;
  customer?: CustomerRow | null;
}

export interface ExecutableTool {
  /** Tool name — must equal the action key for remediation tools. */
  name: string;
  risk: RiskLevel;
  description: string;
  args: z.ZodTypeAny;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

export type { RiskLevel };