import { useEffect, useState } from 'react';
import { Info, Database, Cpu, Key, ShieldCheck, Activity } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { Health, Meta } from '@/api/types';
import { Card, Section, ErrorBanner, GhostLoader } from '@/components/ui';
import { cn } from '@/lib/cn';

const ENV_BLOCKS = [
  {
    title: 'Database',
    icon: Database,
    lines: [
      ['DATABASE_URL', 'Postgres connection (docker-compose db)'],
    ],
  },
  {
    title: 'AI Agent',
    icon: Cpu,
    lines: [
      ['HEURISTIC_MODE', 'rule-based engine (default, no key needed)'],
    ],
  },
  {
    title: 'Sessions & Ops',
    icon: Key,
    lines: [
      ['SESSION_SECRET', 'seals login session cookies'],
      ['SESSION_TTL_DAYS', 'how long sessions live'],
    ],
  },
  {
    title: 'Integrations (optional)',
    icon: ShieldCheck,
    lines: [
      ['SLACK_ENABLED / SLACK_WEBHOOK_URL', 'Slack alerts'],
      ['JIRA_ENABLED / JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN / JIRA_PROJECT_KEY', 'Jira tickets'],
      ['EMAIL_ENABLED / SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS', 'Customer email'],
      ['N8N_ENABLED / N8N_BASE_URL / N8N_WEBHOOK_PATH', 'n8n workflow trigger'],
    ],
  },
];

export default function Settings() {
  const [health, setHealth] = useState<Health | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([get<Health>(endpoints.health()), get<Meta>(endpoints.meta())])
      .then(([h, m]) => {
        setHealth(h);
        setMeta(m);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Backend health, worker state and environment reference</p>
      </div>

      <ErrorBanner message={error} />

      <Section title="Backend Health">
        <Card className="p-5 flex items-center gap-6 flex-wrap">
          {!health ? (
            <GhostLoader label="Probing backend…" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className={cn('w-2.5 h-2.5 rounded-full', health.status === 'ok' ? 'bg-success animate-pulse' : 'bg-danger')} />
                <span className="mono text-sm text-slate-200">{health.status}</span>
                <span className="text-xs text-success uppercase tracking-wider">{health.status === 'ok' ? 'ready' : 'degraded'}</span>
              </div>
              <Chip label="Uptime" value={`${Math.round((health.uptimeSeconds ?? 0) / 60)}m`} ok />
              <Chip label="Postgres" value={health.dependencies?.postgres ?? 'unknown'} ok={health.dependencies?.postgres === 'ok'} okText="reachable" noText="unreachable" />
              <Chip label="Worker" value={meta?.workerInstance ?? '—'} ok />
            </>
          )}
        </Card>
      </Section>

      <Section title="Queue" subtitle="Pending and failed jobs in the worker's postgres-backed queue">
        <Card className="p-5 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4 text-ghost" />
            <span className="text-slate-500 text-xs">pending</span>
            <span className="mono text-slate-200">{meta?.queue.pending ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4 text-ghost" />
            <span className="text-slate-500 text-xs">failed</span>
            <span className="mono text-slate-200">{meta?.queue.failed ?? '—'}</span>
          </div>
        </Card>
      </Section>

      <Section title="Environment Variables" subtitle="Copy backend/.env.example → backend/.env and fill in what you want live">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ENV_BLOCKS.map(({ title, icon: Icon, lines }) => (
            <Card key={title} className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Icon className="w-4 h-4 text-ghost" /> {title}
              </div>
              <div className="mt-3 space-y-2">
                {lines.map(([k, v]) => (
                  <div key={k}>
                    <div className="mono text-[12px] text-ghost/90">{k}</div>
                    <div className="text-[11px] text-slate-500">{v}</div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Quick Start">
        <Card className="p-5 space-y-2 text-xs text-slate-400">
          <div className="mono text-slate-300">docker compose up -d</div>
          <div className="mono text-slate-300">npm run seed --workspace=backend</div>
          <p className="pt-2 text-slate-500 leading-relaxed">
            <Info className="w-3.5 h-3.5 inline mr-1 text-ghost" />
            GhostOps runs fully self-contained on the compose Postgres without external keys: heuristic reasoning engine and outbox adapters for Slack/Jira/email/n8n.
          </p>
        </Card>
      </Section>
    </div>
  );
}

function Chip({ label, value, ok, okText, noText }: { label: string; value: string; ok?: boolean; okText?: string; noText?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="mono text-[12px] text-slate-300">{value}</span>
        <span className={cn('text-[10px]', ok ? 'text-success' : 'text-warn')}>{ok ? (okText ?? 'connected') : (noText ?? 'not connected')}</span>
      </div>
    </div>
  );
}