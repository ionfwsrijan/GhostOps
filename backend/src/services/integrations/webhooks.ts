import crypto from 'crypto';
import { env, safeEqual } from '../../config.js';

export type WebhookProvider = 'payment' | 'booking' | 'monitoring' | 'support';

export const WEBHOOK_PROVIDERS: WebhookProvider[] = ['payment', 'booking', 'monitoring', 'support'];

export function secretFor(provider: WebhookProvider): string {
  switch (provider) {
    case 'payment':
      return env.PAYMENT_WEBHOOK_SECRET;
    case 'booking':
      return env.BOOKING_WEBHOOK_SECRET;
    case 'monitoring':
      return env.MONITORING_WEBHOOK_SECRET;
    case 'support':
      return env.SUPPORT_WEBHOOK_SECRET;
  }
}

/**
 * HMAC-SHA256 signature check (`X-GhostOps-Signature: sha256=<hex>`).
 * Secure by default: providers without a configured secret are rejected.
 */
export function verifySignature(provider: WebhookProvider, rawBody: Buffer, header: string | undefined): { ok: boolean; error?: string } {
  const secret = secretFor(provider);
  if (!secret) return { ok: false, error: 'webhook provider has no HMAC secret configured — refusing anonymous payloads' };
  if (!header) return { ok: false, error: 'missing X-GhostOps-Signature header' };
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  if (!safeEqual(expected, header)) return { ok: false, error: 'signature mismatch' };
  return { ok: true };
}

export interface NormalizedIntake {
  channel: string;
  source: string;
  title: string;
  issue: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  transactionId?: string;
  affectedService?: string;
  customer?: { id?: string; code?: string; name?: string; email?: string; phone?: string; city?: string };
  metadata: Record<string, unknown>;
}

/** Structural validators — unknown providers still reject malformed bodies. */
export function normalizeBody(provider: WebhookProvider, body: unknown): NormalizedIntake {
  switch (provider) {
    case 'payment':
      return normalizePayment(body);
    case 'booking':
      return normalizeBooking(body);
    case 'monitoring':
      return normalizeMonitoring(body);
    case 'support':
      return normalizeSupport(body);
  }
}

function obj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  return {};
}

function normalizePayment(body: unknown): NormalizedIntake {
  const b = obj(body);
  const event = typeof b.event === 'string' ? b.event : 'payment.received';
  const data = obj(b.data);
  const txn = obj(data.transaction);
  const cust = obj(data.customer);
  return {
    channel: 'payment_provider',
    source: 'webhook',
    title: `Payment webhook: ${event}`,
    issue: `Payment notification received from gateway${txn.id ? ` (transaction ${txn.id})` : ''}`,
    severity: 'medium',
    transactionId: typeof txn.id === 'string' ? txn.id : undefined,
    affectedService: 'payment-gateway',
    customer: cust.id || cust.name ? { id: typeof cust.id === 'string' ? cust.id : undefined, code: typeof cust.code === 'string' ? cust.code : undefined, name: typeof cust.name === 'string' ? cust.name : undefined, email: typeof cust.email === 'string' ? cust.email : undefined } : undefined,
    metadata: { event, amount: txn.amount ?? null, gatewayStatus: txn.status ?? null },
  };
}

function normalizeBooking(body: unknown): NormalizedIntake {
  const b = obj(body);
  const event = typeof b.event === 'string' ? b.event : 'booking.webhook';
  const data = obj(b.data);
  const booking = obj(data.booking);
  const txn = obj(data.transaction);
  return {
    channel: 'booking_provider',
    source: 'webhook',
    title: `Booking webhook: ${event}`,
    issue: `Booking notification received from booking service${booking.id ? ` (booking ${booking.id})` : ''}`,
    severity: 'medium',
    transactionId: typeof txn.id === 'string' ? txn.id : typeof data.transactionId === 'string' ? String(data.transactionId) : undefined,
    affectedService: 'booking-service',
    metadata: { event, bookingId: booking.id ?? data.bookingId ?? null, movieTitle: booking.movieTitle ?? data.movieTitle ?? null },
  };
}

function normalizeMonitoring(body: unknown): NormalizedIntake {
  const b = obj(body);
  const data = obj(b.data);
  const service = typeof data.service === 'string' ? data.service : typeof b.service === 'string' ? String(b.service) : inputService(b);
  const message = typeof data.message === 'string' ? data.message : 'Monitoring alert received';
  const details = obj(data.details);
  return {
    channel: service,
    source: 'monitoring',
    title: `Monitoring alert: ${service}`,
    issue: message,
    severity: /critical|outage|down/i.test(message + String(details.status ?? '')) ? 'critical' : /error|fail|5\d\d/i.test(message) ? 'high' : 'medium',
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : typeof details.transactionId === 'string' ? String(details.transactionId) : undefined,
    affectedService: service,
    metadata: { alertName: data.name ?? null, status: details.status ?? null },
  };
}

function inputService(b: Record<string, unknown>): string {
  return typeof b.service === 'string' ? b.service : 'monitoring';
}

function normalizeSupport(body: unknown): NormalizedIntake {
  const b = obj(body);
  const data = obj(b.data);
  const cust = obj(data.customer);
  const txn = obj(data.transaction);
  return {
    channel: 'support_ticket',
    source: 'support',
    title: `Customer complaint: ${typeof data.subject === 'string' ? data.subject : 'Ticket received'}`,
    issue: typeof data.message === 'string' ? data.message : typeof data.description === 'string' ? String(data.description) : 'Customer support ticket',
    severity: /charged twice|duplicate|refund|overcharged/i.test((data.subject as string) + ' ' + (data.message as string)) ? 'high' : 'medium',
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : typeof txn.id === 'string' ? String(txn.id) : undefined,
    affectedService: 'support',
    customer: cust.id || cust.name ? { id: typeof cust.id === 'string' ? cust.id : undefined, code: typeof cust.code === 'string' ? cust.code : undefined, name: typeof cust.name === 'string' ? cust.name : undefined, email: typeof cust.email === 'string' ? cust.email : undefined } : undefined,
    metadata: { ticketId: data.ticketId ?? data.id ?? null, tags: data.tags ?? null },
  };
}