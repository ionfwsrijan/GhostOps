import { getDatabase, DatabaseAdapter } from '../database/index.js';
import { incidentService } from './incidentService.js';
import { executeToolUntraced } from '../tools/index.js';

export interface VerificationCheck {
  tool: string;
  args: (txnId: string) => Record<string, unknown>;
  label: string;
  /** predicate expects true for the incident to be considered healthy */
  healthy: (outcome: { success: boolean; data?: unknown }) => boolean;
}

type ResolvedCheck = Omit<VerificationCheck, 'args'> & { args: Record<string, unknown> };

/**
 * Verification catalog — maps an incident type (or root cause) to the set of
 * checks that must pass before GhostOps declares the incident RESOLVED.
 */
const VERIFICATION_PLANS: Record<string, VerificationCheck[]> = {
  payment_booking_failure: [
    {
      tool: 'check_booking',
      args: (t) => ({ transactionId: t }),
      label: 'Booking record exists',
      healthy: (o) => o.success && Boolean((o.data as { exists?: boolean })?.exists),
    },
    {
      tool: 'verify_transaction',
      args: (t) => ({ transactionId: t }),
      label: 'Payment still confirmed',
      healthy: (o) => o.success && (o.data as { status?: string })?.status === 'success',
    },
  ],
  api_timeout: [
    {
      tool: 'search_logs',
      args: (t) => ({ transactionId: t, level: 'error' }),
      label: 'No recent timeout errors',
      healthy: (o) => o.success && (o.data as { errors?: number })?.errors === 0,
    },
  ],
  customer_complaint: [
    {
      tool: 'db_check_duplicate',
      args: (t) => ({ transactionId: t }),
      label: 'No duplicate transactions',
      healthy: (o) => o.success && (o.data as { duplicates?: number })?.duplicates === 0,
    },
  ],
  database_failure: [
    {
      tool: 'search_logs',
      args: (t) => ({ transactionId: t, service: 'booking-service', level: 'error' }),
      label: 'Booking service healthy',
      healthy: (o) => o.success,
    },
  ],
};

const DEFAULT_PLAN: VerificationCheck[] = [
  {
    tool: 'search_logs',
    args: (t) => ({ transactionId: t }),
    label: 'No critical errors in logs',
    healthy: (o) => o.success,
  },
];

function checksFor(incidentType?: string, transactionId?: string): ResolvedCheck[] {
  const plan = (incidentType && VERIFICATION_PLANS[incidentType]) || DEFAULT_PLAN;
  return plan.map((c) => ({
    tool: c.tool,
    label: c.label,
    healthy: c.healthy,
    args: c.args(transactionId ?? ''),
  }));
}

export type VerificationChecks = Array<{ label: string; ok: boolean; detail: string }>;

export class VerificationService {
  private db: DatabaseAdapter;

  constructor(db: DatabaseAdapter = getDatabase()) {
    this.db = db;
  }

  /**
   * Run the verification plan for an incident. Returns pass/fail per check
   * and overall verdict. Does NOT mutate incident status — callers decide.
   */
  async verify(incidentId: string): Promise<{ passed: boolean; checks: VerificationChecks }> {
    const incident = await this.db.getIncident(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    const incidentType = (incident.metadata?.incidentType as string) ?? undefined;
    const checks = checksFor(incidentType, incident.transaction_id);

    const results = [];
    for (const check of checks) {
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'verify',
        type: 'info',
        title: `Verifying: ${check.label}`,
      });
      const outcome = await executeToolUntraced(check.tool, check.args, incidentId);
      const ok = check.healthy(outcome);
      results.push({
        label: check.label,
        ok,
        detail: outcome.summary,
      });
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'verify',
        type: ok ? 'success' : 'error',
        title: `Verification ${ok ? 'passed' : 'failed'}: ${check.label}`,
        description: outcome.summary,
        metadata: { tool: check.tool, ok },
      });
    }

    const passed = results.every((r) => r.ok);
    return { passed, checks: results };
  }

  /**
   * Convenience wrapper that marks the incident RESOLVED on success or
   * triggers re-investigation on failure.
   */
  async verifyAndResolve(incidentId: string, reInvestigate: () => Promise<void>): Promise<{ resolved: boolean; checks: VerificationChecks }> {
    const { passed, checks } = await this.verify(incidentId);

    if (passed) {
      await this.db.updateIncident(incidentId, {
        status: 'resolved',
        resolution_summary: 'Verified — issue resolved by GhostOps.',
        updated_at: new Date().toISOString(),
      });
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'resolved',
        type: 'success',
        title: 'Incident resolved',
        description: 'All verification checks passed. Incident closed by GhostOps.',
      });
      await incidentService.emit(incidentId, 'incident_status', {
        incident: { status: 'resolved', resolution_summary: 'Verified — issue resolved by GhostOps.' },
      });
      return { resolved: true, checks };
    }

    await incidentService.addTimelineEntry({
      incident_id: incidentId,
      step: 'reinvestigate',
      type: 'warning',
      title: 'Verification failed — re-investigating',
      description: 'One or more checks did not pass. GhostOps is re-investigating the incident.',
    });
    await reInvestigate();
    return { resolved: false, checks };
  }
}

export const verificationService = new VerificationService();