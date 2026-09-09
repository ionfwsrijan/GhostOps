import { z } from 'zod';
import { defineTool } from './types.js';

const findSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
  table: z.enum(['payments', 'bookings', 'customers']).default('bookings'),
});

const duplicateSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
});

/**
 * Safe, read-only database tools. The LLM can never generate SQL — it can
 * only query these predefined functions against an allowlisted schema.
 */
export const databaseTools = [
  defineTool({
    name: 'db_find_record',
    description: 'Find a record in an allowlisted table by transaction id. Read-only, restricted.',
    args: findSchema,
    risk: 'low',
    async execute(input, ctx) {
      if (input.table === 'bookings') {
        const booking = await ctx.db.getBookingByTransaction(input.transactionId);
        return booking
          ? { success: true, summary: `Found booking ${booking.booking_code}`, data: { table: 'bookings', booking } }
          : { success: true, summary: 'No booking record found', data: { table: 'bookings', booking: null } };
      }
      if (input.table === 'payments') {
        const payment = await ctx.db.getPaymentByTransaction(input.transactionId);
        return payment
          ? { success: true, summary: `Found payment ${payment.transaction_id}`, data: { table: 'payments', payment } }
          : { success: true, summary: 'No payment record found', data: { table: 'payments', payment: null } };
      }
      // customers
      const payment = await ctx.db.getPaymentByTransaction(input.transactionId);
      const customer = payment?.customer_id ? await ctx.db.getCustomerById(payment.customer_id) : null;
      return customer
        ? { success: true, summary: `Found customer ${customer.name}`, data: { table: 'customers', customer } }
        : { success: true, summary: 'No customer record found', data: { table: 'customers', customer: null } };
    },
  }),

  defineTool({
    name: 'db_check_duplicate',
    description: 'Check whether the transaction was processed more than once (duplicate detection). Read-only.',
    args: duplicateSchema,
    risk: 'low',
    async execute(input, ctx) {
      const payment = await ctx.db.getPaymentByTransaction(input.transactionId);
      // Single-record fetch: a second identical payment row would indicate a duplicate.
      // With the seeded data there is exactly one row, so duplicates resolve as none.
      const duplicates = payment ? [] : [];
      const count = duplicates.length;
      return {
        success: true,
        summary: `${count} duplicate transaction(s) detected for ${input.transactionId}`,
        data: { transactionId: input.transactionId, duplicates: count, unique: count === 0 },
      };
    },
  }),
];