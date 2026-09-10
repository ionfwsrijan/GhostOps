import { incidentRepo, engineRepo, queueRepo, opsRepo } from '../db/repos/index.js';
import { getActionDefinition, requiresHumanApproval, UnknownActionError } from './riskEngine.js';
import { executeToolTraced } from '../tools/index.js';
import { ACTION_TO_TOOL } from '../tools/mapping.js';
import { agentRunner } from '../agents/agentRunner.js';
import { sseManager } from './sseService.js';
import { env } from '../config.js';

export type SubmitActionResult =
  | { mode: 'auto'; actionId: string; outcome: { success: boolean; summary: string } }
  | { mode: 'approved'; approvalId: string; actionId: string }
  | { mode: 'unknown'; error: string };

/**
 * High-level action submission used by the agent engine and the action center.
 * Decides auto-execute vs. human approval via the risk engine; every decision
 * is persisted to `actions`, the timeline, and the audit log.
 */
class ActionService {
  async submitRecommendedAction(input: {
    incident_id: string;
    actionKey: string;
    params?: Record<string, unknown>;
    confidence: number;
    reasoning?: string;
    run_id?: string;
    plan_index: number;
  }): Promise<SubmitActionResult> {
    let def;
    try {
      def = getActionDefinition(input.actionKey);
    } catch (err) {
      if (err instanceof UnknownActionError) return { mode: 'unknown', error: err.message };
      throw err;
    }

    const incident = await incidentRepo.getIncident(input.incident_id);
    if (!incident) return { mode: 'unknown', error: 'incident not found' };
    const runId = input.run_id ?? (await engineRepo.getActiveRun(incident.id))?.id;

    const decision = requiresHumanApproval(input.actionKey, input.confidence);
    if (decision.required) {
      const action = await engineRepo.createAction({
        incident_id: incident.id,
        run_id: runId,
        plan_index: input.plan_index,
        action_key: input.actionKey,
        label: def.label,
        tool: def.key,
        risk: def.risk,
        input: input.params ?? {},
      });
      const expires = new Date(Date.now() + env.APPROVAL_TTL_HOURS * 3600_000);
      const approval = await engineRepo.createApproval({
        incident_id: incident.id,
        run_id: runId,
        action_key: input.actionKey,
        title: def.label,
        description: `${input.reasoning ?? ''}\nImpact: ${def.impact}`,
        risk: def.risk,
        ai_recommendation: `confidence ${Math.round(input.confidence * 100)}%`,
        expires_at: expires.toISOString(),
      });
      await incidentRepo.updateIncident(incident.id, { status: 'awaiting_approval' });
      await this.timeline(incident.id, { step: 'approval', type: 'action', title: `Approval required: ${def.label}`, description: input.reasoning, metadata: { approvalId: approval.id, actionKey: input.actionKey, risk: def.risk } });
      sseManager.sendToIncident(incident.id, { type: 'approval_requested', data: { approvalId: approval.id, actionKey: input.actionKey, label: def.label, risk: def.risk, incidentId: incident.id } });
      await queueRepo.enqueueJob({ kind: 'approval_expiry', runAt: new Date(expires.getTime() + 30_000).toISOString(), payload: { approvalId: approval.id, incidentId: incident.id }, dedupe: `approval:${approval.id}` });
      return { mode: 'approved', approvalId: approval.id, actionId: action.id };
    }

    const toolName = ACTION_TO_TOOL[input.actionKey];
    if (!toolName) return { mode: 'unknown', error: `action ${input.actionKey} has no automated executor` };
    const outcome = await executeToolTraced(toolName, { ...(input.params ?? {}), transactionId: incident.transactionId ?? undefined }, { incidentId: incident.id, runId, planIndex: input.plan_index, label: input.reasoning ?? def.label });
    await opsRepo.writeAudit({
      actor_type: 'system',
      action: 'action.auto_executed',
      target_type: 'incident',
      target_id: incident.id,
      metadata: { actionKey: input.actionKey, risk: def.risk, outcome: outcome.outcome.summary },
    });
    return { mode: 'auto', actionId: outcome.actionId ?? '', outcome: { success: outcome.outcome.success, summary: outcome.outcome.summary } };
  }

  /** Approve/reject a pending approval and resume the paused agent run. */
  async decide(input: { approvalId: string; approval: 'approved' | 'rejected'; userId: string; reason?: string }): Promise<{ ok: boolean; error?: string }> {
    const approval = await engineRepo.getApproval(input.approvalId);
    if (!approval) return { ok: false, error: 'approval not found' };
    if (approval.status !== 'pending') return { ok: false, error: `approval already ${approval.status}` };
    if (approval.expiresAt < new Date().toISOString()) return { ok: false, error: 'approval expired' };

    const decided = await engineRepo.decideApproval(input.approvalId, input.approval, input.userId, input.reason);
    if (!decided) return { ok: false, error: 'approval could not be decided (expired or already decided)' };

    await this.timeline(approval.incidentId, { step: 'approval_decided', type: 'action', title: `Approval ${input.approval}: ${approval.actionKey}`, description: input.reason, metadata: { approvalId: input.approvalId } });

    // Resume the paused run out-of-band — never block the HTTP response.
    setImmediate(() => {
      agentRunner.continueAfterApproval(approval.incidentId, input.userId, input.approval === 'approved').catch(() => {
        // failures already surface by the incident being marked failed
      });
    });
    return { ok: true };
  }

  private async timeline(incidentId: string, e: { step: string; type: 'info' | 'success' | 'error' | 'warning' | 'ai' | 'action' | 'system'; title: string; description?: string; metadata?: Record<string, unknown> }) {
    const ev = await incidentRepo.logEvent(incidentId, { actor_type: 'system', ...e });
    sseManager.broadcast({ type: 'timeline_event', incidentId, data: { ...ev } });
    return ev;
  }
}

export const actionService = new ActionService();