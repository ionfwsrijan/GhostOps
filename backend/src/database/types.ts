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

export type ActionStatus = 'executed' | 'failed' | 'skipped' | 'pending_approval';

export interface Customer {
  id: string;
  customer_code: string;
  name: string;
  email?: string;
  phone?: string;
  city?: string;
  loyalty_tier?: string;
  created_at?: string;
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
  created_at?: string;
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
  created_at?: string;
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

export type TimelineStepType = 'info' | 'success' | 'error' | 'warning' | 'ai' | 'action' | 'system';

export interface TimelineEntry {
  id: string;
  incident_id: string;
  step: string;
  type: TimelineStepType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentAction {
  id: string;
  incident_id: string;
  tool: string;
  action: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  result: string;
  risk: RiskLevel;
  status: ActionStatus;
  created_at?: string;
}

export interface SystemLog {
  id: string;
  incident_id?: string;
  service: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface Ticket {
  id: string;
  ticket_code: string;
  incident_id?: string;
  integration?: string;
  title: string;
  status: string;
  priority?: string;
  url?: string;
  created_at?: string;
}

export interface Notification {
  id: string;
  incident_id?: string;
  channel: string;
  recipient?: string;
  subject?: string;
  message?: string;
  status?: string;
  created_at?: string;
}

export interface ApprovalRequest {
  id: string;
  incident_id?: string;
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

export interface IncidentCreateInput {
  title: string;
  issue: string;
  description?: string;
  severity?: IncidentSeverity;
  customer_code?: string;
  transaction_id?: string;
  affected_service?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineAddInput {
  incident_id: string;
  step: string;
  type: TimelineStepType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}