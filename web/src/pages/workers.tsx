import { AlertTriangle, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Controller, Tagged, Worker } from "@shared/types";
import { ActionsMenu, CONTROLLER_ACTIONS, useNotify } from "@/components/actions";
import { matches, SearchBox, Toggle, useSorted } from "@/components/table-tools";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { Dot, Empty, HoverCard, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor, useInstances, useStatus } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

type Win = "30s" | "1m" | "5m" | "15m";
const RATE_KEY: Record<Win, keyof NonNullable<Worker["time_windowed_stats"]>> = {
  "30s": "requests_rate_over_30_seconds",
  "1m": "requests_rate_over_1_min",
  "5m": "requests_rate_over_5_min",
  "15m": "requests_rate_over_15_min",
};
const MS_KEY: Record<Win, keyof NonNullable<Worker["time_windowed_stats"]>> = {
  "30s": "request_ms_avg_over_30_seconds",
  "1m": "request_ms_avg_over_1_min",
  "5m": "request_ms_avg_over_5_min",
  "15m": "request_ms_avg_over_15_min",
};

/**
 * Worker ids are "<base>_<n>" or "<base>-<n>", where the base is usually the
 * device id shared by all its workers; split them so the number stands out.
 */
export function splitWorkerId(id: string): { base: string; num: string } {
  const m = /^(.*?)[_-](\d+)$/.exec(id);
  return m ? { base: m[1], num: m[2] } : { base: "", num: id };
}

function workerState(w: Worker): { label: string; tone: StatusTone } {
  if (!w.is_connected) return { label: "Offline", tone: "bad" };
  if (w.is_in_use) return { label: "In use", tone: "good" };
  if (!w.can_be_used) return { label: "Unavailable", tone: "warn" };
  return { label: "Idle", tone: "info" };
}

