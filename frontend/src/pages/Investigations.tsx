import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, ArrowRight } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { Incident } from '@/api/types';
import { Card, StatusPill, SeverityTag, ConfidenceBar, EmptyState, ErrorBanner, Tabs, GhostLoader } from '@/components/ui';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo } from '@/lib/format';

type Phase = 'all' | 'in_progress' | 'root_cause_found';

const PHASES: Array<{ key: Phase; label: string }> = [
  { key: 'all', label: 'All investigations' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'root_cause_found', label: 'Root cause found' },
];

export default function Investigations() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [phase, setPhase] = useState<Phase>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const r = await get<{ incidents: Incident[] }>(endpoints.incidents());
      setIncidents(r.incidents);
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

  useLiveEvents({ onEvent: (evt) => ['incident_detected', 'incident_status', 'incident_update'].includes(evt.type) && void refresh() });

  const rows = useMemo(() => {
    let list = incidents.filter((i) => i.metadata?.agentState || i.root_cause || ['investigating', 'analyzing'].includes(i.status as string));
    if (phase === 'in_progress') list = list.filter((i) => !i.root_cause && i.status !== 'resolved');
    if (phase === 'root_cause_found') list = list.filter((i) => i.root_cause);
    return [...list].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  }, [incidents, phase]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Investigations</h1>
        <p className="text-sm text-slate-500 mt-1">The <span className="text-ghost mono">DETECT → UNDERSTAND → ROOT-CAUSE</span> pipeline for every incident</p>
      </div>

      <Tabs items={PHASES.map((p) => ({ key: p.key, label: p.label }))} active={phase} onChange={(k) => setPhase(k as Phase)} />
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          <div className="lg:col-span-2 p-10"><GhostLoader label="Loading investigations…" /></div>
        ) : rows.length === 0 ? (
          <div className="lg:col-span-2"><EmptyState title="No investigations to show" hint="Detect a new incident to start one." /></div>
        ) : (
          rows.map((i) => (
            <InvestigationCard key={i.id} incident={i} />
          ))
        )}
      </div>
    </div>
  );
}

function InvestigationCard({ incident }: { incident: Incident }) {
  const phaseLabel =
    incident.root_cause
      ? 'Root cause established'
      : (!incident.status || incident.status === 'detected')
        ? 'Classifying issue'
        : (incident.metadata?.agentState as string) ?? 'Investigating';

  const phaseStep =
    incident.root_cause
      ? 3
      : (!incident.status || incident.status === 'detected')
        ? 1
        : 2;

  const steps = ['Detect', 'Understand', 'Root cause'];

  return (
    <Card className="p-4 hover:border-ghost/25 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/incidents/${incident.id}`} className="min-w-0">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-ghost shrink-0" />
            <span className="mono text-[13px] font-semibold text-slate-200 hover:text-ghost">{incident.incident_code}</span>
          </div>
          <div className="mt-1 text-sm text-slate-400 truncate">{incident.title}</div>
        </Link>
        <StatusPill status={incident.status} />
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {steps.map((s, idx) => {
          const done = idx < phaseStep - 1 || phaseStep === 3;
          const active = idx === phaseStep - 1;
          return (
            <div key={s} className="flex items-center gap-1.5 flex-1">
              <span className={[
                'text-[10px] font-medium truncate',
                active ? 'text-ghost' : done ? 'text-slate-400' : 'text-slate-600',
              ].join(' ')}>
                <span className="inline-flex items-center gap-1">
                  <span className={['w-1.5 h-1.5 rounded-full inline-block', active ? 'bg-ghost animate-pulse' : done ? 'bg-success' : 'bg-slate-700'].join(' ')} />
                  {s}
                </span>
              </span>
              {idx < steps.length - 1 ? <span className="h-px flex-1 bg-white/10" /> : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <SeverityTag severity={incident.severity} />
          <span className="text-[11px] text-slate-500 truncate">{phaseLabel}</span>
        </div>
        <Link to={`/incidents/${incident.id}`} className="inline-flex items-center gap-1 text-xs text-ghost hover:text-ghost-glow shrink-0">
          Open <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {incident.root_cause ? (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="flex items-start justify-between gap-3">
            <span className="mono text-xs text-ghost/90 truncate">{incident.root_cause.replace(/_/g, ' ')}</span>
            <div className="w-28 shrink-0"><ConfidenceBar value={incident.root_cause_confidence ?? incident.ai_confidence} showLabel={false} /></div>
          </div>
        </div>
      ) : null}

      <div className="mt-2 text-[10px] text-slate-600 mono">{timeAgo(incident.created_at)}</div>
    </Card>
  );
}