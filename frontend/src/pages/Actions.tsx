import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, ShieldCheck } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { AgentAction } from '@/api/types';
import { Card, RiskTag, EmptyState, ErrorBanner, GhostLoader, Section } from '@/components/ui';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

function resultOf(a: AgentAction): string {
  if (a.result) return a.result;
  if (a.status === 'executed') return 'success';
  if (a.status === 'pending_approval') return 'pending_approval';
  return a.status;
}

export default function Actions() {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const r = await get<{ actions: AgentAction[] }>(endpoints.actions());
      setActions(r.actions.sort((x, y) => new Date(y.createdAt ?? 0).getTime() - new Date(x.createdAt ?? 0).getTime()));
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

  useLiveEvents({ onEvent: (evt) => ['action_executed'].includes(evt.type) && void refresh() });

  const harmMap: Record<string, string> = {
    low: 'Reversible · no external impact',
    medium: 'Reversible · visible to customer',
    high: 'Customer-facing or financial impact',
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Actions</h1>
        <p className="text-sm text-slate-500 mt-1">Every remediation GhostOps executed — gated by the risk engine</p>
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Section title="Execution Log" subtitle="Auto-executed or human-approved remediation steps">
            <Card className="overflow-hidden">
              {loading ? (
                <div className="p-10"><GhostLoader label="Loading action log…" /></div>
              ) : actions.length === 0 ? (
                <EmptyState title="No actions executed yet" hint="Create an incident to see GhostOps act." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Incident</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Risk gate</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a) => (
                      <tr key={a.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 mono text-xs text-slate-500 whitespace-nowrap">{timeAgo(a.createdAt)}</td>
                        <td className="px-4 py-3">
                          <Link to={`/incidents/${a.incidentId}`} className="mono text-[13px] font-semibold text-slate-200 hover:text-ghost">{a.incidentCode ?? a.incidentId.slice(0, 8)}</Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-7 h-7 rounded-md border flex items-center justify-center shrink-0', a.status === 'pending_approval' ? 'border-warn/30 bg-warn/10 text-warn' : 'border-success/30 bg-success/10 text-success')}>
                              {a.status === 'pending_approval' ? <ShieldCheck className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[13px] text-slate-200 font-medium truncate">{a.label || a.tool}</div>
                              <div className="mono text-[10px] text-slate-600 truncate">{a.actionKey}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <RiskTag risk={a.risk} />
                            <div className="text-[10px] text-slate-600 max-w-[180px]">{harmMap[a.risk]}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('mono text-xs', resultOf(a) === 'success' ? 'text-success' : resultOf(a) === 'pending_approval' ? 'text-warn' : 'text-danger')}>{resultOf(a)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>
        </div>

        <RiskGuide />
      </div>
    </div>
  );
}

function RiskGuide() {
  const guides = [
    { risk: 'low' as const, color: 'text-success', bullets: ['Verify payment status', 'Check booking existence', 'Search logs', 'Notify via Slack/email'] },
    { risk: 'medium' as const, color: 'text-warn', bullets: ['Retry a failed booking', 'Update booking status', 'Create Jira ticket'] },
    { risk: 'high' as const, color: 'text-danger', bullets: ['Refund a customer', 'Cancel a booking', 'Destructive / config changes'] },
  ];
  return (
    <Section title="Risk Engine" subtitle="How GhostOps decides auto-execute vs. human approval">
      <Card className="p-4 space-y-4">
        <div className="text-xs text-slate-500 leading-relaxed">
          The risk engine gates every action. Low-risk diagnostics <span className="text-ghost">auto-execute</span>. Medium-risk remediation is attempted
          automatically. High-risk financial or destructive operations always route to a human for approval via <span className="mono">Approvals</span>.
        </div>
        {guides.map((g) => (
          <div key={g.risk} className="rounded-lg border border-white/[0.06] bg-base-950/50 p-3">
            <div className={cn('text-xs font-bold uppercase tracking-wide', g.color)}>{g.risk} — {g.risk === 'low' ? 'auto-execute' : g.risk === 'medium' ? 'auto + retry' : 'human approval'}</div>
            <ul className="mt-2 space-y-1">
              {g.bullets.map((b) => (
                <li key={b} className="text-[11px] text-slate-400">{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </Section>
  );
}