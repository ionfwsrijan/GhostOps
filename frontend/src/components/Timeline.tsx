import { CheckCircle2, AlertTriangle, XCircle, Brain, Zap, Radio, Info } from 'lucide-react';
import { TimelineEntry } from '@/api/types';
import { clockTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-success" />,
  warning: <AlertTriangle className="w-4 h-4 text-warn" />,
  error: <XCircle className="w-4 h-4 text-danger" />,
  ai: <Brain className="w-4 h-4 text-ghost" />,
  action: <Zap className="w-4 h-4 text-accent-light" />,
  system: <Radio className="w-4 h-4 text-slate-500" />,
  info: <Info className="w-4 h-4 text-slate-500" />,
};

function typeColor(type: string): string {
  switch (type) {
    case 'success':
      return 'text-success border-success/30 bg-success/10';
    case 'warning':
      return 'text-warn border-warn/30 bg-warn/10';
    case 'error':
      return 'text-danger border-danger/30 bg-danger/10';
    case 'ai':
      return 'text-ghost border-ghost/30 bg-ghost/10';
    case 'action':
      return 'text-accent border-accent/30 bg-accent/10';
    default:
      return 'text-slate-400 border-white/10 bg-white/[0.03]';
  }
}

export function TimelineIcon({ type }: { type: string }) {
  return <div className={cn('w-7 h-7 rounded-lg border flex items-center justify-center shrink-0', typeColor(type))}>{ICONS[type] ?? <Info className="w-4 h-4" />}</div>;
}

export default function ForwardTimeline({ entries, lastOnly = false }: { entries: TimelineEntry[]; lastOnly?: boolean }) {
  const shown = lastOnly ? entries.slice(-1) : entries;
  return (
    <div className="relative">
      {shown.map((e, i) => (
        <div key={e.id ?? i} className="relative flex gap-3 pb-4">
          {i < shown.length - 1 ? (
            <div className="absolute left-[13px] top-8 bottom-0 w-px bg-gradient-to-b from-white/15 to-transparent" />
          ) : null}
          <TimelineIcon type={e.type} />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className={cn('text-[13px] font-medium', e.type === 'ai' ? 'text-ghost' : e.type === 'success' ? 'text-slate-200' : e.type === 'warning' ? 'text-warn' : e.type === 'error' ? 'text-danger' : 'text-slate-300')}>
                {e.title}
              </span>
              <span className="mono text-[10px] text-slate-600 shrink-0">{clockTime(e.created_at)}</span>
            </div>
            {e.description ? <div className="mt-1 text-[12px] text-slate-500 leading-relaxed">{e.description}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}