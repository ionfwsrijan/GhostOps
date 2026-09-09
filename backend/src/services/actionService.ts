import { getDatabase, DatabaseAdapter } from '../database/index.js';
import { Incident, RiskLevel, ApprovalRequest } from '../database/types.js';
import { incidentService } from './incidentService.js';
import { getActionDefinition, requiresHumanApproval, isAllowedAction } from './riskEngine.js';
import { executeToolUntraced } from '../tools/index.js';
import { sseManager } from './sseService.js';

export interface RecommendedAction {
  actionKey: string;
  params: Record<string, unknown>;
  confidence: number;
  reasoning: string;
}

type ToolMapping = Record<string, { tool: string; buildArgs: (incident: Incident, params: Record<string, unknown>) => Record<string, unknown> }>;

const TOOL_MAP: ToolMapping = {
  verify_payment: {
    tool: 'verify_transaction',
    buildArgs: (inc, p) => ({ transactionId: p.transactionId ?? inc.transaction_id ?? '' }),
  },
  check_booking: {
    tool: 'check_booking',
    buildArgs: (inc, p) => ({ transactionId: p.transactionId ?? inc.transaction_id ?? '' }),
  },
  inspect_logs: {
    tool: 'search_logs',
    buildArgs: (inc, p) => ({
      transactionId: p.transactionId ?? inc.transaction_id ?? '',
      service: (p.service as string) ?? undefined,
      level: (p.level as 'info' | 'warn' | 'error') ?? undefined,
    }),
  },
  retry_booking: {
    tool: 'retry_booking',
    buildArgs: (inc, p) => ({
      transactionId: p.transactionId ?? inc.transaction_id ?? '',
      movieTitle: (p.movieTitle as string) ?? undefined,
      amount: p.amount != null ? Number(p.amount) : undefined,
    }),
  },
  update_booking_status: {
    tool: 'update_booking_status',
    buildArgs: (inc, p) => ({
      transactionId: p.transactionId ?? inc.transaction_id ?? '',
      status: (p.status as 'confirmed' | 'cancelled' | 'refunded') ?? 'confirmed',
    }),
  },
  create_jira_ticket: {
    tool: 'jira_create_ticket',
    buildArgs: (inc, p) => ({
      incidentCode: inc.incident_code,
      title: (p.title as string) ?? inc.title,
      description: (p.description as string) ?? inc.issue,
      priority: (p.priority as 'low' | 'medium' | 'high' | 'critical') ?? (inc.severity === 'critical' ? 'critical' : 'high'),
    }),
  },
  send_slack_notification: {
    tool: 'slack_post_message',
    buildArgs: (inc, p) => ({
      channel: (p.channel as 'on-call' | 'incidents' | 'engineering' | 'support') ?? 'incidents',
      text: (p.text as string) ?? inc.title,
      incidentCode: inc.incident_code,
    }),
  },
  send_customer_notification: {
    tool: 'notify_customer',
    buildArgs: (inc, p) => ({
      recipient: (p.recipient as string) ?? '',
      subject: (p.subject as string) ?? `${inc.incident_code} — Status update`,
      body: (p.body as string) ?? `Your booking issue is being resolved by our team.`,
    }),
  },
  collect_diagnostics: {
    tool: 'search_logs',
    buildArgs: (inc, p) => ({
      transactionId: p.transactionId ?? inc.transaction_id ?? '',
      limit: 20,
    }),
  },
  refund_customer: {
    tool: 'issue_refund',
    buildArgs: (inc, p) => ({
      transactionId: p.transactionId ?? inc.transaction_id ?? '',
      amount: p.amount != null ? Number(p.amount) : Number(inc.metadata?.amount ?? 0),
      reason: (p.reason as string) ?? 'refund_for_failed_booking',
    }),
  },
  // High-risk actions below resolve to an explicit approval step; they are
  // intentionally NOT wired to a destructive tool in the MVP sandbox.
  delete_records: { tool: 'noop_unsafe', buildArgs: () => ({}) },
  modify_sensitive_data: { tool: 'noop_unsafe', buildArgs: () => ({}) },
  change_configuration: { tool: 'noop_unsafe', buildArgs: () => ({}) },
};

export class ActionService {
  private db: DatabaseAdapter;

  constructor(db: DatabaseAdapter = getDatabase()) {
    this.db = db;
  }

