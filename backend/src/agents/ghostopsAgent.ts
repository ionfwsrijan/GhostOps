import { getDatabase, DatabaseAdapter } from '../database/index.js';
import { Incident } from '../database/types.js';
import { incidentService } from '../services/incidentService.js';
import { actionService } from '../services/actionService.js';
import { verificationService } from '../services/verificationService.js';
import { executeToolUntraced } from '../tools/index.js';
import { classifyIncident, analyzeEvidence, generateActionPlan } from '../ai/planner.js';
import { RawEvidence } from '../ai/heuristics.js';
import { sseManager } from '../services/sseService.js';

const STEP_DELAY_MS = Number(process.env.AGENT_STEP_DELAY ?? 700);
const MAX_VERIFY_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AgentState {
  state: 'classifying' | 'investigating' | 'analyzing' | 'planning' | 'acting' | 'waiting_approval' | 'verifying' | 'resolved' | 'failed';
  currentTask?: string;
  reasoning?: string;
}

function persistState(incidentId: string, state: AgentState) {
  sseManager.sendToIncident(incidentId, { type: 'agent_update', data: state });
  sseManager.broadcast({ type: 'agent_update', incidentId, data: state });
}

async function setAgentState(db: DatabaseAdapter, incident: Incident, state: AgentState) {
  await db.updateIncident(incident.id, { metadata: { ...(incident.metadata ?? {}), agentState: state.state } });
  persistState(incident.id, state);
}

/**
 * GhostOps Agent — owns an incident from DETECTION to RESOLUTION.
 *
 * Loop: understand → classify → investigate (tools) → analyze →
 * plan → risk-check (auto/approval) → verify → resolve (or re-investigate).
 */
export class GhostOpsAgent {
  private db: DatabaseAdapter;

  constructor(db: DatabaseAdapter = getDatabase()) {
    this.db = db;
  }

