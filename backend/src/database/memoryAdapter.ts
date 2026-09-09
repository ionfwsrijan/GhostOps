import { randomUUID } from 'crypto';
import { DatabaseAdapter } from './adapter.js';
import {
  AgentAction,
  ApprovalRequest,
  Booking,
  Customer,
  Incident,
  IncidentCreateInput,
  Notification,
  Payment,
  SystemLog,
  Ticket,
  TimelineAddInput,
  TimelineEntry,
} from './types.js';
import { computeAnalytics } from './supabaseAdapter.js';

export class MemoryAdapter implements DatabaseAdapter {
  kind = 'memory' as const;

  private customers: Customer[] = [];
  private payments: Payment[] = [];
  private bookings: Booking[] = [];
  private incidents: Incident[] = [];
  private timeline: TimelineEntry[] = [];
  private agentActions: AgentAction[] = [];
  private systemLogs: SystemLog[] = [];
  private tickets: Ticket[] = [];
  private notifications: Notification[] = [];
  private approvals: ApprovalRequest[] = [];

  private codeCounter = 1040;

  constructor(seed = true) {
    if (seed) this.seed();
  }

  // ---------------------------------------------------------------
  // Seed data
  // ---------------------------------------------------------------
  private seed() {
    const customer: Customer = {
      id: randomUUID(),
      customer_code: 'CUS_102',
      name: 'Rahul Sharma',
      email: 'rahul.sharma@example.com',
      phone: '+91 98100 12345',
      city: 'Mumbai',
      loyalty_tier: 'gold',
      created_at: new Date().toISOString(),
    };

    const customer2: Customer = {
      id: randomUUID(),
      customer_code: 'CUS_114',
      name: 'Priya Patel',
      email: 'priya.patel@example.com',
      phone: '+91 99870 44321',
      city: 'Bengaluru',
      loyalty_tier: 'silver',
      created_at: new Date().toISOString(),
    };

    const rahulRedBoxi = randomUUID();
    const priyaBoxi = randomUUID();
    const rahulGreenBoxi = randomUUID();
    this.customers = [customer, customer2];

    // Rahul's successful payment (TXN_84921) — booking missing → the headline demo incident
    const paymentMain: Payment = {
      id: rahulRedBoxi,
      transaction_id: 'TXN_84921',
      customer_id: customer.id,
      amount: 500,
      currency: 'INR',
      status: 'success',
      payment_method: 'upi',
      gateway: 'razorpay',
      paid_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    };
    this.payments = [
      paymentMain,
      {
        id: priyaBoxi,
        transaction_id: 'TXN_81230',
        customer_id: customer2.id,
        amount: 750,
        currency: 'INR',
        status: 'success',
        payment_method: 'upi',
        gateway: 'razorpay',
        paid_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: rahulGreenBoxi,
        transaction_id: 'TXN_07712',
        customer_id: customer.id,
        amount: 250,
        currency: 'INR',
        status: 'success',
        payment_method: 'card',
        gateway: 'razorpay',
        paid_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    // No booking for TXN_84921 (that's the incident) but one booking for Priya
    this.bookings = [
      {
        id: randomUUID(),
        booking_code: 'BK-88421',
        customer_id: customer.id,
        payment_id: rahulGreenBoxi,
        movie_title: 'Pathaan',
        cinema: 'PVR Juhu',
        city: 'Mumbai',
        show_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        seats: ['G12', 'G13'],
        amount: 250,
        status: 'confirmed',
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: randomUUID(),
        booking_code: 'BK-88219',
        customer_id: customer2.id,
        payment_id: priyaBoxi,
        movie_title: 'Dunki',
        cinema: 'INOX Forum',
        city: 'Bengaluru',
        show_time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        seats: ['L4'],
        amount: 750,
        status: 'confirmed',
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    ];

    this.systemLogs = [
      {
        id: randomUUID(),
        incident_id: undefined,
        service: 'booking-service',
        level: 'error',
        message: 'Database timeout after 5s while creating booking for TXN_84921',
        metadata: { txn: 'TXN_84921', code: 'PG.ERR.TIMEOUT', durationMs: 5032 },
        created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      },
      {
        id: randomUUID(),
        service: 'booking-service',
        level: 'warn',
        message: 'Connection pool exhausted, 12 queued retries',
        metadata: { poolSize: 10 },
        created_at: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
      },
      {
        id: randomUUID(),
        service: 'payment-service',
        level: 'info',
        message: 'Payment TXN_84921 captured successfully',
        metadata: { amount: 500, currency: 'INR' },
        created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      },
      {
        id: randomUUID(),
        service: 'booking-service',
        level: 'error',
        message: 'Booking not found for payment TXN_84921 in booking_created table',
        metadata: { txn: 'TXN_84921' },
        created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: randomUUID(),
        service: i % 2 ? 'api-gateway' : 'auth-service',
        level: 'info' as const,
        message: i % 2 ? `Request /api/bookings 200 in ${90 + i * 7}ms` : 'Token refresh completed',
        created_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      })),
    ];

    this.seedIncidents(customer.id, paymentMain.transaction_id);
  }

  private seedIncidents(customerId: string, txnMain: string) {
    const now = Date.now();
    const mk = (code: string, patch: Partial<Incident>): Incident => ({
      id: randomUUID(),
      incident_code: code,
      title: 'Payment successful but booking failed',
      issue: 'Payment successful but booking missing',
      description: 'Customer paid for a movie ticket but the booking was not confirmed.',
      severity: 'high',
      status: 'detected',
      customer_id: customerId,
      transaction_id: txnMain,
      affected_service: 'booking-service',
      ai_confidence: 0.87,
      metadata: { incidentType: 'payment_booking_failure' },
      created_at: new Date(now - 25 * 60 * 1000).toISOString(),
      updated_at: new Date(now - 25 * 60 * 1000).toISOString(),
      ...patch,
    });

    this.incidents = [
      mk('INC-1042', { status: 'detected' }),
      mk('INC-1041', {
        title: 'API timeout in checkout flow',
        issue: 'Checkout API responding intermittently with 504s',
        severity: 'medium',
        status: 'investigating',
        affected_service: 'api-gateway',
        transaction_id: undefined,
        ai_confidence: 0.72,
        metadata: { incidentType: 'api_timeout' },
        created_at: new Date(now - 90 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 60 * 60 * 1000).toISOString(),
      }),
      mk('INC-1039', {
        title: 'Customer complaint: duplicate charge',
        issue: 'Customer reported being charged twice for one order',
        severity: 'high',
        status: 'resolved',
        root_cause: 'Idempotency key missing on retry request',
        root_cause_confidence: 0.91,
        auto_resolved: true,
        resolution_summary: 'Refunded duplicate charge automatically, added idempotency patch.',
        metadata: { incidentType: 'customer_complaint', escalated: false },
        created_at: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 4.5 * 60 * 60 * 1000).toISOString(),
      }),
      mk('INC-1035', {
        title: 'Database connection pool exhausted',
        issue: 'Booking service database pool exhausted during peak load',
        severity: 'critical',
        status: 'resolved',
        root_cause: 'db_connection_pool_exhaustion',
        root_cause_confidence: 0.84,
        auto_resolved: false,
        resolution_summary: 'Scaled connection pool and routed traffic. No data loss.',
        metadata: { incidentType: 'database_failure', escalated: true },
        created_at: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
      }),
      mk('INC-1027', {
        title: 'Payment gateway webhook delay',
        issue: 'Payment success webhooks delayed by 40 minutes',
        severity: 'low',
        status: 'resolved',
        root_cause: 'webhook_processing_backlog',
        root_cause_confidence: 0.88,
        auto_resolved: true,
        resolution_summary: 'Backlog flushed, webhook worker scaled out.',
        metadata: { incidentType: 'api_timeout', escalated: false },
        created_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 2.99 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      mk('INC-1018', {
        title: 'SSO session expired for batch job',
        issue: 'Batch job failed authentication for account sync',
        severity: 'low',
        status: 'resolved',
        root_cause: 'expired_token_rotation',
        root_cause_confidence: 0.95,
        auto_resolved: true,
        metadata: { incidentType: 'other', escalated: false },
        created_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 5.9 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    // Timeline & actions for the seeded resolved incidents (visual history)
    this.seedTimelineFor(this.incidents[2]); // INC-1039 duplicate charge
    this.seedActionsFor(this.incidents[2]);
    this.seedTimelineFor(this.incidents[4]); // INC-1027 webhook delay
  }

  private seedTimelineFor(inc: Incident) {
    if (inc.id !== this.incidents[2].id) return; // only INC-1039 duplicates complex history
    const base = new Date(inc.created_at!).getTime();
    const tl: TimelineEntry[] = [
      { id: randomUUID(), incident_id: inc.id, step: 'detected', type: 'info', title: 'Incident detected', description: 'Customer complaint ingested from support email', created_at: new Date(base).toISOString() },
      { id: randomUUID(), incident_id: inc.id, step: 'understood', type: 'ai', title: 'Issue understood', description: 'Customer charged twice for a single booking. Refund eligibility confirmed.', created_at: new Date(base + 8_000).toISOString() },
      { id: randomUUID(), incident_id: inc.id, step: 'tool_call', type: 'success', title: 'Payment API investigated', description: 'Two successful captures found for order. Duplicate transaction detected.', created_at: new Date(base + 20_000).toISOString() },
      { id: randomUUID(), incident_id: inc.id, step: 'root_cause', type: 'ai', title: 'Root cause identified', description: 'Idempotency key missing on retry request', metadata: { confidence: 0.91 }, created_at: new Date(base + 40_000).toISOString() },
      { id: randomUUID(), incident_id: inc.id, step: 'action', type: 'action', title: 'Refund issued', description: 'Duplicate charge refunded (₹500) via payment gateway', created_at: new Date(base + 70_000).toISOString() },
      { id: randomUUID(), incident_id: inc.id, step: 'verify', type: 'success', title: 'Resolution verified', description: 'Refund confirmed. Single booking remains.', created_at: new Date(base + 95_000).toISOString() },
      { id: randomUUID(), incident_id: inc.id, step: 'resolved', type: 'success', title: 'Incident resolved', created_at: new Date((inc.updated_at as unknown as string ? base + 100_000 : base + 100_000)).toISOString() },
    ];
    this.timeline.push(...tl);
  }

  private seedActionsFor(inc: Incident) {
    const base = new Date(inc.created_at!).getTime();
    this.agentActions.push(
      { id: randomUUID(), incident_id: inc.id, tool: 'Payment API', action: 'Verify transactions', input: { order: 'ORD-8712' }, output: { captures: 2 }, result: 'Duplicate transaction found', risk: 'low', status: 'executed', created_at: new Date(base + 20_000).toISOString() },
      { id: randomUUID(), incident_id: inc.id, tool: 'Payment API', action: 'Issue refund', input: { amount: 500, reason: 'duplicate charge' }, output: { refundId: 'RFND-2201' }, result: 'Refund issued', risk: 'high', status: 'executed', created_at: new Date(base + 70_000).toISOString() },
    );
  }

  // ---------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------
  async createIncident(input: IncidentCreateInput): Promise<Incident> {
    this.codeCounter += 1;
    let customerId: string | undefined;
    if (input.customer_code) customerId = (await this.getCustomerByCode(input.customer_code))?.id;
    const inc: Incident = {
      id: randomUUID(),
      incident_code: `INC-${this.codeCounter}`,
      title: input.title,
      issue: input.issue,
      description: input.description,
      severity: input.severity ?? 'high',
      status: 'detected',
      customer_id: customerId,
      transaction_id: input.transaction_id,
      affected_service: input.affected_service,
      channel: input.channel ?? 'support_email',
      metadata: input.metadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.incidents.unshift(inc);
    return inc;
  }

  async getIncident(id: string): Promise<Incident | null> {
    return this.incidents.find((i) => i.id === id) ?? null;
  }

  async getIncidentByCode(code: string): Promise<Incident | null> {
    return this.incidents.find((i) => i.incident_code === code) ?? null;
  }

  async listIncidents(limit = 50): Promise<Incident[]> {
    return [...this.incidents].sort((a, b) => (b.created_at! > a.created_at! ? 1 : -1)).slice(0, limit);
  }

  async updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null> {
    const idx = this.incidents.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    this.incidents[idx] = { ...this.incidents[idx], ...patch, updated_at: new Date().toISOString() };
    return this.incidents[idx];
  }

  async incidentsCount(): Promise<number> {
    return this.incidents.length;
  }

  // ---------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------
  async addTimeline(input: TimelineAddInput): Promise<TimelineEntry> {
    const entry: TimelineEntry = { id: randomUUID(), ...input, created_at: new Date().toISOString() };
    this.timeline.push(entry);
    return entry;
  }

  async listTimeline(incidentId: string): Promise<TimelineEntry[]> {
    return this.timeline.filter((t) => t.incident_id === incidentId).sort((a, b) => (a.created_at! > b.created_at! ? 1 : -1));
  }

  // ---------------------------------------------------------------
  // Agent actions
  // ---------------------------------------------------------------
  async addAgentAction(action: Omit<AgentAction, 'id' | 'created_at'>): Promise<AgentAction> {
    const full: AgentAction = { id: randomUUID(), ...action, created_at: new Date().toISOString() };
    this.agentActions.push(full);
    return full;
  }

  async listAgentActions(incidentId?: string, limit = 100): Promise<AgentAction[]> {
    const filtered = incidentId ? this.agentActions.filter((a) => a.incident_id === incidentId) : this.agentActions;
    return [...filtered].sort((a, b) => (b.created_at! > a.created_at! ? 1 : -1)).slice(0, limit);
  }

  // ---------------------------------------------------------------
  // Approvals
  // ---------------------------------------------------------------
  async createApproval(request: Omit<ApprovalRequest, 'id' | 'created_at' | 'decided_at'>): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = { id: randomUUID(), ...request, status: request.status ?? 'pending', created_at: new Date().toISOString() };
    this.approvals.unshift(approval);
    return approval;
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    return this.approvals.find((a) => a.id === id) ?? null;
  }

  async listApprovals(status?: ApprovalRequest['status']): Promise<ApprovalRequest[]> {
    const filtered = status ? this.approvals.filter((a) => a.status === status) : this.approvals;
    return [...filtered].sort((a, b) => (b.created_at! > a.created_at! ? 1 : -1));
  }

  async updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest | null> {
    const idx = this.approvals.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    this.approvals[idx] = { ...this.approvals[idx], ...patch, decided_at: patch.status ? new Date().toISOString() : undefined };
    return this.approvals[idx];
  }

  // ---------------------------------------------------------------
  // Record lookups
  // ---------------------------------------------------------------
  async getCustomerByCode(code: string): Promise<Customer | null> {
    return this.customers.find((c) => c.customer_code === code) ?? null;
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    return this.customers.find((c) => c.id === id) ?? null;
  }

  async getPaymentByTransaction(txnId: string): Promise<Payment | null> {
    return this.payments.find((p) => p.transaction_id === txnId) ?? null;
  }

  async getBookingByTransaction(txnId: string): Promise<Booking | null> {
    const payment = await this.getPaymentByTransaction(txnId);
    if (!payment) return null;
    return this.bookings.find((b) => b.payment_id === payment.id) ?? null;
  }

  async createBooking(input: Omit<Booking, 'id' | 'created_at'>): Promise<Booking> {
    const full: Booking = { id: randomUUID(), ...input, created_at: new Date().toISOString() };
    this.bookings.push(full);
    return full;
  }

  async listSystemLogs(incidentId?: string, limit = 50): Promise<SystemLog[]> {
    const filtered = incidentId ? this.systemLogs.filter((l) => l.incident_id === incidentId) : this.systemLogs;
    return [...filtered].sort((a, b) => (b.created_at! > a.created_at! ? 1 : -1)).slice(0, limit);
  }

  async addSystemLog(log: Omit<SystemLog, 'id' | 'created_at'>): Promise<SystemLog> {
    const full: SystemLog = { id: randomUUID(), ...log, created_at: new Date().toISOString() };
    this.systemLogs.unshift(full);
    return full;
  }

  async createTicket(ticket: Omit<Ticket, 'id' | 'created_at'>): Promise<Ticket> {
    const full: Ticket = { id: randomUUID(), ...ticket, created_at: new Date().toISOString() };
    this.tickets.push(full);
    return full;
  }

  async createNotification(notif: Omit<Notification, 'id' | 'created_at'>): Promise<Notification> {
    const full: Notification = { id: randomUUID(), ...notif, created_at: new Date().toISOString() };
    this.notifications.push(full);
    return full;
  }

  // ---------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------
  async analytics() {
    return computeAnalytics(this.incidents);
  }

  // test helper
  getApprovalsForTest() {
    return this.approvals;
  }
}