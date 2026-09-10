import { getPool } from '../pool.js';
import { JobRow, JobKind, OutboxRow, IntegrationProvider } from '../types.js';

const JOB_COLS = `id, kind, payload, status, run_at AS "runAt", attempts, max_attempts AS "maxAttempts",
  last_error AS "lastError", closed_at AS "closedAt", instance_id AS "instanceId",
  locked_at AS "lockedAt", created_at AS "createdAt"`;

export interface EnqueueJobInput {
  kind: JobKind;
  payload?: Record<string, unknown>;
  runAt?: string;
  maxAttempts?: number;
  dedupe?: string;
}

export const queueRepo = {
  async enqueueJob(input: EnqueueJobInput): Promise<JobRow> {
    if (input.dedupe) {
      const existing = await getPool().query<JobRow>(
        `SELECT ${JOB_COLS} FROM jobs WHERE payload->>'dedupeKey' = $1 AND status IN ('pending','claimed')`,
        [input.dedupe]
      );
      if (existing.rows[0]) return existing.rows[0];
    }
    const payload = { ...(input.payload ?? {}), ...(input.dedupe ? { dedupeKey: input.dedupe } : {}) };
    const { rows } = await getPool().query<JobRow>(
      `INSERT INTO jobs (kind, payload, run_at, max_attempts) VALUES ($1,$2,$3,$4) RETURNING ${JOB_COLS}`,
      [input.kind, payload, input.runAt ?? new Date().toISOString(), input.maxAttempts ?? 5]
    );
    return rows[0];
  },

  /**
   * Atomically claim N due jobs using FOR UPDATE SKIP LOCKED so multiple
   * workers never pick up the same row.
   */
  async claimJobs(instanceId: string, limit = 5): Promise<JobRow[]> {
    const { rows } = await getPool().query<JobRow>(
      `UPDATE jobs j
       SET status = 'claimed', instance_id = $1, locked_at = now()
       WHERE j.id IN (
         SELECT id FROM jobs
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY run_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING ${JOB_COLS}`,
      [instanceId, limit]
    );
    return rows;
  },

  /** Reclaim a job that a crashed worker had claimed (lease expiry). */
  async reclaimStale(instanceId: string, leaseMs = 60_000, limit = 10): Promise<JobRow[]> {
    const { rows } = await getPool().query<JobRow>(
      `UPDATE jobs SET status = 'pending', instance_id = NULL, locked_at = NULL
       WHERE id IN (
         SELECT id FROM jobs
         WHERE status = 'claimed' AND locked_at < now() - make_interval(secs => $1)
         LIMIT $2
       )
       RETURNING ${JOB_COLS}`,
      [leaseMs / 1000, limit]
    );
    void instanceId;
    return rows;
  },

  async completeJob(id: string): Promise<void> {
    await getPool().query(`UPDATE jobs SET status = 'done', closed_at = now(), instance_id = NULL, locked_at = NULL WHERE id = $1`, [id]);
  },

  /**
   * Fail a job: retry with exponential backoff + full jitter until
   * max_attempts, then permanently fail.
   */
  async failJob(id: string, error: string, maxAttempts: number | undefined): Promise<JobRow> {
    const job = await getPool()
      .query<JobRow>(`SELECT ${JOB_COLS} FROM jobs WHERE id = $1`, [id])
      .then((r) => r.rows[0]);
    if (!job) throw new Error(`job ${id} not found`);
    const attempts = job.attempts + 1;
    const cap = maxAttempts ?? job.maxAttempts;
    const baseSec = Math.pow(2, Math.min(attempts, 8));
    const backoffSec = Math.floor(baseSec + Math.random() * baseSec); // full jitter
    if (attempts >= cap) {
      const { rows } = await getPool().query<JobRow>(
        `UPDATE jobs SET status = 'failed', attempts = $2, last_error = $3, closed_at = now(), instance_id = NULL, locked_at = NULL
         WHERE id = $1 RETURNING ${JOB_COLS}`,
        [id, attempts, error]
      );
      return rows[0];
    }
    const { rows } = await getPool().query<JobRow>(
      `UPDATE jobs SET status = 'pending', attempts = $2, last_error = $3, run_at = now() + make_interval(secs => $4),
         instance_id = NULL, locked_at = NULL
       WHERE id = $1 RETURNING ${JOB_COLS}`,
      [id, attempts, error, backoffSec]
    );
    return rows[0];
  },

  async cancelJob(id: string): Promise<void> {
    await getPool().query(`UPDATE jobs SET status = 'cancelled', closed_at = now(), instance_id = NULL, locked_at = NULL WHERE id = $1`, [id]);
  },

  async queueDepth(): Promise<{ pending: number; failed: number }> {
    const { rows } = await getPool().query<{ pending: string; failed: string }>(
      `SELECT count(*) FILTER (WHERE status = 'pending')::text AS pending,
              count(*) FILTER (WHERE status = 'failed')::text AS failed
       FROM jobs`
    );
    return { pending: Number(rows[0].pending), failed: Number(rows[0].failed) };
  },

  // ---- Outbox ---------------------------------------------------------------

  async enqueueOutbox(o: {
    integration: IntegrationProvider;
    event_type: string;
    payload: Record<string, unknown>;
    incident_id?: string;
    runAt?: string;
  }): Promise<OutboxRow> {
    const { rows } = await getPool().query<OutboxRow>(
      `INSERT INTO outbox (integration, event_type, payload, incident_id, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, integration, event_type AS "eventType", payload, status, attempts, max_attempts AS "maxAttempts",
                 next_attempt_at AS "nextAttemptAt", provider_ref AS "providerRef", last_error AS "lastError",
                 incident_id AS "incidentId", created_at AS "createdAt", delivered_at AS "deliveredAt"`,
      [o.integration, o.event_type, o.payload, o.incident_id ?? null, o.runAt ?? new Date().toISOString()]
    );
    return rows[0];
  },

  /**
   * Lease N due outbox rows (SKIP LOCKED + instance lease) so multiple
   * workers never dispatch the same integration message twice even while a
   * row is still mid-flight (status flips to delivered/failed on completion).
   */
  async claimOutbox(instanceId: string, limit = 10): Promise<OutboxRow[]> {
    const { rows } = await getPool().query<OutboxRow>(
      `UPDATE outbox o
       SET status = 'pending', instance_id = $1, locked_at = now()
       WHERE o.id IN (
         SELECT id FROM outbox
         WHERE status = 'pending' AND next_attempt_at <= now()
           AND (instance_id IS NULL OR locked_at IS NULL OR locked_at < now() - make_interval(secs => 60))
         ORDER BY next_attempt_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, integration, event_type AS "eventType", payload, status, attempts, max_attempts AS "maxAttempts",
                 next_attempt_at AS "nextAttemptAt", provider_ref AS "providerRef", last_error AS "lastError",
                 incident_id AS "incidentId", created_at AS "createdAt", delivered_at AS "deliveredAt"`,
      [instanceId, limit]
    );
    return rows;
  },

  /** Release outbox leases older than the lease window (crashed worker). */
  async reclaimStaleOutbox(leaseSecs = 60): Promise<number> {
    const { rowCount } = await getPool().query<OutboxRow>(
      `UPDATE outbox SET instance_id = NULL, locked_at = NULL
       WHERE status = 'pending' AND instance_id IS NOT NULL AND locked_at < now() - make_interval(secs => $1)`,
      [leaseSecs]
    );
    return rowCount ?? 0;
  },

  async completeOutbox(id: string, providerRef?: string): Promise<void> {
    await getPool().query(
      `UPDATE outbox SET status = 'delivered', provider_ref = COALESCE($2, provider_ref), delivered_at = now(), last_error = NULL,
              instance_id = NULL, locked_at = NULL
       WHERE id = $1`,
      [id, providerRef ?? null]
    );
  },

  async skipOutbox(id: string, reason: string): Promise<void> {
    await getPool().query(`UPDATE outbox SET status = 'skipped', last_error = $2, delivered_at = now(), instance_id = NULL, locked_at = NULL WHERE id = $1`, [id, reason]);
  },

  async failOutbox(id: string, error: string): Promise<OutboxRow | null> {
    const { rows } = await getPool().query<OutboxRow>(
      `UPDATE outbox SET attempts = attempts + 1, last_error = $2,
         next_attempt_at = CASE WHEN attempts + 1 >= max_attempts THEN now()
                                ELSE now() + make_interval(secs => (pow(2, LEAST(attempts + 1, 8))::int)) END,
         status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
         instance_id = NULL, locked_at = NULL
       WHERE id = $1
       RETURNING id, integration, event_type AS "eventType", payload, status, attempts, max_attempts AS "maxAttempts",
                 next_attempt_at AS "nextAttemptAt", provider_ref AS "providerRef", last_error AS "lastError",
                 incident_id AS "incidentId", created_at AS "createdAt", delivered_at AS "deliveredAt"`,
      [id, error]
    );
    return rows[0] ?? null;
  },

  async listOutbox(filter: { status?: string; limit?: number } = {}): Promise<OutboxRow[]> {
    const params: unknown[] = [filter.limit ?? 100];
    const where = filter.status ? `WHERE status = $2` : '';
    if (filter.status) params.push(filter.status);
    const { rows } = await getPool().query<OutboxRow>(
      `SELECT id, integration, event_type AS "eventType", payload, status, attempts, max_attempts AS "maxAttempts",
              next_attempt_at AS "nextAttemptAt", provider_ref AS "providerRef", last_error AS "lastError",
              incident_id AS "incidentId", created_at AS "createdAt", delivered_at AS "deliveredAt"
       FROM outbox ${where} ORDER BY next_attempt_at ASC LIMIT $1`,
      params
    );
    return rows;
  },
};