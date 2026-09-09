import React, { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { STATUS_LABELS, STATUS_COLORS, SEVERITY_COLORS, RISK_COLORS, pct } from '@/lib/format';
import type { IncidentStatus, IncidentSeverity, RiskLevel } from '@/api/types';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass rounded-xl', className)} {...props}>
      {children}
    </div>
  );
}

export function Section({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 tracking-wide">{title}</h2>
          {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatusPill({ status }: { status: IncidentStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border', STATUS_COLORS[status] ?? 'text-slate-400 bg-white/5 border-white/10')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', status === 'resolved' ? 'bg-success' : status === 'failed' ? 'bg-danger' : 'bg-current animate-pulse')} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function SeverityTag({ severity }: { severity: IncidentSeverity }) {
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide border', SEVERITY_COLORS[severity] ?? '')}>{severity}</span>;
}

export function RiskTag({ risk }: { risk: RiskLevel }) {
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide border', RISK_COLORS[risk] ?? '')}>{risk}</span>;
}

export function ConfidenceBar({ value, className, showLabel = true }: { value?: number; className?: string; showLabel?: boolean }) {
  const v = value ?? 0;
  const ok = v >= 0.8;
  const mid = v >= 0.6 && v < 0.8;
  const color = ok ? 'bg-success' : mid ? 'bg-warn' : 'bg-danger';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 flex-1 rounded-full bg-base-700 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.min(100, v * 100)}%` }} />
      </div>
      {showLabel ? <span className="mono text-xs text-slate-300 tabular-nums">{pct(v)}</span> : null}
    </div>
  );
}

export function StatCard({ label, value, sub, icon, accent = 'text-slate-200', delay }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: string; delay?: number }) {
  return (
    <Card className="p-4 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <div className="label">{label}</div>
          <div className={cn('mt-2 text-2xl font-bold tracking-tight tabular-nums', accent)}>{value}</div>
          {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
        </div>
        {icon ? <div className="text-slate-600">{icon}</div> : null}
      </div>
      {delay != null ? (
        <div className="absolute bottom-0 left-0 right-0 h-px overflow-hidden">
          <div className="h-full bg-gradient-to-r from-transparent via-ghost/60 to-transparent" style={{ animation: 'shimmer 3s linear infinite' }} />
        </div>
      ) : null}
    </Card>
  );
}

export function GhostLoader({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-400">
      <div className="relative w-6 h-6">
        <div className="absolute inset-0 rounded-full border border-ghost/40 animate-spin" style={{ borderTopColor: 'transparent' }} />
        <div className="absolute inset-[6px] rounded-full bg-ghost/80 animate-pulse" />
      </div>
      {label ?? 'GhostOps is working…'}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-xl border border-white/10 bg-white/[0.02] flex items-center justify-center text-slate-600 text-xl">∅</div>
      <div className="text-sm text-slate-400">{title}</div>
      {hint ? <div className="text-xs text-slate-600 mt-1">{hint}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <div className={cn('w-4 h-4 rounded-full border-2 border-ghost/30 border-t-ghost animate-spin', className)} />;
}

export function Button({ variant = 'default', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'default' | 'danger' | 'ghost' | 'success' }) {
  const styles: Record<string, string> = {
    primary: 'bg-ghost/90 hover:bg-ghost text-base-950 font-semibold',
    default: 'bg-base-800 hover:bg-base-700 text-slate-200 border border-white/10',
    danger: 'bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30',
    success: 'bg-success/15 hover:bg-success/25 text-success border border-success/30',
    ghost: 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
  };
  return <button className={cn('inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed', styles[variant], className)} {...props} />;
}

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{message}</div>;
}

export function Tabs({ items, active, onChange }: { items: Array<{ key: string; label: string }>; active: string; onChange: (k: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-base-900 p-1">
      {items.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', active === t.key ? 'bg-ghost/15 text-ghost' : 'text-slate-400 hover:text-slate-200')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}