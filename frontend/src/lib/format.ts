import { IncidentStatus, IncidentSeverity, RiskLevel } from '@/api/types';

export function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clockTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fullTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m ${Math.round((minutes % 1) * 60)}s`.replace('0s', '').trim() || `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export function rupees(n?: number | null): string {
  if (n == null) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

export function pct(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  detected: 'Detected',
  investigating: 'Investigating',
  action_required: 'Action Required',
  awaiting_approval: 'Awaiting Approval',
  resolving: 'Resolving',
  resolved: 'Resolved',
  failed: 'Failed',
};

export const STATUS_COLORS: Record<IncidentStatus, string> = {
  detected: 'bg-ghost/15 text-ghost border-ghost/30',
  investigating: 'bg-accent/15 text-accent-light border-accent/30',
  action_required: 'bg-warn/15 text-warn border-warn/30',
  awaiting_approval: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  resolving: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  resolved: 'bg-success/15 text-success border-success/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
};

export const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  critical: 'text-danger bg-danger/10 border-danger/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium: 'text-warn bg-warn/10 border-warn/30',
  low: 'text-ghost bg-ghost/10 border-ghost/30',
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: 'text-success bg-success/10 border-success/20',
  medium: 'text-warn bg-warn/10 border-warn/20',
  high: 'text-danger bg-danger/10 border-danger/20',
};

export function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}