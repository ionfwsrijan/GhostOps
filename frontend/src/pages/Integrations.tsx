import { useEffect, useState } from 'react';
import { Bot, Database, Workflow, MessageSquare, Bug, Mail, Plug } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { Card, ErrorBanner, Section } from '@/components/ui';
import { cn } from '@/lib/cn';

interface Capabilities {
  autonomousLoop: boolean;
  humanInTheLoop: boolean;
  realtime: boolean;
  llm: boolean;
  database: string;
  n8nEnabled: boolean;
}

interface Meta {
  names: string[];
  version: string;
  capabilities: Capabilities;
}

const INTEGRATIONS = [
  { key: 'openai', name: 'OpenAI Structured Outputs', desc: 'Agent reasoning, classification & planning', env: 'OPENAI_API_KEY', icon: Bot, liveKey: 'llm' },
  { key: 'supabase', name: 'Supabase PostgreSQL', desc: 'Persistence & realtime changes (falls back to in-memory)', env: 'SUPABASE_URL + SERVICE_ROLE_KEY', icon: Database, liveKey: 'database' },
  { key: 'n8n', name: 'n8n Automation', desc: 'Event-driven workflows — webhook /webhook/ghostops', env: 'N8N_ENABLED', icon: Workflow, liveKey: 'n8nEnabled' },
  { key: 'slack', name: 'Slack Notifications', desc: 'On-call & incident channels (mock adapter in demo)', env: 'SLACK_ENABLED + SLACK_WEBHOOK_URL', icon: MessageSquare, liveKey: null },
  { key: 'jira', name: 'Jira Service Management', desc: 'Auto-created tickets for escalated incidents', env: 'JIRA_ENABLED + JIRA_*', icon: Bug, liveKey: null },
  { key: 'email', name: 'SMTP Email', desc: 'Customer notifications & status updates', env: 'EMAIL_ENABLED + SMTP_*', icon: Mail, liveKey: null },
];

export default function Integrations() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<Meta>(endpoints.meta()).then(setMeta).catch((e) => setError((e as Error).message));
  }, []);

  const caps = meta?.capabilities;
  const adapter = caps?.database === 'supabase-postgres' ? 'Supabase PostgreSQL (live)' : 'In-memory seeded (demo mode)';

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Integrations</h1>
          <p className="text-sm text-slate-500 mt-1">The external systems GhostOps speaks to — real keys via <span className="mono">.env</span></p>
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <Plug className="w-3.5 h-3.5 text-ghost" /> adapter: <span className="mono text-ghost">{adapter}</span>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map(({ key, name, desc, env, icon: Icon, liveKey }) => {
          const configured = liveKey
            ? ((caps as Record<string, unknown> | undefined)?.[liveKey] as boolean | string | undefined)
              ? true
              : false
            : true; // mock adapters always "available" in demo
          return (
            <Card key={key} className="p-5">
              <div className="flex items-start justify-between">
                <div className={cn('w-10 h-10 rounded-lg border flex items-center justify-center', configured ? 'border-ghost/30 bg-ghost/10 text-ghost' : 'border-white/10 bg-white/[0.03] text-slate-500')}>
                  <Icon className="w-5 h-5" />
                </div>
                <StatusDot configured={configured} label={configured ? (liveKey ? 'connected' : 'mock mode') : 'add keys'} />
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-100">{name}</div>
              <div className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</div>
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <div className="label mb-1">Required env</div>
                <div className="mono text-[11px] text-slate-500 break-all">{env}</div>
              </div>
            </Card>
          );
        })}
      </div>

      <Section title="SSE Event Stream" subtitle="The realtime bus that powers the live UI">
        <Card className="p-4 text-xs text-slate-400 space-y-2">
          <div><span className="mono text-ghost">GET /api/events</span> — global stream of <span className="mono">agent_update</span>, <span className="mono">tool_completed</span>, <span className="mono">incident_detected</span>, <span className="mono">approval_requested</span> and more.</div>
          <div><span className="mono text-ghost">GET /api/events?incidentId=:id</span> — per-incident stream powering the investigation workspace.</div>
        </Card>
      </Section>
    </div>
  );
}

function StatusDot({ configured, label }: { configured: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border', configured ? 'text-success border-success/30 bg-success/10' : 'text-warn border-warn/30 bg-warn/10')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', configured ? 'bg-success' : 'bg-warn')} />
      {label}
    </span>
  );
}