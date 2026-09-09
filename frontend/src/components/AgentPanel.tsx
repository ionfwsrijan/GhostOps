import { Bot, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface AgentState {
  state: string;
  currentTask?: string;
  reasoning?: string;
  tool?: string;
  phase?: string;
  ok?: boolean;
  status?: string;
}

const TOOL_NAMES = ['Payment API', 'Supabase', 'Logs', 'Jira', 'Slack', 'Email'];

export default function AgentPanel({ agentState, toolsUsed, collapsed = false }: { agentState: AgentState | null; toolsUsed: string[]; collapsed?: boolean }) {
  const state = agentState?.state ?? 'idle';
  const active = ['classifying', 'investigating', 'analyzing', 'planning', 'acting', 'verifying'].includes(state);

  const tools = TOOL_NAMES.map((name) => {
    const used = toolsUsed.includes(name) || (agentState?.tool && name.toLowerCase().includes(agentState.tool.replace(/_/g, ' ').toLowerCase().split(' ')[0]));
    return { name, used };
  });

  return (
    <div className="glass rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center border', active ? 'border-ghost/40 bg-ghost/10 text-ghost' : 'border-white/10 bg-white/[0.03] text-slate-500')}>
            {active ? <div className="relative w-4 h-4"><div className="absolute inset-0 rounded-full border border-ghost/40 animate-spin" style={{ borderTopColor: 'transparent' }} /><div className="absolute inset-[4px] rounded-full bg-ghost/70" /></div> : <Bot className="w-4 h-4" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 tracking-wide">GHOSTOPS AGENT</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Autonomous Operator</div>
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest border', active ? 'text-ghost border-ghost/30 bg-ghost/10' : 'text-slate-500 border-white/10 bg-white/[0.03]')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-ghost animate-pulse' : 'bg-slate-600')} />
          {active ? 'ACTIVE' : state.toUpperCase()}
        </span>
      </div>

      {!collapsed ? (
        <>
          <div className="space-y-1.5 rounded-lg border border-white/10 bg-base-950/60 p-3.5">
            <div className="label">Current task</div>
            <div className="text-[13px] text-slate-200 leading-relaxed">
              {agentState?.currentTask ?? (state === 'resolved' ? 'Incident resolved. Monitoring for regressions.' : 'Standing by.')}
            </div>
            <div className="label pt-1.5">Agent reasoning summary</div>
            <div className="text-[12px] text-slate-400 leading-relaxed italic">
              {agentState?.reasoning ?? 'No active investigation. GhostOps is idle.'}
            </div>
          </div>

          <div>
            <div className="label mb-2">Tools</div>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((t) => (
                <span
                  key={t.name}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium mono',
                    t.used ? 'border-success/30 bg-success/10 text-success' : 'border-white/10 bg-white/[0.02] text-slate-500'
                  )}
                >
                  {t.used ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}