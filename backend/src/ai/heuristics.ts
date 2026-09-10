import { IncidentRow } from '../db/types.js';
import { Classification, RootCauseAnalysis, ActionPlan } from './schemas.js';

/**
 * Deterministic analysis engine. When OpenAI isn't configured (or the LLM
 * fails), GhostOps classifies, investigates, and plans using rule-based
 * reasoning over evidence — so the full agent loop still runs offline.
 */

export const DEFAULT_INVESTIGATION_PLANS: Record<string, string[]> = {
  payment_booking_failure: ['verify_transaction', 'check_booking', 'db_check_duplicate', 'search_logs'],
  api_timeout: ['db_find_record', 'search_logs', 'verify_transaction'],
  customer_complaint: ['verify_transaction', 'db_check_duplicate', 'search_logs'],
  database_failure: ['db_find_record', 'search_logs'],
  generic: ['db_find_record', 'search_logs'],
};

export function detectIncidentType(input: { title: string; issue?: string; metadata?: Record<string, unknown> }): Classification['incidentType'] {
  const hint = input.metadata?.incidentType as string | undefined;
  if (hint && hint in DEFAULT_INVESTIGATION_PLANS) return hint as Classification['incidentType'];

  const text = `${input.title} ${input.issue ?? ''}`.toLowerCase();
  if (/(pay|payment|charge|refund|transaction|money)/.test(text) && /(booking|ticket|movie|seat)/.test(text)) {
    return 'payment_booking_failure';
  }
  if (/(timeout|latency|504|slow|timed out|timed-out)/.test(text)) return 'api_timeout';
  if (/(database|db|pool|connection|query|sql)/.test(text)) return 'database_failure';
  if (/(complaint|charged twice|double|duplicate|refund)/.test(text)) return 'customer_complaint';
  return 'generic';
}

export function heuristicSeverity(content: string): Classification['severity'] {
  const lower = content.toLowerCase();
  if (/(critical|down|outage|data loss)/.test(lower)) return 'critical';
  if (/(money|payment|booking lost|failed|urgent|refund)/.test(lower) && /(paid|charged|money|500|fail)/.test(lower)) return 'high';
  if (/(intermittent|slow|delayed)/.test(lower)) return 'medium';
  return 'low';
}

export function classifyHeuristically(incident: IncidentRow): Classification {
  const type = detectIncidentType(incident);
  const text = `${incident.title} ${incident.issue ?? ''} ${incident.description ?? ''}`;
  const severity = incident.severity ?? heuristicSeverity(text);
  return {
    incidentType: type,
    severity,
    entities: {
      transactionId: incident.transactionId ?? null,
      customerId: incident.customerId ?? null,
      amount: Number((incident.metadata?.amount as unknown as number) ?? null),
    },
    summary: `Issue: ${incident.issue}. Pattern matches ${type.replace(/_/g, ' ')}.`,
    investigationPlan: DEFAULT_INVESTIGATION_PLANS[type] ?? DEFAULT_INVESTIGATION_PLANS.generic,
    confidence: 0.87,
  };
}

/**
 * Root-cause reasoning from evidence (tool results).
 * Evidence entries: { tool, ok, data }.
 */
export interface RawEvidence {
  tool: string;
  ok: boolean;
  data?: unknown;
  summary?: string;
}

export function analyzeRootCauseHeuristically(_incident: IncidentRow, evidence: RawEvidence[]): RootCauseAnalysis {
  const pay = evidence.find((e) => e.tool === 'verify_transaction');
  const booking = evidence.find((e) => e.tool === 'check_booking');
  const logs = evidence.find((e) => e.tool === 'search_logs');
  const dup = evidence.find((e) => e.tool === 'db_check_duplicate');

  const paymentOk = pay?.ok && (pay.data as { status?: string })?.status === 'success';
  const bookingMissing = booking?.ok && (booking.data as { exists?: boolean })?.exists === false;
  const duplicates = dup?.ok && (dup.data as { duplicates?: number })?.duplicates;

  const logEntries = ((logs?.data as { entries: Array<{ message: string }> })?.entries ?? []) as Array<{ message: string }>;
  const timeoutFound = logEntries.some((l) => /timeout/i.test(l.message));
  const poolFound = logEntries.some((l) => /pool/i.test(l.message));

  if (paymentOk && bookingMissing && (timeoutFound || poolFound)) {
    const rootCause = timeoutFound ? 'database_timeout' : 'db_connection_pool_exhaustion';
    const confidence = timeoutFound ? 0.87 : 0.84;
    return {
      rootCause,
      confidence,
      explanation: timeoutFound
        ? 'Payment succeeded but the booking write timed out against the database, so no booking row was created.'
        : 'The booking service exhausted its database connection pool during the booking write, dropping the insert.',
      evidence: [
        'Payment successful',
        bookingMissing ? 'Booking record missing' : 'Booking state unclear',
        timeoutFound ? 'Database timeout found in logs' : 'Pool exhaustion found in logs',
        duplicates ? `Duplicate transaction detected (${duplicates})` : 'No duplicate transaction detected',
      ],
      nextInvestigationSteps: timeoutFound ? [] : ['search_logs'],
    };
  }

  if (paymentOk && bookingMissing) {
    return {
      rootCause: 'payment_gateway_failure',
      confidence: 0.72,
      explanation: 'Payment was captured but no booking followed. Likely a write-handler failure after gateway callback.',
      evidence: ['Payment successful', 'Booking record missing', 'No timeout found in logs'],
      nextInvestigationSteps: ['db_find_record', 'search_logs'],
    };
  }

  if (duplicates && (duplicates as number) > 0) {
    return {
      rootCause: 'duplicate_transaction',
      confidence: 0.91,
      explanation: 'The customer was charged more than once for the same intent.',
      evidence: [`${duplicates} duplicate transaction(s) detected`, 'Payment successful'],
      nextInvestigationSteps: ['search_logs'],
    };
  }

  if (logEntries.some((l) => /404|not found/i.test(l.message))) {
    return {
      rootCause: 'misconfiguration',
      confidence: 0.7,
      explanation: 'A service dependency returned not-found during the booking flow.',
      evidence: ['Not-found errors in logs', 'Booking record missing'],
      nextInvestigationSteps: ['search_logs'],
    };
  }

  return {
    rootCause: 'unknown',
    confidence: 0.5,
    explanation: 'Evidence was inconclusive. Requires deeper diagnosis.',
    evidence: evidence.map((e) => e.summary ?? `${e.tool} returned ${e.ok ? 'ok' : 'failed'}`),
    nextInvestigationSteps: ['search_logs', 'db_find_record'],
  };
}

