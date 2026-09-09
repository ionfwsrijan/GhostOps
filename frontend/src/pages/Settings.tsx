import { useEffect, useState } from 'react';
import { Info, Database, Cpu, Key, ShieldCheck } from 'lucide-react';
import { get, endpoints } from '@/api/client';
import { Card, Section, ErrorBanner, GhostLoader } from '@/components/ui';
import { cn } from '@/lib/cn';

interface Health {
  status: string;
  service: string;
  ai: { available: boolean; model: string };
  database: { adapter: string };
  time: string;
}

const ENV_BLOCKS = [
  {
    title: 'Database',
    icon: Database,
    lines: [
      ['SUPABASE_URL', 'Your Supabase project URL'],
      ['SUPABASE_ANON_KEY', 'Public anon key'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'Service role key for admin ops'],
    ],
  },
  {
    title: 'AI Agent',
    icon: Cpu,
    lines: [
      ['OPENAI_API_KEY', 'For structured-output reasoning'],
      ['OPENAI_MODEL', 'gpt-4o-mini (default)'],
    ],
  },
  {
    title: 'OPS Intake Key',
    icon: Key,
    lines: [
      ['OPS_INTAKE_KEY', 'Shared secret that gates /api/n8n/webhook'],
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
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<Health>(endpoints.health()).then(setHealth).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Backend health, environment variables and how to connect real systems</p>
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
                <span className="mono text-sm text-slate-200">{health.service}</span>
                <span className="text-xs text-success uppercase tracking-wider">{health.status}</span>
              </div>
              <Chip label="Model" value={health.ai.model} ok={health.ai.available} okText="key present" noText="offline heuristics" />
              <Chip label="Database" ok value={health.database.adapter === 'memory' ? 'in-memory seeded' : 'supabase postgres'} />
            </>
          )}
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
          <div className="mono text-slate-300">cp backend/.env.example backend/.env</div>
          <div className="mono text-slate-300">cd backend && node ../node_modules/tsx/dist/cli.mjs src/index.ts</div>
          <div className="mono text-slate-300">cd frontend && npm run dev</div>
          <p className="pt-2 text-slate-500 leading-relaxed">
            <Info className="w-3.5 h-3.5 inline mr-1 text-ghost" />
            Without any keys GhostOps runs fully self-contained: in-memory seeded database, heuristic reasoning engine and mock adapters for Slack/Jira/email/n8n. Add OpenAI + Supabase keys to unlock the real circuit.
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