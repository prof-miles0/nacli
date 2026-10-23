import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { AreaStats, AreaStatsCounts } from "@shared/types";
import { ChartCard, TimeChart } from "@/components/charts";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { StackTag } from "@/components/stack-tag";
import { SearchBox, Toggle, matches, useSorted } from "@/components/table-tools";
import { Card, HoverCard, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";
import { useState } from "react";

const n = (v: number) => fmt.int(v);
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const quests = (s: AreaStatsCounts) => s.quests.ar + s.quests.noAr;
const rocket = (s: AreaStatsCounts) => s.invasions.grunts + s.invasions.leaders + s.invasions.giovanni + s.invasions.decoys;

/** A figure and, under it, what it is made of. */
function Cell({ value, sub, partial }: { value: string; sub?: string; partial?: boolean }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-semibold tabular-nums">
        {partial ? "≥ " : ""}
        {value}
      </span>
      {sub ? <span className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{sub}</span> : null}
    </div>
  );
}

/** Stops with a quest out of all stops: the admin's "quests scanned" figure. */
function QuestCell({ s }: { s: AreaStatsCounts }) {
  const done = quests(s);
  const p = pct(done, s.quests.stops);
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-0.5 tabular-nums">
          <span>
            AR quests <b>{n(s.quests.ar)}</b>
          </span>
          <span>
            Non-AR quests <b>{n(s.quests.noAr)}</b>
          </span>
          <span className="text-muted-foreground">Of {n(s.quests.stops)} Pokéstops</span>
        </div>
      }
    >
      <div className="flex min-w-28 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 tabular-nums">
          <span className="font-semibold">{fmt.pct(p)}</span>
          <span className="text-[11px] text-muted-foreground">
            {n(done)} / {n(s.quests.stops)}
          </span>
        </div>
        <MiniProgress value={done} max={s.quests.stops} color={p >= 99 ? "#22c55e" : p >= 80 ? "#f59e0b" : "#ef4444"} />
      </div>
    </HoverCard>
  );
}