/**
 * Build the remediation plan from root cause + incident. Returns allowlisted
 * actions only; risk + approval are decided by the action service.
 */
export function planHeuristically(incident: IncidentRow, analysis: RootCauseAnalysis): ActionPlan {
  const txn = incident.transactionId;
  const amount = Number((incident.metadata?.amount as unknown as number) ?? (incident.evidence as { amount?: number } | undefined)?.amount ?? 0);

  if (analysis.rootCause === 'database_timeout' || analysis.rootCause === 'db_connection_pool_exhaustion') {
    return {
      reasoning: 'Database write failed after a confirmed payment. Safest remediation is to re-create the missing booking from the confirmed payment, then notify the customer and log an engineering ticket.',
      actions: [
        { actionKey: 'retry_booking', params: { transactionId: txn, amount }, confidence: analysis.confidence, reasoning: 'Re-create the missing booking from the confirmed payment (idempotent).' },
        { actionKey: 'send_customer_notification', params: { subject: 'Your booking is confirmed' }, confidence: 0.95, reasoning: 'Notify the customer the booking is now confirmed.' },
        { actionKey: 'create_jira_ticket', params: { summary: `[${incident.incidentCode}] booking creation recovered after ${analysis.rootCause}` }, confidence: 0.9, reasoning: 'File an engineering ticket for the timeout remediation.' },
        { actionKey: 'send_slack_notification', params: { channel: 'on-call', text: `${incident.incidentCode}: booking creation recovered after timeout` }, confidence: 0.9, reasoning: 'Inform the on-call team.' },
      ],
    };
  }

  if (analysis.rootCause === 'duplicate_transaction') {
    return {
      reasoning: 'Customer was charged more than once. Refund the duplicate charge (requires human approval) and inform the on-call team.',
      actions: [
        { actionKey: 'refund_customer', params: { transactionId: txn, amount }, confidence: 0.91, reasoning: 'Refund the duplicate charge.' },
        { actionKey: 'send_customer_notification', params: { subject: 'Refund processed' }, confidence: 0.9, reasoning: 'Inform the customer the duplicate charge was refunded.' },
        { actionKey: 'create_jira_ticket', params: { summary: `[${incident.incidentCode}] duplicate charge refund processed` }, confidence: 0.85, reasoning: 'Enqueue idempotency-key fix.' },
      ],
    };
  }

  if (analysis.rootCause === 'payment_gateway_failure') {
    return {
      reasoning: 'Payment captured but booking not created. Retry booking safely; escalate to engineering if it recurs.',
      actions: [
        { actionKey: 'retry_booking', params: { transactionId: txn }, confidence: 0.72, reasoning: 'Attempt safe re-creation of the booking.' },
        { actionKey: 'create_jira_ticket', params: { summary: `[${incident.incidentCode}] gateway callback reliability` }, confidence: 0.8, reasoning: 'Track gateway callback reliability.' },
      ],
    };
  }

  return {
    reasoning: 'Unknown root cause — collect diagnostics and escalate to engineering for deeper triage.',
    actions: [
      { actionKey: 'collect_diagnostics', params: { transactionId: txn }, confidence: 0.6, reasoning: 'Gather more diagnostics before acting.' },
      { actionKey: 'create_jira_ticket', params: { summary: `[${incident.incidentCode}] root cause unresolved requiring manual triage` }, confidence: 0.75, reasoning: 'Escalate for manual review.' },
    ],
  };
}