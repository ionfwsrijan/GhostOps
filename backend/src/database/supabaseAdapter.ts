import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
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

export class SupabaseAdapter implements DatabaseAdapter {
  kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor() {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      throw new Error('Supabase configured but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    }
    this.db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  private async insert<T>(table: string, row: object): Promise<T> {
    const { data, error } = await this.db.from(table).insert(row as never).select().single();
    if (error) throw new Error(`[supabase] insert ${table}: ${error.message}`);
    return data as T;
  }

  // ---------- incidents ----------
  async createIncident(input: IncidentCreateInput): Promise<Incident> {
    const code = await this.nextIncidentCode();
    let customerId: string | undefined;
    if (input.customer_code) {
      const c = await this.getCustomerByCode(input.customer_code);
      customerId = c?.id;
    }
    const row = {
      incident_code: code,
      title: input.title,
      issue: input.issue,
      description: input.description,
      severity: input.severity,
      status: 'detected' as const,
      customer_id: customerId,
      transaction_id: input.transaction_id,
      affected_service: input.affected_service,
      channel: input.channel,
      metadata: input.metadata,
    };
    return this.insert<Incident>('incidents', row);
  }

  async getIncident(id: string): Promise<Incident | null> {
    const { data, error } = await this.db.from('incidents').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`[supabase] get incident: ${error.message}`);
    return (data as Incident) ?? null;
  }

  async getIncidentByCode(code: string): Promise<Incident | null> {
    const { data, error } = await this.db.from('incidents').select('*').eq('incident_code', code).maybeSingle();
    if (error) throw new Error(`[supabase] get incident by code: ${error.message}`);
    return (data as Incident) ?? null;
  }

  async listIncidents(limit = 50): Promise<Incident[]> {
    const { data, error } = await this.db
      .from('incidents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`[supabase] list incidents: ${error.message}`);
    return (data ?? []) as Incident[];
  }

  async updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null> {
    const { data, error } = await this.db
      .from('incidents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`[supabase] update incident: ${error.message}`);
    return (data as Incident) ?? null;
  }

  async incidentsCount(): Promise<number> {
    const { count, error } = await this.db.from('incidents').select('*', { count: 'exact', head: true });
    if (error) throw new Error(`[supabase] count incidents: ${error.message}`);
    return count ?? 0;
  }

  private async nextIncidentCode(): Promise<string> {
    const { count, error } = await this.db.from('incidents').select('*', { count: 'exact', head: true });
    if (error) throw new Error(`[supabase] next incident code: ${error.message}`);
    const n = (count ?? 0) + 1000;
    return `INC-${n}`;
  }

  // ---------- timeline ----------
  async addTimeline(input: TimelineAddInput): Promise<TimelineEntry> {
    return this.insert<TimelineEntry>('incident_timeline', input);
  }

  async listTimeline(incidentId: string): Promise<TimelineEntry[]> {
    const { data, error } = await this.db
      .from('incident_timeline')
      .select('*')
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`[supabase] timeline: ${error.message}`);
    return (data ?? []) as TimelineEntry[];
  }

  // ---------- agent actions ----------
  async addAgentAction(action: Omit<AgentAction, 'id' | 'created_at'>): Promise<AgentAction> {
    return this.insert<AgentAction>('agent_actions', action);
  }

  async listAgentActions(incidentId?: string, limit = 100): Promise<AgentAction[]> {
    let q = this.db.from('agent_actions').select('*').order('created_at', { ascending: false }).limit(limit);
    if (incidentId) q = q.eq('incident_id', incidentId);
    const { data, error } = await q;
    if (error) throw new Error(`[supabase] agent actions: ${error.message}`);
    return (data ?? []) as AgentAction[];
  }

  // ---------- approvals ----------
  async createApproval(request: Omit<ApprovalRequest, 'id' | 'created_at' | 'decided_at'>): Promise<ApprovalRequest> {
    return this.insert<ApprovalRequest>('approval_requests', { ...request, status: 'pending' });
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    const { data, error } = await this.db.from('approval_requests').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`[supabase] get approval: ${error.message}`);
    return (data as ApprovalRequest) ?? null;
  }

  async listApprovals(status?: ApprovalRequest['status']): Promise<ApprovalRequest[]> {
    let q = this.db.from('approval_requests').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(`[supabase] approvals: ${error.message}`);
    return (data ?? []) as ApprovalRequest[];
  }

  async updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest | null> {
    const { data, error } = await this.db
      .from('approval_requests')
      .update({ ...patch, decided_at: patch.status ? new Date().toISOString() : undefined })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`[supabase] update approval: ${error.message}`);
    return (data as ApprovalRequest) ?? null;
  }

