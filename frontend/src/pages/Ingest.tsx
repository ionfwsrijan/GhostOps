import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Send, Copy, Check, Trash2, Plus, Loader2, ArrowRight } from 'lucide-react';
import { get, post, endpoints, authBearer } from '@/api/client';
import { ApiKey } from '@/api/types';
import { useAuth } from '@/hooks/useAuth';
import { Card, Section, RiskTag, ErrorBanner, GhostLoader } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Created {
  incidentId: string;
  code: string;
  queued: boolean;
}

export default function Ingest() {
  const { user } = useAuth();
  const canManageKeys = user?.role === 'admin' || user?.role === 'operator';
  const canRevoke = user?.role === 'admin';

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [error, setError] = useState<string>();

  const [secret, setSecret] = useState<string>(() => localStorage.getItem('ghostops_ingest_secret') ?? '');
  const [copied, setCopied] = useState(false);

  // subject form
  const [title, setTitle] = useState('');
  const [issue, setIssue] = useState('');
  const [severity, setSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [transactionId, setTransactionId] = useState('');
  const [affectedService, setAffectedService] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  // key creation
  const [keyName, setKeyName] = useState('ingest-key');
  const [creatingKey, setCreatingKey] = useState(false);

  const refreshKeys = async () => {
    try {
      const r = await get<{ apiKeys: ApiKey[] }>(endpoints.apiKeys());
      setKeys(r.apiKeys);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    if (canManageKeys) void refreshKeys();
    else setLoadingKeys(false);
  }, [canManageKeys]);

  const createKey = async () => {
    setCreatingKey(true);
    setError(undefined);
    try {
      const r = await post<{ apiKey: { id: string; name: string; prefix: string; scope: string[]; secret: string } }>(
        endpoints.createApiKey(),
        { name: keyName, scope: ['ingest'], expiresDays: 365 }
      );
      localStorage.setItem('ghostops_ingest_secret', r.apiKey.secret);
      setSecret(r.apiKey.secret);
      void refreshKeys();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingKey(false);
    }
  };

  const revoke = async (id: string) => {
    setError(undefined);
    try {
      await post(endpoints.revokeApiKey(id));
      void refreshKeys();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async () => {
    if (!secret.trim()) {
      setError('Create an ingest API key first — the trigger needs it to authenticate.');
      return;
    }
    setSending(true);
    setError(undefined);
    setCreated(null);
    try {
      const r = await post<Created>(
        endpoints.ingest(),
        {
          title,
          issue,
          severity,
          transactionId: transactionId.trim() || undefined,
          affectedService: affectedService.trim() || undefined,
          customer: customerName.trim() || customerEmail.trim()
            ? { name: customerName.trim() || undefined, email: customerEmail.trim() || undefined }
            : undefined,
        },
        authBearer(secret.trim())
      );
      setCreated(r);
    } catch (e) {
      setError((e as Error).message ?? 'Ingest failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Ingest</h1>
        <p className="text-sm text-slate-500 mt-1">Authenticate a signal and hand it to the autonomous response loop</p>
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <Section title="Create incident" subtitle="POST /api/v1 with an ingest-scoped API key — GhostOps investigates live">
            <Card className="p-5 space-y-3">
              <div className="space-y-1.5">
                <label className="label">API key (Bearer)</label>
                <div className="relative">
                  <input
                    value={secret}
                    onChange={(e) => {
                      setSecret(e.target.value);
                      localStorage.setItem('ghostops_ingest_secret', e.target.value);
                    }}
                    placeholder={canManageKeys ? 'Create a key below, or paste one' : 'Paste an ingest API key'}
                    className="w-full mono text-[11px] bg-base-800/80 border border-white/10 rounded-lg pl-9 pr-9 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                  />
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  {secret ? (
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(secret);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-ghost"
                      title="Copy key"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="label">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Customer payment failed"
                  className="w-full bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="label">Issue description</label>
                <textarea
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  rows={3}
                  placeholder="The payment machine reported a failure but the customer may have been charged."
                  className="w-full bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="label">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as typeof severity)}
                    className="w-full bg-base-800/80 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-ghost/40"
                  >
                    {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="label">Transaction ID</label>
                  <input
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="TXN-12345"
                    className="w-full mono text-[12px] bg-base-800/80 border border-white/10 rounded-lg px-3 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">Affected service</label>
                  <input
                    value={affectedService}
                    onChange={(e) => setAffectedService(e.target.value)}
                    placeholder="booking-service"
                    className="w-full mono text-[12px] bg-base-800/80 border border-white/10 rounded-lg px-3 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="label">Customer name</label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Priya Sharma"
                    className="w-full bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">Customer email</label>
                  <input
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="priya@example.com"
                    className="w-full bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                  />
                </div>
              </div>

              <div className="pt-1 flex items-center justify-between gap-4">
                {created ? (
                  <Link to={`/incidents/${created.incidentId}`} className="text-xs text-success hover:underline inline-flex items-center gap-1">
                    {created.code} — investigation {created.queued ? 'queued' : 'started'} <ArrowRight className="w-3 h-3" />
                  </Link>
                ) : (
                  <span className="text-[11px] text-slate-500">High-risk outcomes still stop for human approval.</span>
                )}
                <button
                  onClick={() => void send()}
                  disabled={sending || !title.trim() || !issue.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Dispatching…' : 'Create incident'}
                </button>
              </div>
            </Card>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Ingest API keys" subtitle="gated by /api/v1 with a Bearer token — scoped to ingest">
            <Card className="overflow-hidden">
              {loadingKeys ? (
                <div className="p-10"><GhostLoader label="Loading keys…" /></div>
              ) : !canManageKeys ? (
                <div className="p-5 text-xs text-slate-500">Only admins and operators can manage API keys.</div>
              ) : keys.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-slate-400">No API keys yet.</p>
                  <p className="text-xs text-slate-600 mt-1">Create one to authenticate machine-to-machine signals.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Prefix</th>
                      <th className="px-4 py-3 font-medium">Scopes</th>
                      <th className="px-4 py-3 font-medium hidden md:table-cell">Last used</th>
                      {canRevoke ? <th className="px-4 py-3" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-200 font-medium">{k.name}</td>
                        <td className="px-4 py-3"><span className="mono text-[11px] text-ghost/90">{k.prefix}</span></td>
                        <td className="px-4 py-3 flex gap-1">
                          {k.scope.map((s) => <RiskTag key={s} risk={s === 'ingest' || s === 'all' ? 'medium' : 'low'} />)}
                        </td>
                        <td className="px-4 py-3 mono text-[10px] text-slate-500 hidden md:table-cell">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}</td>
                        {canRevoke ? (
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => void revoke(k.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10" title="Revoke">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {canManageKeys ? (
                <div className="p-4 border-t border-white/[0.06] flex items-center gap-3">
                  <input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="key name"
                    className="flex-1 bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-ghost/40"
                  />
                  <button
                    onClick={() => void createKey()}
                    disabled={creatingKey || !keyName.trim()}
                    className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors', creatingKey ? 'bg-indigo-400 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500')}
                  >
                    {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create key
                  </button>
                </div>
              ) : null}
            </Card>
          </Section>

          <Section title="Webhook path" subtitle="HMAC-signed payloads for your own systems">
            <Card className="p-5 text-xs text-slate-400 space-y-2">
              <div><span className="mono text-ghost">POST /api/v1/webhooks/:provider</span> with header <span className="mono text-ghost">X-GhostOps-Signature: sha256=&lt;hex&gt;</span> — HMAC of the raw body.</div>
              <div>Providers verify, dedupe and enter the same incident pipeline as the console form above.</div>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}