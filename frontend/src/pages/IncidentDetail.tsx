import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileSearch,
  CheckCircle2,
  Loader2,
  Database,
  CreditCard,
  Radio,
  User,
} from 'lucide-react';
import { get, post, endpoints } from '@/api/client';
import { TimelineEntry, AgentAction, IncidentFacts, IncidentEvent, ApprovalRequest, AgentRun } from '@/api/types';
import { Card, StatusPill, SeverityTag, ConfidenceBar, Section, EmptyState, ErrorBanner, Button, GhostLoader } from '@/components/ui';
import ForwardTimeline from '@/components/Timeline';
import AgentPanel, { AgentState } from '@/components/AgentPanel';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { fullTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function toTimeline(events: IncidentEvent[]): TimelineEntry[] {
  return events.map((e) => ({
    id: e.id,
    step: e.step,
    type: e.type,
    title: e.title,
    description: e.description ?? undefined,
    metadata: e.metadata,
    created_at: e.createdAt,
  }));
}

function agentStateFor(facts: IncidentFacts): AgentState {
  const inc = facts.incident;
  const md = inc.metadata?.agentState as string | undefined;
  const state =
    md ??
    (inc.status === 'resolved'
      ? 'resolved'
      : inc.status === 'awaiting_approval'
        ? 'waiting_approval'
        : inc.status === 'investigating'
          ? 'investigating'
          : 'idle');
  const activeRun = facts.runs.find((r) => ['running', 'paused', 'waiting_approval', 'queued', 'claimed'].includes(r.state));
  return {
    state,
    currentTask: (inc.metadata?.agentTask as string | undefined) ?? (activeRun ? `Plan step ${activeRun.attempt}/${activeRun.maxAttempts} (run ${activeRun.id.slice(0, 8)})` : undefined),
    reasoning: (inc.metadata?.reasoning as string | undefined) ?? (md === 'resolved' ? 'Monitoring for regressions.' : undefined),
    tool: (inc.metadata?.lastTool as string | undefined) ?? undefined,
  };
}

export default function IncidentDetail() {
  const { id = '' } = useParams();
  const [facts, setFacts] = useState<IncidentFacts | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const d = await get<IncidentFacts>(endpoints.incident(id));
      setFacts(d);
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

  if (error && !facts) return <ErrorBanner message={error} />;
  if (!facts) return <div className="p-10"><GhostLoader label="Loading incident…" /></div>;

  const inc = facts.incident;
  const agentState = agentStateFor(facts);
  const timeline = toTimeline(facts.events);

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
          <Button variant="default" disabled={busy} onClick={() => startTask(() => post(endpoints.reinvestigate(id)))}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />} Re-investigate
          </Button>
          <Button variant="success" disabled>
            <CheckCircle2 className="w-4 h-4" /> Auto-verified
          </Button>
        </div>
      </div>

      <Header incident={inc} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5 order-2 xl:order-1">
          <LiveTimeline timeline={timeline} />
        </div>

        <div className="space-y-5 order-1 xl:order-2">
          <AgentPanel agentState={agentState} toolsUsed={facts.actions.map((a) => a.tool)} />
          {inc.rootCause ? (
            <RootCauseCard incident={inc} />
          ) : null}
          <ContextCard incident={inc} approvals={facts.approvals} />
          <RunsCard runs={facts.runs} />
          <ActionsHistory actions={facts.actions} />
        </div>
      </div>
    </div>
  );
}

function Header({ incident }: { incident: IncidentFacts['incident'] }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-100 mono">{incident.incidentCode}</h1>
        <StatusPill status={incident.status} />
        <SeverityTag severity={incident.severity} />
      </div>
      <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">{incident.title}</p>
      <p className="text-xs text-slate-600 mt-1 mono">
        {incident.affectedService ?? 'unknown service'} · detected {fullTime(incident.createdAt)}
        {incident.transactionId ? ` · txn ${incident.transactionId}` : ''}
        {incident.autoResolved ? ' · auto-resolved' : ''}
      </p>
    </div>
  );
}

