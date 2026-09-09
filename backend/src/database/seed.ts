/**
 * GhostOps seed script.
 *
 * IMPORTANT: BEFORE running this, execute `supabase/schema.sql` in the
 * Supabase SQL Editor to create the tables.
 *
 * This script inserts demo customers / payments / bookings / incidents
 * into Supabase (or reports clearly if credentials are missing).
 */
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from repo root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(`
========================================================
  Seed requires Supabase credentials.
========================================================
  1. Create a project at https://supabase.com/dashboard
  2. Open the SQL Editor and run supabase/schema.sql
  3. Copy SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY into .env
  4. Re-run: npm run seed
========================================================
`);
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function ensureTable(table: string) {
  const { error } = await db.from(table).select('id').limit(1);
  if (error) {
    throw new Error(
      `Table "${table}" not found (message: ${error.message})\n→ Run supabase/schema.sql in the Supabase SQL Editor first.`
    );
  }
}

async function main() {
  console.log('[seed] verifying schema...');
  for (const t of ['customers', 'payments', 'bookings', 'incidents']) {
    await ensureTable(t);
  }

  const now = new Date().toISOString();

  const customer = {
    customer_code: 'CUS_102',
    name: 'Rahul Sharma',
    email: 'rahul.sharma@example.com',
    phone: '+91 98100 12345',
    city: 'Mumbai',
    loyalty_tier: 'gold',
  };
  const { data: cus, error: cusErr } = await db.from('customers').insert(customer).select().single();
  if (cusErr) {
    if (cusErr.message.includes('duplicate')) {
      console.log('[seed] customer CUS_102 already exists, skipping');
    } else {
      throw cusErr;
    }
  }
  const customerId = cus?.id;

  const payment = {
    transaction_id: 'TXN_84921',
    customer_id: customerId,
    amount: 500,
    currency: 'INR',
    status: 'success',
    payment_method: 'upi',
    gateway: 'razorpay',
    paid_at: now,
  };
  const { error: payErr } = await db.from('payments').insert(payment).select().single();
  if (payErr && !payErr.message.includes('duplicate')) throw payErr;

  const { error: incErr } = await db.from('incidents').insert({
    incident_code: 'INC-1042',
    title: 'Payment successful but booking failed',
    issue: 'Payment successful but booking missing',
    description: 'Customer paid ₹500 for a movie ticket but the booking was not confirmed.',
    severity: 'high',
    status: 'detected',
    customer_id: customerId,
    transaction_id: 'TXN_84921',
    affected_service: 'booking-service',
    ai_confidence: 0.87,
    channel: 'support_email',
    metadata: { incidentType: 'payment_booking_failure' },
  });
  if (incErr && !incErr.message.includes('duplicate')) throw incErr;

  console.log(`[seed] done.
  customer : ${customer.name} (${customer.customer_code})
  payment  : TXN_84921 ₹500 success
  incident : INC-1042 "Payment successful but booking failed" (detected)

Next → npm run dev`);
}

main().catch((err) => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});