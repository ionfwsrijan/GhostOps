import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  Zap,
  Clock,
  Siren,
  ArrowRight,
  ShieldAlert,
  Radio,
  ChevronRight,
} from "lucide-react";
import { get, endpoints } from "@/api/client";
import { KpiStats, Incident } from "@/api/types";
import {
  Card,
  StatCard,
  StatusPill,
  SeverityTag,
  ConfidenceBar,
  Section,
  EmptyState,
  GhostLoader,
} from "@/components/ui";
import { SimulateButton } from "@/components/Simulator";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function Overview() {
  const [stats, setStats] = useState<KpiStats | null>(null);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const s = await get<KpiStats>(endpoints.stats());
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useLiveEvents({
    onEvent: (evt) => {
      if (
        [
          "incident_detected",
          "incident_status",
          "incident_update",
          "incident_resolved",
          "timeline_event",
        ].includes(evt.type)
      ) {
        void refresh();
      }
    },
  });

  const active = useMemo(
    () =>
      (stats?.incidents ?? []).filter(
        (i) => i.status !== "resolved" && i.status !== "failed",
      ),
    [stats],
  );

  return (
    <div className="space-y-7">
      <Header actions={() => <SimulateButton onTriggered={refresh} />} />
      {error ? (
        <div className="text-danger text-sm">Failed to load: {error}</div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Incidents"
          value={stats?.activeIncidents ?? "—"}
          icon={<Siren className="w-5 h-5" />}
          accent="text-rose-500"
          sub="needing attention"
        />
        <StatCard
          label="Resolved Today"
          value={stats?.resolvedToday ?? "—"}
          icon={<CheckCircle2 className="w-5 h-5" />}
          accent="text-success"
          sub={`${stats?.resolvedIncidents ?? 0} total resolved`}
        />
        <StatCard
          label="Avg Resolution Time"
          value={stats ? fmtMin(stats.avgResolutionMinutes) : "—"}
          icon={<Clock className="w-5 h-5" />}
          accent="text-ghost"
          sub="across resolved incidents"
        />
        <StatCard
          label="Automated Resolution"
          value={stats ? `${stats.automationRate}%` : "—"}
          icon={<Zap className="w-5 h-5" />}
          accent="text-accent-light"
          sub={`${stats?.autoResolvedCount ?? 0} handled without humans`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_330px] gap-5">
        <Section
          title="Response queue"
          subtitle="Live incidents ordered by urgency and agent progress"
          action={
            <Link
              to="/incidents"
              className="text-xs font-semibold text-ghost hover:text-ghost-dim inline-flex items-center gap-1"
            >
              Open incident desk <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          <Card className="overflow-hidden">
            {!stats ? (
              <div className="p-8">
                <GhostLoader label="Loading response queue..." />
              </div>
            ) : active.length === 0 ? (
              <EmptyState
                title="Response queue is clear"
                hint="Run a simulation to watch GhostOps resolve one live."
              />
            ) : (
              <IncidentRows incidents={active} />
            )}
          </Card>
        </Section>

        <AttentionPanel activeCount={active.length} />
      </div>

      <Section
        title="Operational coverage"
        subtitle="The current state of autonomous response across your environment"
        action={
          <Link
            to="/incidents"
            className="text-xs text-ghost hover:text-ghost-glow inline-flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CoverageCard
            icon={<Radio className="w-4 h-4" />}
            label="Detection"
            value="Connected"
            detail="Signals are being ingested"
            tone="text-success"
          />
          <CoverageCard
            icon={<Activity className="w-4 h-4" />}
            label="Investigation"
            value={`${active.length} in progress`}
            detail="Agents are analyzing live issues"
            tone="text-ghost"
          />
          <CoverageCard
            icon={<ShieldAlert className="w-4 h-4" />}
            label="Guardrails"
            value="Healthy"
            detail="Approval gates are enforced"
            tone="text-accent-dim"
          />
        </div>
      </Section>
    </div>
  );
}

function Header({ actions }: { actions: () => React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-[11px] text-ghost tracking-[0.14em] uppercase font-semibold">
          <Activity className="w-3.5 h-3.5" /> Autonomous operations
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">
          Incident Command Center
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          See what is happening across your services, understand the cause, and
          let GhostOps coordinate the response.
        </p>
      </div>
      {actions()}
    </div>
  );
}

function AttentionPanel({ activeCount }: { activeCount: number }) {
  return (
    <Card className="p-5 bg-slate-950 text-white border-slate-900">
      <div className="flex items-center justify-between">
        <div className="label !text-slate-400">Needs attention</div>
        <ShieldAlert className="w-4 h-4 text-indigo-300" />
      </div>
      <div className="mt-5 text-4xl font-extrabold tracking-tight">
        {activeCount}
      </div>
      <p className="mt-1 text-sm text-slate-400">
        active incidents in the response queue
      </p>
      <div className="mt-6 space-y-2">
        <Link
          to="/approvals"
          className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2.5 text-xs text-slate-200 hover:bg-white/15"
        >
          <span>Review pending approvals</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </Link>
        <Link
          to="/agent"
          className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2.5 text-xs text-slate-200 hover:bg-white/15"
        >
          <span>Inspect agent activity</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </Link>
      </div>
    </Card>
  );
}

function CoverageCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3 glass-hover">
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100",
          tone,
        )}
      >
        {icon}
      </div>
      <div>
        <div className="label">{label}</div>
        <div className={cn("mt-1 text-sm font-bold", tone)}>{value}</div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </div>
    </Card>
  );
}

