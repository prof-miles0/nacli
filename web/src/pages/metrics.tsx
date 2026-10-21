import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useState } from "react";
import type { HistoryPoint, InstanceInfo } from "@shared/types";
import {
  type CapacityRow,
  ChartCard,
  OccupancyChart,
  type OccupancyInstance,
  type Series,
  TimeChart,
} from "@/components/charts";
import { DeviceMemorySection, DeviceWorkersSection } from "@/components/device-charts";
import { Toggle } from "@/components/table-tools";
import { Card, Dot, HoverCard, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor, useInstances } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

const RANGES = [
  { value: String(15 * 60_000), label: "15m" },
  { value: String(3_600_000), label: "1h" },
  { value: String(6 * 3_600_000), label: "6h" },
  { value: String(24 * 3_600_000), label: "24h" },
];
/** Only offered when history comes from VictoriaMetrics. */
const LONG_RANGES = [
  { value: String(7 * 86_400_000), label: "7d" },
  { value: String(30 * 86_400_000), label: "30d" },
];

/** Bucket width so a chart has at most ~240 points regardless of range. */
function bucketMs(rangeMs: number) {
  return Math.max(10_000, Math.ceil(rangeMs / 240 / 10_000) * 10_000);
}

/**
 * Joins per-instance series onto a shared time axis: each instance's points
 * are averaged into fixed buckets so instances polled at slightly different
 * moments line up in one tooltip.
 */
function join(
  history: Record<string, HistoryPoint[]>,
  ids: string[],
  pick: (p: HistoryPoint) => number | undefined,
  rangeMs: number,
) {
  const step = bucketMs(rangeMs);
  const buckets = new Map<number, Record<string, number[]>>();
  for (const id of ids) {
    for (const p of history[id] ?? []) {
      const v = pick(p);
      if (v == null) continue;
      const t = Math.floor(p.t / step) * step;
      const b = buckets.get(t) ?? {};
      (b[id] ??= []).push(v);
      buckets.set(t, b);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const row: Record<string, number> = { t };
      for (const [id, vs] of Object.entries(b)) row[id] = vs.reduce((x, y) => x + y, 0) / vs.length;
      return row;
    });
}


const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "#22c55e",
  ERROR_RECONNECT: "#f59e0b",
  ERROR_TIMEOUT: "#ef4444",
};
const EXTRA = ["var(--series-1)", "var(--series-7)", "var(--series-5)", "var(--series-4)"];

export function MetricsPage() {
  const [range, setRange] = useState(RANGES[1].value);
  const rangeMs = Number(range);
  const { visible } = useInstances();
  const { data: app } = useAppInfo();
  const fromVm = app?.historySource === "victoriametrics";
  const demand = useQuery({
    queryKey: ["controller-demand"],
    queryFn: endpoints.controllerDemand,
    enabled: fromVm,
    refetchInterval: 60_000,
  });
  const color = useInstanceColor();
  const history = useQuery({
    queryKey: ["history", rangeMs],
    queryFn: () => endpoints.history(rangeMs),
    refetchInterval: 10_000,
  });

  if (history.error) {
    return (
      <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
        Couldn't load history: {(history.error as Error).message}
      </div>
    );
  }
  if (!history.data) return <Spinner className="mx-auto mt-20" />;

  const h = history.data;
  // Instances that never answered have no history; keep them out of legends.
  const withData = visible.filter((i) => (h[i.id]?.length ?? 0) > 0);
  const ids = withData.map((i) => i.id);
  const series: Series[] = withData.map((i) => ({ key: i.id, name: i.name, color: color(i.id) }));


  // Worker responses by status, summed across the visible instances.
  const statuses = [
    ...new Set(ids.flatMap((id) => (h[id] ?? []).flatMap((p) => Object.keys(p.responseRates ?? {})))),
    // SUCCESS goes last so it is the top of the stack: near-zero error series
    // would otherwise draw their outline over it.
  ].sort((a, b) => (a === "SUCCESS" ? 1 : b === "SUCCESS" ? -1 : a.localeCompare(b)));
  const step = bucketMs(rangeMs);
  const respBuckets = new Map<number, Record<string, { sum: number; n: Record<string, number> }>>();
  for (const id of ids) {
    for (const p of h[id] ?? []) {
      if (!p.responseRates) continue;
      const t = Math.floor(p.t / step) * step;
      const b = respBuckets.get(t) ?? {};
      for (const [s, v] of Object.entries(p.responseRates)) {
        const e = (b[s] ??= { sum: 0, n: {} });
        e.sum += v;
        e.n[id] = (e.n[id] ?? 0) + 1;
      }
      respBuckets.set(t, b);
    }
  }
  const respData = [...respBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const row: Record<string, number> = { t };
      for (const [s, e] of Object.entries(b)) {
        // Average per instance within the bucket, then sum across instances.
        const perInstance = Object.values(e.n).reduce((x, y) => x + y, 0) / Object.keys(e.n).length;
        row[s] = e.sum / perInstance;
      }
      return row;
    });
  let extra = 0;
  const statusSeries: Series[] = statuses.map((s) => ({
    key: s,
    name: s,
    color: STATUS_COLORS[s] ?? EXTRA[extra++ % EXTRA.length],
  }));

  return (
    <div className="animate-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Only worth saying when history is the panel's own (short, lost on restart). */}
        {fromVm ? (
          <span />
        ) : (
          <p className="text-sm text-muted-foreground">History kept in memory by the panel since it started.</p>
        )}
        <Toggle value={range} onChange={setRange} options={fromVm ? [...RANGES, ...LONG_RANGES] : RANGES} />
      </div>
      <CapacitySection
        instances={withData}
        history={h}
        rangeMs={rangeMs}
        color={color}
        demand={demand.data?.instances}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Requests per second" subtitle="RPC requests per second" series={series}>
          <TimeChart data={join(h, ids, (p) => p.requestRate, rangeMs)} series={series} format={fmt.rate} />
        </ChartCard>
        <ChartCard title="Average latency" subtitle="ms per RPC request" series={series}>
          <TimeChart data={join(h, ids, (p) => p.latencyMs || undefined, rangeMs)} series={series} format={fmt.ms} />
        </ChartCard>
        <ChartCard title="Online devices" series={series}>
          <TimeChart data={join(h, ids, (p) => p.devicesConnected, rangeMs)} series={series} format={fmt.int} integer />
        </ChartCard>
        <ChartCard
          title="Worker responses by status"
          subtitle="Responses/s (all visible instances)"
          series={statusSeries}
        >
          <TimeChart data={respData} series={statusSeries} format={fmt.rate} stacked />
        </ChartCard>
      </div>
      {fromVm ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <DeviceWorkersSection rangeMs={rangeMs} instanceIds={ids} names={Object.fromEntries(visible.map((i) => [i.id, i.name]))} />
          <DeviceMemorySection rangeMs={rangeMs} instanceIds={ids} names={Object.fromEntries(visible.map((i) => [i.id, i.name]))} />
        </div>
      ) : null}
    </div>
  );
}


