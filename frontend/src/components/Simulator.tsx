import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play, Loader2, Sparkles } from 'lucide-react';
import { get, post, endpoints } from '@/api/client';
import { Button, Card, ErrorBanner, GhostLoader } from '@/components/ui';

export interface Scenario {
  key: string;
  label: string;
  description: string;
}

export function SimulateButton({ onTriggered }: { onTriggered?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Sparkles className="w-4 h-4" /> Simulate Incident
      </Button>
      {open ? <SimulateModal onClose={() => setOpen(false)} onTriggered={onTriggered} /> : null}
    </>
  );
}

function SimulateModal({ onClose, onTriggered }: { onClose: () => void; onTriggered?: () => void }) {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<string>('payment_booking_failure');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    get<{ scenarios: Scenario[] }>(endpoints.scenarios()).then((r) => setScenarios(r.scenarios)).catch(() => setError('Could not load scenarios'));
  }, []);

  async function run() {
    setRunning(true);
    setError(undefined);
    try {
      const res = await post<{ incident: { id: string; incident_code: string } }>(endpoints.simulate(), { scenario: selected });
      setCreated(res.incident.incident_code);
      onTriggered?.();
      setTimeout(() => {
        onClose();
        navigate(`/incidents/${res.incident.id}`);
      }, 900);
    } catch (e) {
      setError((e as Error).message ?? 'Simulation failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base-950/80 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-lg p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <div className="text-sm font-semibold text-slate-100">Simulate an incident</div>
            <div className="text-[11px] text-slate-500 mt-0.5">GhostOps will autonomously investigate and resolve it live.</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          {scenarios.map((s) => (
            <button
              key={s.key}
              onClick={() => setSelected(s.key)}
              className={[
                'w-full text-left rounded-lg border p-3.5 transition-colors',
                selected === s.key ? 'border-ghost/40 bg-ghost/[0.06]' : 'border-white/10 bg-white/[0.02] hover:border-white/20',
              ].join(' ')}
            >
              <div className={['text-[13px] font-medium', selected === s.key ? 'text-ghost' : 'text-slate-200'].join(' ')}>{s.label}</div>
              <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">{s.description}</div>
            </button>
          ))}
          <ErrorBanner message={error} />
        </div>

        <div className="px-5 py-4 border-t border-white/[0.06] flex items-center justify-between gap-4">
          {created ? <div className="text-xs text-success flex items-center gap-2"><GhostLoader label={`${created} — investigation started`} /></div> : <div className="text-xs text-slate-500">Runs the full agent loop end-to-end</div>}
          <Button variant="primary" onClick={run} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? 'Simulating…' : 'Run scenario'}
          </Button>
        </div>
      </Card>
    </div>
  );
}