  /**
   * Main entry point for the agent's recommended action.
   * Applies the risk engine, then auto-executes or routes to human approval.
   */
  async submitRecommendedAction(incidentId: string, rec: RecommendedAction): Promise<{ mode: 'auto' | 'approval'; approval?: ApprovalRequest; actionOutcome?: unknown }> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);
    if (!isAllowedAction(rec.actionKey)) throw new Error(`Action "${rec.actionKey}" is not in the allowlist`);

    const def = getActionDefinition(rec.actionKey);
    const decision = requiresHumanApproval(rec.actionKey, rec.confidence);

    // Always surface the recommendation to the UI
    sseManager.sendToIncident(incidentId, {
      type: 'recommendation',
      data: { actionKey: rec.actionKey, label: def.label, confidence: rec.confidence, reasoning: rec.reasoning, risk: def.risk },
    });

    await incidentService.addTimelineEntry({
      incident_id: incidentId,
      step: 'plan',
      type: 'ai',
      title: `Recommendation: ${def.label}`,
      description: `${rec.reasoning} (confidence ${Math.round(rec.confidence * 100)}%)`,
      metadata: { actionKey: rec.actionKey, risk: def.risk, confidence: rec.confidence },
    });

    if (decision.required) {
      const approval = await this.db.createApproval({
        incident_id: incidentId,
        action_key: rec.actionKey,
        title: def.label,
        description: def.description,
        risk: def.risk,
        status: 'pending',
        ai_recommendation: `${rec.reasoning} — GhostOps recommends ${def.risk === 'high' ? 'human approval' : 're-evaluation'} (confidence ${Math.round(
          rec.confidence * 100
        )}%).`,
      });
      await incidentService.setStatus(incidentId, 'awaiting_approval');
      await this.db.addAgentAction({
        incident_id: incidentId,
        tool: def.label,
        action: rec.actionKey,
        input: rec.params,
        output: { requiresApproval: true, reason: decision.reason },
        result: 'pending_approval',
        risk: def.risk,
        status: 'pending_approval',
      });
      sseManager.sendToIncident(incidentId, { type: 'approval_requested', data: { approval } });
      return { mode: 'approval', approval };
    }

    const actionOutcome = await this.executeAction(incidentId, rec.actionKey, rec.params);
    return { mode: 'auto', actionOutcome };
  }

  /**
   * Execute a recommendation (post-risk-check) via its mapped tool.
   */
  async executeAction(incidentId: string, actionKey: string, params: Record<string, unknown>): Promise<unknown> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);
    const def = getActionDefinition(actionKey);
    const mapping = TOOL_MAP[actionKey];
    if (!mapping) throw new Error(`No tool mapping for action "${actionKey}"`);

    if (mapping.tool === 'noop_unsafe') {
      // Human-approved destructive action — sandbox does not actually run it.
      await this.recordExecuted(incident, actionKey, params, { approved: true, performed: false, note: 'Destructive action logged but not executed in sandbox' }, def.risk);
      return { ok: true, mock: true };
    }

    const args = mapping.buildArgs(incident, params);
    const outcome = await executeToolUntraced(mapping.tool, args, incidentId);
    await this.recordExecuted(incident, actionKey, params, outcome, def.risk, mapping.tool);
    return outcome;
  }

  private async recordExecuted(
    incident: Incident,
    actionKey: string,
    params: Record<string, unknown>,
    output: unknown,
    risk: RiskLevel,
    tool?: string
  ) {
    const def = getActionDefinition(actionKey);
    await this.db.addAgentAction({
      incident_id: incident.id,
      tool: tool ?? def.label,
      action: actionKey,
      input: params,
      output,
      result: (output as { success?: boolean }).success === false ? 'failed' : 'success',
      risk,
      status: 'executed',
    });

    const ok = (output as { success?: boolean }).success !== false;
    await incidentService.addTimelineEntry({
      incident_id: incident.id,
      step: 'action',
      type: ok ? 'action' : 'error',
      title: `${def.label} — ${ok ? 'executed' : 'failed'}`,
      description: (output as { summary?: string }).summary ?? (ok ? okMsg(def) : 'Action failed'),
      metadata: { actionKey, risk, params },
    });

    sseManager.sendToIncident(incident.id, {
      type: 'action_executed',
      data: { actionKey, label: def.label, ok, output },
    });
  }

  async getPendingApprovals(): Promise<ApprovalRequest[]> {
    return this.db.listApprovals('pending');
  }

  async approveApproval(approvalId: string, decisionReason?: string): Promise<ApprovalRequest> {
    const approval = await this.db.getApproval(approvalId);
    if (!approval) throw new Error('Approval request not found');
    if (approval.status !== 'pending') throw new Error(`Approval already ${approval.status}`);

    const updated = await this.db.updateApproval(approvalId, {
      status: 'approved',
      decision_reason: decisionReason || 'Approved by operator',
    });

    if (approval.incident_id) {
      await incidentService.addTimelineEntry({
        incident_id: approval.incident_id,
        step: 'approval',
        type: 'success',
        title: `Approved: ${approval.title}`,
        description: decisionReason || 'Approved by operator',
      });
      // Execute the approved action
      const execResult = await this.executeAction(approval.incident_id, approval.action_key, {});
      sseManager.sendToIncident(approval.incident_id, {
        type: 'approval_updated',
        data: { approval: { ...updated, status: 'approved' }, execResult },
      });
    }

    return updated as ApprovalRequest;
  }

  async rejectApproval(approvalId: string, reason: string): Promise<ApprovalRequest> {
    const approval = await this.db.getApproval(approvalId);
    if (!approval) throw new Error('Approval request not found');
    if (approval.status !== 'pending') throw new Error(`Approval already ${approval.status}`);

    const updated = await this.db.updateApproval(approvalId, {
      status: 'rejected',
      decision_reason: reason,
    });

    if (approval.incident_id) {
      await incidentService.addTimelineEntry({
        incident_id: approval.incident_id,
        step: 'approval',
        type: 'warning',
        title: `Rejected: ${approval.title}`,
        description: reason,
      });
      sseManager.sendToIncident(approval.incident_id, {
        type: 'approval_updated',
        data: { approval: { ...updated, status: 'rejected' } },
      });
    }

    return updated as ApprovalRequest;
  }
}

function okMsg(def: { label: string }) {
  return `${def.label} completed successfully`;
}

export const actionService = new ActionService();