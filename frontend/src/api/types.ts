// Shared GhostOps data types (mirror of backend/src/database/types.ts)

export type IncidentStatus =
  | 'detected'
  | 'investigating'
  | 'action_required'
  | 'awaiting_approval'
  | 'resolving'
  | 'resolved'
  | 'failed';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface Customer {
  id: string;
  customer_code: string;
  name: string;
  email?: string;
  phone?: string;
  city?: string;
  loyalty_tier?: string;
}

export interface Payment {
  id: string;
  transaction_id: string;
  customer_id?: string;
  amount: number;
  currency?: string;
  status: string;
  payment_method?: string;
  gateway?: string;
  paid_at?: string;
}

export interface Booking {
  id: string;
  booking_code: string;
  customer_id?: string;
  payment_id?: string;
  movie_title: string;
  cinema?: string;
  city?: string;
  show_time?: string;
  seats?: string[];
  amount?: number;
  status: string;
}

export interface Incident {
  id: string;
  incident_code: string;
  title: string;
  issue: string;
  description?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  customer_id?: string;
  transaction_id?: string;
  affected_service?: string;
  ai_confidence?: number;
  root_cause?: string;
  root_cause_confidence?: number;
  evidence?: Record<string, unknown>;
  resolution_summary?: string;
  auto_resolved?: boolean;
  channel?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface TimelineEntry {
  id: string;
  incident_id: string;
  step: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'ai' | 'action' | 'system';
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentAction {
  id: string;
  incident_id: string;
  incident_code?: string;
  tool: string;
  action: string;
  input?: unknown;
  output?: unknown;
  result: string;
  risk: RiskLevel;
  status: string;
  created_at?: string;
}

export interface ApprovalRequest {
  id: string;
  incident_id?: string;
  incident_code?: string;
  action_key: string;
  title: string;
  description?: string;
  risk: RiskLevel;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  ai_recommendation?: string;
  decision_reason?: string;
  created_at?: string;
  decided_at?: string;
}

export interface IncidentDetail {
  incident: Incident;
  timeline: TimelineEntry[];
  actions: AgentAction[];
  customer?: Customer | null;
  payment?: Payment | null;
  booking?: Booking | null;
  investigation: {
    running: boolean;
    agentState: string;
    status: IncidentStatus;
  };
  allowedActions: Array<{ key: string; label: string; risk: RiskLevel }>;
}

export interface KpiStats {
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
  incidents: Incident[];
}

export interface ActivityRow extends AgentAction {
  incident_code?: string;
}

export interface LiveEvent {
  type: string;
  incidentId?: string;
  data?: unknown;
}