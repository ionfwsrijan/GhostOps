// GhostOps shared data types (mirror of backend/src/db/types.ts — camelCase as
// returned by the /api/v1 repositories).

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

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Incident {
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

export interface IncidentPage {
  rows: Incident[];
  total: number;
  limit: number;
  offset: number;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  seq: number | string;
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

/** UI shape consumed by ForwardTimeline (created_at snake_case kept for compat). */
export interface TimelineEntry {
  id: string;
  step: string;
  type: IncidentEvent['type'];
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentAction {
  id: string;
  incidentId: string;
  incidentCode?: string | null;
  runId?: string | null;
  planIndex: number;
  actionKey: string;
  label: string;
  tool: string;
  risk: RiskLevel;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  status: 'pending' | 'executed' | 'failed' | 'skipped' | 'pending_approval';
  result?: string | null;
  executedAt?: string | null;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  incidentId: string;
  incidentCode?: string | null;
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

export interface AgentRun {
  id: string;
  incidentId: string;
  correlationId: string;
  state: 'queued' | 'claimed' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  attempt: number;
  maxAttempts: number;
  statusSnapshot: Record<string, unknown>;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  createdAt: string;
}

/** GET /incidents/:id (incidentService.withFacts). */
export interface IncidentFacts {
  incident: Incident;
  events: IncidentEvent[];
  actions: AgentAction[];
  approvals: ApprovalRequest[];
  runs: AgentRun[];
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
  byRootCause: { name: string; count: number }[];
  byType: { name: string; count: number }[];
}

export interface ActionDefinition {
  key: string;
  label: string;
  description: string;
  impact: string;
  risk: RiskLevel;
  autoExecuteThreshold: number;
  idempotent: boolean;
}

export interface AgentStatus {
  status: string;
  instance: string;
  uptimeSeconds: number;
  tools: string[];
  queue: { pending: number; failed: number };
}

export interface AuditEntry {
  id: string;
  requestId?: string | null;
  actorType: string;
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

export interface AuditPage {
  rows: AuditEntry[];
  total: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: string[];
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface Meta {
  env: string;
  workerInstance: string;
  queue: { pending: number; failed: number };
  integrations: Array<{ provider: string; enabled: boolean; status: string }>;
  timestamp: string;
}

export interface Health {
  status: string;
  uptimeSeconds: number;
  timestamp: string;
  dependencies: { postgres: string };
}

export interface LiveEvent {
  type: string;
  incidentId?: string;
  data?: unknown;
}