import { NavLink, Outlet } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/incidents", label: "Incidents", icon: Siren },
  { to: "/agent", label: "Agent Activity", icon: Bot },
  { to: "/investigations", label: "Investigations", icon: FlaskConical },
  { to: "/actions", label: "Actions", icon: Zap },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/integrations", label: "Integrations", icon: Puzzle },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  const [pulse, setPulse] = useState(0);

  const { connected } = useLiveEvents({
    onEvent: useCallback(() => {
      setPulse((p) => p + 1);
    }, []),
  });

  return (
    <div className="h-screen flex overflow-hidden bg-[#f4f7fb]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header connected={connected} pulse={pulse} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1480px] mx-auto px-5 md:px-8 py-7 pb-24">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="px-5 h-[76px] flex items-center gap-3 border-b border-slate-100">
        <div className="relative w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
          <Radar className="w-4 h-4" />
        </div>
        <div>
          <div className="font-extrabold tracking-tight text-slate-950 leading-none">
            GhostOps
          </div>
          <div className="text-[10px] text-slate-400 mt-1 tracking-[0.12em] uppercase">
            Incident command
          </div>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors",
                isActive
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                  : "text-slate-500 border border-transparent hover:text-slate-900 hover:bg-slate-50",
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-100">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="relative flex w-2 h-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-success" />
          </span>
          Response engine online
        </div>
      </div>
    </aside>
  );
}

function Header({ connected, pulse }: { connected: boolean; pulse: number }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  return (
    <header className="h-[76px] shrink-0 border-b border-slate-200 bg-white flex items-center gap-4 px-5 md:px-8">
      <div className="hidden md:block relative w-84">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim())
              navigate(`/incidents?q=${encodeURIComponent(q.trim())}`);
          }}
          placeholder="Search incidents, services, actions..."
          className="w-80 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:bg-white"
        />
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 border-r border-slate-200 pr-4">
          <span className="w-2 h-2 rounded-full bg-success" /> Production
        </div>
        <LiveDot connected={connected} pulses={pulse} />
      </div>
    </header>
  );
}

function LiveDot({
  connected,
  pulses,
}: {
  connected: boolean;
  pulses: number;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] text-slate-500">
      <span className="relative flex w-2 h-2">
        <span
          className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
            connected ? "bg-success" : "bg-warn",
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full w-2 h-2",
            connected ? "bg-success" : "bg-warn",
          )}
        />
      </span>
      {connected ? "Live" : "Connecting…"}
      {pulses > 0 ? (
        <span className="mono text-ghost">{pulses} events</span>
      ) : null}
    </div>
  );
}
