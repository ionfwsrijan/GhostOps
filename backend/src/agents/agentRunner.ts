import { incidentRepo, engineRepo, queueRepo } from '../db/repos/index.js';
import { IncidentRow, AgentRunRow, AgentRunState } from '../db/types.js';
import { ToolResult } from '../tools/types.js';
import { classifyIncident, analyzeEvidence, generateActionPlan } from '../ai/planner.js';
import { getActionDefinition, requiresHumanApproval, UnknownActionError } from '../services/riskEngine.js';
import { sseManager } from '../services/sseService.js';
import { executeToolTraced, executeToolUntraced, getTool } from '../tools/index.js';
import { ACTION_TO_TOOL } from '../tools/mapping.js';
import { verificationService } from '../services/verificationService.js';
import { env } from '../config.js';
import { logger } from '../logger.js';

export interface RunSnapshot extends Record<string, unknown> {
  phase?: string;
  task?: string;
  reasoning?: string;
  plan?: Array<{ actionKey: string; params: Record<string, unknown>; confidence: number; reasoning: string }>;
  planIndex?: number;
  verifyAttempts?: number;
  lastTool?: string;
}

interface PlanStep {
  actionKey: string;
  params: Record<string, unknown>;
  confidence: number;
  reasoning: string;
}

const TERMINAL_INCIDENT = new Set(['resolved', 'failed', 'cancelled']);
const TERMINAL_RUN: AgentRunState[] = ['completed', 'failed', 'cancelled'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Semaphore {
  private n: number;
  private waiters: Array<() => void> = [];
  constructor(n: number) {
    this.n = n;
  }
  async acquire(): Promise<void> {
    if (this.n > 0) {
      this.n--;
      return;
    }
    await new Promise<void>((res) => this.waiters.push(res));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.n++;
  }
}

/**
 * GhostOps agent engine.
 *
 * Invariant guarantees:
 *  - Exactly one active run per incident (DB partial unique index).
 *  - Every tool call is allowlisted + schema-validated + traced to `actions`.
 *  - High-risk anything never auto-executes (riskEngine gates by confidence).
 *  - Approval pauses persist in `agent_runs.status_snapshot`; a job resumes it.
 *  - Failure marks the incident + run as failed with a recorded error.
 */
export class AgentRunner {
  private semaphore = new Semaphore(env.AGENT_MAX_CONCURRENT_RUNS);
  private inFlight = new Set<string>();
  private readonly stepDelay = env.AGENT_STEP_DELAY_MS;

  async run(incidentId: string, opts?: { jobId?: string }): Promise<void> {
    const incident = await incidentRepo.getIncident(incidentId);
    if (!incident || TERMINAL_INCIDENT.has(incident.status)) return;
    if (this.inFlight.has(incidentId)) {
      logger.debug({ incidentId }, 'agent: run already in flight for incident');
      return;
    }
    this.inFlight.add(incidentId);
    await this.semaphore.acquire();
    try {
      let run = await engineRepo.getActiveRun(incidentId);
      if (!run) {
        run = await engineRepo.createRun(incidentId, incidentId, env.AGENT_JOB_MAX_ATTEMPTS);
      } else if (!TERMINAL_RUN.includes(run.state)) {
        await engineRepo.incrementAttempt(run.id, run.attempt + 1);
      }
      if (TERMINAL_RUN.includes(run.state)) return;
      await this.#execute(incidentId, run, opts?.jobId);
    } catch (err) {
      logger.error({ incidentId, err }, 'agent: run crashed');
      await this.#failIncident(incidentId, null, (err as Error).message);
    } finally {
      this.semaphore.release();
      this.inFlight.delete(incidentId);
    }
  }

  /** Resume after an approval decision. */
  async continueAfterApproval(incidentId: string, userId: string, approved: boolean): Promise<void> {
    void userId;
    const incident = await incidentRepo.getIncident(incidentId);
    if (!incident || TERMINAL_INCIDENT.has(incident.status)) return;
    const run = await engineRepo.getActiveRun(incidentId);
    if (!run) return;
    await this.semaphore.acquire();
    try {
      await this.#execute(incidentId, run, undefined, { approved });
    } catch (err) {
      logger.error({ incidentId, err }, 'agent: resume crashed');
      await this.#failIncident(incidentId, run, (err as Error).message);
    } finally {
      this.semaphore.release();
    }
  }

  // ---- Main orchestration -----------------------------------------------------

  async #execute(incidentId: string, run: AgentRunRow, _jobId?: string, resume?: { approved: boolean }): Promise<void> {
    let row = await incidentRepo.getIncident(incidentId);
    if (!row || TERMINAL_INCIDENT.has(row.status)) return;
    const snapshot = (run.statusSnapshot ?? {}) as RunSnapshot;

    // Resume-with-approval path: first materialize the decided action.
    if (resume) {
      const decide = resume.approved ? 'approving' : 'rejecting';
      await this.#setPhase(run, snapshot, { phase: 'acting', task: `Human ${decide} the paused action` });
    }

    // Phase 1 — classify (skipped on resume: classification already persisted).
    if (!snapshot.plan) {
      await this.#setPhase(run, snapshot, { phase: 'classifying', task: 'Classifying the incident' });
      const classification = await classifyIncident(row);
      await incidentRepo.updateIncident(incidentId, {
        severity: classification.severity,
        ai_confidence: classification.confidence,
        metadata: { ...row.metadata, incidentType: classification.incidentType, classificationSummary: classification.summary },
      });
      await this.#event(row, 'classification', 'ai', 'Incident classified', `${classification.incidentType} — ${classification.severity} (${Math.round(classification.confidence * 100)}% confidence)`, { incidentType: classification.incidentType, severity: classification.severity, confidence: classification.confidence });
      sseManager.sendToIncident(incidentId, { type: 'incident_status', data: { step: 'classification', incidentType: classification.incidentType, severity: classification.severity } });

      // Phase 2 — investigate.
      for (const tool of classification.investigationPlan) {
        await sleep(this.stepDelay);
        this.#setPhaseFire(run, snapshot, { phase: 'investigating', task: `Running ${tool}`, lastTool: tool });
        await executeToolTraced(tool, { transactionId: row.transactionId ?? undefined, level: undefined, service: row.affectedService ?? undefined }, { incidentId, runId: run.id, label: `investigation: ${tool}` });
        row = (await incidentRepo.getIncident(incidentId)) ?? row;
      }

      // Phase 3 — root-cause analysis.
      await sleep(this.stepDelay);
      await this.#setPhase(run, snapshot, { phase: 'analyzing', task: 'Analyzing evidence' });
      const evidenceList = await this.#gatherEvidence(incidentId);
      const analysis = await analyzeEvidence(row, evidenceList);
      await incidentRepo.updateIncident(incidentId, {
        root_cause: analysis.rootCause,
        root_cause_confidence: analysis.confidence,
        evidence: { ...row.evidence, rootCause: analysis.rootCause, explanation: analysis.explanation, evidence: analysis.evidence },
      });
      await this.#event(row, 'root_cause', 'ai', 'Root cause identified', `${analysis.rootCause} (${Math.round(analysis.confidence * 100)}% confidence): ${analysis.explanation}`, { rootCause: analysis.rootCause, confidence: analysis.confidence });
      sseManager.sendToIncident(incidentId, { type: 'incident_status', data: { step: 'root_cause', rootCause: analysis.rootCause } });
      row = (await incidentRepo.getIncident(incidentId)) ?? row;

      // Phase 4 — plan.
      await sleep(this.stepDelay);
      await this.#setPhase(run, snapshot, { phase: 'planning', task: 'Generating remediation plan' });
      const plan = await generateActionPlan(row, analysis);
      snapshot.plan = plan.actions;
      snapshot.planIndex = 0;
      await this.#event(row, 'plan', 'ai', 'Remediation plan generated', plan.reasoning, { actions: plan.actions.map((a) => a.actionKey) });
      sseManager.sendToIncident(incidentId, { type: 'incident_status', data: { step: 'plan', actions: plan.actions.map((a) => a.actionKey) } });
      await engineRepo.updateRunState(run.id, 'running', { statusSnapshot: snapshot });
    }

    // Phase 5 — execute plan (fresh from 0, resume from stored index).
    row = (await incidentRepo.getIncident(incidentId)) ?? row;
    const plan = snapshot.plan ?? [];
    const startIndex = snapshot.planIndex ?? 0;
    for (let i = startIndex; i < plan.length; i++) {
      const step = plan[i];
      await sleep(this.stepDelay);
      await this.#setPhase(run, snapshot, { phase: 'acting', planIndex: i, task: `Planning ${step.actionKey}` });

      let definition;
      try {
        definition = getActionDefinition(step.actionKey);
      } catch (e) {
        if (e instanceof UnknownActionError) {
          await engineRepo.traceToolCall({ incident_id: incidentId, run_id: run.id, plan_index: i, action_key: step.actionKey, label: 'Unknown action in plan', tool: step.actionKey, risk: 'medium', input: step.params, output: { error: 'unknown_action' }, status: 'skipped', result: 'unknown_action' });
          await this.#event(row, 'action_skipped', 'warning', `Action skipped: ${step.actionKey}`, 'Not in the allowlist — ignoring.', {});
          continue;
        }
        throw e;
      }

      const pendingAction = await this.#pendingAction(incidentId, i);
      if (pendingAction && ['executed', 'approved', 'skipped', 'expired', 'failed'].includes(pendingAction.status)) {
        continue; // already materialized on a previous resume — never re-approve
      }
      const decision = requiresHumanApproval(step.actionKey, step.confidence);

      if (pendingAction?.status === 'pending_approval' && resume?.approved) {
        // Human approved: execute the paused action.
        await this.#executeApprovedStep(row, pendingAction.id, step);
      } else if (pendingAction?.status === 'pending_approval' && resume && !resume.approved) {
        await engineRepo.updateAction(pendingAction.id, { status: 'skipped', result: 'rejected', output: { reason: 'human rejected' } });
        await this.#event(row, 'action_skipped', 'warning', `Action rejected: ${pendingAction.actionKey}`, step.reasoning, {});
      } else if (decision.required) {
        // Need human approval → pause.
        const label = definition.label;
        await engineRepo.createAction({ incident_id: incidentId, run_id: run.id, plan_index: i, action_key: step.actionKey, label, tool: definition.key, risk: definition.risk, input: step.params });
        const expires = new Date(Date.now() + env.APPROVAL_TTL_HOURS * 3600_000);
        const approval = await engineRepo.createApproval({ incident_id: incidentId, run_id: run.id, action_key: step.actionKey, title: label, description: `${step.reasoning}\nImpact: ${definition.impact}`, risk: definition.risk, ai_recommendation: `confidence ${Math.round(step.confidence * 100)}%`, expires_at: expires.toISOString() });
        snapshot.planIndex = i;
        await engineRepo.updateRunState(run.id, 'waiting_approval', { statusSnapshot: snapshot });
        await incidentRepo.updateIncident(incidentId, { status: 'awaiting_approval' });
        await this.#event(row, 'approval', 'action', `Approval required: ${label}`, descriptionOf(step), { approvalId: approval.id, risk: definition.risk, confidence: step.confidence });
        sseManager.sendToIncident(incidentId, { type: 'approval_requested', data: { approvalId: approval.id, actionKey: step.actionKey, label, risk: definition.risk, incidentId } });
        sseManager.sendToIncident(incidentId, { type: 'recommendation', data: { actionKey: step.actionKey, confidence: step.confidence, reasoning: step.reasoning } });
        // Schedule expiry reaper.
        await queueRepo.enqueueJob({ kind: 'approval_expiry', runAt: new Date(expires.getTime() + 30_000).toISOString(), payload: { approvalId: approval.id, incidentId }, dedupe: `approval:${approval.id}` });
        return; // pause — job for agent_run completes
      } else {
        // Auto-execute.
        const toolName = ACTION_TO_TOOL[step.actionKey];
        const outcome = toolName
          ? await executeToolTraced(toolName, { ...step.params, transactionId: row.transactionId ?? step.params?.transactionId }, { incidentId, runId: run.id, planIndex: i, label: step.reasoning })
          : null;
        if (outcome && !outcome.outcome.success) {
          await this.#event(row, 'action_failed', 'error', `Action failed: ${step.actionKey}`, outcome.outcome.summary, {});
        }
      }
    }

    // Phase 6 — verify + resolve.
    await sleep(this.stepDelay);
    await this.#setPhase(run, snapshot, { phase: 'verifying', task: 'Verifying resolution' });
    row = (await incidentRepo.getIncident(incidentId)) ?? row;
    const verdict = await verificationService.verify(row);
    if (verdict.resolved) {
      await incidentRepo.updateIncident(incidentId, { status: 'resolved', auto_resolved: true, resolution_summary: verdict.summary });
      await this.#event(row, 'resolved', 'success', 'Incident resolved', verdict.summary, { auto: true });
      sseManager.sendToIncident(incidentId, { type: 'incident_resolved', data: { incidentId, summary: verdict.summary, auto: true } });
      await engineRepo.updateRunState(run.id, 'completed', { statusSnapshot: { ...snapshot, phase: 'resolved' }, completedAt: new Date().toISOString() });
    } else {
      await incidentRepo.updateIncident(incidentId, { status: 'failed' });
      await this.#event(row, 'escalated', 'error', 'Verification failed — escalated to manual review', verdict.summary, {});
      sseManager.sendToIncident(incidentId, { type: 'incident_update', data: { status: 'failed', reason: verdict.summary } });
      await engineRepo.updateRunState(run.id, 'failed', { error: verdict.summary, statusSnapshot: { ...snapshot, phase: 'failed' }, completedAt: new Date().toISOString() });
    }
    sseManager.broadcast({ type: 'agent_update', incidentId, data: { status: 'idle' } });
  }

  // ---- Internals ---------------------------------------------------------------

  async #executeApprovedStep(row: IncidentRow, actionId: string, step: PlanStep): Promise<void> {
    const toolName = ACTION_TO_TOOL[step.actionKey];
    let outcome: ToolResult = { success: false, summary: `No executor for ${step.actionKey}`, error: 'blocked_action' };
    if (toolName && getTool(toolName)) {
      outcome = await executeToolUntraced(toolName, { ...step.params, transactionId: row.transactionId ?? step.params?.transactionId }, { incidentId: row.id });
    }
    await engineRepo.updateAction(actionId, {
      status: outcome.success ? 'executed' : 'failed',
      result: outcome.success ? 'success' : (outcome.error ?? 'error'),
      output: (outcome.data ?? outcome) as Record<string, unknown>,
      executed_at: new Date().toISOString(),
    });
    await this.#event(row, 'action', outcome.success ? 'success' : 'error', `Action executed: ${step.actionKey}`, outcome.summary, { approved: true });
    sseManager.sendToIncident(row.id, { type: 'action_executed', data: { actionId, actionKey: step.actionKey, ok: outcome.success, result: outcome } });
  }

  async #pendingAction(incidentId: string, planIndex: number) {
    const actions = await engineRepo.listActions(incidentId);
    return actions.find((a) => a.planIndex === planIndex) ?? null;
  }

  async #setPhase(run: AgentRunRow, snapshot: RunSnapshot, patch: Partial<RunSnapshot>): Promise<void> {
    Object.assign(snapshot, patch);
    await engineRepo.updateRunState(run.id, 'running', { statusSnapshot: snapshot });
    sseManager.broadcast({ type: 'agent_update', incidentId: run.incidentId, data: { phase: snapshot.phase, task: snapshot.task, tool: snapshot.lastTool } });
  }

  #setPhaseFire(run: AgentRunRow, snapshot: RunSnapshot, patch: Partial<RunSnapshot>): void {
    Object.assign(snapshot, patch);
    sseManager.broadcast({ type: 'agent_update', incidentId: run.incidentId, data: { phase: snapshot.phase, task: snapshot.task, tool: snapshot.lastTool } });
  }

  async #event(row: IncidentRow, step: string, type: 'info' | 'success' | 'error' | 'warning' | 'ai' | 'action' | 'system', title: string, description?: string, metadata?: Record<string, unknown>): Promise<void> {
    const ev = await incidentRepo.logEvent(row.id, {
      step,
      type,
      title,
      description,
      metadata,
      actor_type: 'system',
    });
    sseManager.broadcast({ type: 'timeline_event', incidentId: row.id, data: { ...ev } });
  }

  async #gatherEvidence(incidentId: string) {
    const actions = await engineRepo.listActions(incidentId);
    return actions
      .slice()
      .sort((a, b) => a.planIndex - b.planIndex)
      .map((a) => ({ tool: a.actionKey, ok: a.status === 'executed' && a.result === 'success', data: a.output ?? undefined, summary: (a.output?.summary as string | undefined) ?? a.result ?? 'ok' }));
  }

  async #failIncident(incidentId: string, run: AgentRunRow | null, error: string): Promise<void> {
    try {
      await incidentRepo.updateIncident(incidentId, { status: 'failed' });
      const incident = await incidentRepo.getIncident(incidentId);
      if (incident) await this.#event(incident, 'agent_failed', 'error', 'Agent run failed', error, { error });
      if (run) await engineRepo.updateRunState(run.id, 'failed', { error, completedAt: new Date().toISOString() });
    } catch (err) {
      logger.error({ incidentId, err }, 'agent: error while failing incident');
    }
  }
}

function descriptionOf(step: PlanStep): string {
  return `${step.reasoning}\nConfidence: ${Math.round(step.confidence * 100)}%`;
}

/** Singleton used by the worker and routes. */
export const agentRunner = new AgentRunner();

export const sleepFor = sleep;