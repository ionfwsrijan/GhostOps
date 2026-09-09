import { z } from 'zod';
import { getDatabase } from '../database/index.js';
import { getIntegrationHub } from '../integrations/index.js';
import { sseManager } from '../services/sseService.js';
import { incidentService } from '../services/incidentService.js';
import { ExecutableTool, ToolContext, ToolResult } from './types.js';
import { paymentTools } from './paymentTool.js';
import { bookingTools } from './bookingTool.js';
import { databaseTools } from './databaseTool.js';
import { logsTools } from './logsTool.js';
import { jiraTools } from './jiraTool.js';
import { slackTools } from './slackTool.js';
import { notificationTools } from './notificationTool.js';

const ALL_TOOLS: ExecutableTool[] = [
  ...paymentTools,
  ...bookingTools,
  ...databaseTools,
  ...logsTools,
  ...jiraTools,
  ...slackTools,
  ...notificationTools,
];

// Allowlist = the full registry (above). Tools not defined here can never run.
const TOOL_REGISTRY = new Map<string, ExecutableTool>(ALL_TOOLS.map((t) => [t.name, t]));

export function isToolAllowed(name: string): boolean {
  return TOOL_REGISTRY.has(name);
}

export function listToolNames(): string[] {
  return [...TOOL_REGISTRY.keys()];
}

export interface ExecuteToolOptions {
  incidentId: string;
  /** Record an agent_action row + SSE emissions (default true) */
  trace?: boolean;
  /** Mark actions that are part of resolution to be high-trust (e.g., after approval) */
  force?: boolean;
}

export interface ToolExecutionOutcome {
  outcome: ToolResult;
  actionId?: string;
}

/**
 * Execute a tool with strict allowlist + schema validation. Every invocation
 * is recorded in agent_actions for the audit log, and streamed to the UI.
 */
export async function executeTool(name: string, args: unknown, opts: ExecuteToolOptions): Promise<ToolExecutionOutcome> {
  if (!opts.incidentId) throw new Error('incidentId is required to execute a tool');
  const tool = TOOL_REGISTRY.get(name);
  if (!tool) {
    throw new Error(`Tool "${name}" is not in the allowlist`);
  }

  const trace = opts.trace ?? true;

  const db = getDatabase();

  if (trace) {
    sseManager.sendToIncident(opts.incidentId, {
      type: 'tool_started',
      data: { tool: name, args },
    });
    sseManager.broadcast({
      type: 'agent_update',
      incidentId: opts.incidentId,
      data: { status: 'investigating', tool: name, phase: 'tool_call' },
    });
  }

  // Schema validation — reject malformed input before touching anything.
  const parsed = tool.args.safeParse(args);
  if (!parsed.success) {
    const outcomeErr: ToolResult = {
      success: false,
      summary: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      error: 'validation_error',
    };
    if (trace) {
      await recordAction(db, {
        incident_id: opts.incidentId,
        tool: name,
        action: 'execute',
        input: args,
        output: outcomeErr,
        result: 'failed',
        risk: tool.risk,
        status: 'executed',
      });
      sseManager.sendToIncident(opts.incidentId, { type: 'tool_completed', data: { tool: name, ok: false, result: outcomeErr } });
    }
    return { outcome: outcomeErr };
  }

  const integrations = getIntegrationHub();
  const ctx: ToolContext = { incidentId: opts.incidentId, db, integrations };

  try {
    const outcome = await tool.execute(parsed.data, ctx);
    if (trace) {
      const actionId = (await recordAction(db, {
        incident_id: opts.incidentId,
        tool: name,
        action: 'execute',
        input: args,
        output: outcome.data,
        result: outcome.success ? 'success' : 'failed',
        risk: tool.risk,
        status: 'executed',
      })).id;

      sseManager.sendToIncident(opts.incidentId, {
        type: 'tool_completed',
        data: { tool: name, ok: outcome.success, result: outcome },
      });
      sseManager.broadcast({
        type: 'agent_update',
        incidentId: opts.incidentId,
        data: { status: 'investigating', tool: name, phase: 'tool_completed', ok: outcome.success },
      });
      return { outcome, actionId };
    }
    return { outcome };
  } catch (err) {
    const failed: ToolResult = {
      success: false,
      summary: `Tool ${name} threw: ${(err as Error).message}`,
      error: 'execution_error',
    };
    if (trace) {
      await recordAction(db, {
        incident_id: opts.incidentId,
        tool: name,
        action: 'execute',
        input: args,
        output: failed,
        result: 'failed',
        risk: tool.risk,
        status: 'executed',
      });
      sseManager.sendToIncident(opts.incidentId, { type: 'tool_completed', data: { tool: name, ok: false, result: failed } });
    }
    return { outcome: failed };
  }
}

let currentIncidentServiceForTrace: { addTimelineEntry: (i: import('../database/types.js').TimelineAddInput) => Promise<unknown> } | null = incidentService;

async function recordAction(
  db: import('../database/adapter.js').DatabaseAdapter,
  payload: Omit<import('../database/types.js').AgentAction, 'id' | 'created_at'>
) {
  const action = await db.addAgentAction(payload);
  await currentIncidentServiceForTrace?.addTimelineEntry({
    incident_id: payload.incident_id,
    step: 'tool_call',
    type: payload.result === 'success' ? 'success' : 'error',
    title: `${payload.tool}: ${payload.action}`,
    description: summaryOf(payload),
    metadata: { tool: payload.tool, result: payload.result, risk: payload.risk },
  });
  return action;
}

function summaryOf(payload: { output?: unknown; result: string }) {
  if (payload.result !== 'success') return `Tool call ${payload.result}`;
  const out = payload.output as { summary?: string } | undefined;
  return out?.summary ?? `Executed successfully`;
}

/**
 * Used by the action executor to run an allowlisted *action* through its
 * mapped tool without duplicate tracing (the action layer traces itself).
 */
export async function executeToolUntraced(name: string, args: unknown, incidentId: string): Promise<ToolResult> {
  return (await executeTool(name, args, { incidentId, trace: false })).outcome;
}

export { z };
export type { ToolResult, ToolContext, ExecutableTool };