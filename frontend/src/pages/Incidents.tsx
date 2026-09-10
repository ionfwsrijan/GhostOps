import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, X, Sparkles } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { Incident, IncidentPage } from '@/api/types';
import { Card, StatusPill, SeverityTag, ConfidenceBar, EmptyState, ErrorBanner, Tabs, GhostLoader } from '@/components/ui';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo, truncate } from '@/lib/format';
import { cn } from '@/lib/cn';

type FilterKey = 'all' | 'active' | 'resolved' | 'failed';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'failed', label: 'Failed' },
];

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';

  const refresh = async () => {
    try {
      const res = await get<IncidentPage>(endpoints.incidents(), { limit: 200 });
      setIncidents(res.rows);
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
      if (['incident_detected', 'incident_status', 'incident_update', 'incident_resolved', 'timeline_event'].includes(evt.type)) void refresh();
    },
  });

  const rows = useMemo(() => {
    let list = incidents;
    if (filter === 'active') list = list.filter((i) => i.status !== 'resolved' && i.status !== 'failed' && i.status !== 'cancelled');
    if (filter === 'resolved') list = list.filter((i) => i.status === 'resolved');
    if (filter === 'failed') list = list.filter((i) => i.status === 'failed');
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(
        (i) =>
          i.incidentCode?.toLowerCase().includes(needle) ||
          i.title?.toLowerCase().includes(needle) ||
          i.issue?.toLowerCase().includes(needle) ||
          i.rootCause?.toLowerCase().includes(needle)
      );
    }
    return [...list].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  }, [incidents, filter, q]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Incidents</h1>
          <p className="text-sm text-slate-500 mt-1">Every issue GhostOps detects and owns from detection to resolution</p>
        </div>
        <Link
          to="/ingest"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          <Sparkles className="w-4 h-4" /> Create incident
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={(k) => setFilter(k as FilterKey)} />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={q}
            onChange={(e) => {
              const v = e.target.value;
              setParams(v ? { q: v } : {});
            }}
            placeholder="Search by code, title, root cause…"
            className="w-80 bg-base-800/80 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
          />
          {q ? (
            <button onClick={() => setParams({})} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-10"><GhostLoader label="Syncing incidents…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title={q ? `No incidents match "${q}"` : 'No incidents yet'} hint={q ? undefined : 'Send a signal from the Ingest console to generate a live incident.'} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Root Cause</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Detected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group">
                  <td className="px-4 py-3">
                    <Link to={`/incidents/${i.id}`} className="mono text-[13px] font-semibold text-slate-200 group-hover:text-ghost">{i.incidentCode}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/incidents/${i.id}`} className="block max-w-[340px] truncate text-slate-300 hover:text-white">{i.title}</Link>
                    <div className="text-[11px] text-slate-600 mt-0.5 max-w-[340px] truncate">{truncate(i.issue ?? '', 70)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs mono', i.rootCause ? 'text-ghost/90' : 'text-slate-600')}>{i.rootCause ?? 'unidentified'}</span>
                  </td>
                  <td className="px-4 py-3"><SeverityTag severity={i.severity} /></td>
                  <td className="px-4 py-3"><StatusPill status={i.status} /></td>
                  <td className="px-4 py-3 w-36"><ConfidenceBar value={i.rootCauseConfidence ?? i.aiConfidence ?? undefined} /></td>
                  <td className="px-4 py-3 mono text-xs text-slate-500 hidden md:table-cell">{timeAgo(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}