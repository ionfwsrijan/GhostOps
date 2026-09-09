import { RiskLevel } from '../database/types.js';

/**
 * Action registry — the allowlist of every action GhostOps may take.
 *
 * Security model:
 *  - The agent can ONLY request actions that exist in this registry.
 *  - Each action declares an explicit risk level and human-approval rule.
 *  - Actions are mapped 1:1 to a predefined tool executor with a strict
 *    input schema (never free-form SQL / shell).
 */
export interface ActionDefinition {
  key: string;
  label: string;
  description: string;
  impact: string;
  risk: RiskLevel;
  autoExecuteThreshold: number; // min AI confidence (0..1) to auto-run
  idempotent: boolean;
}

export class UnknownActionError extends Error {
  constructor(key: string) {
    super(`Unknown action "${key}" is not in the allowlist`);
    this.name = 'UnknownActionError';
  }
}

const REGISTRY: ActionDefinition[] = [
  {
    key: 'verify_payment',
    label: 'Verify payment',
    description: 'Query the payment gateway for the transaction status.',
    impact: 'Read-only check of payment status.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: true,
  },
  {
    key: 'check_booking',
    label: 'Check booking',
    description: 'Query the booking database for the booking record.',
    impact: 'Read-only check of booking record.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: true,
  },
  {
    key: 'inspect_logs',
    label: 'Inspect application logs',
    description: 'Search system logs for errors around the incident window.',
    impact: 'Read-only log search.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: true,
  },
  {
    key: 'retry_booking',
    label: 'Retry booking creation',
    description: 'Create the missing booking record using the confirmed payment.',
    impact: 'Creates the missing booking record for the customer.',
    risk: 'low',
    autoExecuteThreshold: 0.5,
    idempotent: true,
  },
  {
    key: 'update_booking_status',
    label: 'Update booking status',
    description: 'Set the booking to CONFIRMED after resolution.',
    impact: 'Mutates booking record status. Reversible.',
    risk: 'medium',
    autoExecuteThreshold: 0.8,
    idempotent: false,
  },
  {
    key: 'create_jira_ticket',
    label: 'Create engineering ticket',
    description: 'Create an engineering follow-up ticket for the platform team.',
    impact: 'Creates a Jira ticket. Non-destructive.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: false,
  },
  {
    key: 'send_slack_notification',
    label: 'Send Slack notification',
    description: 'Notify the on-call engineering channel.',
    impact: 'Posts a message to Slack. Non-destructive.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: false,
  },
  {
    key: 'send_customer_notification',
    label: 'Send customer notification',
    description: 'Notify the customer about the resolution.',
    impact: 'Sends an email/SMS to the customer. Non-destructive.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: false,
  },
  {
    key: 'collect_diagnostics',
    label: 'Collect diagnostics',
    description: 'Gather diagnostics (logs, traces, metrics) for the incident.',
    impact: 'Read-only diagnostics collection.',
    risk: 'low',
    autoExecuteThreshold: 0,
    idempotent: true,
  },
  {
    key: 'refund_customer',
    label: 'Refund customer',
    description: 'Issue a refund for the customer payment.',
    impact: 'Financial transaction — moves real money. Irreversible.',
    risk: 'high',
    autoExecuteThreshold: 1,
    idempotent: false,
  },
  {
    key: 'delete_records',
    label: 'Delete records',
    description: 'Delete a record from the database.',
    impact: 'Irreversible data deletion.',
    risk: 'high',
    autoExecuteThreshold: 1,
    idempotent: false,
  },
  {
    key: 'modify_sensitive_data',
    label: 'Modify sensitive production data',
    description: 'Update sensitive production data.',
    impact: 'Mutates sensitive data. High blast radius.',
    risk: 'high',
    autoExecuteThreshold: 1,
    idempotent: false,
  },
  {
    key: 'change_configuration',
    label: 'Change production configuration',
    description: 'Alter production configuration at runtime.',
    impact: 'Affects entire service. High blast radius.',
    risk: 'high',
    autoExecuteThreshold: 1,
    idempotent: false,
  },
  {
    key: 'cancel_booking',
    label: 'Cancel booking',
    description: 'Cancel a booking record.',
    impact: 'Makes a booking unusable. Reversible with reprovisioning.',
    risk: 'medium',
    autoExecuteThreshold: 0.85,
    idempotent: false,
  },
];

export function getActionDefinition(key: string): ActionDefinition {
  const def = REGISTRY.find((a) => a.key === key);
  if (!def) throw new UnknownActionError(key);
  return def;
}

export function isAllowedAction(key: string): boolean {
  return REGISTRY.some((a) => a.key === key);
}

export function listActionDefinitions(): ActionDefinition[] {
  return [...REGISTRY];
}

/**
 * Decision rule used by the agent + action center:
 *  - high risk  → always human approval
 *  - medium/low → auto-execute if confidence >= threshold, else human approval
 */
export function requiresHumanApproval(key: string, confidence: number): { required: boolean; reason?: string } {
  const def = getActionDefinition(key);
  if (def.risk === 'high') {
    return { required: true, reason: `${def.risk.toUpperCase()} risk action — ${def.impact}` };
  }
  if (confidence < def.autoExecuteThreshold) {
    return {
      required: true,
      reason: `AI confidence (${Math.round(confidence * 100)}%) below auto-execute threshold (${Math.round(
        def.autoExecuteThreshold * 100
      )}%)`,
    };
  }
  return { required: false };
}