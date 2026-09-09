import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Cpu, Zap, Activity as ActivityIcon } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { ActivityRow } from '@/api/types';
import { Card, StatCard, RiskTag, EmptyState, ErrorBanner, GhostLoader } from '@/components/ui';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function AgentActivity() {
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [status, setStatus] = useState<{ status: string; tools: string[]; uptime: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const [a, s] = await Promise.all([get<{ activity: ActivityRow[] }>(endpoints.activity()), get<typeof status>(endpoints.agentStatus())]);
      setActivity(a.activity.sort((x, y) => new Date(y.created_at ?? 0).getTime() - new Date(x.created_at ?? 0).getTime()));
      setStatus(s);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useLiveEvents({
    onEvent: (evt) => {
      if (['tool_completed', 'action_executed', 'incident_detected'].includes(evt.type)) void refresh();
    },
  });

  const autoCount = activity.filter((a) => a.result === 'success' || a.result === 'executed').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Agent Activity</h1>
        <p className="text-sm text-slate-500 mt-1">Every tool call GhostOps made across all incidents</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Agent State" value={status?.status ?? '—'} icon={<Bot className="w-5 h-5" />} accent="text-ghost" sub="live process status" />
        <StatCard label="Tools Available" value={status?.tools.length ?? '—'} icon={<Cpu className="w-5 h-5" />} accent="text-accent-light" sub="integrated capabilities" />
        <StatCard label="Actions Executed" value={autoCount} icon={<Zap className="w-5 h-5" />} accent="text-success" sub="across session" />
        <StatCard label="Uptime" value={status ? `${Math.round((status.uptime ?? 0) / 60)}m` : '—'} icon={<ActivityIcon className="w-5 h-5" />} accent="text-ghost" sub="agent process running" />
      </div>

      <ErrorBanner message={error} />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10"><GhostLoader label="Reading agent telemetry…" /></div>
        ) : activity.length === 0 ? (
          <EmptyState title="No agent activity yet" hint="Run a simulation to watch GhostOps work." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Incident</th>
                <th className="px-4 py-3 font-medium">Tool</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Result</th>
                <th className="px-4 py-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 mono text-xs text-slate-500 whitespace-nowrap">{timeAgo(a.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/incidents/${a.incident_id}`} className="mono text-[13px] font-semibold text-slate-200 hover:text-ghost">
                      {a.incident_code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                      <span className={cn('w-1.5 h-1.5 rounded-full', a.result === 'success' ? 'bg-success' : a.result === 'pending_approval' ? 'bg-warn' : 'bg-danger')} />
                      {a.tool}
                    </span>
                  </td>
                  <td className="px-4 py-3"><span className="mono text-xs text-slate-500">{a.action}</span></td>
                  <td className="px-4 py-3"><span className={cn('mono text-xs', a.result === 'success' ? 'text-success' : a.result === 'pending_approval' ? 'text-warn' : 'text-danger')}>{a.result}</span></td>
                  <td className="px-4 py-3"><RiskTag risk={a.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}