import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { endpoints } from "@/lib/api";
import { isUp, linkState } from "@/lib/dragonite";
import { useAppInfo } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

interface Alert {
  key: string;
  level: "critical" | "warning";
  /** Who has the problem, in bold. */
  subject: string;
  text: string;
  to: string;
}

const ago = (s?: number) => (s != null ? ` (last seen ${fmt.ago(Date.now() - s * 1000)})` : "");

/**
 * Everything that is not working right now, gathered from the same queries the
 * pages use (react-query shares them, so this adds no extra requests).
 */
function useAlerts(): Alert[] {
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
  const rotomName = (id: string) => app.instances.find((i) => i.id === id)?.name ?? id;
  const out: Alert[] = [];

  for (const i of app.instances) {
    if (!i.reachable) {
      out.push({
        key: `rotom:${i.id}`,
        level: "critical",
        subject: `Rotom ${i.name}`,
        text: `offline${i.lastError ? ` (${i.lastError})` : ""}`,
        to: `/instances#${i.id}`,
      });
      continue;
    }
    const d = demand.data?.instances[i.id];
    // Same threshold as the Workers page badge: ignore the odd reconnect.
    if (d && d.rejected >= Math.max(5, d.attempts * 0.05)) {
      out.push({
        key: `rejected:${i.id}`,
        level: "warning",
        subject: `Rotom ${i.name}`,
        text: `rejects ≈${fmt.int(d.rejected)} controllers/h for lack of free workers`,
        to: "/workers",
      });
    }
  }

  for (const d of dragonite.data?.instances ?? []) {
    const subject = `Dragonite ${d.name}`;
    if (!isUp(d)) {
      out.push({ key: `dragonite:${d.id}`, level: "critical", subject, text: `isn't sending metrics${ago(d.lastSeenS)}`, to: "/" });
      continue;
    }
    const state = linkState(d);
    if (state === "none") {
      out.push({
        key: `dragonite-link:${d.id}`,
        level: "warning",
        subject,
        text: `no Rotom sees its controllers${d.rotom ? ` (should be on ${rotomName(d.rotom)})` : ""}`,
        to: "/",
      });
    } else if (state === "mismatch") {
      const where = d.links.filter((l) => l.controllers > 0 && l.rotomId !== d.rotom).map((l) => rotomName(l.rotomId));
      out.push({
        key: `dragonite-link:${d.id}`,
        level: "warning",
        subject,
        text: `has controllers on ${where.join(", ")}, but is configured for ${rotomName(d.rotom!)}`,
        to: "/",
      });
    }
  }
  // Dragonite slowed itself down: the admin's "Global Rate Limit Degraded" banner.
  for (const r of rates.data ?? []) {
    const l = r.rateLimit;
    if (l.ratio >= 1) continue;
    out.push({
      key: `rate:${r.id}`,
      level: l.ratio < 0.25 ? "critical" : "warning",
      subject: `Dragonite ${r.name}`,
      text: `global rate limit degraded to ${fmt.dec2(l.allowedPerSecond)}/s (${fmt.pct(l.ratio * 100)} of base): ${l.lastDecreaseReason || "unknown reason"}${
        l.lastDecreaseAt ? ` · ${fmt.ago(l.lastDecreaseAt * 1000)}` : ""
      }`,
      to: "/status",
    });
  }
  for (const u of dragonite.data?.unmatched ?? []) {
    out.push({
      key: `unmatched:${u.rotomId}:${u.source}`,
      level: "warning",
      subject: `Rotom ${rotomName(u.rotomId)}`,
      text: `has ${u.controllers} controller${u.controllers === 1 ? "" : "s"} from "${u.source}", which matches no [[stack]]`,
      to: "/",
    });
  }

  // An account in two stacks: both use it and get in each other's way.
  const dup = duplicates.data ?? [];
  if (dup.length) {
    const names = dup.slice(0, 3).map((o) => o.username).join(", ");
    out.push({
      key: "account-duplicates",
      level: "warning",
      subject: `${dup.length} account${dup.length === 1 ? "" : "s"}`,
      text: `in more than one stack: ${names}${dup.length > 3 ? "…" : ""}`,
      to: "/dragonite/accounts",
    });
  }

  const g = golbat.data;
  if (g && (g.lastSeenS == null || g.lastSeenS >= 120)) {
    out.push({ key: "golbat", level: "critical", subject: "Golbat", text: `isn't sending metrics${ago(g.lastSeenS)}`, to: "/golbat/metrics" });
  }

  // Critical first; stable otherwise.
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

const SHOWN = 3;

/** Alarm box at the top of every page; absent while everything works. */
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
        "animate-in mb-4 flex gap-3 rounded-xl border px-4 py-3",
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
              <Link to={a.to} className="min-w-0 hover:underline">
                <b className="font-medium">{a.subject}</b> <span className="text-muted-foreground">{a.text}</span>
              </Link>
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
