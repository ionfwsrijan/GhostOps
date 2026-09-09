import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import { get, post, endpoints } from '@/api/client';
import { ApprovalRequest } from '@/api/types';
import { Card, RiskTag, EmptyState, ErrorBanner, GhostLoader, Button, Tabs, Section } from '@/components/ui';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

type FilterKey = 'pending' | 'approved' | 'rejected';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'pending', label: 'Pending review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function Approvals() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);

  const refresh = async (f = filter) => {
    try {
      const r = await get<{ approvals: ApprovalRequest[] }>(endpoints.approvals(f));
      setApprovals(r.approvals.sort((x, y) => new Date(y.created_at ?? 0).getTime() - new Date(x.created_at ?? 0).getTime()));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [filter]);

  useLiveEvents({
    onEvent: (evt) => {
      if (['approval_requested'].includes(evt.type)) void refresh('pending');
      if (['incident_status'].includes(evt.type)) void refresh();
    },
  });

  const decide = async (a: ApprovalRequest, approved: boolean, reason?: string) => {
    setBusyId(a.id);
    setError(undefined);
    try {
      await post(approved ? endpoints.approve(a.id) : endpoints.reject(a.id), approved ? {} : { reason });
      setRejecting(null);
      void refresh('pending');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Approvals</h1>
        <p className="text-sm text-slate-500 mt-1">High-risk actions need a human in the loop — the agent pauses until you decide</p>
      </div>

      <Tabs items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={(k) => setFilter(k as FilterKey)} />
      <ErrorBanner message={error} />

      <Section title={filter === 'pending' ? 'Awaiting your decision' : 'Approval history'}>
        <div className="space-y-3">
          {loading ? (
            <div className="p-10"><GhostLoader label="Loading approvals…" /></div>
          ) : approvals.length === 0 ? (
            <EmptyState title={filter === 'pending' ? 'No pending approvals — the agent resolved everything autonomously' : 'No approvals in this state'} hint="High-risk actions like refunds or cancellations trigger human approval." />
          ) : (
            approvals.map((a) => (
              <Card key={a.id} className={cn('p-4', a.status === 'pending' && 'border-warn/25')}>
                <div className="flex items-start gap-4">
                  <div className={cn('w-9 h-9 rounded-lg border flex items-center justify-center shrink-0', a.status === 'pending' ? 'border-warn/30 bg-warn/10 text-warn' : a.status === 'approved' ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger')}>
                    {a.status === 'pending' ? <ShieldCheck className="w-4 h-4" /> : a.status === 'approved' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-200">{a.title}</span>
                      <RiskTag risk={a.risk} />
                      {a.status === 'pending' ? <span className="text-[10px] font-semibold uppercase tracking-wider text-warn border border-warn/30 bg-warn/10 px-2 py-0.5 rounded">agent paused</span> : null}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 leading-relaxed">{a.description}</div>

                    {a.ai_recommendation ? (
                      <div className="mt-2 rounded-lg border border-ghost/20 bg-ghost/[0.05] px-3 py-2 text-[11px] text-slate-300 italic">
                        <span className="mono text-ghost not-italic font-semibold mr-1.5">AI recommendation:</span>
                        {a.ai_recommendation}
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                      {a.incident_code ? (
                        <Link to={`/incidents/${a.incident_id}`} className="mono text-ghost hover:text-ghost-glow">{a.incident_code}</Link>
                      ) : null}
                      <span>raised {timeAgo(a.created_at)}</span>
                      <span className="mono">{a.action_key}</span>
                    </div>

                    {a.status === 'pending' ? (
                      <div className="mt-3 flex items-center gap-2">
                        <Button variant="success" disabled={busyId === a.id} onClick={() => void decide(a, true)}>
                          {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve & resume agent
                        </Button>
                        <Button variant="danger" disabled={busyId === a.id} onClick={() => setRejecting(a)}>
                          <X className="w-4 h-4" /> Reject
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500">
                        {a.status === 'approved' ? 'Approved' : 'Rejected'} {a.decided_at ? `· ${timeAgo(a.decided_at)}` : ''}
                        {a.decision_reason ? <span className="text-slate-400"> — “{a.decision_reason}”</span> : null}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </Section>

      {rejecting ? (
        <RejectModal approval={rejecting} onClose={() => setRejecting(null)} onSubmit={(reason) => void decide(rejecting, false, reason)} />
      ) : null}
    </div>
  );
}

function RejectModal({ approval, onClose, onSubmit }: { approval: ApprovalRequest; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base-950/80 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-warn">
          <AlertTriangle className="w-5 h-5" />
          <div className="text-sm font-semibold text-slate-100">Reject “{approval.title}”</div>
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          The agent will abandon this action and continue its loop — it may attempt an alternative remediation if one exists.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you rejecting this action? (required)"
          rows={3}
          className="w-full mt-3 bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-warn/40"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>Reject action</Button>
        </div>
      </Card>
    </div>
  );
}