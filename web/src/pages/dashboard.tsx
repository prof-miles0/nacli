import { useQueries, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router";
import type { AccountCounts, HistoryPoint, InstanceInfo } from "@shared/types";
import { Legend, REJECTED_NOISE_PER_HOUR, type Series, Sparkline, TimeChart } from "@/components/charts";
import { Toggle } from "@/components/table-tools";
import { Card, HoverCard, Label, Spinner, StackBar, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { type DragoniteRow, isUp, linkState } from "@/lib/dragonite";
import { useAppInfo, useInstanceColor, useInstances } from "@/lib/state";
import { toChart } from "@/components/vm-panel";
import { MiniBar, segments, STATUSES } from "@/pages/dragonite-accounts";
import { cn, fmt } from "@/lib/utils";

// MapLibre is large: load it only when the map is shown.
const DeviceMap = lazy(() => import("@/components/device-map").then((m) => ({ default: m.DeviceMap })));

const RANGES = [
  { value: String(3_600_000), label: "1h" },
  { value: String(6 * 3_600_000), label: "6h" },
  { value: String(12 * 3_600_000), label: "12h" },
  { value: String(24 * 3_600_000), label: "24h" },
];

type WorkerMetric = "workersInUse";

/**
 * One row per time bucket with each instance's value averaged inside it, so
 * instances polled at slightly different moments stack cleanly.
 */
function bucketize(history: Record<string, HistoryPoint[]>, ids: string[], metric: WorkerMetric, rangeMs: number) {
  // Size buckets by the data actually held, not the requested range, so a
  // freshly started panel still draws a line at 24h.
  const first = Math.min(...ids.map((id) => history[id]?.[0]?.t ?? Date.now()));
  const span = Math.min(rangeMs, Date.now() - first);
  const step = Math.max(10_000, Math.ceil(span / 240 / 10_000) * 10_000);
  const buckets = new Map<number, Record<string, number[]>>();
  for (const id of ids) {
    for (const p of history[id] ?? []) {
      const t = Math.floor(p.t / step) * step;
      const b = buckets.get(t) ?? {};
      (b[id] ??= []).push(p[metric]);
      buckets.set(t, b);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const row: Record<string, number> = { t };
      for (const id of ids) {
        const vs = b[id];
        // An instance with no sample in this bucket counts as 0 so the stack stays honest.
        row[id] = vs ? Math.round(vs.reduce((x, y) => x + y, 0) / vs.length) : 0;
      }
      return row;
    });
}

function WorkersChart({ instances, color }: { instances: InstanceInfo[]; color: (id: string) => string }) {
  const [range, setRange] = useState(RANGES[3].value);
  const rangeMs = Number(range);
  const history = useQuery({
    queryKey: ["history", rangeMs],
    queryFn: () => endpoints.history(rangeMs),
    refetchInterval: 30_000,
  });
  const ids = instances.map((i) => i.id);
  const data = history.data ? bucketize(history.data, ids, "workersInUse", rangeMs) : [];
  // An instance with no workers in use all period would only draw its outline
  // over the top of the stack, so it stays out of the chart (but in the legend).
  const series: Series[] = instances
    .filter((i) => data.some((r) => (r[i.id] ?? 0) > 0))
    .map((i) => ({ key: i.id, name: i.name, color: color(i.id) }));
  const now = instances.reduce((a, i) => a + (i.reachable ? (i.summary?.workersInUse ?? 0) : 0), 0);
  const connected = instances.reduce((a, i) => a + (i.reachable ? (i.summary?.workersConnected ?? 0) : 0), 0);

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label>Workers in use</Label>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl leading-none font-bold tabular-nums">{now}</span>
              <span className="text-sm text-muted-foreground">of {connected} connected</span>
            </div>
          </div>
          <Toggle value={range} onChange={setRange} options={RANGES} />
        </div>
        {/* Occupancy across the whole panel: one segment per instance in its colour, the rest is free capacity. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
            {instances
              .filter((i) => i.reachable && (i.summary?.workersInUse ?? 0) > 0)
              .map((i) => (
                <div
                  key={i.id}
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${((i.summary?.workersInUse ?? 0) / Math.max(1, connected)) * 100}%`,
                    background: color(i.id),
                  }}
                  title={`${i.name}: ${i.summary?.workersInUse ?? 0}`}
                />
              ))}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            <b className="text-foreground">{fmt.pct(connected ? (now / connected) * 100 : 0)}</b> occupancy ·{" "}
            {Math.max(0, connected - now)} free
          </span>
        </div>
      </div>
      {history.isLoading ? (
        <div className="grid h-[220px] place-items-center">
          <Spinner />
        </div>
      ) : (
        <TimeChart data={data} series={series} format={fmt.int} height={220} stacked integer />
      )}
      {/* Legend with each instance's workers in use right now. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {instances.map((i) => (
          <span key={i.id} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ background: color(i.id) }} />
            <span className="text-muted-foreground">{i.name}</span>
            <span className="font-semibold tabular-nums">{i.reachable ? (i.summary?.workersInUse ?? 0) : "—"}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { visible, isLoading } = useInstances();
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const navigate = useNavigate();
  const spark = useQuery({
    queryKey: ["history", 3_600_000],
    queryFn: () => endpoints.history(3_600_000),
    refetchInterval: 10_000,
  });

  if (isLoading) return <Spinner className="mx-auto mt-20" />;

  return (
    <div className="animate-in flex flex-col gap-4">
      {/* Where the devices are, from Golbat; above everything else. */}
      {app?.golbatMap ? (
        <Suspense fallback={<Card className="grid h-[440px] place-items-center"><Spinner /></Card>}>
          <DeviceMap instances={visible} color={color} basemap={app.map} />
        </Suspense>
      ) : null}
      {app?.dragonite.length ? <DragoniteOverview instances={visible} color={color} /> : null}
      {/* Only with a [stack.rotom] in config.toml. */}
      {app?.instances.length ? (
        <>
          <h2 className="mt-2 -mb-1 text-lg font-bold">Rotom</h2>
          <WorkersChart instances={visible} color={color} />
          <Table>
            <thead>
              <tr>
                <th>Instance</th>
                <th className="min-w-40">Workers</th>
                <th>Dev.</th>
                <th>Ctrl.</th>
                <th>Req/s</th>
                <th>Latency</th>
                <th className="w-36">Req/s · 1h</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const s = i.summary;
                const ok = i.reachable && s;
                return (
                  <tr key={i.id} className="cursor-pointer" onClick={() => navigate(`/instances#${i.id}`)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <InstanceStatusDot color={color(i.id)} online={i.reachable} error={i.lastError} />
                        <span className="font-medium whitespace-nowrap">{i.name}</span>
                        {i.config?.version ? (
                          <span className="text-xs text-muted-foreground">v{i.config.version}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {ok ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${s.workersConnected ? (s.workersInUse / s.workersConnected) * 100 : 0}%`,
                                background: color(i.id),
                              }}
                            />
                          </div>
                          <span className="w-14 text-right text-xs font-semibold tabular-nums">
                            {s.workersInUse}/{s.workersConnected}
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="tabular-nums">{ok ? `${s.devicesConnected}/${s.devices}` : "—"}</td>
                    <td className="tabular-nums">{ok ? s.controllers : "—"}</td>
                    <td className="tabular-nums">{ok ? fmt.dec2(s.requestRate) : "—"}</td>
                    <td className="tabular-nums whitespace-nowrap">{ok ? fmt.ms(s.latencyMs) : "—"}</td>
                    <td className="py-1!">
                      {ok ? (
                        <Sparkline values={(spark.data?.[i.id] ?? []).map((p) => p.requestRate)} color={color(i.id)} height={28} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      ) : null}

      {app?.golbat ? <GolbatOverview /> : null}
    </div>
  );
}

/**
 * The instance's colour inside a ring that says whether it answers: green
 * (online) or pulsing red (unreachable), with the reason on hover.
 */
function InstanceStatusDot({ color, online, error }: { color: string; online: boolean; error?: string }) {
  return (
    <HoverCard
      content={
        <span>
          <span className={cn("font-medium", online ? "text-green-400" : "text-red-400")}>
            {online ? "Online" : "Offline"}
          </span>
          {!online && error ? <span className="text-muted-foreground"> · {error}</span> : null}
        </span>
      }
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full ring-2",
          online ? "ring-green-500/80" : "animate-pulse ring-red-500",
        )}
      >
        <span className="size-2 rounded-full" style={{ background: color }} />
      </span>
    </HoverCard>
  );
}

/**
 * Each Dragonite next to the Rotom it feeds. The link is checked live: Rotom
 * lists its controllers and each one names its Dragonite in the user agent.
 */
function DragoniteOverview({ instances, color }: { instances: InstanceInfo[]; color: (id: string) => string }) {
  const navigate = useNavigate();
  const summary = useQuery({ queryKey: ["dragonite-summary"], queryFn: endpoints.dragoniteSummary, refetchInterval: 30_000 });
  const nameOf = (id: string) => instances.find((i) => i.id === id)?.name ?? id;
  const d = summary.data;
  // Without any [stack.rotom] there is no Rotom to link to.
  const withRotom = instances.length > 0;

  return (
    <>
      <h2 className="-mb-1 text-lg font-bold">Dragonite</h2>
      <AccountsOverview color={color} />
      {summary.error ? (
        <p className="text-sm text-red-300">{(summary.error as Error).message}</p>
      ) : !d ? (
        <Spinner />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>Instance</th>
                {withRotom ? <th>Rotom</th> : null}
                <th>Locations/h</th>
                <th>Time/loc.</th>
                <th>RPC · GMO OK</th>
                <th>Accounts · 1h</th>
                <th>No worker · 1h</th>
              </tr>
            </thead>
            <tbody>
              {d.instances.map((x) => {
                const up = isUp(x);
                return (
                  <tr key={x.id} className="cursor-pointer" onClick={() => navigate("/dragonite/metrics")}>
                    <td>
                      <div className="flex items-center gap-2">
                        <InstanceStatusDot
                          color={x.rotom ? color(x.rotom) : "var(--muted-foreground)"}
                          online={up}
                          error={x.lastSeenS != null ? `no metrics since ${fmt.ago(Date.now() - x.lastSeenS * 1000)}` : "no metrics"}
                        />
                        <HoverCard content={x.version ? `Dragonite v${x.version}` : "unknown version"}>
                          <span className="font-medium whitespace-nowrap">{x.name}</span>
                        </HoverCard>
                      </div>
                    </td>
                    {withRotom ? (
                      <td>
                        <RotomLink row={x} nameOf={nameOf} color={color} />
                      </td>
                    ) : null}
                    <td className="tabular-nums">{up ? fmt.int(x.locations) : "—"}</td>
                    <td className="tabular-nums whitespace-nowrap">
                      {up && x.locationSeconds != null ? `${fmt.dec2(x.locationSeconds)} s` : "—"}
                    </td>
                    <td className="tabular-nums whitespace-nowrap">
                      <PctCell value={up ? x.rpcOkPct : undefined} />
                      <span className="mx-1 text-muted-foreground">·</span>
                      <PctCell value={up ? x.gmoOkPct : undefined} />
                    </td>
                    <td className="tabular-nums whitespace-nowrap">
                      <HoverCard
                        content={
                          <span>
                            {fmt.int(x.accountsOk)} successful sessions · {fmt.int(x.accountsLimited)} accounts hit the limit
                            in the last hour
                          </span>
                        }
                      >
                        <span>
                          {fmt.int(x.accountsOk)}
                          {x.accountsLimited ? (
                            <span className="ml-1 text-amber-400">· {fmt.int(x.accountsLimited)} lim.</span>
                          ) : null}
                        </span>
                      </HoverCard>
                    </td>
                    <td className="tabular-nums whitespace-nowrap">
                      <HoverCard
                        content={
                          <span>
                            Times {x.rotom ? nameOf(x.rotom) : "Rotom"} closed a connection from this Dragonite for lack of
                            free workers, in the last hour.
                          </span>
                        }
                      >
                        <span className={cn(x.noWorkers > REJECTED_NOISE_PER_HOUR && "font-semibold text-amber-400")}>
                          {fmt.int(x.noWorkers)}
                        </span>
                      </HoverCard>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}

/**
 * Account health across every Dragonite with an API: the combined breakdown,
 * then one bar per instance. Shares its queries with the Accounts page.
 */
function AccountsOverview({ color }: { color: (id: string) => string }) {
  const navigate = useNavigate();
  const { data: app } = useAppInfo();
  const dragonites = (app?.dragonite ?? []).filter((d) => d.accounts);
  const stats = useQueries({
    queries: dragonites.map((d) => ({
      queryKey: ["account-stats", d.id],
      queryFn: () => endpoints.accountStats(d.id),
      refetchInterval: 15_000,
    })),
  });
  if (!dragonites.length) return null;

  const loaded = dragonites.map((d, i) => ({ d, q: stats[i] }));
  const ok = loaded.filter((x) => x.q.data);
  const total = { total: 0 } as AccountCounts;
  for (const st of STATUSES) total[st.key] = 0;
  for (const { q } of ok) {
    total.total += q.data!.total;
    for (const st of STATUSES) total[st.key] += q.data![st.key];
  }
  const lost = total.banned + total.auth_banned + total.invalid + total.suspended;

  return (
    <Card className="cursor-pointer gap-4 p-5" onClick={() => navigate("/dragonite/accounts")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label>Accounts · all instances</Label>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl leading-none font-bold tabular-nums">{fmt.int(total.total)}</span>
            <span className="text-sm text-muted-foreground">
              {fmt.int(total.good)} available · {fmt.int(total.in_use)} in use
              {lost ? <span className="text-red-400"> · {fmt.int(lost)} lost</span> : null}
            </span>
          </div>
        </div>
      </div>
      {ok.length ? (
        // Zero states only clutter the legend here; the Accounts page lists them all.
        <StackBar segments={segments(total).filter((x) => x.value > 0)} />
      ) : (
        <Spinner />
      )}
      <div className="flex flex-col gap-2">
        {loaded.map(({ d, q }) => (
          <div key={d.id} className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-3 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <span className="size-2 rounded-full" style={{ background: d.rotom ? color(d.rotom) : "var(--muted-foreground)" }} />
              {d.name}
            </span>
            {q.error ? (
              <span className="truncate text-xs text-red-300">{(q.error as Error).message}</span>
            ) : q.data ? (
              <MiniBar counts={q.data} />
            ) : (
              <span />
            )}
            <span className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {q.data ? (
                <>
                  <b className="text-foreground">{fmt.int(q.data.good)}</b> / {fmt.int(q.data.total)} available
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PctCell({ value }: { value?: number }) {
  if (value == null) return <>—</>;
  return <span className={cn(value < 95 && "text-amber-400", value < 80 && "text-red-400")}>{fmt.dec(value)} %</span>;
}

/** The Rotom a Dragonite feeds, with how many of its controllers that Rotom sees now. */
function RotomLink({
  row,
  nameOf,
  color,
}: {
  row: DragoniteRow;
  nameOf: (id: string) => string;
  color: (id: string) => string;
}) {
  const state = linkState(row);
  const live = row.links.filter((l) => l.controllers > 0);
  const target = row.rotom ?? live[0]?.rotomId;
  return (
    <HoverCard
      content={
        <div className="flex max-w-72 flex-col gap-1">
          <span>
            {row.rotom ? (
              <>
                Configured for <b>{nameOf(row.rotom)}</b>.
              </>
            ) : (
              "No rotom in config.toml; link detected from its controllers."
            )}
          </span>
          {live.length ? (
            live.map((l) => (
              <span key={l.rotomId} className="text-muted-foreground">
                {nameOf(l.rotomId)}: {l.controllers} {l.controllers === 1 ? "controller" : "controllers"} connected now
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">No Rotom sees controllers from this Dragonite.</span>
          )}
        </div>
      }
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {target ? <span className="size-2 rounded-full" style={{ background: color(target) }} /> : null}
        <span className="font-medium">{target ? nameOf(target) : "—"}</span>
        {state === "ok" ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {live.reduce((a, l) => a + l.controllers, 0)} ctrl.
          </span>
        ) : state === "none" ? (
          <span className="text-xs text-muted-foreground">no controllers</span>
        ) : (
          <span className="text-xs font-medium text-amber-400">
            on {live.filter((l) => l.rotomId !== row.rotom).map((l) => nameOf(l.rotomId)).join(", ")}
          </span>
        )}
      </span>
    </HoverCard>
  );
}

/** One headline figure for the Golbat card. */
function GolbatStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
      <Label>{label}</Label>
      <div className="truncate text-lg leading-none font-bold tabular-nums">{value}</div>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/**
 * Golbat at a glance: Pokémon seen per 10 minutes over the last day, and the
 * last hour's key numbers (what it found, how well it is keeping up).
 */
function GolbatOverview() {
  const summary = useQuery({ queryKey: ["golbat-summary"], queryFn: endpoints.golbatSummary, refetchInterval: 60_000 });
  const pokemon = useQuery({
    queryKey: ["golbat-panel", "pokemon", 86_400_000, "10m", ""],
    queryFn: () => endpoints.golbatPanel("pokemon", 86_400_000, "10m"),
    refetchInterval: 60_000,
  });
  const s = summary.data;
  const { data, series } = pokemon.data ? toChart(pokemon.data) : { data: [], series: [] as Series[] };
  const errorRate = s && s.rawOk + s.rawErrors > 0 ? (s.rawErrors / (s.rawOk + s.rawErrors)) * 100 : 0;

  return (
    <>
      <h2 className="mt-2 -mb-1 text-lg font-bold">Golbat</h2>
      {summary.error ? (
        <p className="text-sm text-red-300">{(summary.error as Error).message}</p>
      ) : !s ? (
        <Spinner />
      ) : (
        <Card className="gap-4 p-5">
          <div className="flex flex-col gap-1">
            <Label>Pokémon · last hour</Label>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl leading-none font-bold tabular-nums">{fmt.int(s.pokemonNew)}</span>
              <span className="text-sm text-muted-foreground">new · {fmt.int(s.pokemonIv)} with IV</span>
            </div>
          </div>
          <TimeChart data={data} series={series} format={fmt.int} height={180} integer gaps />
          <Legend series={series} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <GolbatStat label="100 %" value={fmt.int(s.hundos)} sub="last hour" />
            <GolbatStat label="Shinies" value={fmt.int(s.shinies)} sub="last hour" />
            <GolbatStat label="Raids" value={fmt.int(s.raids)} sub="new, last hour" />
            <GolbatStat
              label="Verified TTL"
              value={s.ttlMinutes != null ? `${fmt.dec(s.ttlMinutes)} min` : "—"}
              sub="average, last hour"
            />
            <GolbatStat
              label="RAW requests"
              value={fmt.int(s.rawOk + s.rawErrors)}
              sub={
                s.rawErrors ? (
                  <span className="text-red-400">{fmt.dec2(errorRate)} % with errors</span>
                ) : (
                  "no errors"
                )
              }
            />
            <GolbatStat
              label="Queues"
              value={fmt.int((s.workerBacklog ?? 0) + (s.rawWaiting ?? 0))}
              sub={`write: ${fmt.int(s.writeQueue)}`}
            />
          </div>
        </Card>
      )}
    </>
  );
}