function invasionSub(s: AreaStatsCounts) {
  const i = s.invasions;
  return [
    `${n(i.grunts)} grunts`,
    i.leaders ? `${n(i.leaders)} leaders` : "",
    i.giovanni ? `${n(i.giovanni)} Giovanni` : "",
    i.decoys ? `${n(i.decoys)} decoys` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function eventsSub(s: AreaStatsCounts) {
  const parts = [s.invasions.kecleon ? `${n(s.invasions.kecleon)} Kecleon` : "", s.invasions.golden ? `${n(s.invasions.golden)} golden` : ""];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/** The figures of one row (an area or the totals), as table cells. */
function Cells({ s, partial }: { s: AreaStatsCounts; partial?: boolean }) {
  return (
    <>
      <td>
        <QuestCell s={s} />
      </td>
      <td>
        <Cell
          value={n(s.pokemon.active)}
          partial={partial}
          sub={`${n(s.pokemon.withIv)} IV · ${n(s.pokemon.hundo)} 100% · ${n(s.pokemon.shiny)} shiny`}
        />
      </td>
      <td>
        <Cell value={n(rocket(s))} sub={invasionSub(s)} />
      </td>
      <td>
        <Cell value={n(s.gyms.raids)} sub={`${n(s.gyms.eggs)} eggs · ${n(s.gyms.total)} gyms`} />
      </td>
      <td>
        <Cell value={n(s.stops.lures)} sub={eventsSub(s)} />
      </td>
      <td>
        <Cell value={n(s.stations.battles)} sub={`${n(s.stations.active)} active stations`} />
      </td>
    </>
  );
}

/** Per area, for phones: the same figures as label/value pairs. */
function AreaCard({ a, picked, onPick }: { a: AreaStats; picked?: boolean; onPick?: () => void }) {
  const s = a.stats;
  return (
    <Card className={cn("gap-3 p-4", onPick && "cursor-pointer", picked && "border-primary/60")} onClick={onPick}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{a.area}</span>
        <StackTag id={a.stack} className="text-xs text-muted-foreground" />
      </div>
      {!s ? (
        <p className="text-sm text-red-300">{a.error}</p>
      ) : (
        <>
          <QuestCell s={s} />
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Pokémon", n(s.pokemon.active), `${n(s.pokemon.hundo)} 100% · ${n(s.pokemon.shiny)} shiny`],
              ["Invasions", n(rocket(s)), invasionSub(s)],
              ["Raids", n(s.gyms.raids), `${n(s.gyms.eggs)} eggs`],
              ["Lures", n(s.stops.lures), eventsSub(s)],
              ["Max battles", n(s.stations.battles), `${n(s.stations.active)} stations`],
            ].map(([label, value, sub]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</span>
                <Cell value={value!} sub={sub || undefined} partial={label === "Pokémon" && a.partial} />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** The figures the history can chart, each read from one take. */
const METRICS = [
  { key: "quests", label: "Quests", value: (s: AreaStatsCounts) => pct(quests(s), s.quests.stops), format: (v: number) => fmt.pct(v) },
  { key: "pokemon", label: "Pokémon", value: (s: AreaStatsCounts) => s.pokemon.active, format: n },
  { key: "invasions", label: "Invasions", value: rocket, format: n },
  { key: "raids", label: "Raids", value: (s: AreaStatsCounts) => s.gyms.raids, format: n },
  { key: "lures", label: "Lures", value: (s: AreaStatsCounts) => s.stops.lures, format: n },
  { key: "battles", label: "Max battles", value: (s: AreaStatsCounts) => s.stations.battles, format: n },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

/**
 * The last 24 h of one figure (stats_poll_interval in [golbat]): of every
 * area together, or of the area picked in the table.
 */
function StatsHistory({ area, multi, onClear }: { area?: AreaStats; multi: boolean; onClear: () => void }) {
  const [metric, setMetric] = useState<MetricKey>("quests");
  const key = area ? `${area.stack}:${area.areaId}` : undefined;
  const q = useQuery({
    queryKey: ["golbat-area-stats-history", key ?? "all"],
    queryFn: () => endpoints.golbatAreaStatsHistory(key),
    refetchInterval: 60_000,
  });
  const m = METRICS.find((x) => x.key === metric)!;
  const series = [{ key: "v", name: area ? area.area : "All areas", color: "var(--series-1)" }];
  const data = (q.data?.points ?? []).map((p) => ({ t: p.t, v: m.value(p.stats) }));
  return (
    <ChartCard
      title="Last 24 h"
      subtitle={area ? `${area.area}${area.stackName && multi ? ` · ${area.stackName}` : ""}` : "All areas · pick one in the table to see it alone"}
      series={series}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {area ? (
            <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-3" />
              All areas
            </button>
          ) : null}
          <Toggle value={metric} onChange={(v) => setMetric(v as MetricKey)} options={METRICS.map((x) => ({ value: x.key, label: x.label }))} />
        </div>
      }
    >
      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Spinner className="mx-auto my-16" />
      ) : (
        <TimeChart data={data} series={series} format={m.format} axisFormat={m.format} integer={metric !== "quests"} height={200} />
      )}
    </ChartCard>
  );
}

/**
 * What Golbat sees in each Dragonite area right now: quests (as the admin's
 * dashboard counts them), active Pokémon, invasions, raids, lures and Max
 * battles, counted inside each area's geofence.
 */
export function GolbatStatsPage() {
  const color = useInstanceColor();
  const [search, setSearch] = useState("");
  const { data: app } = useAppInfo();
  // The area the history shows ("stack:areaId"); none: every area together.
  const [picked, setPicked] = useState<string>();
  const q = useQuery({ queryKey: ["golbat-area-stats"], queryFn: endpoints.golbatAreaStats, refetchInterval: 120_000 });
  const rows = (q.data?.areas ?? []).filter((a) => matches(search, a.area, a.stackName));
  const multi = new Set((q.data?.areas ?? []).map((a) => a.stack)).size > 1;
  const zero = -1;
  const { sorted, header } = useSorted(
    rows,
    {
      area: (a) => a.area,
      quests: (a) => (a.stats ? pct(quests(a.stats), a.stats.quests.stops) : zero),
      pokemon: (a) => a.stats?.pokemon.active ?? zero,
      invasions: (a) => (a.stats ? rocket(a.stats) : zero),
      raids: (a) => a.stats?.gyms.raids ?? zero,
      lures: (a) => a.stats?.stops.lures ?? zero,
      battles: (a) => a.stats?.stations.battles ?? zero,
    },
    "area",
  );
  const dot = (a: AreaStats) => (a.rotom ? color(a.rotom) : "var(--muted-foreground)");

  if (q.error) return <p className="text-sm text-red-300">{(q.error as Error).message}</p>;
  if (!q.data) {
    return (
      <div className="mt-20 flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <Spinner />
        Asking Golbat about every area…
      </div>
    );
  }
  const t = q.data.totals;
  const done = quests(t);

  return (
    <div className="animate-in flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <HeadStat label="Quests" value={fmt.pct(pct(done, t.quests.stops))} hint={`${n(done)} of ${n(t.quests.stops)} Pokéstops have a quest`}>
          <MiniProgress value={done} max={t.quests.stops} color="#22c55e" />
        </HeadStat>
        <HeadStat label="Pokémon" value={n(t.pokemon.active)} hint={`${n(t.pokemon.hundo)} at 100% · ${n(t.pokemon.shiny)} shiny`} />
        <HeadStat label="Invasions" value={n(rocket(t))} hint={invasionSub(t)} />
        <HeadStat label="Raids" value={n(t.gyms.raids)} hint={`${n(t.gyms.eggs)} eggs about to hatch, of ${n(t.gyms.total)} gyms`} />
        <HeadStat label="Lures" value={n(t.stops.lures)} hint={eventsSub(t) ?? "Active lure modules"} />
        <HeadStat label="Max battles" value={n(t.stations.battles)} hint={`${n(t.stations.active)} active Power Spots`} />
      </div>

      {app?.golbatStatsHistoryMs ? (
        <StatsHistory area={q.data.areas.find((a) => `${a.stack}:${a.areaId}` === picked)} multi={multi} onClear={() => setPicked(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search areas…" />
        <span className="text-xs text-muted-foreground">
          Counted inside each enabled area's geofence · updated {fmt.ago(q.data.checkedAt)}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:hidden">
        {sorted.map((a) => (
          <AreaCard
            key={`${a.stack}:${a.areaId}`}
            a={a}
            picked={picked === `${a.stack}:${a.areaId}`}
            onPick={app?.golbatStatsHistoryMs ? () => setPicked((p) => (p === `${a.stack}:${a.areaId}` ? undefined : `${a.stack}:${a.areaId}`)) : undefined}
          />
        ))}
      </div>

      <div className="hidden sm:block">
        <Table>
          <thead>
            <tr>
              {header("area", "Area")}
              {header("quests", "Quests")}
              {header("pokemon", "Pokémon")}
              {header("invasions", "Invasions")}
              {header("raids", "Raids")}
              {header("lures", "Lures")}
              {header("battles", "Max battles")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr
                key={`${a.stack}:${a.areaId}`}
                className={cn(app?.golbatStatsHistoryMs && "cursor-pointer", picked === `${a.stack}:${a.areaId}` && "bg-accent/60")}
                onClick={app?.golbatStatsHistoryMs ? () => setPicked((p) => (p === `${a.stack}:${a.areaId}` ? undefined : `${a.stack}:${a.areaId}`)) : undefined}
              >
                <td>
                  <div className="flex items-center gap-2">
                    {multi ? <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot(a) }} title={a.stackName} /> : null}
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium">{a.area}</span>
                      {multi ? <span className="text-[11px] text-muted-foreground">{a.stackName}</span> : null}
                    </div>
                  </div>
                </td>
                {a.stats ? (
                  <Cells s={a.stats} partial={a.partial} />
                ) : (
                  <td colSpan={6} className="text-sm text-red-300">
                    {a.error}
                  </td>
                )}
              </tr>
            ))}
            {!sorted.length ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No areas match.
                </td>
              </tr>
            ) : null}
          </tbody>
          {sorted.length > 1 && !search ? (
            <tfoot>
              <tr className={cn("border-t bg-muted/30 font-medium")}>
                <td>All areas</td>
                <Cells s={t} />
              </tr>
            </tfoot>
          ) : null}
        </Table>
      </div>
    </div>
  );
}
