import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Clock, Cpu, Gamepad2, Gauge, Network, Smartphone, Timer } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { HistoryPoint, InstanceInfo } from "@shared/types";
import { Sparkline } from "@/components/charts";
import { AccentCard, Badge, Label, Spinner, StackBar } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useInstanceColor, useInstances } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

export function InstancesPage() {
  const { visible, isLoading } = useInstances();
  const color = useInstanceColor();
  const { hash } = useLocation();
  const history = useQuery({
    queryKey: ["history", 3_600_000],
    queryFn: () => endpoints.history(3_600_000),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!hash || isLoading) return;
    document.getElementById(`inst-${hash.slice(1)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, isLoading]);

  if (isLoading) return <Spinner className="mx-auto mt-20" />;

  return (
    <div className="animate-in flex flex-col gap-5">
      {visible.map((i) => (
        <AccentCard
          key={i.id}
          id={`inst-${i.id}`}
          accent={color(i.id)}
          hover={false}
          className="scroll-mt-20"
        >
          <InstanceCard i={i} accent={color(i.id)} history={history.data?.[i.id] ?? []} />
        </AccentCard>
      ))}
    </div>
  );
}

/** Small tile with an icon, a label, a headline value and an optional line below. */
function Tile({
  icon: Icon,
  label,
  value,
  sub,
  children,
}: {
  icon: typeof Cpu;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" />
        <Label>{label}</Label>
      </div>
      <div className="truncate text-xl leading-none font-bold tabular-nums">{value}</div>
      {children}
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function Ratio({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
    </div>
  );
}

/** "label value" pair laid out as a definition row. */
function Item({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate text-right font-medium tabular-nums">{v ?? "—"}</span>
    </div>
  );
}

/** Detail panel, collapsed by default; the header shows a one-line summary while closed. */
function Panel({ title, summary, children }: { title: string; summary?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-background/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <Label>{title}</Label>
        {!open && summary ? (
          <span className="ml-auto truncate text-xs text-muted-foreground tabular-nums">{summary}</span>
        ) : null}
      </button>
      {open ? <div className="animate-in divide-y divide-border/60 px-4 pb-3">{children}</div> : null}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "#22c55e",
  ERROR_RECONNECT: "#f59e0b",
  ERROR_RESTART_SESSION: "#a855f7",
  ERROR_TIMEOUT: "#f97316",
  ERROR_UNKNOWN: "#ef4444",
};
const OTHER_COLORS = ["#3b82f6", "#06b6d4", "#ec4899", "#84cc16"];

type Cfg = Record<string, Record<string, unknown> | string | undefined>;

function InstanceCard({ i, accent, history }: { i: InstanceInfo; accent: string; history: HistoryPoint[] }) {
  const s = i.summary;
  const p = i.metrics?.process;
  const cfg = i.config as Cfg | undefined;
  const dev = cfg?.device_listener as Record<string, string> | undefined;
  const ctl = cfg?.controller_listener as Record<string, string> | undefined;
  const rl = cfg?.rate_limit as Record<string, unknown> | undefined;
  const uptime = p?.startTimeSeconds ? Date.now() - p.startTimeSeconds * 1000 : undefined;

  // Worker responses since start, grouped by status for the stacked bar and by method for the list.
  const responses = i.metrics?.workerResponses ?? [];
  const total = responses.reduce((a, r) => a + r.count, 0);
  const byStatus = new Map<string, number>();
  const byMethod = new Map<string, { total: number; ok: number }>();
  for (const r of responses) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + r.count);
    const m = byMethod.get(r.method) ?? { total: 0, ok: 0 };
    m.total += r.count;
    if (r.status === "SUCCESS") m.ok += r.count;
    byMethod.set(r.method, m);
  }
  let other = 0;
  const segments = [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, value]) => ({
      label: status,
      value,
      color: STATUS_COLORS[status] ?? OTHER_COLORS[other++ % OTHER_COLORS.length],
    }));

  return (
    <div className="flex flex-col gap-5 p-5">
      {/* Header: name and pills share one centred row. The URL is never shown: it is often an internal address. */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              i.reachable ? "bg-green-500 shadow-[0_0_8px] shadow-green-500/70" : "bg-red-500",
            )}
          />
          <h2 className="text-xl leading-7 font-bold">{i.name}</h2>
          <div className="flex w-full flex-wrap items-center gap-1.5 pl-5.5 sm:ml-auto sm:w-auto sm:pl-0">
            {i.config?.version ? <Badge className="h-5">v{i.config.version}</Badge> : null}
            {i.config?.sha ? (
              <span title={i.config.sha} className="inline-flex">
                <Badge className="h-5 font-mono">{i.config.sha.slice(0, 7)}</Badge>
              </span>
            ) : null}
            {i.reachable ? (
              <Badge tone="good" className="h-5">
                Online
              </Badge>
            ) : (
              <Badge tone="bad" className="h-5">
                Offline
              </Badge>
            )}
            <span className="ml-1 inline-flex h-5 items-center gap-1 text-xs text-muted-foreground tabular-nums">
              <Clock className="size-3" />
              {fmt.ago(i.lastPollAt)}
              {i.latencyMs != null && i.reachable ? ` · ${i.latencyMs} ms` : ""}
            </span>
          </div>
        </div>
      </div>

      {!i.reachable ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {i.lastError ?? "Waiting for the first poll…"}
            {i.lastSuccessAt ? (
              <span className="text-muted-foreground"> · last good data {fmt.ago(i.lastSuccessAt)}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {s || p ? (
        <>
          {/* Live state */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile
              icon={Cpu}
              label="Workers"
              value={s ? `${s.workersInUse}/${s.workersConnected}` : "—"}
              sub={s ? `${fmt.pct(s.workersConnected ? (s.workersInUse / s.workersConnected) * 100 : 0)} in use` : undefined}
            >
              {s ? <Ratio value={s.workersConnected ? s.workersInUse / s.workersConnected : 0} color={accent} /> : null}
            </Tile>
            <Tile
              icon={Smartphone}
              label="Devices"
              value={s ? `${s.devicesConnected}/${s.devices}` : "—"}
              sub={s ? `weight ${s.weightInUse}/${s.weightMax}` : undefined}
            >
              {s ? <Ratio value={s.devices ? s.devicesConnected / s.devices : 0} color={accent} /> : null}
            </Tile>
            <Tile icon={Gamepad2} label="Controllers" value={s?.controllers ?? "—"} sub="online now" />
            <Tile
              icon={Gauge}
              label="Requests/s"
              value={s ? fmt.dec2(s.rates["30s"]) : "—"}
              sub={s ? `5m ${fmt.dec2(s.rates["5m"])} · 15m ${fmt.dec2(s.rates["15m"])}` : undefined}
            />
            <Tile
              icon={Timer}
              label="Latency"
              value={s ? fmt.ms(s.latencies["30s"]) : "—"}
              sub={s ? `15m ${fmt.ms(s.latencies["15m"])}` : undefined}
            />
            <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Network className="size-3.5" />
                <Label>Req/s · 1h</Label>
              </div>
              <div className="mt-auto">
                <Sparkline values={history.map((h) => h.requestRate)} color={accent} height={44} />
              </div>
            </div>
          </div>

          {/* Details: each panel collapsed by default */}
          <div className="grid items-start gap-3 lg:grid-cols-3">
            <Panel
              title="Process"
              summary={`${fmt.duration(uptime)} up · ${fmt.bytes(p?.residentBytes)}`}
            >
              <Item k="Uptime" v={fmt.duration(uptime)} />
              <Item
                k="Average CPU"
                v={p?.cpuSecondsTotal && uptime ? fmt.pct((p.cpuSecondsTotal / (uptime / 1000)) * 100) : "—"}
              />
              <Item k="Resident memory" v={fmt.bytes(p?.residentBytes)} />
              <Item k="Heap in use" v={fmt.bytes(p?.heapBytes)} />
              <Item k="Goroutines · threads" v={p ? `${fmt.int(p.goroutines)} · ${fmt.int(p.threads)}` : "—"} />
              <Item k="Network rx · tx" v={p ? `${fmt.bytes(p.networkRxBytes)} · ${fmt.bytes(p.networkTxBytes)}` : "—"} />
              <Item k="Go" v={p?.goVersion} />
            </Panel>

            <Panel
              title="Configuration"
              summary={`Jobs ${i.config?.jobs?.enable ? "yes" : "no"} · ping ${dev?.ping_interval ?? "—"}`}
            >
              <Item k="Instance name" v={(cfg?.instance as string) || "—"} />
              <Item
                k="Jobs"
                v={i.config?.jobs?.enable ? <Badge tone="good">Enabled</Badge> : <Badge>Disabled</Badge>}
              />
              <Item
                k="Rate limit"
                v={rl ? (rl.enable ? `${rl.max_selections} / ${rl.duration}` : <Badge>Disabled</Badge>) : "—"}
              />
              <Item k="Devices · ping/pong" v={dev ? `${dev.ping_interval} / ${dev.pong_wait}` : "—"} />
              <Item k="Controllers · ping/pong" v={ctl ? `${ctl.ping_interval} / ${ctl.pong_wait}` : "—"} />
              <Item k="Registration timeout" v={ctl?.registration_timeout} />
              <Item k="Data timeout" v={ctl?.data_timeout} />
            </Panel>

            <Panel
              title="Responses"
              summary={
                total
                  ? `${fmt.int(total)} · ${fmt.int(total - (byStatus.get("SUCCESS") ?? 0))} errors`
                  : "no data"
              }
            >
              {total ? (
                <div className="flex flex-col gap-4 py-2">
                  <p className="text-xs text-muted-foreground">Worker responses since Rotom started.</p>
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold tabular-nums">{fmt.int(total)}</span>
                    {/* A count, not a percentage: with millions of responses errors round away to "100%". */}
                    <span className="text-xs text-muted-foreground">
                      {total - (byStatus.get("SUCCESS") ?? 0)
                        ? `${fmt.int(total - (byStatus.get("SUCCESS") ?? 0))} errors`
                        : "no errors"}
                    </span>
                  </div>
                  <StackBar segments={segments} />
                  <div className="flex flex-col gap-1">
                    {[...byMethod.entries()]
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([method, m]) => (
                        <div key={method} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">{method}</span>
                          <span className="tabular-nums">
                            {fmt.int(m.total)}{" "}
                            <span className="text-muted-foreground">· {fmt.dec2((m.ok / m.total) * 100)}% ok</span>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">No responses recorded yet.</p>
              )}
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}
