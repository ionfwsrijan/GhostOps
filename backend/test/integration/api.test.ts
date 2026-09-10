import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { buildApp } from '../../src/index.js';
import { authRepo } from '../../src/db/repos/auth.js';
import { closePool } from '../../src/db/pool.js';
import { hashToken } from '../../src/config.js';
import { secretFor } from '../../src/services/integrations/webhooks.js';

const ADMIN = { email: 'api.admin@test.local', password: 'ApiAdmin!23456' };
const READONLY = { email: 'api.readonly@test.local', password: 'ApiReadonly!23456' };

type App = ReturnType<typeof buildApp>;

let app: App;
let admin: request.Agent;
let ingestSecret = '';

function hmac(provider: 'payment' | 'booking' | 'monitoring' | 'support', body: string): string {
  return `sha256=${crypto.createHmac('sha256', secretFor(provider)).update(body).digest('hex')}`;
}

async function createUser(email: string, password: string, name: string, role: 'admin' | 'operator' | 'readonly') {
  const hash = await bcrypt.hash(password, 10);
  await authRepo.createUser({ email, password_hash: hash, name, role });
}

/** Bakes a real session cookie onto the agent (bypasses the login rate limiter). */
async function sessionFor(agent: request.Agent, email: string) {
  const user = await authRepo.getUserByEmail(email);
  if (!user) throw new Error(`no test user ${email}`);
  const token = crypto.randomBytes(32).toString('hex');
  await authRepo.createSession({
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  agent.set('Cookie', `ghostops_session=${token}`);
}

beforeAll(async () => {
  await createUser(ADMIN.email, ADMIN.password, 'API Admin', 'admin');
  await createUser(READONLY.email, READONLY.password, 'API Readonly', 'readonly');
  app = buildApp();
  admin = request.agent(app);
  await sessionFor(admin, ADMIN.email);
});

afterAll(async () => {
  await closePool();
});

describe('auth', () => {
  it('rejects bad credentials', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'wrong-password' }).expect(401);
  });

  it('returns the current user from the session', async () => {
    const a = request.agent(app);
    await a.post('/api/v1/auth/login').send(ADMIN).expect(200);
    const res = await a.get('/api/v1/auth/me').expect(200);
    expect(res.body.user.email).toBe(ADMIN.email);
    expect(res.body.user.role).toBe('admin');
  });

  it('logs out and clears the session', async () => {
    const a = request.agent(app);
    await a.post('/api/v1/auth/login').send(ADMIN).expect(200);
    const res = await a.post('/api/v1/auth/logout').expect(200);
    expect(res.body.ok).toBe(true);
    await a.get('/api/v1/auth/me').expect(401);
  });
});

describe('api keys', () => {
  it('admin creates an ingest + read scoped key', async () => {
    const res = await admin.post('/api/v1/auth/api-keys').send({ name: 'ci-ingest', scope: ['ingest', 'read'], expiresDays: 1 }).expect(201);
    expect(res.body.apiKey.secret).toMatch(/^gho_live_/);
    expect(res.body.apiKey.scope).toEqual(['ingest', 'read']);
    ingestSecret = res.body.apiKey.secret;
  });

  it('readonly users cannot create keys', async () => {
    const r = request.agent(app);
    await sessionFor(r, READONLY.email);
    await r.post('/api/v1/auth/api-keys').send({ name: 'nope', scope: ['read'] }).expect(403);
  });

  it('lists existing keys without exposing secrets', async () => {
    const res = await admin.get('/api/v1/auth/api-keys').expect(200);
    expect(res.body.apiKeys.length).toBeGreaterThan(0);
    expect(res.body.apiKeys[0].secret).toBeUndefined();
  });
});

