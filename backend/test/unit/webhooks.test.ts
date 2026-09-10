import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { normalizeBody, secretFor, verifySignature } from '../../src/services/integrations/webhooks.js';

function sign(provider: 'payment' | 'booking' | 'monitoring' | 'support', body: Buffer): string {
  return `sha256=${crypto.createHmac('sha256', secretFor(provider)).update(body).digest('hex')}`;
}

describe('verifySignature', () => {
  it('rejects payloads without a signature header', () => {
    expect(verifySignature('monitoring', Buffer.from('{}'), undefined).ok).toBe(false);
  });

  it('rejects a wrong signature', () => {
    const r = verifySignature('monitoring', Buffer.from('{"a":1}'), 'sha256=deadbeef');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mismatch/);
  });

  it('accepts an exact HMAC over the raw bytes', () => {
    const body = Buffer.from('{"event":"payment.received","data":{"transaction":{"id":"T1"}}}');
    expect(verifySignature('payment', body, sign('payment', body)).ok).toBe(true);
  });

  it('signature is byte-order sensitive', () => {
    const a = Buffer.from('{"a":1}');
    const b = Buffer.from(' {"a":1}');
    expect(verifySignature('monitoring', a, sign('monitoring', b)).ok).toBe(false);
  });

  it('uses provider-specific secrets', () => {
    const body = Buffer.from('{}');
    const paymentSig = sign('payment', body);
    // sign with payment secret is invalid for monitoring
    expect(verifySignature('monitoring', body, paymentSig).ok).toBe(false);
  });
});

describe('normalizeBody', () => {
  it('normalizes payment webhooks', () => {
    const n = normalizeBody('payment', {
      event: 'payment.received',
      data: {
        transaction: { id: 'TXN-1', amount: 500, status: 'success' },
        customer: { id: 'C-9', name: 'Ada' },
      },
    });
    expect(n.channel).toBe('payment_provider');
    expect(n.transactionId).toBe('TXN-1');
    expect(n.metadata.amount).toBe(500);
    expect(n.customer?.name).toBe('Ada');
  });

  it('normalizes monitoring alerts and derives severity', () => {
    const n = normalizeBody('monitoring', { data: { service: 'booking-service', message: 'CRITICAL outage detected', status: 'down' } });
    expect(n.affectedService).toBe('booking-service');
    expect(n.severity).toBe('critical');
    expect(n.source).toBe('monitoring');
  });

  it('normalizes support tickets and detects duplicates', () => {
    const n = normalizeBody('support', {
      data: { subject: 'Charged twice', message: 'I was charged twice for my booking', transactionId: 'TXN-2', customer: { email: 'a@b.c' } },
    });
    expect(n.severity).toBe('high');
    expect(n.transactionId).toBe('TXN-2');
    expect(n.channel).toBe('support_ticket');
  });

  it('normalizes booking webhooks', () => {
    const n = normalizeBody('booking', { data: { transactionId: 'TXN-3', booking: { id: 'BK-1', movieTitle: 'Dune' } } });
    expect(n.transactionId).toBe('TXN-3');
    expect(n.affectedService).toBe('booking-service');
  });

  it('tolerates empty / malformed envelopes', () => {
    expect(() => normalizeBody('monitoring', null)).not.toThrow();
    expect(() => normalizeBody('payment', 'not-an-object')).not.toThrow();
  });
});