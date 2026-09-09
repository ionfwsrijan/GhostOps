import { z } from 'zod';
import { hasOpenAI } from '../config.js';

// ---------------------------------------------------------------------------
// Structured outputs (Zod first-class). Used to parse LLM responses AND to
// drive the deterministic fallback when no OpenAI key is configured.
// ---------------------------------------------------------------------------

export const incidentTypes = [
  'payment_booking_failure',
  'api_timeout',
  'customer_complaint',
  'database_failure',
  'generic',
] as const;
export type IncidentType = (typeof incidentTypes)[number];

export const incidentTypeZ = z.enum(incidentTypes);

export const classificationSchema = z.object({
  incidentType: incidentTypeZ,
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  entities: z.object({
    transactionId: z.string().nullable(),
    customerId: z.string().nullable(),
    amount: z.number().nullable(),
  }),
  summary: z.string(),
  investigationPlan: z.array(z.string()).max(6),
  confidence: z.number().min(0).max(1),
});

export type Classification = z.infer<typeof classificationSchema>;

export const rootCauseZ = z.enum([
  'database_timeout',
  'db_connection_pool_exhaustion',
  'api_timeout',
  'duplicate_transaction',
  'idempotency_key_missing',
  'payment_gateway_failure',
  'webhook_processing_backlog',
  'expired_token_rotation',
  'misconfiguration',
  'unknown',
]);

export const rootCauseSchema = z.object({
  rootCause: rootCauseZ,
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  evidence: z.array(z.string()).max(8),
  nextInvestigationSteps: z.array(z.string()).max(4),
});

export type RootCauseAnalysis = z.infer<typeof rootCauseSchema>;

export const actionPlanSchema = z.object({
  reasoning: z.string(),
  actions: z
    .array(
      z.object({
        actionKey: z.string(),
        params: z.record(z.unknown()),
        confidence: z.number().min(0).max(1),
        reasoning: z.string(),
      })
    )
    .min(1)
    .max(6),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

export { hasOpenAI };

// ---------------------------------------------------------------------------
// Available tools the agent may reference
// ---------------------------------------------------------------------------
export const TOOL_CATALOG = [
  { name: 'verify_transaction', description: 'Check payment gateway status for a transaction (read-only)' },
  { name: 'check_booking', description: 'Check if a booking record exists for a transaction (read-only)' },
  { name: 'db_find_record', description: 'Look up a record in payments/bookings/customers by transaction (read-only)' },
  { name: 'db_check_duplicate', description: 'Detect duplicate transactions (read-only)' },
  { name: 'search_logs', description: 'Search application/system logs for a transaction (read-only)' },
  { name: 'retry_booking', description: 'Re-create a missing booking from a confirmed payment (safe, idempotent)' },
  { name: 'update_booking_status', description: 'Update a booking status (mutating)' },
  { name: 'jira_create_ticket', description: 'Create an engineering follow-up ticket' },
  { name: 'slack_post_message', description: 'Post a message to Slack' },
  { name: 'notify_customer', description: 'Send the customer a status update' },
] as const;

export function catalogSnippet(): string {
  return TOOL_CATALOG.map((t) => `- ${t.name}: ${t.description}`).join('\n');
}