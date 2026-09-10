import { getPool, Tx, withTx, Queryable } from '../pool.js';
import { ConflictError } from '../../errors.js';
import {
  IncidentRow,
  IncidentEventRow,
  IncidentCreateInput,
  IncidentPatch,
  EventAddInput,
  CustomerRow,
  PaymentRow,
  BookingRow,
  BookingRecordRow,
} from '../types.js';

export interface IncidentFilter {
  status?: string;
  severity?: string;
  q?: string;
  customerId?: string;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

type Q = Tx;

const INCIDENT_COLS = `
  id, incident_code AS "incidentCode", title, issue, description,
  severity, status, customer_id AS "customerId", transaction_id AS "transactionId",
  affected_service AS "affectedService", channel, source,
  ai_confidence AS "aiConfidence", root_cause AS "rootCause",
  root_cause_confidence AS "rootCauseConfidence", evidence,
  resolution_summary AS "resolutionSummary", auto_resolved AS "autoResolved",
  metadata, version, created_at AS "createdAt", updated_at AS "updatedAt"`;

async function nextIncidentCode(client: Q): Promise<string> {
  const y = new Date().getUTCFullYear();
  const { rows } = await client.query<{ code: string }>(
    `SELECT 'INC-' || $1 || '-' || lpad(nextval('incident_seq')::text, 5, '0') AS code`,
    [String(y)]
  );
  return rows[0].code;
}

export const incidentRepo = {
  /** Create an incident and its first timeline event atomically. */
  createIncident(input: IncidentCreateInput): Promise<{ incident: IncidentRow; event: IncidentEventRow }> {
    return withTx(async (client) => {
      const code = await nextIncidentCode(client);
      const i = await client.query<IncidentRow>(
        `INSERT INTO incidents
           (incident_code, title, issue, description, severity, customer_id, transaction_id,
            affected_service, channel, source, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${INCIDENT_COLS}`,
        [
          code,
          input.title,
          input.issue,
          input.description ?? null,
          input.severity ?? 'medium',
          input.customer_id ?? null,
          input.transaction_id ?? null,
          input.affected_service ?? null,
          input.channel ?? 'api',
          input.source ?? 'api',
          input.metadata ?? {},
        ]
      );
      const incident = i.rows[0];
      const e = await this.addEvent(client, {
        incident_id: incident.id,
        step: 'detected',
        type: 'info',
        title: 'Incident detected',
        description: `Complaint received via ${incident.channel}: "${input.issue}"`,
        metadata: { source: incident.source },
      });
      return { incident, event: e };
    });
  },

  async getIncident(id: string, client?: Q): Promise<IncidentRow | null> {
    const { rows } = await (client ?? getPool()).query<IncidentRow>(`SELECT ${INCIDENT_COLS} FROM incidents WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /**
   * Optimistic-concurrency update. Throws CONFLICT if `expectedVersion` is
   * provided and the row has moved on — callers retry by re-reading.
   */
  async updateIncident(id: string, patch: Partial<IncidentPatch>, opts?: { expectedVersion?: number }): Promise<IncidentRow | null> {
    const allowed = [
      'title', 'issue', 'description', 'severity', 'status', 'customer_id', 'transaction_id',
      'affected_service', 'ai_confidence', 'root_cause', 'root_cause_confidence',
      'evidence', 'resolution_summary', 'auto_resolved', 'metadata',
    ] as const;
    const picks: string[] = [];
    const values: unknown[] = [id];
    const set: string[] = [];
    for (const key of allowed) {
      const v = (patch as Record<string, unknown>)[key];
      if (v !== undefined) {
        values.push(v);
        picks.push(key);
        set.push(`${key} = $${values.length}`);
      }
    }
    if (set.length === 0) return this.getIncident(id);

    if (opts?.expectedVersion != null) {
      set.push(`version = version + 1`);
      values.push(opts.expectedVersion);
      const { rows } = await getPool().query<IncidentRow>(
        `UPDATE incidents SET ${set.join(', ')} WHERE id = $1 AND version = $${values.length} RETURNING ${INCIDENT_COLS}`,
        values
      );
      if (rows.length === 0) {
        throw new ConflictError(`incident ${id} was modified concurrently`);
      }
      return rows[0];
    }

    set.push(`version = version + 1`);
    const { rows } = await getPool().query<IncidentRow>(`UPDATE incidents SET ${set.join(', ')} WHERE id = $1 RETURNING ${INCIDENT_COLS}`, values);
    return rows[0] ?? null;
  },

  async listIncidents(filter: IncidentFilter = {}): Promise<Page<IncidentRow>> {
    const { limit = 50, offset = 0, status, severity, q, customerId } = filter;
    const where: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      where.push(`severity = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      where.push(`customer_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(`(lower(title) LIKE $${params.length} OR lower(issue) LIKE $${params.length} OR incident_code ILIKE $${params.length} OR lower(coalesce(root_cause,'')) LIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await getPool().query<IncidentRow>(
      `SELECT ${INCIDENT_COLS} FROM incidents ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const count = await getPool().query<{ n: string }>(`SELECT count(*) AS n FROM incidents ${whereSql}`, params.slice(0, params.length - 2));
    return { rows, total: Number(count.rows[0].n), limit, offset };
  },

  async addEvent(client: Queryable, input: EventAddInput): Promise<IncidentEventRow> {
    const { rows } = await client.query<IncidentEventRow>(
      `INSERT INTO incident_events (incident_id, step, type, title, description, metadata, actor_type, actor_id, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, incident_id AS "incidentId", seq, step, type, title, description, metadata,
                 actor_type AS "actorType", actor_id AS "actorId", run_id AS "runId", created_at AS "createdAt"`,
      [
        input.incident_id,
        input.step,
        input.type,
        input.title,
        input.description ?? null,
        input.metadata ?? {},
        input.actor_type ?? 'system',
        input.actor_id ?? null,
        input.run_id ?? null,
      ]
    );
    return rows[0];
  },

  /** Non-transactional event append (pool client) for service layer convenience. */
  logEvent(incidentId: string, input: Omit<EventAddInput, 'incident_id'>): Promise<IncidentEventRow> {
    return this.addEvent(getPool(), { ...input, incident_id: incidentId });
  },

  async listEvents(incidentId: string, limit = 200): Promise<IncidentEventRow[]> {
    const { rows } = await getPool().query<IncidentEventRow>(
      `SELECT id, incident_id AS "incidentId", seq, step, type, title, description, metadata,
              actor_type AS "actorType", actor_id AS "actorId", run_id AS "runId", created_at AS "createdAt"
       FROM incident_events WHERE incident_id = $1 ORDER BY seq ASC LIMIT $2`,
      [incidentId, limit]
    );
    return rows;
  },

  lastEventFor(incidentId: string): Promise<IncidentEventRow | null> {
    return getPool()
      .query<IncidentEventRow>(
        `SELECT id, incident_id AS "incidentId", seq, step, type, title, description, metadata,
                actor_type AS "actorType", actor_id AS "actorId", run_id AS "runId", created_at AS "createdAt"
         FROM incident_events WHERE incident_id = $1 ORDER BY seq DESC LIMIT 1`,
        [incidentId]
      )
      .then((r) => r.rows[0] ?? null);
  },

  // ---- Domain lookups (the "real systems" the agent reads/writes) ---------

  async findCustomerByCode(code: string, client?: Q): Promise<CustomerRow | null> {
    const { rows } = await (client ?? getPool()).query<CustomerRow>(
      `SELECT id, customer_code AS "customerCode", name, email, phone, city, loyalty_tier AS "loyaltyTier", created_at AS "createdAt"
       FROM customers WHERE customer_code = $1`,
      [code]
    );
    return rows[0] ?? null;
  },

  async getCustomerById(id: string, client?: Q): Promise<CustomerRow | null> {
    const { rows } = await (client ?? getPool()).query<CustomerRow>(
      `SELECT id, customer_code AS "customerCode", name, email, phone, city, loyalty_tier AS "loyaltyTier", created_at AS "createdAt"
       FROM customers WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async createCustomer(customer: { customer_code: string; name: string; email?: string; phone?: string; city?: string; loyalty_tier?: string }): Promise<CustomerRow> {
    const { rows } = await getPool().query<CustomerRow>(
      `INSERT INTO customers (customer_code, name, email, phone, city, loyalty_tier)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, customer_code AS "customerCode", name, email, phone, city, loyalty_tier AS "loyaltyTier", created_at AS "createdAt"`,
      [customer.customer_code, customer.name, customer.email ?? null, customer.phone ?? null, customer.city ?? null, customer.loyalty_tier ?? null]
    );
    return rows[0];
  },

  async getPaymentByTransaction(txn: string, client?: Q): Promise<PaymentRow | null> {
    const { rows } = await (client ?? getPool()).query<PaymentRow>(
      `SELECT id, transaction_id AS "transactionId", customer_id AS "customerId", amount, currency, status,
              payment_method AS "paymentMethod", gateway, paid_at AS "paidAt", provider_payload AS "providerPayload",
              created_at AS "createdAt"
       FROM payments WHERE transaction_id = $1`,
      [txn]
    );
    return rows[0] ?? null;
  },

  async createPayment(p: { transaction_id: string; customer_id?: string; amount: number; currency?: string; status: string; payment_method?: string; gateway?: string; paid_at?: string; provider_payload?: Record<string, unknown> }): Promise<PaymentRow> {
    const { rows } = await getPool().query<PaymentRow>(
      `INSERT INTO payments (transaction_id, customer_id, amount, currency, status, payment_method, gateway, paid_at, provider_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, transaction_id AS "transactionId", customer_id AS "customerId", amount, currency, status,
                 payment_method AS "paymentMethod", gateway, paid_at AS "paidAt", provider_payload AS "providerPayload", created_at AS "createdAt"`,
      [p.transaction_id, p.customer_id ?? null, p.amount, p.currency ?? 'INR', p.status, p.payment_method ?? null, p.gateway ?? null, p.paid_at ?? null, p.provider_payload ?? {}]
    );
    return rows[0];
  },

  async getBookingByTransaction(txn: string, client?: Q): Promise<BookingRow | null> {
    const { rows } = await (client ?? getPool()).query<BookingRow>(
      `SELECT id, booking_code AS "bookingCode", customer_id AS "customerId", payment_id AS "paymentId", transaction_id AS "transactionId",
              movie_title AS "movieTitle", cinema, city, show_time AS "showTime", seats, amount, status, created_at AS "createdAt"
       FROM bookings WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [txn]
    );
    return rows[0] ?? null;
  },

  async createBooking(b: { booking_code: string; customer_id?: string; payment_id?: string; transaction_id?: string; movie_title: string; cinema?: string; city?: string; show_time?: string; seats?: string[]; amount?: number | null }): Promise<BookingRow> {
    const { rows } = await getPool().query<BookingRow>(
      `INSERT INTO bookings (booking_code, customer_id, payment_id, transaction_id, movie_title, cinema, city, show_time, seats, amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
       RETURNING id, booking_code AS "bookingCode", customer_id AS "customerId", payment_id AS "paymentId", transaction_id AS "transactionId",
                 movie_title AS "movieTitle", cinema, city, show_time AS "showTime", seats, amount, status, created_at AS "createdAt"`,
      [b.booking_code, b.customer_id ?? null, b.payment_id ?? null, b.transaction_id ?? null, b.movie_title, b.cinema ?? null, b.city ?? null, b.show_time ?? null, b.seats ?? [], b.amount ?? null]
    );
    return rows[0];
  },

  async updateBookingStatus(txn: string, status: BookingRow['status'], client?: Q): Promise<BookingRow | null> {
    const { rows } = await (client ?? getPool()).query<BookingRow>(
      `UPDATE bookings SET status = $2 WHERE transaction_id = $1
       RETURNING id, booking_code AS "bookingCode", customer_id AS "customerId", payment_id AS "paymentId", transaction_id AS "transactionId",
                 movie_title AS "movieTitle", cinema, city, show_time AS "showTime", seats, amount, status, created_at AS "createdAt"`,
      [txn, status]
    );
    return rows[0] ?? null;
  },

  async refundPayment(transactionId: string, amount?: number, reason?: string): Promise<PaymentRow | null> {
    void amount;
    return withTx(async (client) => {
      const existing = await client.query<PaymentRow>(
        `SELECT transaction_id AS "transactionId" FROM payments WHERE transaction_id = $1 AND status <> 'refunded' LIMIT 1`,
        [transactionId]
      );
      if (!existing.rows[0]) return null;
      const payload = { refundedAt: new Date().toISOString(), refundReason: reason ?? null };
      const { rows } = await client.query<PaymentRow>(
        `UPDATE payments SET status = 'refunded', provider_payload = provider_payload || $2 WHERE transaction_id = $1
         RETURNING id, transaction_id AS "transactionId", customer_id AS "customerId", amount, currency, status,
                   payment_method AS "paymentMethod", gateway, paid_at AS "paidAt", provider_payload AS "providerPayload",
                   created_at AS "createdAt"`,
        [transactionId, payload]
      );
      return rows[0] ?? null;
    });
  },

  async addBookingRecord(r: { service: string; level: string; message: string; transaction_id?: string; metadata?: Record<string, unknown>; occurred_at?: string }): Promise<BookingRecordRow> {
    const { rows } = await getPool().query<BookingRecordRow>(
      `INSERT INTO booking_records (service, level, message, transaction_id, metadata, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, service, level, message, transaction_id AS "transactionId", metadata, occurred_at AS "occurredAt"`,
      [r.service, r.level, r.message, r.transaction_id ?? null, r.metadata ?? {}, r.occurred_at ?? new Date().toISOString()]
    );
    return rows[0];
  },

  async listBookingRecords(filter: { transactionId?: string; service?: string; level?: string; limit?: number } = {}): Promise<BookingRecordRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.transactionId) {
      params.push(filter.transactionId);
      where.push(`transaction_id = $${params.length}`);
    }
    if (filter.service) {
      params.push(filter.service);
      where.push(`service = $${params.length}`);
    }
    if (filter.level) {
      params.push(filter.level);
      where.push(`level = $${params.length}`);
    }
    params.push(filter.limit ?? 20);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await getPool().query<BookingRecordRow>(
      `SELECT id, service, level, message, transaction_id AS "transactionId", metadata, occurred_at AS "occurredAt"
       FROM booking_records ${whereSql} ORDER BY occurred_at DESC LIMIT $${params.length}`,
      params
    );
    return rows;
  },

  // ---- Analytics (SQL aggregates, no in-memory computation) ----------------

  async incidentStats() {
    const r = await getPool().query<{
      total?: string; active?: string; resolved?: string; resolvedToday?: string;
      autoResolved?: string; escalated?: string; avgMinutes?: string | null;
    }>(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE status NOT IN ('resolved','failed','cancelled'))::text AS active,
         count(*) FILTER (WHERE status = 'resolved')::text AS resolved,
         count(*) FILTER (WHERE status = 'resolved' AND updated_at >= date_trunc('day', now()))::text AS "resolvedToday",
         count(*) FILTER (WHERE status = 'resolved' AND auto_resolved)::text AS "autoResolved",
         count(*) FILTER (WHERE metadata->>'escalated' = 'true')::text AS escalated,
         round(avg(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60)::numeric, 2)::text AS "avgMinutes"
       FROM incidents`
    );
    const s = r.rows[0];
    const resolved = Number(s.resolved ?? 0);
    const autoResolved = Number(s.autoResolved ?? 0);
    const bySeverity = new Map<string, string>();
    const byRootCause = new Map<string, string>();
    const byType = new Map<string, string>();
    for (const { name, n } of (await getPool().query<{ name: string; n: string }>(`SELECT severity AS name, count(*)::text AS n FROM incidents GROUP BY severity`)).rows) bySeverity.set(name, n);
    for (const { name, n } of (await getPool().query<{ name: string | null; n: string }>(`SELECT coalesce(root_cause,'unknown') AS name, count(*)::text AS n FROM incidents GROUP BY coalesce(root_cause,'unknown')`)).rows) byRootCause.set(name ?? 'unknown', n);
    for (const { name, n } of (await getPool().query<{ name: string; n: string }>(`SELECT coalesce(metadata->>'incidentType','general') AS name, count(*)::text AS n FROM incidents GROUP BY coalesce(metadata->>'incidentType','general')`)).rows) byType.set(name, n);
    const toMap = (m: Map<string, string>) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, Number(v)]));
    return {
      totalIncidents: Number(s.total ?? 0),
      activeIncidents: Number(s.active ?? 0),
      resolvedIncidents: resolved,
      resolvedToday: Number(s.resolvedToday ?? 0),
      autoResolvedCount: autoResolved,
      escalatedCount: Number(s.escalated ?? 0),
      avgResolutionMinutes: s.avgMinutes ? Number(s.avgMinutes) : 0,
      automationRate: resolved > 0 ? Math.round((autoResolved / resolved) * 100) : 0,
      bySeverity: toMap(bySeverity),
      byRootCause: toMap(byRootCause),
      byType: toMap(byType),
    };
  },
};