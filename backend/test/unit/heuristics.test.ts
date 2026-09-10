import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVESTIGATION_PLANS,
  analyzeRootCauseHeuristically,
  classifyHeuristically,
  detectIncidentType,
  heuristicSeverity,
  planHeuristically,
} from '../../src/ai/heuristics.js';
import { IncidentRow } from '../../src/db/types.js';

function makeIncident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: 'inc-1',
    incidentCode: 'INC-T-00001',
    title: 'Test incident',
    issue: 'Payment taken but booking missing',
    description: null,
    severity: 'medium',
    status: 'detected',
    customerId: null,
    transactionId: 'TXN-1',
    affectedService: 'booking-service',
    channel: 'api',
    source: 'test',
    aiConfidence: null,
    rootCause: null,
    rootCauseConfidence: null,
    evidence: {},
    resolutionSummary: null,
    autoResolved: false,
    metadata: {},
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('detectIncidentType', () => {
  it('returns a metadata hint when provided', () => {
    expect(detectIncidentType({ title: 'x', metadata: { incidentType: 'api_timeout' } })).toBe('api_timeout');
  });

  it('classifies payment failures around bookings', () => {
    expect(detectIncidentType({ title: 'Payment failed', issue: 'booking was not created' })).toBe('payment_booking_failure');
  });

  it('classifies timeouts', () => {
    expect(detectIncidentType({ title: 'orders-api timed out after 30s', issue: '' })).toBe('api_timeout');
  });

  it('classifies database failures', () => {
    expect(detectIncidentType({ title: 'db connection pool exhausted', issue: '' })).toBe('database_failure');
  });

  it('falls back to generic', () => {
    expect(detectIncidentType({ title: 'mysterious widget', issue: '' })).toBe('generic');
  });
});

describe('heuristicSeverity', () => {
  it('flags outages as critical', () => {
    expect(heuristicSeverity('the checkout service is down')).toBe('critical');
  });
  it('flags financial issues as high', () => {
    expect(heuristicSeverity('customer paid but booking lost')).toBe('high');
  });
  it('flags slow issues as medium', () => {
    expect(heuristicSeverity('endpoint is intermittently slow')).toBe('medium');
  });
  it('defaults to low', () => {
    expect(heuristicSeverity('nothing interesting')).toBe('low');
  });
});

describe('classifyHeuristically', () => {
  it('produces a deterministic classification', () => {
    const c = classifyHeuristically(makeIncident({ issue: 'Payment succeeded but the booking was never created' }));
    expect(c.incidentType).toBe('payment_booking_failure');
    expect(c.confidence).toBeGreaterThan(0.8);
    expect(c.investigationPlan).toEqual(DEFAULT_INVESTIGATION_PLANS.payment_booking_failure);
    expect(c.entities.transactionId).toBe('TXN-1');
  });

  it('extracts amount from metadata', () => {
    const c = classifyHeuristically(makeIncident({ metadata: { amount: 1299 } }));
    expect(c.entities.amount).toBe(1299);
  });
});

describe('analyzeRootCauseHeuristically', () => {
  const evidence = {
    paymentOk: (status = 'success') => ({ tool: 'verify_transaction', ok: true, data: { exists: true, status, amount: 500 } }),
    bookingMissing: () => ({ tool: 'check_booking', ok: true, data: { exists: false } }),
    timeoutLog: () => ({
      tool: 'search_logs',
      ok: true,
      data: { entries: [{ message: 'database timeout after 5000ms' }] },
    }),
    poolLog: () => ({
      tool: 'search_logs',
      ok: true,
      data: { entries: [{ message: 'connection pool exhausted' }] },
    }),
  };

  it('detects database_timeout', () => {
    const a = analyzeRootCauseHeuristically(makeIncident(), [evidence.paymentOk(), evidence.bookingMissing(), evidence.timeoutLog()]);
    expect(a.rootCause).toBe('database_timeout');
    expect(a.confidence).toBeGreaterThan(0.8);
  });

  it('detects pool exhaustion', () => {
    const a = analyzeRootCauseHeuristically(makeIncident(), [evidence.paymentOk(), evidence.bookingMissing(), evidence.poolLog()]);
    expect(a.rootCause).toBe('db_connection_pool_exhaustion');
  });

  it('detects gateway callback failure when no timeout in logs', () => {
    const a = analyzeRootCauseHeuristically(makeIncident(), [evidence.paymentOk(), evidence.bookingMissing()]);
    expect(a.rootCause).toBe('payment_gateway_failure');
  });

  it('favors duplicate detection over the generic gateway fallback', () => {
    const dup = () => ({ tool: 'db_check_duplicate', ok: true, data: { payments: 2, bookings: 0, duplicates: 1 } });
    const a = analyzeRootCauseHeuristically(makeIncident(), [evidence.paymentOk(), evidence.bookingMissing(), dup()]);
    expect(a.rootCause).toBe('duplicate_transaction');
  });

  it('returns unknown for inconclusive evidence', () => {
    const a = analyzeRootCauseHeuristically(makeIncident(), [evidence.bookingMissing()]);
    expect(a.rootCause).toBe('unknown');
    expect(a.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe('planHeuristically', () => {
  function analyze(rootCause: string) {
    return { rootCause, confidence: 0.9, explanation: 'x', evidence: ['y'], nextInvestigationSteps: [] } as Parameters<typeof planHeuristically>[1];
  }

  it('plans re-creation for database_timeout', () => {
    const p = planHeuristically(makeIncident({ transactionId: 'TXN-2', metadata: { amount: 100 } }), analyze('database_timeout'));
    expect(p.actions.map((a) => a.actionKey)).toContain('retry_booking');
    expect(p.actions[0].params.transactionId).toBe('TXN-2');
  });

  it('routes duplicate charges to refund (human approval)', () => {
    const p = planHeuristically(makeIncident(), analyze('duplicate_transaction'));
    expect(p.actions.map((a) => a.actionKey)).toContain('refund_customer');
  });

  it('falls back to diagnostics + ticket for unknown causes', () => {
    const p = planHeuristically(makeIncident(), analyze('unknown'));
    expect(p.actions.map((a) => a.actionKey)).toEqual(['collect_diagnostics', 'create_jira_ticket']);
  });
});