import { useEffect, useState } from 'react';
import { MessageSquare, Bug, Mail, Workflow, Database, Activity } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { Meta } from '@/api/types';
import { Card, ErrorBanner, Section } from '@/components/ui';
import { cn } from '@/lib/cn';

const PROVIDERS: Record<string, { name: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = {
  slack: { name: 'Slack Notifications', desc: 'On-call & incident channels via the outbox', icon: MessageSquare },
  jira: { name: 'Jira Service Management', desc: 'Auto-created tickets for escalated incidents', icon: Bug },
  email: { name: 'SMTP Email', desc: 'Customer notifications & status updates', icon: Mail },
  n8n: { name: 'n8n Automation', desc: 'Event-driven workflow triggers', icon: Workflow },
};

export default function Integrations() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<Meta>(endpoints.meta()).then(setMeta).catch((e) => setError((e as Error).message));
  }, []);

  const rows = (meta?.integrations ?? []).map((i) => ({ ...i, ...(PROVIDERS[i.provider] ?? { name: i.provider, desc: 'External system', icon: Database }) }));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Integrations</h1>
          <p className="text-sm text-slate-500 mt-1">The external systems GhostOps speaks to through the outbox relay</p>
        </div>
        {meta ? (
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-ghost" /> job queue: <span className="mono text-ghost">{meta.queue.pending} pending / {meta.queue.failed} failed</span>
          </div>
        ) : null}
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 ? (
          <Card className="p-6 text-sm text-slate-500">No integrations registered yet.</Card>
        ) : (
          rows.map(({ provider, enabled, status, name, desc, icon: Icon }) => {
            const live = status === 'healthy' || (enabled && status !== 'unhealthy');
            return (
              <Card key={provider} className="p-5">
                <div className="flex items-start justify-between">
                  <div className={cn('w-10 h-10 rounded-lg border flex items-center justify-center', live ? 'border-ghost/30 bg-ghost/10 text-ghost' : 'border-white/10 bg-white/[0.03] text-slate-500')}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <StatusDot enabled={enabled} status={status} />
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-100">{name}</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</div>
                <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
                  <div className="label">provider</div>
                  <div className="mono text-[11px] text-slate-500">{provider}</div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Section title="SSE Event Stream" subtitle="The realtime bus that powers the live UI">
        <Card className="p-4 text-xs text-slate-400 space-y-2">
          <div><span className="mono text-ghost">GET /api/v1/events</span> — global stream of <span className="mono">incident_detected</span>, <span className="mono">incident_status</span>, <span className="mono">approval_requested</span>, <span className="mono">action_executed</span> and more.</div>
          <div><span className="mono text-ghost">GET /api/v1/events?incidentId=:id</span> — per-incident stream powering the investigation workspace.</div>
          <div className="pt-1">Events need a valid session cookie — the stream stays authenticated like every other endpoint.</div>
        </Card>
      </Section>

      <Section title="Worker" subtitle="Which worker instance holds this control plane">
        <Card className="p-4 flex items-center gap-4 flex-wrap text-xs">
          <div><span className="label">Worker instance</span><div className="mono text-slate-300 mt-0.5">{meta?.workerInstance ?? '—'}</div></div>
          <div><span className="label">Environment</span><div className="mono text-slate-300 mt-0.5">{meta?.env ?? '—'}</div></div>
          <div><span className="label">Last heartbeat</span><div className="mono text-slate-300 mt-0.5">{meta ? new Date(meta.timestamp).toLocaleTimeString() : '—'}</div></div>
        </Card>
      </Section>
    </div>
  );
}

function StatusDot({ enabled, status }: { enabled: boolean; status: string }) {
  const live = status === 'healthy' || (enabled && status !== 'unhealthy');
  const label = status === 'not_configured' ? 'add keys' : status === 'unhealthy' ? 'unhealthy' : live ? 'connected' : 'disabled';
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border', live ? 'text-success border-success/30 bg-success/10' : 'text-warn border-warn/30 bg-warn/10')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', live ? 'bg-success' : 'bg-warn')} />
      {label}
    </span>
  );
}