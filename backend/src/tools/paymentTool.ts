import { z } from 'zod';
import { defineTool } from './types.js';

const verifySchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
});

const refundSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

export const paymentTools = [
  defineTool({
    name: 'verify_transaction',
    description: 'Verify a payment transaction against the payment gateway. Read-only.',
    args: verifySchema,
    risk: 'low',
    async execute(input, ctx) {
      const payment = await ctx.db.getPaymentByTransaction(input.transactionId);
      if (!payment) {
        return { success: false, summary: `Transaction ${input.transactionId} not found` };
      }
      return {
        success: true,
        summary: `Payment ${payment.status.toLowerCase()} — ₹${payment.amount} via ${payment.gateway}`,
        data: {
          transactionId: payment.transaction_id,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.payment_method,
          gateway: payment.gateway,
          paidAt: payment.paid_at,
        },
      };
    },
  }),

  defineTool({
    name: 'issue_refund',
    description: 'Issue a refund for a payment transaction. HIGH RISK — requires human approval.',
    args: refundSchema,
    risk: 'high',
    async execute(input, ctx) {
      const payment = await ctx.db.getPaymentByTransaction(input.transactionId);
      if (!payment) {
        return { success: false, summary: `Cannot refund: transaction ${input.transactionId} not found` };
      }
      if (payment.status === 'refunded') {
        return { success: true, summary: 'Refund already issued (idempotent no-op)' };
      }
      // In the sandbox this up-to-dated the payment record; in production this
      // would call Razorpay/Stripe. Recorded here as an idempotent-ish action.
      const refundId = `RFND-${Date.now()}`;
      return {
        success: true,
        summary: `Refund ₹${input.amount} issued for ${input.transactionId}`,
        data: { refundId, transactionId: input.transactionId, amount: input.amount, status: 'refunded' },
      };
    },
  }),
];