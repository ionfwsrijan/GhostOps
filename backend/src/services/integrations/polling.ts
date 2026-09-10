import { incidentRepo } from '../../db/repos/index.js';
import { env } from '../../config.js';
import { ingestService } from '../ingestService.js';
import { logger } from '../../logger.js';

/**
 * Payment-provider reconciliation poller. On each tick it fetches recent
 * successful transactions from the provider API and creates the missing
 * booking (or surfaces an incident when the domain is out of sync). This is
 * the *only* scheduled pull-based intake; webhooks are push.
 */
export class PaymentPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = 30_000): void {
    if (!env.PAYMENT_PROVIDER_API_URL) {
      logger.warn('polling: PAYMENT_PROVIDER_API_URL not set — payment reconciliation disabled');
      return;
    }
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    logger.info({ url: env.PAYMENT_PROVIDER_API_URL }, 'polling: payment reconciliation started');
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const res = await fetch(`${env.PAYMENT_PROVIDER_API_URL.replace(/\/$/, '')}/transactions?status=success&limit=50`, {
        headers: { authorization: `Bearer ${env.PAYMENT_PROVIDER_API_KEY}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'polling: provider returned non-2xx');
        return;
      }
      const body = (await res.json()) as { transactions?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
      const txs = (body.transactions ?? body.data ?? []) as Array<{ id?: string; amount?: number; status?: string; movieTitle?: string; cinema?: string; customerId?: string; customer?: { id?: string; name?: string; code?: string } }>;
      for (const tx of txs) {
        if (!tx.id || tx.status !== 'success') continue;
        const exists = await incidentRepo.getPaymentByTransaction(tx.id);
        if (!exists) {
          await incidentRepo.createPayment({
            transaction_id: tx.id,
            customer_id: tx.customer?.id ?? tx.customerId ?? undefined,
            amount: tx.amount ?? 0,
            status: 'success',
            gateway: 'provider',
            provider_payload: { source: 'poll' },
            paid_at: new Date().toISOString(),
          });
        }
        const booking = await incidentRepo.getBookingByTransaction(tx.id);
        if (!booking) {
          logger.info({ transactionId: tx.id }, 'polling: paid transaction with no booking — creating incident');
          await ingestService.ingest({
            channel: 'payment_provider',
            source: 'polling',
            title: `Payment succeeded but no booking created (${tx.id})`,
            issue: 'A confirmed payment has no matching booking record in the booking service.',
            severity: 'high',
            transactionId: tx.id,
            affectedService: 'booking-service',
            customer: tx.customer
              ? { id: tx.customer.id, code: tx.customer.code, name: tx.customer.name }
              : tx.customerId
                ? { id: tx.customerId }
                : undefined,
            metadata: { amount: tx.amount ?? null, incidentType: 'payment_booking_failure' },
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'polling: reconcile tick failed');
    } finally {
      this.running = false;
    }
  }
}

export const paymentPoller = new PaymentPoller();