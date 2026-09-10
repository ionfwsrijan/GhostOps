import { IncidentRow } from '../db/types.js';
import { executeToolUntraced } from '../tools/index.js';
import { ToolResult } from '../tools/types.js';
import { logger } from '../logger.js';

export interface VerificationCheck {
  tool: string;
  ok: boolean;
  summary: string;
}

export interface VerificationVerdict {
  rootCause: string | null;
  confidence: number;
  checks: VerificationCheck[];
  resolved: boolean;
  summary: string;
}

const PLANS: Record<string, string[]> = {
  database_timeout: ['verify_transaction', 'check_booking'],
  db_connection_pool_exhaustion: ['verify_transaction', 'check_booking'],
  duplicate_transaction: ['verify_transaction', 'db_check_duplicate'],
  payment_gateway_failure: ['verify_transaction', 'check_booking'],
  api_timeout: ['verify_transaction', 'check_booking'],
  idempotency_key_missing: ['verify_transaction', 'check_booking'],
  webhook_processing_backlog: ['verify_transaction', 'check_booking'],
  expired_token_rotation: ['check_booking'],
  misconfiguration: ['verify_transaction', 'check_booking'],
  unknown: ['verify_transaction', 'check_booking'],
};

/**
 * Post-remediation verification. Re-checks the live domain state through the
 * real repositories (untraced — no action ledger pollution). Resolves only
 * when every check passes.
 */
export const verificationService = {
  async verify(incident: IncidentRow): Promise<VerificationVerdict> {
    const rootCause = incident.rootCause ?? 'unknown';
    const plan = PLANS[rootCause] ?? PLANS.unknown;
    const checks: VerificationCheck[] = [];
    const args = { transactionId: incident.transactionId ?? undefined };

    for (const tool of plan) {
      try {
        const r: ToolResult = await executeToolUntraced(tool, { ...args, level: undefined, service: incident.affectedService ?? undefined }, { incidentId: incident.id, incident });
        checks.push({ tool, ok: r.success, summary: r.summary });
      } catch (err) {
        logger.warn({ incidentId: incident.id, tool, err }, 'verification tool error');
        checks.push({ tool, ok: false, summary: (err as Error).message });
      }
    }

    const passes = checks.length > 0 && checks.every((c) => c.ok);
    const evidenceLines = checks.map((c) => `${c.tool} → ${c.ok ? 'PASS' : 'FAIL'} (${c.summary})`).join('; ');
    return {
      rootCause,
      confidence: incident.rootCauseConfidence ?? 0.5,
      checks,
      resolved: passes,
      summary: passes
        ? `Verification passed — ${checks.length} check(s) confirmed the fix (${evidenceLines})`
        : `Verification failed — ${checks.filter((c) => !c.ok).map((c) => c.tool).join(', ')} did not pass (${evidenceLines})`,
    };
  },
};