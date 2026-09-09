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

/**
 * Storage abstraction so GhostOps can run against Supabase PostgreSQL,
 * or fall back to an in-memory store when credentials aren't configured
 * (critical for a hackathon demo).
 */
export interface DatabaseAdapter {
  kind: 'supabase' | 'memory';

  // --- incidents ---
  createIncident(input: IncidentCreateInput): Promise<Incident>;
  getIncident(id: string): Promise<Incident | null>;
  getIncidentByCode(code: string): Promise<Incident | null>;
  listIncidents(limit?: number): Promise<Incident[]>;
  updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null>;
  incidentsCount(): Promise<number>;

  // --- timeline ---
  addTimeline(input: TimelineAddInput): Promise<TimelineEntry>;
  listTimeline(incidentId: string): Promise<TimelineEntry[]>;

  // --- agent actions ---
  addAgentAction(action: Omit<AgentAction, 'id' | 'created_at'>): Promise<AgentAction>;
  listAgentActions(incidentId?: string, limit?: number): Promise<AgentAction[]>;

  // --- approvals ---
  createApproval(request: Omit<ApprovalRequest, 'id' | 'created_at' | 'decided_at'>): Promise<ApprovalRequest>;
  getApproval(id: string): Promise<ApprovalRequest | null>;
  listApprovals(status?: ApprovalRequest['status']): Promise<ApprovalRequest[]>;
  updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest | null>;

  // --- customer / payments / bookings / logs / tickets / notifications ---
  getCustomerByCode(code: string): Promise<Customer | null>;
  getCustomerById(id: string): Promise<Customer | null>;
  getPaymentByTransaction(txnId: string): Promise<Payment | null>;
  getBookingByTransaction(txnId: string): Promise<Booking | null>;
  createBooking(input: Omit<Booking, 'id' | 'created_at'>): Promise<Booking>;
  listSystemLogs(incidentId?: string, limit?: number): Promise<SystemLog[]>;
  addSystemLog(log: Omit<SystemLog, 'id' | 'created_at'>): Promise<SystemLog>;
  createTicket(ticket: Omit<Ticket, 'id' | 'created_at'>): Promise<Ticket>;
  createNotification(notif: Omit<Notification, 'id' | 'created_at'>): Promise<Notification>;

  // --- stats / analytics ---
  analytics(): Promise<{
    totalIncidents: number;
    activeIncidents: number;
    resolvedIncidents: number;
    resolvedToday: number;
    autoResolvedCount: number;
    escalatedCount: number;
    avgResolutionMinutes: number;
    automationRate: number;
    bySeverity: Record<string, number>;
    byType: Array<{ name: string; count: number }>;
    byRootCause: Array<{ name: string; count: number }>;
  }>;
}