  async run(incidentId: string): Promise<{ status: string }> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);
    if (['resolved', 'failed'].includes(incident.status)) {
      return { status: incident.status };
    }

    try {
      // ---- UNDERSTAND & CLASSIFY ----
      await incidentService.setStatus(incidentId, 'investigating');
      await setAgentState(this.db, incident, {
        state: 'classifying',
        currentTask: 'Understanding the customer complaint',
        reasoning: 'Parsing the complaint and extracting entities (transaction, customer, amount).',
      });
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'understood',
        type: 'ai',
        title: 'Issue understood',
        description: incident.issue,
        metadata: { source: incident.channel },
      });
      await sleep(STEP_DELAY_MS);

      const classification = await classifyIncident(incident);
      await this.db.updateIncident(incidentId, {
        severity: classification.severity,
        ai_confidence: Math.round(classification.confidence * 100) / 100,
        metadata: {
          ...(incident.metadata ?? {}),
          incidentType: classification.incidentType,
          classification: classification,
          agentState: 'investigating',
        },
      });
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'classified',
        type: 'ai',
        title: `Classified: ${classification.incidentType.replace(/_/g, ' ')}`,
        description: classification.summary,
        metadata: { confidence: classification.confidence, severity: classification.severity },
      });
      await sleep(STEP_DELAY_MS * 0.5);

      // ---- INVESTIGATE (tool loop) ----
      await setAgentState(this.db, incident, {
        state: 'investigating',
        currentTask: 'Investigating the issue across services',
        reasoning: 'Running the investigation plan using read-only diagnostics tools.',
      });
      const evidence = await this.investigate(incident, classification.investigationPlan);

      // ---- ANALYZE (root cause) ----
      await setAgentState(this.db, incident, {
        state: 'analyzing',
        currentTask: 'Analyzing evidence for root cause',
        reasoning: 'Correlating payment, booking, and log evidence to isolate the probable cause.',
      });
      await sleep(STEP_DELAY_MS);
      const analysis = await analyzeEvidence(incident, evidence);
      await this.db.updateIncident(incidentId, {
        root_cause: analysis.rootCause,
        root_cause_confidence: Math.round(analysis.confidence * 100) / 100,
        evidence: { ...(incident.evidence ?? {}), rootCauseEvidence: analysis.evidence, toolResults: evidence.map((e) => ({ tool: e.tool, summary: e.summary })) },
      });
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'root_cause',
        type: 'ai',
        title: 'Root cause identified',
        description: `${analysis.rootCause.replace(/_/g, ' ')} — ${analysis.explanation}`,
        metadata: { confidence: analysis.confidence, rootCause: analysis.rootCause, evidence: analysis.evidence },
      });
      await sleep(STEP_DELAY_MS);

      // ---- PLAN + ACT (risk-gated) ----
      await setAgentState(this.db, incident, {
        state: 'planning',
        currentTask: 'Generating remediation plan',
        reasoning: 'Selecting safe remediation actions and applying risk classification.',
      });
      const plan = await generateActionPlan(incident, analysis);

      await this.db.updateIncident(incidentId, {
        metadata: {
          ...(incident.metadata ?? {}),
          agentState: 'acting',
          agentPlan: plan.actions,
          agentActionIndex: 0,
          rootCauseAnalysis: { rootCause: analysis.rootCause, confidence: analysis.confidence, explanation: analysis.explanation },
        },
      });
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'plan',
        type: 'ai',
        title: 'Remediation plan generated',
        description: plan.actions.map((a, i) => `${i + 1}. ${a.actionKey.replace(/_/g, ' ')}`).join(' • '),
        metadata: { plan: plan.actions },
      });
      await sleep(STEP_DELAY_MS);

      // Execute plan actions in order; pause at first approval request.
      const pause = await this.executePlan(incidentId, plan.actions, 0);
      if (pause) {
        return { status: 'awaiting_approval' };
      }

      // ---- VERIFY ----
      return await this.verifyAndResolve(incidentId);
    } catch (err) {
      console.error(`[agent] incident ${incidentId} failed:`, err);
      await incidentService.setStatus(incidentId, 'failed');
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'failed',
        type: 'error',
        title: 'Investigation failed',
        description: (err as Error).message,
      });
      await setAgentState(this.db, incident, { state: 'failed', currentTask: 'Investigation error' });
      return { status: 'failed' };
    }
  }

  /**
   * Execute tool steps in the investigation plan. Only allowlisted tools run.
   */
  private async investigate(incident: Incident, plan: string[]): Promise<RawEvidence[]> {
    const evidence: RawEvidence[] = [];
    const txn = incident.transaction_id;
    const steps: Array<{ tool: string; args: Record<string, unknown>; label: string }> = [];

    for (const step of plan) {
      switch (step) {
        case 'verify_transaction':
          steps.push({ tool: 'verify_transaction', args: { transactionId: txn }, label: 'Payment API' });
          break;
        case 'check_booking':
          steps.push({ tool: 'check_booking', args: { transactionId: txn }, label: 'Booking database' });
          break;
        case 'db_check_duplicate':
          steps.push({ tool: 'db_check_duplicate', args: { transactionId: txn }, label: 'Duplicate check' });
          break;
        case 'db_find_record':
          steps.push({ tool: 'db_find_record', args: { transactionId: txn, table: 'bookings' }, label: 'Database' });
          break;
        case 'search_logs':
          steps.push({ tool: 'search_logs', args: { transactionId: txn, limit: 15 }, label: 'Application logs' });
          break;
        default:
          // ignore unknown tool requests (allowlist protection)
          break;
      }
    }

    for (const step of steps) {
      await incidentService.addTimelineEntry({
        incident_id: incident.id,
        step: 'tool_call',
        type: 'info',
        title: `Investigating ${step.label}`,
        description: `Running ${step.tool}...`,
        metadata: { tool: step.tool },
      });
      await setAgentState(this.db, incident, {
        state: 'investigating',
        currentTask: `Investigating ${step.label}`,
        reasoning: this.labelForReasoning(step.tool),
      });
      await sleep(STEP_DELAY_MS);

      const outcome = await executeToolUntraced(step.tool, step.args, incident.id);
      evidence.push({ tool: step.tool, ok: outcome.success, data: outcome.data, summary: outcome.summary });

      await incidentService.addTimelineEntry({
        incident_id: incident.id,
        step: 'tool_call',
        type: outcome.success ? (outcome.summary.includes('missing') || outcome.summary.includes('fail') ? 'warning' : 'success') : 'error',
        title: `${step.label} investigated`,
        description: outcome.summary,
        metadata: { tool: step.tool, ok: outcome.success },
      });
      await sleep(STEP_DELAY_MS * 0.5);
    }
    return evidence;
  }

  private labelForReasoning(tool: string): string {
    switch (tool) {
      case 'verify_transaction':
        return 'Checking the payment gateway to confirm whether the funds were captured.';
      case 'check_booking':
      case 'db_find_record':
        return 'Looking up the booking database for the matching booking record.';
      case 'db_check_duplicate':
        return 'Scanning for duplicate transactions that could explain the discrepancy.';
      case 'search_logs':
        return 'Searching application logs around the incident window for errors.';
      default:
        return 'Gathering diagnostic evidence.';
    }
  }

  /**
   * Execute recommended actions, pausing if any requires human approval.
   * Returns true when paused on an approval.
   */
  private async executePlan(incidentId: string, actions: Array<{ actionKey: string; params: Record<string, unknown>; confidence: number; reasoning: string }>, index: number): Promise<boolean> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) return false;

    for (let i = index; i < actions.length; i++) {
      const action = actions[i];
      await this.db.updateIncident(incidentId, {
        metadata: { ...(incident.metadata ?? {}), agentState: 'acting', agentActionIndex: i, agentPlan: actions },
      });
      await setAgentState(this.db, incident, {
        state: 'acting',
        currentTask: `Executing ${action.actionKey.replace(/_/g, ' ')}`,
        reasoning: action.reasoning,
      });
      await sleep(STEP_DELAY_MS * 0.5);

      const result = await actionService.submitRecommendedAction(incidentId, action);
      if (result.mode === 'approval') {
        return true; // paused — UI will approve/reject, then resumeAgent runs
      }
      await sleep(STEP_DELAY_MS);
    }
    return false;
  }

  /**
   * Verification — declare RESOLVED or trigger re-investigation.
   */
  private async verifyAndResolve(incidentId: string): Promise<{ status: string }> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) return { status: 'unknown' };

    await incidentService.setStatus(incidentId, 'resolving');
    await setAgentState(this.db, incident, {
      state: 'verifying',
      currentTask: 'Verifying resolution',
      reasoning: 'Re-checking the booking and payment records to confirm the incident is resolved.',
    });

    const attempts = Number((incident.metadata?.verifyAttempts as unknown as number) ?? 0);
    let currentIncident = incident;

    const outcome = await verificationService.verifyAndResolve(incidentId, async () => {
      // Re-investigation path
      currentIncident = (await this.db.getIncident(incidentId)) ?? currentIncident;
      const attempt = Number((currentIncident.metadata?.verifyAttempts as unknown as number) ?? 0) + 1;
      if (attempt >= MAX_VERIFY_ATTEMPTS) {
        await this.db.updateIncident(incidentId, {
          status: 'failed',
          metadata: { ...(currentIncident.metadata ?? {}), verifyAttempts: attempt },
        });
        return;
      }
      await this.db.updateIncident(incidentId, {
        metadata: { ...(currentIncident.metadata ?? {}), verifyAttempts: attempt, agentState: 'investigating' },
      });
      await incidentService.setStatus(incidentId, 'investigating');
      await sleep(STEP_DELAY_MS * 2);
      await this.run(incidentId);
    });

    if (outcome.resolved || attempts > 0) {
      currentIncident = (await this.db.getIncident(incidentId)) ?? incident;
    }

    const final = await this.db.getIncident(incidentId);
    if (final?.status === 'resolved') {
      await this.db.updateIncident(incidentId, {
        auto_resolved: true,
        resolution_summary: 'GhostOps autonomously detected, investigated, remediated, and verified the incident.',
      });
      await incidentService.emit(incidentId, 'incident_resolved', { incident: final });
      await setAgentState(this.db, final, { state: 'resolved', currentTask: 'Incident resolved', reasoning: 'All verification checks passed.' });
      return { status: 'resolved' };
    }
    return { status: final?.status ?? 'unknown' };
  }

  /**
   * Called when an operator approves/rejects a pending action.
   * Continues the plan (remaining actions), then verifies.
   */
  async resumeAfterApproval(incidentId: string, approved: boolean): Promise<void> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) return;
    const plan = (incident.metadata?.agentPlan as unknown as Array<{ actionKey: string; params: Record<string, unknown>; confidence: number; reasoning: string }>) ?? [];
    const idx = Number((incident.metadata?.agentActionIndex as unknown as number) ?? 0);
    const next = approved ? idx + 1 : idx;

    if (approved && next > 0) {
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'action',
        type: 'action',
        title: 'Approved action executed',
        description: `GhostOps continued remediation after operator approval.`,
      });
    }

    if (next < plan.length) {
      const pause = await this.executePlan(incidentId, plan, next);
      if (pause) return;
    }
    await this.verifyAndResolve(incidentId);
  }
}

export const ghostOpsAgent = new GhostOpsAgent();