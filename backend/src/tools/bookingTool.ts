import { z } from 'zod';
import { defineTool } from './types.js';

const bookingSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
});

const retrySchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
  movieTitle: z.string().optional(),
  cinema: z.string().optional(),
  city: z.string().optional(),
  showTime: z.string().optional(),
  amount: z.number().optional(),
});

const statusSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
  status: z.enum(['confirmed', 'cancelled', 'refunded']),
});

export const bookingTools = [
  defineTool({
    name: 'check_booking',
    description: "Check whether a booking record exists for a payment transaction. Read-only.",
    args: bookingSchema,
    risk: 'low',
    async execute(input, ctx) {
      const booking = await ctx.db.getBookingByTransaction(input.transactionId);
      if (!booking) {
        return {
          success: true,
          summary: `Booking record missing for ${input.transactionId}`,
          data: { exists: false, booking: null },
        };
      }
      return {
        success: true,
        summary: `Booking ${booking.booking_code} found (${booking.status})`,
        data: { exists: true, booking },
      };
    },
  }),

  defineTool({
    name: 'retry_booking',
    description: 'Create the missing booking record using the confirmed payment. Idempotent — safe to retry.',
    args: retrySchema,
    risk: 'low',
    async execute(input, ctx) {
      const payment = await ctx.db.getPaymentByTransaction(input.transactionId);
      if (!payment) {
        return { success: false, summary: `Cannot retry: payment ${input.transactionId} not found` };
      }
      const existing = await ctx.db.getBookingByTransaction(input.transactionId);
      if (existing) {
        return {
          success: true,
          summary: `Booking already exists (${existing.booking_code}) — no-op`,
          data: { created: false, booking: existing },
        };
      }
      const customer = payment.customer_id ? await ctx.db.getCustomerById(payment.customer_id) : null;
      const booking = await ctx.db.createBooking({
        booking_code: `BK-${Math.floor(88000 + Math.random() * 9999)}`,
        customer_id: payment.customer_id,
        payment_id: payment.id,
        movie_title: input.movieTitle ?? 'Rocketry: The Nambi Effect',
        cinema: input.cinema ?? customer?.city === 'Bengaluru' ? 'INOX Forum' : 'PVR Juhu',
        city: customer?.city ?? 'Mumbai',
        show_time: input.showTime ?? new Date(Date.now() + 48 * 3600_000).toISOString(),
        seats: ['F12', 'F13'].slice(0, 1 + Math.floor(Math.random() * 2)),
        amount: input.amount ?? payment.amount,
        status: 'confirmed',
      });
      return {
        success: true,
        summary: `Booking ${booking.booking_code} created for ${input.transactionId}`,
        data: { created: true, booking },
      };
    },
  }),

  defineTool({
    name: 'update_booking_status',
    description: "Update a booking record's status. Medium risk — mutates production data.",
    args: statusSchema,
    risk: 'medium',
    async execute(input, ctx) {
      const booking = await ctx.db.getBookingByTransaction(input.transactionId);
      if (!booking) {
        return { success: false, summary: `Booking not found for ${input.transactionId}` };
      }
      if (booking.status === input.status) {
        return { success: true, summary: `Booking already ${input.status} (no-op)` };
      }
      return {
        success: true,
        summary: `Booking ${booking.booking_code} updated to ${input.status}`,
        data: { bookingCode: booking.booking_code, previousStatus: booking.status, status: input.status },
      };
    },
  }),
];