import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { authRepo, engineRepo, incidentRepo } from '../../src/db/repos/index.js';
import { closePool } from '../../src/db/pool.js';
import { ingestService } from '../../src/services/ingestService.js';
import { agentRunner } from '../../src/agents/agentRunner.js';
import { actionService } from '../../src/services/actionService.js';

let approverId: string;

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 30_000, step = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('timed out waiting for condition');
}

beforeAll(async () => {
  const approver = await authRepo.createUser({
    email: 'approver@test.local',
    password_hash: await bcrypt.hash('Approver!23456', 10),
    name: 'Loop Approver',
    role: 'operator',
  });
  approverId = approver.id;
  const cust = await incidentRepo.createCustomer({ customer_code: 'CUST-LOOP-1', name: 'Loop Customer', email: 'loop@test.local', city: 'Mumbai' });
  await incidentRepo.createPayment({ transaction_id: 'TXN-LOOP-1', customer_id: cust.id, amount: 500, currency: 'INR', status: 'success', payment_method: 'card', gateway: 'razorpay' });
  await incidentRepo.addBookingRecord({
    service: 'booking-service',
    level: 'error',
    message: 'database timeout after 5000ms while writing booking for TXN-LOOP-1',
    transaction_id: 'TXN-LOOP-1',
    metadata: { cause: 'statement_timeout' },
  });
});

afterAll(async () => {
  await closePool();
});

describe('agent loop — full auto-resolution', () => {
  it('detects a database timeout, heals the booking, and resolves', async () => {
    const { incidentId, code } = await ingestService.ingest({
      channel: 'api',
      source: 'test',
      title: 'Payment succeeded but booking missing',
      issue: 'Payment succeeded but booking not created',
      severity: 'high',
      transactionId: 'TXN-LOOP-1',
      affectedService: 'booking-service',
      customer: { code: 'CUST-LOOP-1' },
      metadata: { incidentType: 'payment_booking_failure', amount: 500 },
    });
    expect(code).toMatch(/^INC-\d{4}-\d{5}$/);

    await agentRunner.run(incidentId);

    const incident = await incidentRepo.getIncident(incidentId);
    expect(incident?.status).toBe('resolved');
    expect(incident?.autoResolved).toBe(true);
    expect(incident?.rootCause).toBe('database_timeout');
    expect(incident?.resolutionSummary).toBeTruthy();

    // the booking was actually healed
    const booking = await incidentRepo.getBookingByTransaction('TXN-LOOP-1');
    expect(booking?.status).toBe('confirmed');

    // the remedy is traced in the action ledger as an executed retry
    const actions = await engineRepo.listActions(incidentId);
    const retry = actions.find((a) => a.actionKey === 'retry_booking');
    expect(retry?.status).toBe('executed');
    expect(retry?.result).toBe('success');

    // run completed cleanly with a bounded ledger
    const runs = await engineRepo.listRuns(incidentId);
    expect(runs[0].state).toBe('completed');
    expect(runs[0].startedAt).toBeTruthy();
    expect(new Date(runs[0].completedAt!).getTime()).toBeGreaterThanOrEqual(new Date(runs[0].startedAt!).getTime());
  });
});

describe('agent loop — human-in-the-loop approvals', () => {
  it('pauses high-risk refunds and resumes after human approval', async () => {
    const cust = await incidentRepo.createCustomer({ customer_code: 'CUST-LOOP-2', name: 'Dupe Customer', email: 'dupe@test.local' });
    await incidentRepo.createPayment({ transaction_id: 'TXN-LOOP-2', customer_id: cust.id, amount: 400, currency: 'INR', status: 'success', payment_method: 'card', gateway: 'razorpay' });
    await incidentRepo.createPayment({ transaction_id: 'TXN-LOOP-2', customer_id: cust.id, amount: 400, currency: 'INR', status: 'success', payment_method: 'card', gateway: 'razorpay' });

    const { incidentId } = await ingestService.ingest({
      channel: 'api',
      source: 'test',
      title: 'Customer charged twice',
      issue: 'Customer was charged twice for the same booking',
      severity: 'high',
      transactionId: 'TXN-LOOP-2',
      affectedService: 'booking-service',
      customer: { code: 'CUST-LOOP-2' },
      metadata: { incidentType: 'payment_booking_failure', amount: 400 },
    });

    await agentRunner.run(incidentId);

    // the agent paused for human review instead of auto-refunding
    const incident = await incidentRepo.getIncident(incidentId);
    expect(incident?.status).toBe('awaiting_approval');
    expect(incident?.rootCause).toBe('duplicate_transaction');

    const pending = await engineRepo.listApprovals('pending');
    const approval = pending.find((a) => a.incidentId === incidentId && a.actionKey === 'refund_customer');
    expect(approval).toBeDefined();
    expect(approval?.risk).toBe('high');

    // human approves → agent resumes, refunds, verifies, and resolves
    const decide = await actionService.decide({ approvalId: approval!.id, approval: 'approved', userId: approverId, reason: 'duplicate charge confirmed' });
    expect(decide.ok).toBe(true);

    await waitFor(async () => (await incidentRepo.getIncident(incidentId))?.status === 'resolved');

    const resolved = await incidentRepo.getIncident(incidentId);
    expect(resolved?.autoResolved).toBe(true);
    const refund = (await engineRepo.listActions(incidentId)).find((a) => a.actionKey === 'refund_customer');
    expect(refund?.status).toBe('executed');
    expect(refund?.result).toBe('success');
    expect((await engineRepo.listApprovals('approved')).some((a) => a.id === approval!.id)).toBe(true);
  });
});