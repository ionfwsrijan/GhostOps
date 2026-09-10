import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  TrendingUp,
  Zap,
  Activity,
  ArrowRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart as RePie,
  Pie,
  Cell,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import { get, endpoints } from '@/api/client';
import { KpiStats, IncidentPage } from '@/api/types';
import { Card, StatCard, Section, EmptyState, ErrorBanner, GhostLoader } from '@/components/ui';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo } from '@/lib/format';

const SEV_COLORS: Record<string, string> = {
  critical: '#f43f5e',
  high: '#f97316',
  medium: '#eab308',
  low: '#22d3ee',
};

export default function Analytics() {
  const [stats, setStats] = useState<KpiStats | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<IncidentPage['rows']>([]);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const [s, page] = await Promise.all([
        get<KpiStats>(endpoints.stats()),
        get<IncidentPage>(endpoints.incidents(), { limit: 50 }),
      ]);
      setStats(s);
      setRecentIncidents(page.rows);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useLiveEvents({ onEvent: (evt) => ['incident_detected', 'incident_status', 'incident_resolved'].includes(evt.type) && void refresh() });

  const severityData = useMemo(() => Object.entries(stats?.bySeverity ?? {}).map(([name, count]) => ({ name, count })), [stats]);
  const rootCauseData = useMemo(() => (stats?.byRootCause ?? []).map((r) => ({ name: r.name.replace(/_/g, ' '), count: r.count })).sort((a, b) => b.count - a.count), [stats]);
  const typeData = useMemo(() => (stats?.byType ?? []).map((t) => ({ name: t.name.replace(/_/g, ' '), count: t.count })).sort((a, b) => b.count - a.count), [stats]);
  const trendData = useMemo(
    () =>
      recentIncidents
        .slice()
        .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
        .map((i) => ({
          name: timeAgo(i.createdAt),
          detected: 1,
        })),
    [recentIncidents]
  );

  const pieTotals = severityData.reduce((a, b) => a + b.count, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">How effectively GhostOps automates operations</p>
      </div>

      <ErrorBanner message={error} />

      {!stats ? (
        <div className="p-10"><GhostLoader label="Crunching telemetry…" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Incidents" value={stats.totalIncidents} icon={<Activity className="w-5 h-5" />} accent="text-slate-200" sub={`${stats.activeIncidents} active`} />
            <StatCard label="Automation Rate" value={`${stats.automationRate}%`} icon={<Zap className="w-5 h-5" />} accent="text-ghost" sub={`${stats.autoResolvedCount} auto-resolved`} />
            <StatCard label="Escalated to Humans" value={stats.escalatedCount} icon={<TrendingUp className="w-5 h-5" />} accent="text-warn" sub="for approval or review" />
            <StatCard label="Resolved" value={stats.resolvedIncidents} icon={<BarChart3 className="w-5 h-5" />} accent="text-success" sub={`${stats.resolvedToday} today`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Section title="Incidents by Severity" subtitle="Distribution across the blast-radius scale">
              <Card className="p-5 h-[280px]">
                {severityData.length === 0 ? (
                  <EmptyState title="No data yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RePie>
                      <Pie data={severityData} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                        {severityData.map((s) => (
                          <Cell key={s.name} fill={SEV_COLORS[s.name] ?? '#475569'} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                        formatter={(value: number, name: string) => [`${value}`, name.toLocaleUpperCase()]}
                      />
                    </RePie>
                  </ResponsiveContainer>
                )}
                <div className="absolute bottom-4 right-5 text-xs text-slate-500 mono">{pieTotals} total</div>
              </Card>
            </Section>

            <Section title="Root Cause Frequency" subtitle="The failure signatures GhostOps keeps finding">
              <Card className="p-5 h-[280px]">
                {rootCauseData.length === 0 ? (
                  <EmptyState title="No data yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rootCauseData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                        cursor={{ fill: 'rgba(34,211,238,0.05)' }}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
                        {rootCauseData.map((_, idx) => (
                          <Cell key={idx} fill={idx === 0 ? '#22d3ee' : '#164e63'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </Section>

            <Section title="Incident Types" subtitle="What kinds of issues hit the pipeline">
              <Card className="p-5 h-[280px]">
                {typeData.length === 0 ? (
                  <EmptyState title="No data yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typeData} margin={{ top: 8, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'rgba(34,211,238,0.05)' }} />
                      <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} barSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </Section>

            <Section title="Incident Volume Over Time" subtitle="Detection cadence across the session">
              <Card className="p-5 h-[280px]">
                {trendData.length === 0 ? (
                  <EmptyState title="No data yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, left: 8 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" hide />
                      <YAxis allowDecimals={false} tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="detected" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3, fill: '#22d3ee' }} name="Detected" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </Section>
          </div>

          <Section title="Recent Incidents" action={<Link to="/incidents" className="text-xs text-ghost hover:text-ghost-glow inline-flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></Link>}>
            <Card className="divide-y divide-white/[0.05]">
              {recentIncidents.slice(0, 5).map((i) => (
                <Link key={i.id} to={`/incidents/${i.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                  <div className="min-w-0">
                    <span className="mono text-[13px] font-semibold text-slate-200 group-hover:text-ghost">{i.incidentCode}</span>
                    <span className="text-sm text-slate-500 ml-3 truncate">{i.title}</span>
                  </div>
                  <span className="mono text-[10px] text-slate-600 shrink-0">{timeAgo(i.createdAt)}</span>
                </Link>
              ))}
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}