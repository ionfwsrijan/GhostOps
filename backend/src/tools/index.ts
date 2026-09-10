import { z } from 'zod';
import { incidentRepo, engineRepo, queueRepo } from '../db/repos/index.js';
import { sseManager } from '../services/sseService.js';
import { ExecutableTool, ToolContext, ToolResult } from './types.js';

const txnSchema = z.object({ transactionId: z.string().min(1) }).passthrough();

/**
 * Strict tool registry. Every diagnostic and remediation the agent performs
 * must be an explicit, schema-validated function here — there are no
 * free-form SQL / shell executors. Tools read/write ONLY through the Postgres
 * repositories or enqueue tracked outbox messages for outbound integrations.
 */
const TOOLS: ExecutableTool[] = [
  // ---- Diagnostics (read-only) ----------------------------------------------

  {
    name: 'verify_transaction',
    risk: 'low',
    description: 'Query the payment gateway table for the transaction status.',
    args: txnSchema,
    async execute(args: unknown) {
      const { transactionId } = args as { transactionId: string };
      const p = await incidentRepo.getPaymentByTransaction(transactionId);
      if (!p) return { success: false, summary: 'No payment found for transaction', data: { exists: false, transactionId } };
      return {
        success: true,
        summary: `Payment ${p.transactionId} status=${p.status} amount=${Number(p.amount)} ${p.currency}`,
        data: { exists: true, status: p.status, amount: Number(p.amount), currency: p.currency, gateway: p.gateway },
      };
    },
  },
  {
    name: 'check_booking',
    risk: 'low',
    description: 'Query the bookings table for the booking record.',
    args: txnSchema,
    async execute(args: unknown) {
      const { transactionId } = args as { transactionId: string };
      const b = await incidentRepo.getBookingByTransaction(transactionId);
      if (!b) return { success: false, summary: 'No booking exists for transaction', data: { exists: false, transactionId } };
      return {
        success: true,
        summary: `Booking ${b.bookingCode} status=${b.status} movie=${b.movieTitle}`,
        data: { exists: true, status: b.status, bookingCode: b.bookingCode, movieTitle: b.movieTitle },
      };
    },
  },
  {
    name: 'db_find_record',
    risk: 'low',
    description: 'Look up any booking by transaction id.',
    args: txnSchema,
    async execute(args: unknown) {
      const { transactionId } = args as { transactionId: string };
      const b = await incidentRepo.getBookingByTransaction(transactionId);
      if (!b) return { success: false, summary: 'No booking record found', data: { exists: false } };
      return {
        success: true,
        summary: `Booking ${b.bookingCode} status=${b.status}`,
        data: { exists: true, bookingCode: b.bookingCode, status: b.status, transactionId },
      };
    },
  },
  {
    name: 'db_check_duplicate',
    risk: 'low',
    description: 'Check for duplicate payment rows for the same transaction.',
    args: txnSchema,
    async execute(args: unknown) {
      const { transactionId } = args as { transactionId: string };
      const { rows } = await (await import('../db/pool.js')).getPool().query<{ payments: string; bookings: string }>(
        `SELECT (SELECT count(*) FROM payments WHERE transaction_id = $1)::text AS payments,
                (SELECT count(*) FROM bookings WHERE transaction_id = $1)::text AS bookings`,
        [transactionId]
      );
      const payments = Number(rows[0].payments);
      const bookings = Number(rows[0].bookings);
      return {
        success: payments > 0,
        summary: `Payments=${payments} Bookings=${bookings} Duplicates=${Math.max(0, payments - 1)}`,
        data: { payments, bookings, duplicates: Math.max(0, payments - 1) },
      };
    },
  },
  {
    name: 'search_logs',
    risk: 'low',
    description: 'Search booking service log records for the transaction.',
    args: txnSchema.extend({ level: z.string().optional(), service: z.string().optional() }),
    async execute(args: unknown) {
      const { transactionId, level, service } = args as { transactionId: string; level?: string; service?: string };
      const entries = await incidentRepo.listBookingRecords({ transactionId, level, service, limit: 50 });
      return {
        success: true,
        summary: `Found ${entries.length} log entries`,
        data: { entries },
      };
    },
  },

  // ---- Remediation -----------------------------------------------------------

  {
    name: 'retry_booking',
    risk: 'low',
    description: 'Re-create the missing booking from the confirmed payment. Idempotent.',
    args: txnSchema.extend({ amount: z.number().optional(), movieTitle: z.string().optional(), cinema: z.string().optional(), city: z.string().optional() }),
    async execute(args: unknown) {
      const { transactionId, amount } = args as { transactionId: string; amount?: number };
      const existing = await incidentRepo.getBookingByTransaction(transactionId);
      if (existing) {
        return { success: true, summary: `Booking already exists (${existing.bookingCode}, ${existing.status}) — nothing to create`, data: { idempotent: true, bookingCode: existing.bookingCode, status: existing.status } };
      }
      const payment = await incidentRepo.getPaymentByTransaction(transactionId);
      if (!payment) {
        return { success: false, summary: 'No confirmed payment found to back a booking', data: { transactionId } };
      }
      const booking = await incidentRepo.createBooking({
        booking_code: `BK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        customer_id: payment.customerId ?? undefined,
        payment_id: payment.id,
        transaction_id: transactionId,
        movie_title: 'Ticketed event',
        cinema: 'City Cineplex',
        amount: amount ?? Number(payment.amount),
      });
      return {
        success: true,
        summary: `Created booking ${booking.bookingCode} (status=${booking.status}) for transaction ${transactionId}`,
        data: { bookingCode: booking.bookingCode, status: booking.status },
      };
    },
  },
  {
    name: 'update_booking_status',
    risk: 'medium',
    description: 'Set a booking status (confirmed/cancelled/refunded).',
    args: txnSchema.extend({ status: z.enum(['confirmed', 'cancelled', 'refunded']) }),
    async execute(args: unknown) {
      const { transactionId, status } = args as { transactionId: string; status: 'confirmed' | 'cancelled' | 'refunded' };
      const updated = await incidentRepo.updateBookingStatus(transactionId, status);
      if (!updated) return { success: false, summary: 'No booking found to update', data: { transactionId } };
      return { success: true, summary: `Booking ${updated.bookingCode} set to ${status}`, data: { bookingCode: updated.bookingCode, status } };
    },
  },
  {
    name: 'cancel_booking',
    risk: 'medium',
    description: 'Cancel a booking.',
    args: txnSchema,
    async execute(args: unknown) {
      const { transactionId } = args as { transactionId: string };
      const updated = await incidentRepo.updateBookingStatus(transactionId, 'cancelled');
      if (!updated) return { success: false, summary: 'No booking found to cancel', data: { transactionId } };
      return { success: true, summary: `Booking ${updated.bookingCode} cancelled`, data: { bookingCode: updated.bookingCode, status: 'cancelled' } };
    },
  },
  {
    name: 'create_jira_ticket',
    risk: 'low',
    description: 'Queue an engineering ticket for the platform team.',
    args: z.object({ summary: z.string(), description: z.string().optional() }),
    async execute(args: unknown, ctx: ToolContext) {
      const { summary, description } = args as { summary: string; description?: string };
      const out = await queueRepo.enqueueOutbox({
        integration: 'jira',
        event_type: 'jira.issue.created',
        payload: {
          summary: summary || `GhostOps follow-up — ${ctx.incident?.incidentCode ?? ctx.incidentId}`,
          description: description ?? (ctx.incident?.title ?? '') + (ctx.incident?.issue ? `\n\n${ctx.incident.issue}` : ''),
          projectKey: undefined,
        },
        incident_id: ctx.incidentId,
      });
      return { success: true, summary: 'Engineering ticket queued for delivery', data: { outboxId: out.id } };
    },
  },
  {
    name: 'send_slack_notification',
    risk: 'low',
    description: 'Post a message to the on-call channel.',
    args: z.object({ channel: z.string().optional(), text: z.string().min(1) }),
    async execute(args: unknown, ctx: ToolContext) {
      const { channel, text } = args as { channel?: string; text: string };
      const out = await queueRepo.enqueueOutbox({
        integration: 'slack',
        event_type: 'slack.message.posted',
        payload: { channel: channel ?? 'on-call', text: `[${ctx.incident?.incidentCode ?? ctx.incidentId}] ${text}` },
        incident_id: ctx.incidentId,
      });
      return { success: true, summary: 'Slack notification queued', data: { outboxId: out.id } };
    },
  },
  {
    name: 'send_customer_notification',
    risk: 'low',
    description: 'Notify the customer (email) about the outcome.',
    args: z.object({ subject: z.string(), message: z.string().optional(), to: z.string().optional() }),
    async execute(args: unknown, ctx: ToolContext) {
      const { subject, message, to } = args as { subject: string; message?: string; to?: string };
      const customer = ctx.customer;
      const out = await queueRepo.enqueueOutbox({
        integration: 'email',
        event_type: 'email.delivered',
        payload: {
          to: to ?? customer?.email ?? '',
          subject,
          message: message ?? `${subject}. Ref ${ctx.incident?.incidentCode ?? ctx.incidentId}`,
          customerId: customer?.id,
        },
        incident_id: ctx.incidentId,
      });
      return { success: true, summary: customer?.email ? `Customer notified (${customer.email})` : 'Customer notification queued (no email on file)', data: { outboxId: out.id, to: to ?? customer?.email ?? null } };
    },
  },
  {
    name: 'collect_diagnostics',
    risk: 'low',
    description: 'Trigger the diagnostics workflow.',
    args: txnSchema.extend({ service: z.string().optional() }),
    async execute(args: unknown, ctx: ToolContext) {
      const { transactionId } = args as { transactionId: string };
      const out = await queueRepo.enqueueOutbox({
        integration: 'n8n',
        event_type: 'automation.diagnostics.started',
        payload: { incidentCode: ctx.incident?.incidentCode, incidentId: ctx.incidentId, transactionId, service: ctx.incident?.affectedService },
        incident_id: ctx.incidentId,
      });
      return { success: true, summary: 'Diagnostics workflow triggered', data: { outboxId: out.id } };
    },
  },
  {
    name: 'refund_customer',
    risk: 'high',
    description: 'Refund a payment. Irreversible financial action — only runs after human approval.',
    args: txnSchema.extend({ amount: z.number().optional(), reason: z.string().optional() }),
    async execute(args: unknown) {
      const { transactionId, amount, reason } = args as { transactionId: string; amount?: number; reason?: string };
      const refunded = await incidentRepo.refundPayment(transactionId, amount, reason ?? 'duplicate charge refund');
      if (!refunded) return { success: false, summary: 'No payment found to refund', data: { transactionId } };
      await incidentRepo.updateBookingStatus(transactionId, 'refunded');
      return { success: true, summary: `Refunded ${Number(refunded.amount)} ${refunded.currency} for ${transactionId}`, data: { transactionId, amount: Number(refunded.amount) } };
    },
  },

  // ---- Guardrails: destructive actions must go through a manual runbook ----
  {
    name: 'delete_records',
    risk: 'high',
    description: 'BLOCKED — destructive action is not executable by the agent.',
    args: z.record(z.unknown()),
    async execute() {
      return { success: false, summary: 'Blocked: delete_records has no automated executor. Follow the runbook.', error: 'blocked_action' };
    },
  },
  {
    name: 'modify_sensitive_data',
    risk: 'high',
    description: 'BLOCKED — destructive action is not executable by the agent.',
    args: z.record(z.unknown()),
    async execute() {
      return { success: false, summary: 'Blocked: modify_sensitive_data has no automated executor. Follow the runbook.', error: 'blocked_action' };
    },
  },
  {
    name: 'change_configuration',
    risk: 'high',
    description: 'BLOCKED — destructive action is not executable by the agent.',
    args: z.record(z.unknown()),
    async execute() {
      return { success: false, summary: 'Blocked: change_configuration has no automated executor. Follow the runbook.', error: 'blocked_action' };
    },
  },
];

const REGISTRY = new Map<string, ExecutableTool>(TOOLS.map((t) => [t.name, t]));

export function listToolNames(): string[] {
  return [...REGISTRY.keys()];
}

export function isToolAllowed(name: string): boolean {
  return REGISTRY.has(name);
}

export function getTool(name: string): ExecutableTool | undefined {
  return REGISTRY.get(name);
}

export interface TraceOptions {
  incidentId: string;
  runId?: string;
  /** Actions table plan_index; diagnostics use auto 1_000_000 + counter. */
  planIndex?: number;
  label?: string;
}

/**
 * Execute an allowlisted tool with full tracing: an `actions` row (status
 * executed/failed) + a timeline event + live SSE. Returns the outcome.
 */
export async function executeToolTraced(name: string, args: unknown, opts: TraceOptions): Promise<{ outcome: ToolResult; actionId?: string }> {
  const tool = REGISTRY.get(name);
  if (!tool) throw new Error(`Tool "${name}" is not in the allowlist`);
  const outcome = await runTool(tool, args, opts.incidentId);

  const actionId = await engineRepo.traceToolCall({
    incident_id: opts.incidentId,
    run_id: opts.runId ?? null,
    plan_index: opts.planIndex ?? null,
    action_key: name,
    label: opts.label ?? tool.description,
    tool: name,
    risk: tool.risk,
    input: (args ?? {}) as Record<string, unknown>,
    output: (outcome.data ?? {}) as Record<string, unknown>,
    status: outcome.success ? 'executed' : 'failed',
    result: outcome.success ? 'success' : (outcome.error ?? 'error'),
  });

  if (outcome.success) {
    sseManager.sendToIncident(opts.incidentId, {
      type: 'tool_completed',
      data: { tool: name, ok: true, result: outcome },
    });
  } else {
    sseManager.sendToIncident(opts.incidentId, {
      type: 'tool_completed',
      data: { tool: name, ok: false, result: outcome },
    });
  }
  sseManager.broadcast({
    type: 'agent_update',
    incidentId: opts.incidentId,
    data: { tool: name, ok: outcome.success, phase: outcome.success ? 'tool_completed' : 'tool_failed' },
  });
  return { outcome, actionId: actionId?.id };
}

/**
 * Execute a tool WITHOUT tracing (used by verification passes so they don't
 * pollute the action ledger).
 */
export async function executeToolUntraced(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = REGISTRY.get(name);
  if (!tool) return { success: false, summary: `Unknown tool ${name}`, error: 'unknown_tool' };
  return runTool(tool, args, ctx.incidentId, ctx);
}

async function runTool(tool: ExecutableTool, args: unknown, incidentId: string, ctxOverride?: ToolContext): Promise<ToolResult> {
  const parsed = tool.args.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      success: false,
      summary: `Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      error: 'validation_error',
    };
  }
  const incident = await incidentRepo.getIncident(incidentId);
  const customer = incident?.customerId ? await incidentRepo.getCustomerById(incident.customerId).catch(() => null) : null;
  const ctx: ToolContext = { incidentId, incident, customer, ...(ctxOverride ?? {}) };
  try {
    return await tool.execute(parsed.data, ctx);
  } catch (err) {
    return {
      success: false,
      summary: `Tool ${tool.name} threw: ${(err as Error).message}`,
      error: 'execution_error',
    };
  }
}

/** For engine use in verification (no rows) — alias for clarity. */
export function toolCatalog(): Pick<ExecutableTool, 'name' | 'description' | 'risk' | 'args'>[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, risk: t.risk, args: t.args }));
}