/** Status dot plus the worker's number; the full id shows on hover. */
export function WorkerName({ w }: { w: Worker }) {
  const st = workerState(w);
  const { base, num } = splitWorkerId(w.id);
  return (
    <div className="flex items-center gap-2.5">
      <StatusDot
        tone={st.tone}
        label={st.label}
        detail={w.is_connected ? undefined : `Seen ${fmt.ago(w.last_seen_at_ms)}`}
      />
      {/* Full id only on hover; the number is what tells workers apart. */}
      <span className="group/name relative" tabIndex={0}>
        <span className="cursor-default font-mono font-semibold tabular-nums">{num}</span>
        {base ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute top-1/2 left-full z-20 ml-2 -translate-y-1/2 rounded-md border bg-popover px-2 py-1 font-mono text-xs whitespace-nowrap opacity-0 shadow-lg transition-opacity group-hover/name:opacity-100 group-focus/name:opacity-100"
          >
            {w.id}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Agent, weight and traffic of a controller, for its hover card. */
function ControllerDetails({ c }: { c: Controller }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{c.id}</span>
      <span className="text-muted-foreground">{c.user_agent || "Unknown agent"}</span>
      <span className="text-muted-foreground tabular-nums">
        Weight {c.weight} · online {fmt.duration(Date.now() - c.connected_at_ms)} · messages{" "}
        {fmt.int(c.messages_received)}/{fmt.int(c.messages_sent)}
      </span>
    </div>
  );
}

/** Rows per instance before "Show more". */
const COLLAPSED_ROWS = 4;

export function WorkersPage() {
  const { data, isLoading } = useStatus();
  const { visible } = useInstances();
  const color = useInstanceColor();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [win, setWin] = useState<Win>("1m");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { notify, node } = useNotify();
  const { data: app } = useAppInfo();
  const demand = useQuery({
    queryKey: ["controller-demand"],
    queryFn: endpoints.controllerDemand,
    enabled: !!app?.instances.length,
    refetchInterval: 60_000,
  });
  const toggleGroup = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rows = (data?.workers ?? []).filter(
    (w) =>
      matches(
        q,
        w.id,
        w.origin,
        w.instanceName,
        w.session?.controller?.id,
        w.session?.controller?.account_username,
        w.session?.controller?.user_agent,
      ) &&
      (filter === "all" ||
        (filter === "inuse" && w.is_in_use) ||
        (filter === "free" && w.is_connected && !w.is_in_use) ||
        (filter === "offline" && !w.is_connected)),
  );
  const rate = (w: Worker) => w.time_windowed_stats?.[RATE_KEY[win]] ?? 0;
  const lat = (w: Worker) => w.time_windowed_stats?.[MS_KEY[win]] ?? 0;

  const { sorted, header } = useSorted<Tagged<Worker>>(
    rows,
    {
      // Device first, then worker number, so a device's workers stay together.
      id: (w) => `${w.origin} ${splitWorkerId(w.id).num.padStart(6, "0")}`,
      origin: (w) => w.origin,
      ctrl: (w) => w.session?.controller?.id ?? "",
      account: (w) => w.session?.controller?.account_username ?? "",
      rate,
      lat,
      since: (w) => -(w.session?.connected_at_ms ?? Date.now()),
    },
    "rate",
    true,
  );

  // One table per instance, in config.toml order; empty instances keep their
  // header unless a search or filter is narrowing the list.
  const narrowed = !!q || filter !== "all";
  const groups = visible
    .map((i) => ({ id: i.id, name: i.name, rows: sorted.filter((w) => w.instanceId === i.id) }))
    .filter((g) => g.rows.length || !narrowed);

  if (isLoading) return <Spinner className="mx-auto mt-20" />;

  return (
    <div className="animate-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search worker, origin, account…" />
        <div className="flex flex-wrap gap-2">
          <Toggle
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All (${data?.workers.length ?? 0})` },
              { value: "inuse", label: "In use" },
              { value: "free", label: "Free" },
              { value: "offline", label: "Offline" },
            ]}
          />
          <Toggle
            value={win}
            onChange={(v) => setWin(v as Win)}
            options={(["30s", "1m", "5m", "15m"] as const).map((w) => ({ value: w, label: w }))}
          />
        </div>
      </div>
      {groups.length === 0 ? (
        <Empty>No workers to show.</Empty>
      ) : (
        groups.map((g) => {
          const all = (data?.workers ?? []).filter((w) => w.instanceId === g.id);
          const totalRate = all.reduce((a, w) => a + rate(w), 0);
          const open = expanded.has(g.id);
          const shown = open ? g.rows : g.rows.slice(0, COLLAPSED_ROWS);
          const hidden = g.rows.length - shown.length;
          const d = demand.data?.instances[g.id];
          return (
            <section key={g.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <Dot color={color(g.id)} />
                <h2 className="font-semibold">{g.name}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {all.filter((w) => w.is_in_use).length}/{all.filter((w) => w.is_connected).length} in use ·{" "}
                  {fmt.dec2(totalRate)} req/s ({win})
                </span>
                {/* increase() extrapolates, so a handful of "rejections" is counter noise. */}
                {d && d.rejected >= Math.max(5, d.attempts * 0.05) ? (
                  <HoverCard
                    content={
                      <div className="flex max-w-xs flex-col gap-1">
                        <span className="font-medium">Unserved controllers (last hour)</span>
                        <span className="text-muted-foreground">
                          Rotom received {fmt.int(d.attempts)} controller connections and assigned a worker to{" "}
                          {fmt.int(d.served)}. The rest were rejected because no worker was free.
                        </span>
                        <span className="text-muted-foreground/80">
                          Rotom closes those connections immediately, so they don't appear in the table: the figure is
                          an estimate from its metrics.
                        </span>
                      </div>
                    }
                  >
                    <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                      <AlertTriangle className="size-3" />≈{fmt.int(d.rejected)} controllers rejected/h
                    </span>
                  </HoverCard>
                ) : null}
              </div>
              {g.rows.length === 0 ? (
                <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No workers on this instance.
                </div>
              ) : (
                <div className={cn("relative", g.rows.length > COLLAPSED_ROWS && "mb-3")}>
                <Table className={cn(g.rows.length > COLLAPSED_ROWS && "pb-3.5")}>
                  <thead>
                    <tr>
                      {header("id", "Worker")}
                      {header("origin", "Device")}
                      {header("ctrl", "Controller")}
                      {header("account", "Account")}
                      {header("rate", `Req/s (${win})`)}
                      {header("lat", `Latency (${win})`)}
                      {header("since", "Session")}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((w) => {
                      const c = w.session?.controller;
                      return (
                        <tr key={w.id}>
                          <td>
                            <WorkerName w={w} />
                          </td>
                          <td className="whitespace-nowrap">{w.origin}</td>
                          <td className="whitespace-nowrap">
                            {c ? <HoverCard content={<ControllerDetails c={c} />}>{c.id}</HoverCard> : "—"}
                          </td>
                          <td className="text-muted-foreground">
                            {c ? (
                              <>
                                {c.account_username} <span className="text-[10px] opacity-70">{c.account_source}</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="tabular-nums">{fmt.dec2(rate(w))}</td>
                          <td className="tabular-nums">{fmt.ms(lat(w))}</td>
                          <td className="whitespace-nowrap text-muted-foreground">
                            {w.session ? fmt.duration(Date.now() - w.session.connected_at_ms) : "—"}
                          </td>
                          <td className="py-0! text-right">
                            {c ? (
                              <ActionsMenu
                                instanceId={w.instanceId}
                                basePath={`/controller/${encodeURIComponent(c.uuid)}`}
                                actions={CONTROLLER_ACTIONS}
                                subject={c.id}
                                kind="Controller"
                                notify={notify}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                  {g.rows.length > COLLAPSED_ROWS ? (
                    // Sits on the table's bottom edge, centred, half inside and half out.
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      className="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 translate-y-1/2 items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs whitespace-nowrap text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                      {open ? "Show less" : `Show ${hidden} more`}
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          );
        })
      )}
      {node}
    </div>
  );
}
