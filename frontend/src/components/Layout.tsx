import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Siren,
  Bot,
  FlaskConical,
  Zap,
  ShieldCheck,
  Puzzle,
  BarChart3,
  Settings,
  Radar,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/incidents', label: 'Incidents', icon: Siren },
  { to: '/agent', label: 'Agent Activity', icon: Bot },
  { to: '/investigations', label: 'Investigations', icon: FlaskConical },
  { to: '/actions', label: 'Actions', icon: Zap },
  { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { to: '/integrations', label: 'Integrations', icon: Puzzle },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const [pulse, setPulse] = useState(0);

  const { connected } = useLiveEvents({
    onEvent: useCallback(() => {
      setPulse((p) => p + 1);
    }, []),
  });

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header connected={connected} pulse={pulse} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-6 py-6 pb-24">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-white/[0.06] bg-base-900/60 backdrop-blur-xl flex flex-col">
      <div className="px-5 h-16 flex items-center gap-3 border-b border-white/[0.06]">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-ghost/30 to-accent/30" />
          <div className="absolute inset-1 rounded-md bg-base-900 flex items-center justify-center text-ghost">
            <Radar className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="font-bold tracking-tight text-slate-100 leading-none">GhostOps <span className="text-ghost">AI</span></div>
          <div className="text-[10px] text-slate-500 mt-1 tracking-wide uppercase">Autonomous Ops Agent</div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors',
                isActive ? 'bg-ghost/10 text-ghost border border-ghost/20' : 'text-slate-400 border border-transparent hover:text-slate-200 hover:bg-white/[0.04]'
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="relative flex w-2 h-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-success" />
          </span>
          Agent active · v1.0.0
        </div>
      </div>
    </aside>
  );
}

function Header({ connected, pulse }: { connected: boolean; pulse: number }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  return (
    <header className="h-16 shrink-0 border-b border-white/[0.06] bg-base-900/50 backdrop-blur-xl flex items-center gap-4 px-6">
      <div className="hidden md:block relative w-84">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) navigate(`/incidents?q=${encodeURIComponent(q.trim())}`);
          }}
          placeholder="Search incidents…"
          className="w-72 bg-base-800/80 border border-white/10 rounded-lg px-3.5 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-ghost/40"
        />
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <LiveDot connected={connected} pulses={pulse} />
      </div>
    </header>
  );
}

function LiveDot({ connected, pulses }: { connected: boolean; pulses: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-base-800/60 text-[11px] text-slate-400">
      <span className="relative flex w-2 h-2">
        <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-60', connected ? 'bg-success' : 'bg-warn')} />
        <span className={cn('relative inline-flex rounded-full w-2 h-2', connected ? 'bg-success' : 'bg-warn')} />
      </span>
      {connected ? 'Live' : 'Connecting…'}
      {pulses > 0 ? <span className="mono text-ghost">{pulses} events</span> : null}
    </div>
  );
}