import { getPool } from '../pool.js';
import { IntegrationRow, IntegrationProvider, AuditRow } from '../types.js';

export const opsRepo = {
  async ensureIntegration(provider: IntegrationProvider, name: string): Promise<IntegrationRow> {
    const { rows } = await getPool().query<IntegrationRow>(
      `INSERT INTO integrations (provider, name, status, config, secrets)
       VALUES ($1,$2,'not_configured','{}','{}')
       ON CONFLICT (provider) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id, provider, name, enabled, config, secrets, status,
                 last_health_check_at AS "lastHealthCheckAt", last_health_error AS "lastHealthError",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [provider, name]
    );
    return rows[0];
  },

  async listIntegrations(): Promise<IntegrationRow[]> {
    const { rows } = await getPool().query<IntegrationRow>(
      `SELECT id, provider, name, enabled, config, secrets, status,
              last_health_check_at AS "lastHealthCheckAt", last_health_error AS "lastHealthError",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM integrations ORDER BY provider ASC`
    );
    return rows;
  },

  async updateIntegration(
    provider: IntegrationProvider,
    patch: {
      config?: Record<string, unknown>;
      secrets?: Record<string, unknown>;
      enabled?: boolean;
      status?: IntegrationRow['status'];
      last_health_error?: string | null;
      last_health_check_at?: string | null;
    }
  ): Promise<IntegrationRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [provider];
    if (patch.config !== undefined) { sets.push(`config = $${params.length + 1}`); params.push(patch.config); }
    if (patch.secrets !== undefined) { sets.push(`secrets = $${params.length + 1}`); params.push(patch.secrets); }
    if (patch.enabled !== undefined) { sets.push(`enabled = $${params.length + 1}`); params.push(patch.enabled); }
    if (patch.status !== undefined) { sets.push(`status = $${params.length + 1}`); params.push(patch.status); }
    if (patch.last_health_error !== undefined) { sets.push(`last_health_error = $${params.length + 1}`); params.push(patch.last_health_error); }
    if (patch.last_health_check_at !== undefined) { sets.push(`last_health_check_at = $${params.length + 1}`); params.push(patch.last_health_check_at); }
    if (sets.length === 0) return this.listIntegrations().then((rows) => rows.find((r) => r.provider === provider) ?? null);
    sets.push(`updated_at = now()`);
    const { rows } = await getPool().query<IntegrationRow>(
      `UPDATE integrations SET ${sets.join(', ')} WHERE provider = $1
       RETURNING id, provider, name, enabled, config, secrets, status,
                 last_health_check_at AS "lastHealthCheckAt", last_health_error AS "lastHealthError",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      params
    );
    return rows[0] ?? null;
  },

  // ---- Audit log --------------------------------------------------------------

  async writeAudit(entry: {
    request_id?: string;
    actor_type: AuditRow['actorType'];
    actor_id?: string;
    actor_email?: string;
    action: string;
    target_type?: string;
    target_id?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ip?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<AuditRow> {
    const { rows } = await getPool().query<AuditRow>(
      `INSERT INTO audit_log (request_id, actor_type, actor_id, actor_email, action, target_type, target_id, before, after, ip, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, request_id AS "requestId", actor_type AS "actorType", actor_id AS "actorId", actor_email AS "actorEmail",
                 action, target_type AS "targetType", target_id AS "targetId", before, after, ip, metadata, created_at AS "createdAt"`,
      [
        entry.request_id ?? null,
        entry.actor_type,
        entry.actor_id ?? null,
        entry.actor_email ?? null,
        entry.action,
        entry.target_type ?? null,
        entry.target_id ?? null,
        entry.before ?? null,
        entry.after ?? null,
        entry.ip ?? null,
        entry.metadata ?? null,
      ]
    );
    return rows[0];
  },

  async listAudit(filter: { action?: string; actorType?: string; limit?: number; offset?: number } = {}): Promise<{ rows: AuditRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.action) { params.push(filter.action); where.push(`action = $${params.length}`); }
    if (filter.actorType) { params.push(filter.actorType); where.push(`actor_type = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const { rows } = await getPool().query<AuditRow>(
      `SELECT id, request_id AS "requestId", actor_type AS "actorType", actor_id AS "actorId", actor_email AS "actorEmail",
              action, target_type AS "targetType", target_id AS "targetId", before, after, ip, metadata, created_at AS "createdAt"
       FROM audit_log ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = await getPool().query<{ n: string }>(`SELECT count(*) AS n FROM audit_log ${whereSql}`, params);
    return { rows, total: Number(total.rows[0].n) };
  },

  async recordWebhookIngest(e: {
    provider: string;
    signature_verified: boolean;
    auth_method: string;
    raw: unknown;
    source_ip?: string;
    incident_id?: string;
    error?: string;
  }): Promise<void> {
    await getPool().query(
      `INSERT INTO webhook_ingest (provider, signature_verified, auth_method, raw, source_ip, incident_id, error, processed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
      [e.provider, e.signature_verified, e.auth_method, e.raw ?? {}, e.source_ip ?? null, e.incident_id ?? null, e.error ?? null]
    );
  },
};