/*
 * Row types mirror the Postgres schema AS RETURNED BY THE REPOSITORIES
 * (SELECT aliases map snake_case columns to camelCase). Services and the
 * agent engine consume these camelCase shapes.
 */

export type IncidentStatus =
  | 'detected'
  | 'investigating'
  | 'action_required'
  | 'awaiting_approval'
  | 'resolving'
  | 'resolved'
  | 'failed'
  | 'cancelled';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RiskLevel = 'low' | 'medium' | 'high';
export type UserRole = 'admin' | 'operator' | 'readonly';
export type JobKind = 'agent_run' | 'agent_resume' | 'outbox_delivery' | 'approval_expiry' | 'reconcile_incident';
export type IntegrationProvider = 'slack' | 'jira' | 'email' | 'n8n';
export type AgentRunState = 'queued' | 'claimed' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  keyHash: string;
  scope: string[];
  ownerUserId?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface CustomerRow {
  id: string;
  customerCode: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  loyaltyTier?: string | null;
  createdAt: string;
}

export interface PaymentRow {
  id: string;
  transactionId: string;
  customerId?: string | null;
  amount: number | string;
  currency: string;
  status: string;
  paymentMethod?: string | null;
  gateway?: string | null;
  paidAt?: string | null;
  providerPayload: Record<string, unknown>;
  createdAt: string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded';

export interface BookingRow {
  id: string;
  bookingCode: string;
  customerId?: string | null;
  paymentId?: string | null;
  transactionId?: string | null;
  movieTitle: string;
  cinema?: string | null;
  city?: string | null;
  showTime?: string | null;
  seats: unknown[];
  amount?: number | string | null;
  status: BookingStatus;
  createdAt: string;
}

export interface BookingRecordRow {
  id: string;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  transactionId?: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface IncidentRow {
  id: string;
  incidentCode: string;
  title: string;
  issue: string;
  description?: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  customerId?: string | null;
  transactionId?: string | null;
  affectedService?: string | null;
  channel: string;
  source: string;
  aiConfidence?: number | null;
  rootCause?: string | null;
  rootCauseConfidence?: number | null;
  evidence: Record<string, unknown>;
  resolutionSummary?: string | null;
  autoResolved: boolean;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentEventRow {
  id: string;
  incidentId: string;
  seq: string | number;
  step: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'ai' | 'action' | 'system';
  title: string;
  description?: string | null;
  metadata: Record<string, unknown>;
  actorType: string;
  actorId?: string | null;
  runId?: string | null;
  createdAt: string;
}

export interface AgentRunRow {
  id: string;
  incidentId: string;
  correlationId: string;
  state: AgentRunState;
  attempt: number;
  maxAttempts: number;
  statusSnapshot: Record<string, unknown>;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  createdAt: string;
}

export interface ApprovalRow {
  id: string;
  incidentId: string;
  runId?: string | null;
  actionKey: string;
  title: string;
  description?: string | null;
  risk: RiskLevel;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  aiRecommendation?: string | null;
  requestedAt: string;
  expiresAt: string;
  decidedByUserId?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
}

export type ActionStatus = 'pending' | 'executed' | 'failed' | 'skipped' | 'pending_approval';

export interface ActionRow {
  id: string;
  incidentId: string;
  runId?: string | null;
  planIndex: number;
  actionKey: string;
  label: string;
  tool: string;
  risk: RiskLevel;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  status: ActionStatus;
  result?: string | null;
  executedAt?: string | null;
  createdAt: string;
}

export interface JobRow {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'done' | 'failed' | 'cancelled';
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  closedAt?: string | null;
  instanceId?: string | null;
  lockedAt?: string | null;
  createdAt: string;
}

export interface OutboxRow {
  id: string;
  integration: IntegrationProvider;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed' | 'skipped';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  providerRef?: string | null;
  lastError?: string | null;
  incidentId?: string | null;
  createdAt: string;
  deliveredAt?: string | null;
}

export interface IntegrationRow {
  id: string;
  provider: IntegrationProvider;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  status: 'unknown' | 'healthy' | 'unhealthy' | 'not_configured';
  lastHealthCheckAt?: string | null;
  lastHealthError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRow {
  id: string;
  requestId?: string | null;
  actorType: 'user' | 'api' | 'system';
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface IncidentCreateInput {
  title: string;
  issue: string;
  description?: string;
  severity?: IncidentSeverity;
  customer_id?: string;
  transaction_id?: string;
  affected_service?: string;
  channel?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/** Snake-keyed patch accepted by incidentRepo.updateIncident (DB columns). */
export interface IncidentPatch {
  title?: string;
  issue?: string;
  description?: string | null;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  customer_id?: string | null;
  transaction_id?: string | null;
  affected_service?: string | null;
  ai_confidence?: number | null;
  root_cause?: string | null;
  root_cause_confidence?: number | null;
  evidence?: Record<string, unknown>;
  resolution_summary?: string | null;
  auto_resolved?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EventAddInput {
  incident_id: string;
  step: string;
  type: IncidentEventRow['type'];
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actor_type?: string;
  actor_id?: string;
  run_id?: string;
}