function IncidentRows({ incidents }: { incidents: Incident[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
          <th className="px-4 py-3 font-medium">Incident</th>
          <th className="px-4 py-3 font-medium">Severity</th>
          <th className="px-4 py-3 font-medium">Status</th>
          <th className="px-4 py-3 font-medium">AI Confidence</th>
          <th className="px-4 py-3 font-medium hidden lg:table-cell">
            Agent action
          </th>
          <th className="px-4 py-3 font-medium hidden md:table-cell">
            Elapsed
          </th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((i) => (
          <tr
            key={i.id}
            className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
          >
            <td className="px-4 py-3">
              <Link to={`/incidents/${i.id}`} className="group">
                <div className="font-semibold mono text-[13px] text-slate-200 group-hover:text-ghost">
                  {i.incident_code}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 max-w-[300px] truncate">
                  {i.title}
                </div>
              </Link>
            </td>
            <td className="px-4 py-3">
              <SeverityTag severity={i.severity} />
            </td>
            <td className="px-4 py-3">
              <StatusPill status={i.status} />
            </td>
            <td className="px-4 py-3 w-40">
              <ConfidenceBar
                value={i.ai_confidence ?? i.root_cause_confidence}
              />
            </td>
            <td className="px-4 py-3 hidden lg:table-cell">
              <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    i.status === "investigating"
                      ? "bg-ghost animate-pulse"
                      : "bg-slate-600",
                  )}
                />
                {agentActionLabel(i)}
              </span>
            </td>
            <td className="px-4 py-3 mono text-xs text-slate-500 hidden md:table-cell">
              {timeAgo(i.created_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function agentActionLabel(i: Incident): string {
  const st = i.metadata?.agentState as string | undefined;
  const map: Record<string, string> = {
    classifying: "Classifying issue",
    investigating: "Investigating",
    analyzing: "Analyzing root cause",
    planning: "Building remediation plan",
    acting: "Executing remediation",
    verifying: "Verifying resolution",
    waiting_approval: "Awaiting human approval",
    resolved: "Monitoring",
  };
  return map[st ?? ""] ?? (i.status === "resolved" ? "Monitoring" : "Idle");
}

function fmtMin(mins: number): string {
  if (!mins || mins <= 0) return "—";
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}
