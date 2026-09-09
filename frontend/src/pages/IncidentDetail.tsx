import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  ShieldCheck,
  User,
  CreditCard,
  Film,
  FileSearch,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { get, post, endpoints } from '@/api/client';
import { TimelineEntry, AgentAction, IncidentDetail as DetailData, Customer, Payment, Booking } from '@/api/types';
import { Card, StatusPill, SeverityTag, ConfidenceBar, Section, EmptyState, ErrorBanner, Button, GhostLoader } from '@/components/ui';
import ForwardTimeline from '@/components/Timeline';
import AgentPanel, { AgentState } from '@/components/AgentPanel';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { fullTime, rupees } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function IncidentDetail() {
  const { id = '' } = useParams();
  const [incident, setIncident] = useState<DetailData | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const d = await get<DetailData>(endpoints.incident(id));
      setIncident(d);
      setActions(d.actions);
      const t = await get<{ timeline: TimelineEntry[] }>(endpoints.timeline(id));
      setTimeline(t.timeline);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message ?? 'Could not load incident');
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveEvents({
    incidentId: id,
    onEvent: (evt) => {
      if (['incident_detected', 'incident_status', 'incident_update', 'incident_resolved', 'timeline_event', 'action_executed', 'approval_requested', 'recommendation'].includes(evt.type)) {
        void refresh();
      }
    },
  });

  if (error && !incident) return <ErrorBanner message={error} />;
  if (!incident) return <div className="p-10"><GhostLoader label="Loading incident…" /></div>;

  const inv = incident.investigation;
  const agentState: AgentState = {
    state: inv.agentState === 'idle' && incident.incident.status === 'resolved' ? 'resolved' : (inv.agentState ?? inv.status ?? 'idle'),
    currentTask: incident.incident.metadata?.agentTask as string | undefined,
    reasoning: (incident.incident.metadata?.reasoning as string) ?? undefined,
    tool: incident.incident.metadata?.lastTool as string | undefined,
  };

  const startTask = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/incidents" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300">
          <ArrowLeft className="w-3.5 h-3.5" /> All incidents
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="default" disabled={busy} onClick={() => startTask(() => post(endpoints.investigate(id)))}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />} Re-investigate
          </Button>
          <Button variant="success" disabled={busy} onClick={() => startTask(async () => post(endpoints.verify(id)))}>
            <Play className="w-4 h-4" /> Verify resolution
          </Button>
        </div>
      </div>

      <Header incident={incident.incident} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5 order-2 xl:order-1">
          <LiveTimeline timeline={timeline} />
        </div>

        <div className="space-y-5 order-1 xl:order-2">
          <AgentPanel agentState={agentState} toolsUsed={actions.map((a) => a.tool)} />
          {incident.incident.root_cause ? (
            <RootCauseCard rootCause={incident.incident.root_cause} confidence={incident.incident.root_cause_confidence ?? incident.incident.ai_confidence ?? 0} evidence={incident.incident.evidence} severity={incident.incident.severity} incidentCode={incident.incident.incident_code} />
          ) : null}
          <ContextCards customer={incident.customer} payment={incident.payment} booking={incident.booking} code={incident.incident.incident_code} />
          <ActionsHistory actions={actions} />
        </div>
      </div>
    </div>
  );
}

function Header({ incident }: { incident: DetailData['incident'] }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-100 mono">{incident.incident_code}</h1>
        <StatusPill status={incident.status} />
        <SeverityTag severity={incident.severity} />
      </div>
      <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">{incident.title}</p>
      <p className="text-xs text-slate-600 mt-1 mono">
        {incident.affected_service ?? 'unknown service'} · detected {fullTime(incident.created_at)}
        {incident.transaction_id ? ` · txn ${incident.transaction_id}` : ''}
        {incident.auto_resolved ? ' · auto-resolved' : ''}
      </p>
    </div>
  );
}

