import { getPool, withTx } from '../pool.js';
import { AgentRunRow, AgentRunState, ApprovalRow, ActionRow, ActionStatus } from '../types.js';

const RUN_COLS = `id, incident_id AS "incidentId", correlation_id AS "correlationId", state, attempt,
  max_attempts AS "maxAttempts", status_snapshot AS "statusSnapshot", started_at AS "startedAt",
  completed_at AS "completedAt", error, created_at AS "createdAt"`;

const ACTIVE_STATES: AgentRunState[] = ['queued', 'claimed', 'running', 'paused', 'waiting_approval'];

export const engineRepo = {
  // ---- Agent runs -----------------------------------------------------------

  async createRun(incident_id: string, correlation_id: string, maxAttempts: number): Promise<AgentRunRow> {
    return withTx(async (client) => {
      const existing = await client.query<AgentRunRow>(
        `SELECT ${RUN_COLS} FROM agent_runs WHERE correlation_id = $1`,
        [correlation_id]
      );
      if (existing.rows[0]) return existing.rows[0];
      const { rows } = await client.query<AgentRunRow>(
        `INSERT INTO agent_runs (incident_id, correlation_id, max_attempts, started_at) VALUES ($1,$2,$3, now()) RETURNING ${RUN_COLS}`,
        [incident_id, correlation_id, maxAttempts]
      );
      return rows[0];
    });
  },

  /**
   * Claim an active run for an incident. The partial unique index
   * `one_active_run_per_incident` guarantees at most one live run.
   */
  async getActiveRun(incidentId: string): Promise<AgentRunRow | null> {
    const { rows } = await getPool().query<AgentRunRow>(
      `SELECT ${RUN_COLS} FROM agent_runs WHERE incident_id = $1 AND state = ANY($2) ORDER BY created_at DESC LIMIT 1`,
      [incidentId, ACTIVE_STATES]
    );
    return rows[0] ?? null;
  },

  async updateRunState(runId: string, state: AgentRunState, patch?: { error?: string; statusSnapshot?: Record<string, unknown>; startedAt?: string; completedAt?: string }): Promise<AgentRunRow | null> {
    const set: string[] = [];
    const params: unknown[] = [runId];
    set.push(`state = $2`);
    params.push(state);
    if (patch?.error !== undefined) {
      set.push(`error = $${params.length + 1}`);
      params.push(patch.error);
    }
    if (patch?.statusSnapshot !== undefined) {
      set.push(`status_snapshot = $${params.length + 1}`);
      params.push(patch.statusSnapshot);
    }
    if (patch?.startedAt !== undefined) {
      set.push(`started_at = now()`);
    }
    if (patch?.completedAt !== undefined) {
      set.push(`completed_at = now()`);
    }
    const { rows } = await getPool().query<AgentRunRow>(
      `UPDATE agent_runs SET ${set.join(', ')} WHERE id = $1 RETURNING ${RUN_COLS}`,
      params
    );
    return rows[0] ?? null;
  },

  async listRuns(incidentId: string): Promise<AgentRunRow[]> {
    const { rows } = await getPool().query<AgentRunRow>(
      `SELECT ${RUN_COLS} FROM agent_runs WHERE incident_id = $1 ORDER BY created_at DESC`,
      [incidentId]
    );
    return rows;
  },

  async incrementAttempt(runId: string, attempt: number): Promise<void> {
    await getPool().query(`UPDATE agent_runs SET attempt = $2 WHERE id = $1`, [runId, attempt]);
  },

  // ---- Approvals --------------------------------------------------------------

  async createApproval(a: {
    incident_id: string; run_id?: string; action_key: string; title: string; description?: string;
    risk: ApprovalRow['risk']; ai_recommendation?: string; expires_at: string;
  }): Promise<ApprovalRow> {
    const { rows } = await getPool().query<ApprovalRow>(
      `INSERT INTO approvals (incident_id, run_id, action_key, title, description, risk, ai_recommendation, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, incident_id AS "incidentId", run_id AS "runId", action_key AS "actionKey", title, description, risk, status,
                 ai_recommendation AS "aiRecommendation", requested_at AS "requestedAt", expires_at AS "expiresAt",
                 decided_by_user_id AS "decidedByUserId", decision_reason AS "decisionReason", decided_at AS "decidedAt"`,
      [a.incident_id, a.run_id ?? null, a.action_key, a.title, a.description ?? null, a.risk, a.ai_recommendation ?? null, a.expires_at]
    );
    return rows[0];
  },

  async listApprovals(status?: ApprovalRow['status'], limit = 100): Promise<ApprovalRow[]> {
    const params: unknown[] = [limit];
    const where = status ? `WHERE a.status = $2` : '';
    if (status) params.push(status);
    const { rows } = await getPool().query<ApprovalRow>(
      `SELECT a.id, a.incident_id AS "incidentId", i.incident_code AS "incidentCode", a.run_id AS "runId", a.action_key AS "actionKey", a.title, a.description, a.risk, a.status,
              a.ai_recommendation AS "aiRecommendation", a.requested_at AS "requestedAt", a.expires_at AS "expiresAt",
              a.decided_by_user_id AS "decidedByUserId", a.decision_reason AS "decisionReason", a.decided_at AS "decidedAt"
       FROM approvals a LEFT JOIN incidents i ON i.id = a.incident_id ${where} ORDER BY a.requested_at DESC LIMIT $1`,
      params
    );
    return rows;
  },

  async getApproval(id: string): Promise<ApprovalRow | null> {
    const { rows } = await getPool().query<ApprovalRow>(
      `SELECT id, incident_id AS "incidentId", run_id AS "runId", action_key AS "actionKey", title, description, risk, status,
              ai_recommendation AS "aiRecommendation", requested_at AS "requestedAt", expires_at AS "expiresAt",
              decided_by_user_id AS "decidedByUserId", decision_reason AS "decisionReason", decided_at AS "decidedAt"
       FROM approvals WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async decideApproval(id: string, decision: 'approved' | 'rejected', decidedByUserId: string, reason?: string): Promise<ApprovalRow | null> {
    const { rows } = await getPool().query<ApprovalRow>(
      `UPDATE approvals
       SET status = $2, decided_by_user_id = $3, decision_reason = $4, decided_at = now()
       WHERE id = $1 AND status = 'pending' AND expires_at > now()
       RETURNING id, incident_id AS "incidentId", run_id AS "runId", action_key AS "actionKey", title, description, risk, status,
                 ai_recommendation AS "aiRecommendation", requested_at AS "requestedAt", expires_at AS "expiresAt",
                 decided_by_user_id AS "decidedByUserId", decision_reason AS "decisionReason", decided_at AS "decidedAt"`,
      [id, decision, decidedByUserId, reason ?? null]
    );
    return rows[0] ?? null;
  },

  /** Expire approvals past their TTL. Returns ids expired. */
  async expireStaleApprovals(now = new Date()): Promise<string[]> {
    const { rows } = await getPool().query<{ id: string }>(
      `UPDATE approvals SET status = 'expired', decided_at = $1
       WHERE status = 'pending' AND expires_at <= $1 RETURNING id`,
      [now.toISOString()]
    );
    return rows.map((r) => r.id);
  },

  // ---- Actions -----------------------------------------------------------------

  async createAction(a: {
    incident_id: string; run_id?: string; plan_index: number; action_key: string; label: string;
    tool: string; risk: ActionRow['risk']; input?: Record<string, unknown>; status?: ActionStatus;
  }): Promise<ActionRow> {
    const { rows } = await getPool().query<ActionRow>(
      `INSERT INTO actions (incident_id, run_id, plan_index, action_key, label, tool, risk, input, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, incident_id AS "incidentId", run_id AS "runId", plan_index AS "planIndex",
                 action_key AS "actionKey", label, tool, risk, input, output, status, result,
                 executed_at AS "executedAt", created_at AS "createdAt"`,
      [a.incident_id, a.run_id ?? null, a.plan_index, a.action_key, a.label, a.tool, a.risk, a.input ?? {}, a.status ?? 'pending']
    );
    return rows[0];
  },

  async updateAction(id: string, patch: { status?: ActionRow['status']; result?: string | null; output?: Record<string, unknown> | null; executed_at?: string | null }): Promise<ActionRow | null> {
    const { rows } = await getPool().query<ActionRow>(
      `UPDATE actions SET
         status = COALESCE($2, status),
         result = COALESCE($3, result),
         output = COALESCE($4, output),
         executed_at = COALESCE($5, executed_at)
       WHERE id = $1
       RETURNING id, incident_id AS "incidentId", run_id AS "runId", plan_index AS "planIndex",
                 action_key AS "actionKey", label, tool, risk, input, output, status, result,
                 executed_at AS "executedAt", created_at AS "createdAt"`,
      [id, patch.status ?? null, patch.result ?? null, patch.output ?? null, patch.executed_at ?? null]
    );
    return rows[0] ?? null;
  },

  async listActions(incidentId: string): Promise<ActionRow[]> {
    const { rows } = await getPool().query<ActionRow>(
      `SELECT id, incident_id AS "incidentId", run_id AS "runId", plan_index AS "planIndex",
              action_key AS "actionKey", label, tool, risk, input, output, status, result,
              executed_at AS "executedAt", created_at AS "createdAt"
       FROM actions WHERE incident_id = $1 ORDER BY plan_index ASC`,
      [incidentId]
    );
    return rows;
  },

  async listAllActions(limit = 200): Promise<ActionRow[]> {
    const { rows } = await getPool().query<ActionRow>(
      `SELECT a.id, a.incident_id AS "incidentId", i.incident_code AS "incidentCode", a.run_id AS "runId", a.plan_index AS "planIndex",
              a.action_key AS "actionKey", a.label, a.tool, a.risk, a.input, a.output, a.status, a.result,
              a.executed_at AS "executedAt", a.created_at AS "createdAt"
       FROM actions a LEFT JOIN incidents i ON i.id = a.incident_id ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  },

  /**
   * Record a tool call as an `actions` row and a timeline event in one
   * transaction. Diagnostic calls pass a negative plan_index so they never
   * collide with remedial plan steps.
   */
  async traceToolCall(a: {
    incident_id: string;
    run_id?: string | null;
    plan_index?: number | null;
    action_key: string;
    label: string;
    tool: string;
    risk: ActionRow['risk'];
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    status: ActionRow['status'];
    result?: string;
  }): Promise<ActionRow | null> {
    const idx = a.plan_index ?? -(1_000_000 + Math.floor(Math.random() * 1_000_000));
    return withTx(async (client) => {
      const { rows } = await client.query<ActionRow>(
        `INSERT INTO actions (incident_id, run_id, plan_index, action_key, label, tool, risk, input, output, status, result, executed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 CASE WHEN $10 = 'executed' THEN now() ELSE NULL END)
         RETURNING id, incident_id AS "incidentId", run_id AS "runId", plan_index AS "planIndex",
                   action_key AS "actionKey", label, tool, risk, input, output, status, result,
                   executed_at AS "executedAt", created_at AS "createdAt"`,
        [
          a.incident_id, a.run_id ?? null, idx, a.action_key, a.label, a.tool, a.risk,
          a.input, a.output, a.status, a.result ?? null,
        ]
      );
      await client.query(
        `INSERT INTO incident_events (incident_id, step, type, title, description, metadata, run_id)
         VALUES ($1, 'tool_call', $2, $3, $4, $5, $6)`,
        [
          a.incident_id,
          a.status === 'executed' ? 'success' : 'error',
          `${a.tool}: ${a.label}`,
          a.status === 'executed' ? (a.output?.summary as string | undefined) ?? 'Executed successfully' : a.result ?? 'Tool call failed',
          { tool: a.tool, status: a.status, result: a.result, risk: a.risk },
          a.run_id ?? null,
        ]
      );
      return rows[0] ?? null;
    });
  },
};