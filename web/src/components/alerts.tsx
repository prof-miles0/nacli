import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, CircleHelp, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { type Alert, computeAlerts } from "@shared/alerts";
import { endpoints } from "@/lib/api";
import { useAppInfo } from "@/lib/state";
import { cn } from "@/lib/utils";

/**
 * Everything that is not working right now, gathered from the same queries the
 * pages use (react-query shares them, so this adds no extra requests).
 */
export function useAlerts(): Alert[] {
  const { data: app } = useAppInfo();
  // Rejected controllers: from Zapdos or from the metrics kept in memory.
  const demand = useQuery({
    queryKey: ["controller-demand"],
    queryFn: endpoints.controllerDemand,
    enabled: !!app?.instances.length,
    refetchInterval: 60_000,
  });
  const dragonite = useQuery({
    queryKey: ["dragonite-summary"],
    queryFn: endpoints.dragoniteSummary,
    enabled: !!app?.dragonite.length,
    refetchInterval: 30_000,
  });
  const golbat = useQuery({
    queryKey: ["golbat-summary"],
    queryFn: endpoints.golbatSummary,
    enabled: !!app?.golbat,
    refetchInterval: 60_000,
  });
  const rates = useQuery({
    queryKey: ["dragonite-rate-limits"],
    queryFn: endpoints.rateLimits,
    enabled: !!app?.dragonite.some((d) => d.accounts),
    refetchInterval: 30_000,
  });
  const duplicates = useQuery({
    queryKey: ["account-duplicates"],
    queryFn: endpoints.accountDuplicates,
    enabled: (app?.dragonite.filter((d) => d.accounts).length ?? 0) > 1,
    refetchInterval: 300_000,
  });
  if (!app) return [];
  return computeAlerts({
    app,
    demand: demand.data,
    dragonite: dragonite.data,
    golbat: golbat.data,
    rates: rates.data,
    duplicates: duplicates.data,
  });
}

const SHOWN = 3;

/** How many problems there are, beside Status in the sidebar: the alerts live on that page. */
export function AlertCount() {
  const alerts = useAlerts();
  if (!alerts.length) return null;
  const n = alerts.length;
  return (
    <span
      className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-400 tabular-nums"
      title={n === 1 ? "1 problem" : `${n} problems`}
      aria-label={n === 1 ? "1 problem" : `${n} problems`}
    >
      {n}
    </span>
  );
}

/** Alarm box at the top of Status; absent while everything works. */
export function AlertsBar() {
  const alerts = useAlerts();
  const [expanded, setExpanded] = useState(false);
  if (!alerts.length) return null;
  const critical = alerts.some((a) => a.level === "critical");
  const list = expanded ? alerts : alerts.slice(0, SHOWN);
  const Icon = critical ? OctagonAlert : AlertTriangle;

  return (
    <div
      role="alert"
      className={cn(
        "animate-in flex gap-3 rounded-xl border px-4 py-3",
        critical ? "border-red-500/40 bg-red-500/10" : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", critical ? "text-red-400" : "text-amber-400")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className={cn("text-sm font-semibold", critical ? "text-red-300" : "text-amber-300")}>
          {alerts.length === 1 ? "Something's wrong" : `${alerts.length} problems`}
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {list.map((a) => (
            <li key={a.key} className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  a.level === "critical" ? "animate-pulse bg-red-500" : "bg-amber-500",
                )}
              />
              <span className="min-w-0">
                <Link to={a.to} className="hover:underline">
                  <b className="font-medium">{a.subject}</b> <span className="text-muted-foreground">{a.text}</span>
                </Link>
                {a.help ? (
                  <Link
                    to={`/help#${a.help}`}
                    className="ml-2 inline-flex items-center gap-0.5 align-baseline text-xs font-medium whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    <CircleHelp className="size-3 self-center" />
                    Help
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {alerts.length > SHOWN ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Show less" : `Show ${alerts.length - SHOWN} more`}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
