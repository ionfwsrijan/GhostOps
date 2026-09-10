import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, ScrollText } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { AuditEntry, AuditPage } from '@/api/types';
import { Card, Section, EmptyState, ErrorBanner, GhostLoader } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await get<AuditPage>(endpoints.audit(), { limit: 200 });
      setRows(r.rows);
      setTotal(r.total);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter(
      (r) =>
        r.action?.toLowerCase().includes(needle) ||
        r.actorEmail?.toLowerCase().includes(needle) ||
        r.actorType?.toLowerCase().includes(needle) ||
        r.targetType?.toLowerCase().includes(needle) ||
        r.targetId?.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">An append-only trail of every action across the control plane</p>
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <ScrollText className="w-3.5 h-3.5 text-ghost" /> {total} entries
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative w-80 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by action, actor, target…"
            className="w-full bg-base-800/80 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
          />
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-ghost/40 disabled:opacity-50"
          disabled={refreshing}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

      <ErrorBanner message={error} />

      <Section title="Append-only trail" subtitle="Written by the agent, webhook pump, auth and every operator decision">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-10"><GhostLoader label="Reading audit trail…" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState title={q ? `No entries match "${q}"` : 'No audit entries yet'} hint="Actions like auth.login, webhook.accepted and approval.decided will appear here." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Payload</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 mono text-xs text-slate-500 whitespace-nowrap">{timeAgo(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-300">{r.actorEmail ?? r.actorType}</div>
                      <div className="mono text-[10px] text-slate-600">{r.actorType}</div>
                    </td>
                    <td className="px-4 py-3"><span className="mono text-xs text-ghost/90">{r.action}</span></td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-400">{r.targetType ?? '—'}</div>
                      {r.targetId ? <div className="mono text-[10px] text-slate-600 truncate max-w-[180px]">{r.targetId}</div> : null}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <Payload preview={r.after ?? r.metadata ?? null} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>
    </div>
  );
}

function Payload({ preview }: { preview: Record<string, unknown> | null }) {
  if (!preview || Object.keys(preview).length === 0) return <span className="text-[10px] text-slate-600">—</span>;
  try {
    const s = JSON.stringify(preview);
    return <span className="mono text-[10px] text-slate-500">{s.length > 120 ? `${s.slice(0, 117)}…` : s}</span>;
  } catch {
    return <span className="text-[10px] text-slate-600">—</span>;
  }
}