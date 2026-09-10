/* eslint-disable camelcase */
/**
 * Initial GhostOps schema.
 * Postgres 15+. Extension-free (gen_random_uuid() is built in since PG13).
 */

exports.up = (pgm) => {
  // ---- Identity & access -------------------------------------------------
  pgm.createTable('users', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    email: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true, default: 'readonly', check: "role IN ('admin','operator','readonly')" },
    status: { type: 'text', notNull: true, default: 'active', check: "status IN ('active','disabled')" },
    last_login_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('users', pgm.func('lower(email)'), { name: 'users_email_lower_key', unique: true });

  pgm.createTable('sessions', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    user_agent: { type: 'text' },
    ip: { type: 'inet' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sessions', 'user_id');
  pgm.createIndex('sessions', 'expires_at');

  pgm.createTable('api_keys', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    name: { type: 'text', notNull: true },
    prefix: { type: 'text', notNull: true, unique: true },
    key_hash: { type: 'text', notNull: true, unique: true },
    scope: { type: 'text[]', notNull: true, default: pgm.func("ARRAY['ingest']") },
    owner_user_id: { type: 'uuid', references: 'users' },
    expires_at: { type: 'timestamptz' },
    last_used_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('api_keys', 'owner_user_id');

  // ---- Domain entities ----------------------------------------------------
  pgm.createTable('customers', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    customer_code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    email: { type: 'text' },
    phone: { type: 'text' },
    city: { type: 'text' },
    loyalty_tier: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('payments', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    transaction_id: { type: 'text', notNull: true, unique: true },
    customer_id: { type: 'uuid', references: 'customers' },
    amount: { type: 'numeric(12,2)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'INR' },
    status: { type: 'text', notNull: true },
    payment_method: { type: 'text' },
    gateway: { type: 'text' },
    paid_at: { type: 'timestamptz' },
    provider_payload: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('payments', ['customer_id', 'created_at']);

  pgm.createTable('bookings', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    booking_code: { type: 'text', notNull: true, unique: true },
    customer_id: { type: 'uuid', references: 'customers' },
    payment_id: { type: 'uuid', references: 'payments' },
    transaction_id: { type: 'text' },
    movie_title: { type: 'text', notNull: true },
    cinema: { type: 'text' },
    city: { type: 'text' },
    show_time: { type: 'timestamptz' },
    seats: { type: 'jsonb', notNull: true, default: '[]' },
    amount: { type: 'numeric(12,2)' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','confirmed','cancelled','refunded')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('bookings', 'transaction_id');
  pgm.createIndex('bookings', ['customer_id', 'created_at']);

  pgm.createTable('booking_records', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    service: { type: 'text', notNull: true },
    level: { type: 'text', notNull: true, default: 'info', check: "level IN ('debug','info','warn','error','fatal')" },
    message: { type: 'text', notNull: true },
    transaction_id: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('booking_records', ['transaction_id', 'occurred_at']);
  pgm.createIndex('booking_records', ['service', 'level', 'occurred_at']);

  // ---- Incidents + agent loop --------------------------------------------
  pgm.createSequence('incident_seq', { start: 1000 });

  pgm.createTable('incidents', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    incident_code: { type: 'text', notNull: true, unique: true },
    title: { type: 'text', notNull: true },
    issue: { type: 'text', notNull: true },
    description: { type: 'text' },
    severity: {
      type: 'text',
      notNull: true,
      default: 'medium',
      check: "severity IN ('critical','high','medium','low')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'detected',
      check:
        "status IN ('detected','investigating','action_required','awaiting_approval','resolving','resolved','failed','cancelled')",
    },
    customer_id: { type: 'uuid', references: 'customers' },
    transaction_id: { type: 'text' },
    affected_service: { type: 'text' },
    channel: { type: 'text', notNull: true, default: 'api' },
    source: { type: 'text', notNull: true, default: 'api' },
    ai_confidence: { type: 'numeric(5,4)' },
    root_cause: { type: 'text' },
    root_cause_confidence: { type: 'numeric(5,4)' },
    evidence: { type: 'jsonb', notNull: true, default: '{}' },
    resolution_summary: { type: 'text' },
    auto_resolved: { type: 'boolean', notNull: true, default: false },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    version: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('incidents', 'status');
  pgm.createIndex('incidents', 'severity');
  pgm.createIndex('incidents', ['customer_id', 'created_at']);
  pgm.createIndex('incidents', ['created_at', 'id'], { name: 'incidents_created_id_idx' });

  pgm.createTable('incident_events', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    incident_id: { type: 'uuid', notNull: true, references: 'incidents', onDelete: 'CASCADE' },
    seq: { type: 'bigserial', notNull: true },
    step: { type: 'text', notNull: true },
    type: {
      type: 'text',
      notNull: true,
      default: 'info',
      check: "type IN ('info','success','error','warning','ai','action','system')",
    },
    title: { type: 'text', notNull: true },
    description: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    actor_type: { type: 'text', notNull: true, default: 'system' },
    actor_id: { type: 'uuid' },
    run_id: { type: 'uuid' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('incident_events', ['incident_id', 'seq'], { unique: true });

  pgm.createTable('agent_runs', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    incident_id: { type: 'uuid', notNull: true, references: 'incidents' },
    correlation_id: { type: 'text', notNull: true, unique: true },
    state: {
      type: 'text',
      notNull: true,
      default: 'queued',
      check:
        "state IN ('queued','claimed','running','paused','waiting_approval','completed','failed','cancelled')",
    },
    attempt: { type: 'integer', notNull: true, default: 1 },
    max_attempts: { type: 'integer', notNull: true, default: 5 },
    status_snapshot: { type: 'jsonb', notNull: true, default: '{}' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('agent_runs', 'incident_id');
  pgm.sql(
    "CREATE UNIQUE INDEX one_active_run_per_incident ON agent_runs(incident_id) WHERE state IN ('queued','claimed','running','paused','waiting_approval');"
  );

  pgm.createTable('approvals', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    incident_id: { type: 'uuid', notNull: true, references: 'incidents' },
    run_id: { type: 'uuid', references: 'agent_runs' },
    action_key: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    description: { type: 'text' },
    risk: { type: 'text', notNull: true, check: "risk IN ('low','medium','high')" },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','approved','rejected','expired')",
    },
    ai_recommendation: { type: 'text' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    decided_by_user_id: { type: 'uuid', references: 'users' },
    decision_reason: { type: 'text' },
    decided_at: { type: 'timestamptz' },
  });
  pgm.createIndex('approvals', ['status', 'expires_at']);

  pgm.createTable('actions', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    incident_id: { type: 'uuid', notNull: true, references: 'incidents', onDelete: 'CASCADE' },
    run_id: { type: 'uuid', references: 'agent_runs' },
    plan_index: { type: 'integer', notNull: true },
    action_key: { type: 'text', notNull: true },
    label: { type: 'text', notNull: true },
    tool: { type: 'text', notNull: true },
    risk: { type: 'text', notNull: true, check: "risk IN ('low','medium','high')" },
    input: { type: 'jsonb', notNull: true, default: '{}' },
    output: { type: 'jsonb' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','executed','failed','skipped','pending_approval')",
    },
    result: { type: 'text' },
    executed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('actions', 'incident_id');
  pgm.createIndex('actions', ['incident_id', 'plan_index'], { unique: true, name: 'actions_incident_plan_unique' });

  // ---- Work queues ---------------------------------------------------------
  pgm.createTable('jobs', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    kind: {
      type: 'text',
      notNull: true,
      check: "kind IN ('agent_run','agent_resume','outbox_delivery','approval_expiry','reconcile_incident')",
    },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    status: { type: 'text', notNull: true, default: 'pending', check: "status IN ('pending','claimed','done','failed','cancelled')" },
    run_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    attempts: { type: 'integer', notNull: true, default: 0 },
    max_attempts: { type: 'integer', notNull: true, default: 5 },
    last_error: { type: 'text' },
    closed_at: { type: 'timestamptz' },
    instance_id: { type: 'text' },
    locked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('jobs', ['status', 'run_at'], { name: 'jobs_pending_idx' });

  pgm.createTable('outbox', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    integration: { type: 'text', notNull: true, check: "integration IN ('slack','jira','email','n8n')" },
    event_type: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    status: { type: 'text', notNull: true, default: 'pending', check: "status IN ('pending','delivered','failed','skipped')" },
    attempts: { type: 'integer', notNull: true, default: 0 },
    max_attempts: { type: 'integer', notNull: true, default: 5 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    provider_ref: { type: 'text' },
    last_error: { type: 'text' },
    incident_id: { type: 'uuid', references: 'incidents' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    delivered_at: { type: 'timestamptz' },
  });
  pgm.createIndex('outbox', ['status', 'next_attempt_at'], { name: 'outbox_pending_idx' });

  // ---- Integrations + ingestion + audit -------------------------------------
  pgm.createTable('integrations', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    provider: {
      type: 'text',
      notNull: true,
      unique: true,
      check: "provider IN ('slack','jira','email','n8n')",
    },
    name: { type: 'text', notNull: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    config: { type: 'jsonb', notNull: true, default: '{}' },
    secrets: { type: 'jsonb', notNull: true, default: '{}' },
    status: {
      type: 'text',
      notNull: true,
      default: 'not_configured',
      check: "status IN ('unknown','healthy','unhealthy','not_configured')",
    },
    last_health_check_at: { type: 'timestamptz' },
    last_health_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('webhook_ingest', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    provider: { type: 'text', notNull: true },
    signature_verified: { type: 'boolean', notNull: true, default: false },
    auth_method: { type: 'text', notNull: true },
    api_key_id: { type: 'uuid', references: 'api_keys' },
    raw: { type: 'jsonb', notNull: true },
    source_ip: { type: 'inet' },
    incident_id: { type: 'uuid', references: 'incidents' },
    error: { type: 'text' },
    processed: { type: 'boolean', notNull: true, default: false },
    received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('webhook_ingest', 'received_at');

  pgm.createTable('audit_log', {
    id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()'), primaryKey: true },
    request_id: { type: 'text' },
    actor_type: { type: 'text', notNull: true, check: "actor_type IN ('user','api','system')" },
    actor_id: { type: 'uuid' },
    actor_email: { type: 'text' },
    action: { type: 'text', notNull: true },
    target_type: { type: 'text' },
    target_id: { type: 'text' },
    before: { type: 'jsonb' },
    after: { type: 'jsonb' },
    ip: { type: 'text' },
    metadata: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_log', 'created_at');
  pgm.createIndex('audit_log', ['actor_type', 'actor_id']);
  pgm.createIndex('audit_log', 'action');

  // Trigger: keep incidents.updated_at fresh
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  for (const table of ['users', 'customers', 'payments', 'bookings', 'incidents', 'integrations']) {
    pgm.sql(`CREATE TRIGGER trg_${table}_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);
  }
};

exports.down = (pgm) => {
  for (const table of ['users', 'customers', 'payments', 'bookings', 'incidents', 'integrations']) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table};`);
  }
  pgm.sql('DROP FUNCTION IF EXISTS set_updated_at();');
  pgm.dropTable('audit_log');
  pgm.dropTable('webhook_ingest');
  pgm.dropTable('integrations');
  pgm.dropTable('outbox');
  pgm.dropTable('jobs');
  pgm.dropTable('actions');
  pgm.dropTable('approvals');
  pgm.dropTable('agent_runs');
  pgm.dropTable('incident_events');
  pgm.dropTable('incidents');
  pgm.dropSequence('incident_seq');
  pgm.dropTable('booking_records');
  pgm.dropTable('bookings');
  pgm.dropTable('payments');
  pgm.dropTable('customers');
  pgm.dropTable('api_keys');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
};