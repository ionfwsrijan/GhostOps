import { Router } from 'express';
import { getDatabase } from '../database/index.js';
import { incidentService } from '../services/incidentService.js';
import { investigationService } from '../services/investigationService.js';

export const simulateRouter = Router();

export interface SimulationScenario {
  key: string;
  label: string;
  description: string;
  /**
   * Seed the underlying demo data (fresh payment per run) and return an
   * incident create payload.
   */
  seed: () => Promise<{
    title: string;
    issue: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    customer_code: string;
    transaction_id: string;
    affected_service: string;
    metadata: Record<string, unknown>;
  }>;
}

const MOVIE = { title: 'Rocketry: The Nambi Effect', cinema: 'PVR Juhu', city: 'Mumbai' };

const SCENARIOS: SimulationScenario[] = [
  {
    key: 'payment_booking_failure',
    label: 'Payment successful but booking failed',
    description: 'Customer paid ₹500 but the booking was never confirmed. The flagship scenario.',
    async seed() {
      const db = getDatabase();
      const txn = `TXN_${Math.floor(90000 + Math.random() * 9999)}`;
      const customer = await db.getCustomerByCode('CUS_102');
      await db.createPayment({
        transaction_id: txn,
        customer_id: customer?.id,
        amount: 500,
        currency: 'INR',
        status: 'success',
        payment_method: 'upi',
        gateway: 'razorpay',
        paid_at: new Date().toISOString(),
      });
      await db.addSystemLog({ service: 'booking-service', level: 'error', message: 'Database timeout after 5s while creating booking', metadata: { txn, code: 'PG.ERR.TIMEOUT' } });
      await db.addSystemLog({ service: 'payment-service', level: 'info', message: `Payment ${txn} captured successfully`, metadata: { txn, amount: 500 } });
      return {
        title: 'Payment successful but booking failed',
        issue: 'Payment successful but booking missing',
        description: `${customer?.name} paid ₹500 for a movie ticket at ${MOVIE.cinema}, but the booking was not confirmed.`,
        severity: 'high',
        customer_code: 'CUS_102',
        transaction_id: txn,
        affected_service: 'booking-service',
        metadata: { incidentType: 'payment_booking_failure', amount: 500, scenario: 'payment_booking_failure' },
      };
    },
  },
  {
    key: 'api_timeout',
    label: 'API timeout',
    description: 'Checkout API is timing out during booking creation.',
    async seed() {
      const db = getDatabase();
      const txn = `TXN_${Math.floor(90000 + Math.random() * 9999)}`;
      const customer = await db.getCustomerByCode('CUS_102');
      await db.createPayment({
        transaction_id: txn,
        customer_id: customer?.id,
        amount: 350,
        currency: 'INR',
        status: 'success',
        payment_method: 'card',
        gateway: 'razorpay',
        paid_at: new Date().toISOString(),
      });
      await db.addSystemLog({ service: 'api-gateway', level: 'error', message: 'Gateway timeout (504) while proxying /api/bookings', metadata: { txn, upstream: 'booking-service' } });
      return {
        title: 'Checkout API timeout',
        issue: 'Booking request timed out at the API gateway',
        description: `Customer ${customer?.name} hit a 504 while confirming a booking; payment was captured.`,
        severity: 'medium',
        customer_code: 'CUS_102',
        transaction_id: txn,
        affected_service: 'api-gateway',
        metadata: { incidentType: 'api_timeout', amount: 350, scenario: 'api_timeout' },
      };
    },
  },
  {
    key: 'customer_complaint',
    label: 'Customer complaint',
    description: 'Customer reports their booking was never confirmed after paying.',
    async seed() {
      const db = getDatabase();
      const txn = `TXN_${Math.floor(90000 + Math.random() * 9999)}`;
      const customer = await db.getCustomerByCode('CUS_102');
      await db.createPayment({
        transaction_id: txn,
        customer_id: customer?.id,
        amount: 420,
        currency: 'INR',
        status: 'success',
        payment_method: 'upi',
        gateway: 'razorpay',
        paid_at: new Date().toISOString(),
      });
      return {
        title: 'Customer complaint: booking not confirmed',
        issue: 'Customer says they paid but no booking email arrived',
        description: `Complaint from ${customer?.name} via support email. Payment reference ${txn}.`,
        severity: 'high',
        customer_code: 'CUS_102',
        transaction_id: txn,
        affected_service: 'booking-service',
        metadata: { incidentType: 'customer_complaint', amount: 420, scenario: 'customer_complaint' },
      };
    },
  },
  {
    key: 'database_failure',
    label: 'Database failure',
    description: 'Booking database reported failures during peak load.',
    async seed() {
      const db = getDatabase();
      const txn = `TXN_${Math.floor(90000 + Math.random() * 9999)}`;
      const customer = await db.getCustomerByCode('CUS_102');
      const payment = await db.createPayment({
        transaction_id: txn,
        customer_id: customer?.id,
        amount: 600,
        currency: 'INR',
        status: 'success',
        payment_method: 'upi',
        gateway: 'razorpay',
        paid_at: new Date().toISOString(),
      });
      await db.addSystemLog({ service: 'booking-service', level: 'error', message: 'Database connection pool exhausted while persisting booking', metadata: { txn, paymentId: payment.id } });
      await db.addSystemLog({ service: 'booking-service', level: 'warn', message: 'Connection pool exhaustion — retries queued', metadata: { txn } });
      return {
        title: 'Booking database failure',
        issue: 'Booking service could not persist booking due to database errors',
        description: `Transaction ${txn} shows a confirmed payment but no persisted booking.`,
        severity: 'critical',
        customer_code: 'CUS_102',
        transaction_id: txn,
        affected_service: 'booking-db',
        metadata: { incidentType: 'database_failure', amount: 600, scenario: 'database_failure' },
      };
    },
  },
];

simulateRouter.get('/scenarios', (_req, res) => {
  res.json({ scenarios: SCENARIOS.map(({ key, label, description }) => ({ key, label, description })) });
});

simulateRouter.post('/run', async (req, res, next) => {
  try {
    const key = (req.body as { scenario?: string }).scenario ?? 'payment_booking_failure';
    const scenario = SCENARIOS.find((s) => s.key === key);
    if (!scenario) return res.status(400).json({ error: `Unknown scenario "${key}"` });

    const payload = await scenario.seed();
    const incident = await incidentService.createIncidentFromComplaint(payload);
    void investigationService.investigate(incident.id);

    res.status(201).json({
      incident,
      investigation: { started: true },
      message: `Scenario "${scenario.label}" simulated — GhostOps is now investigating ${incident.incident_code}.`,
    });
  } catch (err) {
    next(err);
  }
});

// Legacy alias for the spec-listed endpoint
simulateRouter.post('/payment-failure', async (_req, res, next) => {
  try {
    const scenario = SCENARIOS[0];
    const payload = await scenario.seed();
    const incident = await incidentService.createIncidentFromComplaint(payload);
    void investigationService.investigate(incident.id);
    res.status(201).json({ incident, investigation: { started: true } });
  } catch (err) {
    next(err);
  }
});