  // ---------- customers / payments / bookings / logs / tickets / notifications ----------
  async getCustomerByCode(code: string): Promise<Customer | null> {
    return this.getByField<Customer>('customers', 'customer_code', code);
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    return this.getByField<Customer>('customers', 'id', id);
  }

  async getPaymentByTransaction(txnId: string): Promise<Payment | null> {
    return this.getByField<Payment>('payments', 'transaction_id', txnId);
  }

  async createPayment(input: Omit<Payment, 'id' | 'created_at'>): Promise<Payment> {
    return this.insert<Payment>('payments', input);
  }

  async getBookingByTransaction(txnId: string): Promise<Booking | null> {
    // bookings reference payments by id; resolve transaction -> payment -> booking
    const payment = await this.getPaymentByTransaction(txnId);
    if (!payment) return null;
    const { data, error } = await this.db.from('bookings').select('*').eq('payment_id', payment.id).maybeSingle();
    if (error) throw new Error(`[supabase] get booking: ${error.message}`);
    return (data as Booking) ?? null;
  }

  async createBooking(input: Omit<Booking, 'id' | 'created_at'>): Promise<Booking> {
    const { data, error } = await this.db.from('bookings').insert(input).select().single();
    if (error) throw new Error(`[supabase] create booking: ${error.message}`);
    return data as Booking;
  }

  async listSystemLogs(incidentId?: string, limit = 50): Promise<SystemLog[]> {
    let q = this.db.from('system_logs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (incidentId) q = q.eq('incident_id', incidentId);
    const { data, error } = await q;
    if (error) throw new Error(`[supabase] system logs: ${error.message}`);
    return (data ?? []) as SystemLog[];
  }

  async addSystemLog(log: Omit<SystemLog, 'id' | 'created_at'>): Promise<SystemLog> {
    return this.insert<SystemLog>('system_logs', log);
  }

  async createTicket(ticket: Omit<Ticket, 'id' | 'created_at'>): Promise<Ticket> {
    const { data, error } = await this.db.from('tickets').insert(ticket).select().single();
    if (error) throw new Error(`[supabase] create ticket: ${error.message}`);
    return data as Ticket;
  }

  async createNotification(notif: Omit<Notification, 'id' | 'created_at'>): Promise<Notification> {
    return this.insert<Notification>('notifications', notif);
  }

  // ---------- analytics ----------
  async analytics() {
    const incidents = await this.listIncidents(1000);
    return computeAnalytics(incidents);
  }

  private async getByField<T>(table: string, field: string, value: string): Promise<T | null> {
    const { data, error } = await this.db.from(table).select('*').eq(field, value).maybeSingle();
    if (error) throw new Error(`[supabase] get ${table}: ${error.message}`);
    return (data as T) ?? null;
  }
}

export function computeAnalytics(incidents: Incident[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const total = incidents.length;
  const active = incidents.filter((i) => !['resolved', 'failed'].includes(i.status)).length;
  const resolved = incidents.filter((i) => i.status === 'resolved');
  const resolvedToday = resolved.filter((i) => i.updated_at && new Date(i.updated_at) >= startOfToday).length;
  const autoResolved = incidents.filter((i) => i.auto_resolved && i.status === 'resolved').length;
  const escalated = incidents.filter((i) => i.metadata?.escalated === true).length;

  const durationsMin = resolved
    .map((i) => (i.created_at && i.updated_at ? (new Date(i.updated_at).getTime() - new Date(i.created_at).getTime()) / 60000 : null))
    .filter((d): d is number => d !== null && d >= 0);
  const avgResolutionMinutes = durationsMin.length ? durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length : 0;

  const automationRate = resolved.length > 0 ? Math.round((autoResolved / resolved.length) * 100) : 0;

  const bySeverity: Record<string, number> = {};
  for (const i of incidents) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;

  const byType = groupCount(incidents, (i) => i.metadata?.incidentType as string | undefined, 'General');
  const byRootCause = groupCount(incidents, (i) => i.root_cause, 'Unknown');

  return {
    totalIncidents: total,
    activeIncidents: active,
    resolvedIncidents: resolved.length,
    resolvedToday,
    autoResolvedCount: autoResolved,
    escalatedCount: escalated,
    avgResolutionMinutes: Math.round(avgResolutionMinutes * 100) / 100,
    automationRate,
    bySeverity,
    byType,
    byRootCause,
  };
}

function groupCount(items: Incident[], keyFn: (i: Incident) => string | undefined, fallback: string) {
  const map: Record<string, number> = {};
  for (const i of items) {
    const k = keyFn(i) || fallback;
    map[k] = (map[k] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}