function RootCauseCard({ incident }: { incident: IncidentFacts['incident'] }) {
  const rootCause = incident.rootCause ?? '';
  const confidence = incident.rootCauseConfidence ?? incident.aiConfidence ?? 0;
  const err = incident.severity === 'critical' || incident.severity === 'high';
  const keys = incident.evidence ? Object.keys(incident.evidence).slice(0, 4) : [];
  return (
    <Card className="p-4 border-l-2">
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
                <span className="text-slate-300 break-all truncate">{String(incident.evidence?.[k])}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-3 text-[10px] text-slate-600 mono">case #{incident.incidentCode}</div>
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

function ContextCard({ incident, approvals }: { incident: IncidentFacts['incident']; approvals: ApprovalRequest[] }) {
  return (
    <Section title="Context" subtitle="Entities GhostOps pulled into this investigation">
      <div className="space-y-3">
        <ContextRow icon={<User className="w-4 h-4" />} label="Customer">
          {incident.customerId ? (
            <div className="mono text-[11px] text-slate-500">{incident.customerId}</div>
          ) : (
            <div className="text-xs text-slate-600">not linked</div>
          )}
        </ContextRow>
        <ContextRow icon={<CreditCard className="w-4 h-4" />} label="Payment">
          {incident.transactionId ? (
            <div className="mono text-[11px] text-slate-500">{incident.transactionId}</div>
          ) : (
            <div className="text-xs text-slate-600">not linked</div>
          )}
        </ContextRow>
        <ContextRow icon={<Database className="w-4 h-4" />} label="Affected service">
          <div className="mono text-[11px] text-slate-500">{incident.affectedService ?? 'unknown'}</div>
        </ContextRow>
        <ContextRow icon={<Radio className="w-4 h-4" />} label="Channel / source">
          <div className="mono text-[11px] text-slate-500">{incident.channel} → {incident.source}</div>
        </ContextRow>
        {approvals.length ? (
          <ContextRow icon={<CheckCircle2 className="w-4 h-4" />} label="Approvals">
            <div className="space-y-1">
              {approvals.map((a) => (
                <div key={a.id} className="text-[11px] text-slate-500 mono">{a.actionKey} — <span className={a.status === 'pending' ? 'text-warn' : a.status === 'approved' ? 'text-success' : 'text-danger'}>{a.status}</span></div>
              ))}
            </div>
          </ContextRow>
        ) : null}
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

function RunsCard({ runs }: { runs: AgentRun[] }) {
  const shown = runs.slice(0, 3);
  return (
    <Section title="Agent Runs" subtitle="Execution state of the autonomous loop">
      <Card className="divide-y divide-white/[0.05]">
        {shown.length === 0 ? (
          <div className="p-5 text-xs text-slate-600">No runs yet.</div>
        ) : (
          shown.map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="mono text-[11px] text-slate-300 truncate">{r.id.slice(0, 8)}…</div>
                <div className="mono text-[10px] text-slate-500 mt-0.5">attempt {r.attempt}/{r.maxAttempts}</div>
              </div>
              <RunStatePill state={r.state} />
            </div>
          ))
        )}
      </Card>
    </Section>
  );
}

function RunStatePill({ state }: { state: AgentRun['state'] }) {
  const ok = state === 'completed' || state === 'running' || state === 'waiting_approval';
  const bad = state === 'failed';
  return (
    <span className={cn('shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border', bad ? 'text-danger border-danger/30 bg-danger/10' : ok ? 'text-success border-success/30 bg-success/10' : 'text-slate-500 border-white/10 bg-white/[0.03]')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', bad ? 'bg-danger' : ok ? 'bg-success' : 'bg-slate-500')} />
      {state.replace(/_/g, ' ')}
    </span>
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
                <div className="text-[13px] text-slate-200 font-medium truncate">{a.label || a.tool}</div>
                <div className="mono text-[10px] text-slate-500 truncate">{a.input ? JSON.stringify(a.input).slice(0, 60) : a.actionKey}</div>
              </div>
              {a.status === 'pending_approval' ? <PendingPill /> : <ActionResultPill result={a.result ?? (a.status === 'executed' ? 'executed' : a.status)} />}
            </div>
          ))
        )}
      </Card>
    </Section>
  );
}

function ActionResultPill({ result }: { result: string }) {
  const ok = result === 'success' || result === 'executed';
  return (
    <span className={cn('shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border', ok ? 'text-success border-success/30 bg-success/10' : 'text-danger border-danger/30 bg-danger/10')}>
      {result}
    </span>
  );
}

function PendingPill() {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border text-warn border-warn/30 bg-warn/10">
      pending approval
    </span>
  );
}