function RootCauseCard({ rootCause, confidence, evidence, severity, incidentCode }: { rootCause: string; confidence: number; evidence?: Record<string, unknown>; severity: string; incidentCode: string }) {
  const err = severity === 'critical' || severity === 'high';
  const keys = evidence ? Object.keys(evidence).slice(0, 4) : [];
  return (
    <Card className="p-4 border-l-2" >
      <div className="flex items-start justify-between">
        <div className="label flex items-center gap-1.5"><FileSearch className="w-3 h-3" /> Root cause</div>
        <span className={cn('mono text-[10px] uppercase tracking-widest', err ? 'text-danger' : 'text-warn')}>{err ? 'high severity' : 'flag'}</span>
      </div>
      <div className={cn('mt-2 font-mono text-sm', err ? 'text-danger' : 'text-warn')}>{rootCause.replace(/_/g, ' ')}</div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
          <span>confidence</span>
          <span className="mono">{Math.round(confidence * 100)}%</span>
        </div>
        <ConfidenceBar value={confidence} showLabel={false} />
      </div>
      {keys.length ? (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="label mb-1.5">Evidence</div>
          <div className="mono text-[11px] space-y-1">
            {keys.map((k) => (
              <div key={k} className="flex items-start gap-2">
                <span className="text-slate-500 truncate shrink-0">{k}:</span>
                <span className="text-slate-300 break-all truncate">{String(evidence?.[k])}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-3 text-[10px] text-slate-600 mono">case #{incidentCode}</div>
    </Card>
  );
}

function LiveTimeline({ timeline }: { timeline: TimelineEntry[] }) {
  return (
    <Section title="Agent Investigation Timeline" subtitle="Streamed live from the autonomous agent loop">
      <Card className="p-5">
        {timeline.length === 0 ? <EmptyState title="No investigation started yet" hint="Trigger Re-investigate to kick off the agent loop." /> : <ForwardTimeline entries={timeline} />}
      </Card>
    </Section>
  );
}

function ContextCards({ customer, payment, booking, code }: { customer?: Customer | null; payment?: Payment | null; booking?: Booking | null; code: string }) {
  return (
    <Section title="Context" subtitle="Entities GhostOps pulled into this investigation">
      <div className="space-y-3">
        <ContextRow icon={<User className="w-4 h-4" />} label="Customer">
          {customer ? (
            <>
              <div className="text-sm text-slate-200">{customer.name}</div>
              <div className="mono text-[11px] text-slate-500">{customer.customer_code}{customer.city ? ` · ${customer.city}` : ''}{customer.loyalty_tier ? ` · ${customer.loyalty_tier}` : ''}</div>
            </>
          ) : (
            <div className="text-xs text-slate-600">not linked</div>
          )}
        </ContextRow>
        <ContextRow icon={<CreditCard className="w-4 h-4" />} label="Payment">
          {payment ? (
            <>
              <div className="flex items-center gap-2">
                <span className={cn('text-[11px] font-semibold uppercase', payment.status === 'success' ? 'text-success' : 'text-warn')}>{payment.status}</span>
                <span className="mono text-[11px] text-slate-500">{payment.transaction_id}</span>
              </div>
              <div className="mono text-xs text-slate-300">{rupees(payment.amount)} · {payment.payment_method} · {payment.gateway}</div>
            </>
          ) : (
            <div className="text-xs text-slate-600">not linked</div>
          )}
        </ContextRow>
        <ContextRow icon={<Film className="w-4 h-4" />} label="Booking">
          {booking ? (
            <>
              <div className="text-sm text-slate-200">{booking.movie_title}</div>
              <div className="mono text-[11px] text-slate-500">{booking.booking_code} · {booking.cinema ?? ''} {booking.city ?? ''} · <span className={cn(booking.status === 'confirmed' ? 'text-success' : 'text-warn')}>{booking.status}</span></div>
            </>
          ) : (
            <div className="text-xs text-slate-600">{code} not yet created — GhostOps will retry/create it</div>
          )}
        </ContextRow>
      </div>
    </Section>
  );
}

function ContextRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-lg px-4 py-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-slate-500 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="label">{label}</div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function ActionsHistory({ actions }: { actions: AgentAction[] }) {
  const recent = actions.slice(0, 6);
  return (
    <Section title="Executed Actions" subtitle="Every tool call the agent performed">
      <Card className="divide-y divide-white/[0.05]">
        {recent.length === 0 ? (
          <div className="p-5 text-xs text-slate-600">No actions recorded yet.</div>
        ) : (
          recent.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] text-slate-200 font-medium truncate">{a.tool}</div>
                <div className="mono text-[10px] text-slate-500 truncate">{a.input ? JSON.stringify(a.input).slice(0, 60) : a.action}</div>
              </div>
              <ActionResultPill result={a.result} />
            </div>
          ))
        )}
      </Card>
    </Section>
  );
}

function ActionResultPill({ result }: { result: string }) {
  const ok = result === 'success' || result === 'executed';
  const pending = result === 'pending_approval';
  return (
    <span className={cn('shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border', ok ? 'text-success border-success/30 bg-success/10' : pending ? 'text-warn border-warn/30 bg-warn/10' : 'text-danger border-danger/30 bg-danger/10')}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : pending ? <ShieldCheck className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" />}
      {result}
    </span>
  );
}