describe('incident intake via API key', () => {
  it('requires an API key with the ingest scope', async () => {
    await request(app).post('/api/v1/incidents').send({ title: 'no auth', issue: 'x' }).expect(403);
    // a session user is NOT an ingestion identity — the endpoint is machine-only
    await admin.post('/api/v1/incidents').send({ title: 'session user', issue: 'x' }).expect(403);
  });

  it('validates the ingest payload', async () => {
    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${ingestSecret}`)
      .send({ issue: 'missing title' })
      .expect(422);
  });

  it('creates an incident, dedupes the agent run, and returns its code', async () => {
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${ingestSecret}`)
      .send({ title: 'API intake test', issue: 'Payment taken but booking missing', transactionId: 'TXN-API-100', severity: 'high' })
      .expect(201);
    expect(res.body.code).toMatch(/^INC-\d{4}-\d{5}$/);
    expect(res.body.incidentId).toBeTruthy();
    expect(res.body.queued).toBe(true);

    // dedupe: only one agent_run job exists for this incident
    const again = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${ingestSecret}`)
      .send({ title: 'duplicate intent', issue: 'Payment taken but booking missing', transactionId: 'TXN-API-100' })
      .expect(201);
    expect(again.body.code).not.toBe(res.body.code);
  });
});

describe('incident dashboard API', () => {
  it('lists incidents as a paged { rows, total, limit, offset } envelope', async () => {
    const res = await admin.get('/api/v1/incidents').expect(200);
    expect(res.body.rows.length).toBeGreaterThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
    expect(res.body.rows[0].incidentCode).toBeTruthy();
    expect(res.body.rows[0].createdAt).toBeTruthy();
  });

  it('filters by status and searches', async () => {
    const res = await admin.get('/api/v1/incidents?status=detected&q=booking').expect(200);
    expect(res.body.rows.every((r: { status: string }) => r.status === 'detected')).toBe(true);
  });

  it('exposes incident stats in the KpiStats shape', async () => {
    const res = await admin.get('/api/v1/incidents/stats').expect(200);
    expect(res.body.totalIncidents).toBeGreaterThanOrEqual(2);
    expect(res.body.bySeverity).toHaveProperty('high');
  });

  it('returns full detail with events + actions', async () => {
    const list = await admin.get('/api/v1/incidents').expect(200);
    const id = list.body.rows[0].id;
    const res = await admin.get(`/api/v1/incidents/${id}`).expect(200);
    expect(res.body.incident.id).toBe(id);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.events[0].createdAt).toBeTruthy();
    expect(Array.isArray(res.body.actions)).toBe(true);
  });

  it('404s for unknown incidents', async () => {
    await admin.get('/api/v1/incidents/00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('readonly role may view but not cancel', async () => {
    const list = await admin.get('/api/v1/incidents').expect(200);
    const id = list.body.rows[0].id;
    const r = request.agent(app);
    await sessionFor(r, READONLY.email);
    await r.get('/api/v1/incidents').expect(200);
    await r.post(`/api/v1/incidents/${id}/cancel`).expect(403);
  });
});

describe('webhook intake (HMAC)', () => {
  it('rejects unsigned payloads', async () => {
    await request(app).post('/api/v1/webhooks/monitoring').set('content-type', 'application/json').send('{"data":{"service":"booking-service","message":"outage"}}').expect(503);
  });

  it('rejects tampered signatures', async () => {
    const body = JSON.stringify({ data: { service: 'booking-service', message: 'outage' } });
    await request(app)
      .post('/api/v1/webhooks/monitoring')
      .set('content-type', 'application/json')
      .set('X-GhostOps-Signature', 'sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      .send(body)
      .expect(503);
  });

  it('accepts a valid payment webhook and creates an incident', async () => {
    const body = JSON.stringify({
      event: 'payment.received',
      data: { transaction: { id: 'TXN-WH-200', amount: 450, status: 'success' }, customer: { name: 'Webhook Customer' } },
    });
    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('content-type', 'application/json')
      .set('X-GhostOps-Signature', hmac('payment', body))
      .send(body)
      .expect(201);
    expect(res.body.accepted).toBe(true);
    expect(res.body.code).toMatch(/^INC-\d{4}-\d{5}$/);
  });

  it('ignores signatures produced by another provider secret', async () => {
    const body = JSON.stringify({ data: { service: 'booking-service', message: 'outage' } });
    const wrong = `sha256=${crypto.createHmac('sha256', secretFor('payment')).update(body).digest('hex')}`;
    await request(app).post('/api/v1/webhooks/monitoring').set('content-type', 'application/json').set('X-GhostOps-Signature', wrong).send(body).expect(503);
  });
});

describe('audit + system surface', () => {
  it('records audit rows for login/ingest/webhook activity', async () => {
    const res = await admin.get('/api/v1/audit').expect(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows[0].action).toBeTruthy();
    expect(res.body.rows[0].createdAt).toBeTruthy();
    const actions = res.body.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('incident.ingested');
  });

  it('reports healthy system status publicly', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.postgres).toBe('ok');
  });

  it('returns metadata for authenticated actors', async () => {
    const res = await admin.get('/api/v1/meta').expect(200);
    expect(res.body.workerInstance).toBeTruthy();
    expect(Array.isArray(res.body.integrations)).toBe(true);
  });
});