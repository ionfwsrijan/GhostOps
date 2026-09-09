import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle2, Zap, Clock, Siren, ArrowRight } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { KpiStats, Incident } from '@/api/types';
import { Card, StatCard, StatusPill, SeverityTag, ConfidenceBar, Section, EmptyState, GhostLoader } from '@/components/ui';
import { SimulateButton } from '@/components/Simulator';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function Overview() {
  const [stats, setStats] = useState<KpiStats | null>(null);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const s = await get<KpiStats>(endpoints.stats());
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useLiveEvents({
    onEvent: (evt) => {
      if (['incident_detected', 'incident_status', 'incident_update', 'incident_resolved', 'timeline_event'].includes(evt.type)) {
        void refresh();
      }
    },
  });

  const active = useMemo(() => (stats?.incidents ?? []).filter((i) => i.status !== 'resolved' && i.status !== 'failed'), [stats]);

  return (
    <div className="space-y-6">
      <Header actions={() => <SimulateButton onTriggered={refresh} />} />
      {error ? <div className="text-danger text-sm">Failed to load: {error}</div> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Incidents" value={stats?.activeIncidents ?? '—'} icon={<Siren className="w-5 h-5" />} accent="text-orange-400" sub="needing attention" />
        <StatCard label="Resolved Today" value={stats?.resolvedToday ?? '—'} icon={<CheckCircle2 className="w-5 h-5" />} accent="text-success" sub={`${stats?.resolvedIncidents ?? 0} total resolved`} />
        <StatCard label="Avg Resolution Time" value={stats ? fmtMin(stats.avgResolutionMinutes) : '—'} icon={<Clock className="w-5 h-5" />} accent="text-ghost" sub="across resolved incidents" />
        <StatCard label="Automated Resolution" value={stats ? `${stats.automationRate}%` : '—'} icon={<Zap className="w-5 h-5" />} accent="text-accent-light" sub={`${stats?.autoResolvedCount ?? 0} handled without humans`} />
      </div>

      <Section
        title="Live Incidents"
        subtitle="GhostOps takes ownership of every incident from detection to resolution"
        action={<Link to="/incidents" className="text-xs text-ghost hover:text-ghost-glow inline-flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></Link>}
      >
        <Card className="overflow-hidden">
          {!stats ? (
            <div className="p-8"><GhostLoader label="Loading live events…" /></div>
          ) : active.length === 0 ? (
            <EmptyState title="No active incidents" hint="Run a simulation to watch GhostOps resolve one live." />
          ) : (
            <IncidentRows incidents={active} />
          )}
        </Card>
      </Section>
    </div>
  );
}

function Header({ actions }: { actions: () => React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-[11px] text-ghost tracking-wide uppercase">
          <Activity className="w-3.5 h-3.5" /> Autonomous operations
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
          GhostOps <span className="text-ghost">Command Center</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Detect → Understand → Investigate → Plan → Act → Verify → Resolve</p>
      </div>
      {actions()}
    </div>
  );
}

function IncidentRows({ incidents }: { incidents: Incident[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
          <th className="px-4 py-3 font-medium">Incident</th>
          <th className="px-4 py-3 font-medium">Severity</th>
          <th className="px-4 py-3 font-medium">Status</th>
          <th className="px-4 py-3 font-medium">AI Confidence</th>
          <th className="px-4 py-3 font-medium hidden lg:table-cell">Agent action</th>
          <th className="px-4 py-3 font-medium hidden md:table-cell">Elapsed</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((i) => (
          <tr key={i.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
            <td className="px-4 py-3">
              <Link to={`/incidents/${i.id}`} className="group">
                <div className="font-semibold mono text-[13px] text-slate-200 group-hover:text-ghost">{i.incident_code}</div>
                <div className="text-xs text-slate-500 mt-0.5 max-w-[300px] truncate">{i.title}</div>
              </Link>
            </td>
            <td className="px-4 py-3"><SeverityTag severity={i.severity} /></td>
            <td className="px-4 py-3"><StatusPill status={i.status} /></td>
            <td className="px-4 py-3 w-40"><ConfidenceBar value={i.ai_confidence ?? i.root_cause_confidence} /></td>
            <td className="px-4 py-3 hidden lg:table-cell">
              <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                <span className={cn('w-1.5 h-1.5 rounded-full', i.status === 'investigating' ? 'bg-ghost animate-pulse' : 'bg-slate-600')} />
                {agentActionLabel(i)}
              </span>
            </td>
            <td className="px-4 py-3 mono text-xs text-slate-500 hidden md:table-cell">{timeAgo(i.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function agentActionLabel(i: Incident): string {
  const st = i.metadata?.agentState as string | undefined;
  const map: Record<string, string> = {
    classifying: 'Classifying issue',
    investigating: 'Investigating',
    analyzing: 'Analyzing root cause',
    planning: 'Building remediation plan',
    acting: 'Executing remediation',
    verifying: 'Verifying resolution',
    waiting_approval: 'Awaiting human approval',
    resolved: 'Monitoring',
  };
  return map[st ?? ''] ?? (i.status === 'resolved' ? 'Monitoring' : 'Idle');
}

function fmtMin(mins: number): string {
  if (!mins || mins <= 0) return '—';
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}