/**
 * Occupancy of every instance on one percentage chart, with each instance's
 * current numbers (occupancy, free workers, rejections in the last hour) as
 * pills in the header.
 */
function CapacitySection({
  instances,
  history,
  rangeMs,
  color,
  demand,
}: {
  instances: InstanceInfo[];
  history: Record<string, HistoryPoint[]>;
  rangeMs: number;
  color: (id: string) => string;
  demand?: Record<string, { attempts: number; served: number; rejected: number }>;
}) {
  const step = bucketMs(rangeMs);
  const series: OccupancyInstance[] = instances.map((i) => {
    // One point per bucket (the latest), same buckets as the other charts.
    const byBucket = new Map<number, CapacityRow>();
    for (const p of history[i.id] ?? []) {
      const t = Math.floor(p.t / step) * step;
      byBucket.set(t, {
        t,
        used: p.controllers,
        free: Math.max(0, p.workersConnected - p.controllers),
        rejected: p.rejectedPerHour,
      });
    }
    return { id: i.id, name: i.name, color: color(i.id), rows: [...byBucket.values()].sort((a, b) => a.t - b.t) };
  });

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">Occupancy</h3>
          <HoverCard
            content={
              <div className="flex max-w-xs flex-col gap-1">
                <span>Share of online workers that are in use, per instance.</span>
                <span className="text-muted-foreground">
                  The strip below turns <span className="text-red-400">red</span> when Rotom rejected
                  controllers because no worker was free.
                </span>
              </div>
            }
          >
            <Info className="size-3.5 text-muted-foreground hover:text-foreground" aria-label="Info" />
          </HoverCard>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {instances.map((i) => {
            const s = i.summary;
            const used = s?.workersInUse ?? 0;
            const total = s?.workersConnected ?? 0;
            const free = Math.max(0, total - used);
            const d = demand?.[i.id];
            const rejecting = d && d.rejected >= Math.max(5, d.attempts * 0.05);
            return (
              <span
                key={i.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-background/40 px-2.5 py-1 text-[11px] tabular-nums"
              >
                <Dot color={color(i.id)} />
                <span className="font-medium">{i.name}</span>
                <span className="text-muted-foreground">
                  {total ? fmt.pct((used / total) * 100) : "—"} · {used}/{total}
                </span>
                <span className={cn(total && free === 0 ? "text-amber-400" : "text-muted-foreground")}>
                  · {free} free
                </span>
                {rejecting ? <span className="text-red-400">· ≈{fmt.int(d.rejected)} rejected/h</span> : null}
              </span>
            );
          })}
        </div>
      </div>
      <OccupancyChart instances={series} />
    </Card>
  );
}
