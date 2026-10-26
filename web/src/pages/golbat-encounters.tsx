import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { useState } from "react";
import type { EncounterHistory } from "@shared/types";
import { ChartCard, type Series, TimeChart } from "@/components/charts";
import { FilterMenu, RangeMenu } from "@/components/filter-menu";
import { Card, HoverCard, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { KNOWN } from "@/lib/spawnpoints";
import { fmt } from "@/lib/utils";

const SCOPE_KEY = "nacli.encounters.area";
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
/** Percent formats of the Dragonite metric panels. */
const PCT = (n: number) => `${fmt.dec(n)} %`;
const PCT_AXIS = (n: number) => `${fmt.int(n)}%`;

function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Not remembered; the choice still applies now.
  }
}

const ENCOUNTER_RANGES = [
  { value: String(86_400_000), label: "24h" },
  { value: String(7 * 86_400_000), label: "7d" },
  { value: String(30 * 86_400_000), label: "30d" },
  { value: String(90 * 86_400_000), label: "90d" },
];
const ENCOUNTER_SERIES: Series[] = [
  { key: "verified", name: "Verified encounters", color: KNOWN.yes },
  { key: "iv", name: "Pokémon with IV", color: "#60a5fa" },
];

// Blissey's "Spawnpoint type" and "Despawn minutes left details" panels, with
// Grafana's colours. tth[i] holds encounters with 5i to 5i+5 minutes left.
const GRAFANA = { darkGreen: "#37872d", green: "#73bf69", darkYellow: "#e0b400", darkOrange: "#fa6400", red: "#f2495c", darkRed: "#c4162a", blue: "#5794f2", orange: "#ff9830" };
const SPAWN_TYPE_SERIES: Series[] = [
  { key: "m30", name: "30 min spawnpoint", color: GRAFANA.blue },
  { key: "m60", name: "60 min spawnpoint", color: GRAFANA.orange },
];
const STEPS = [GRAFANA.darkGreen, GRAFANA.green, GRAFANA.darkYellow, GRAFANA.darkOrange, GRAFANA.red, GRAFANA.darkRed];
/** Most time left first, at the bottom of each bar, as Blissey stacks them. */
const LEFT_30_SERIES: Series[] = [5, 4, 3, 2, 1, 0].map((i, n) => ({
  key: `b${i}`,
  name: i === 0 ? "Under 5 min" : `${i * 5}–${i * 5 + 5} min`,
  color: STEPS[n],
}));
const LEFT_60_SERIES: Series[] = [11, 10, 9, 8, 7, 6].map((i, n) => ({
  key: `b${i}`,
  name: i === 11 ? "Over 55 min" : `${i * 5}–${i * 5 + 5} min`,
  color: STEPS[n],
}));

/** Each bucket's share of its group (buckets `from` to `to`), per point; points without any are left out. */
function shares(points: EncounterHistory["points"], from: number, to: number) {
  return points.flatMap((p) => {
    const part = p.tth.slice(from, to + 1);
    const total = part.reduce((a, b) => a + b, 0);
    if (!total) return [];
    const row: Record<string, number> = { t: p.t };
    part.forEach((n, j) => (row[`b${from + j}`] = pct(n, total)));
    return [row];
  });
}

/**
 * Golbat's encounters per area, from its pokemon_area_stats: read every 5
 * minutes, as Blissey does, and kept 90 days. The share with a verified
 * despawn time and of Pokémon with IV, and Blissey's "Spawnpoint type" and
 * minutes-left panels. These are Golbat's own areas and fences, which need
 * not match Dragonite's.
 */
/**
 * A short chart card: the title with the period's key figures beside it in
 * large type (their detail on hover), and a low chart.
 */
function CompactChart({
  title,
  figures,
  children,
}: {
  title: string;
  /** Also the legend: each one's dot is its series' colour. */
  figures: { value: string; label: string; color: string; hint: string }[];
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex gap-4">
          {figures.map((f) => (
            <HoverCard key={f.label} content={f.hint}>
              <span className="flex items-baseline gap-1.5">
                <span className="size-2 self-center rounded-full" style={{ background: f.color }} />
                <span className="text-lg leading-none font-semibold tabular-nums">{f.value}</span>
                <span className="text-xs text-muted-foreground">{f.label}</span>
              </span>
            </HoverCard>
          ))}
        </div>
      </div>
      {children}
    </Card>
  );
}

export function GolbatEncountersPage() {
  const [range, setRange] = useState(ENCOUNTER_RANGES[0].value);
  const [chosen, setChosenRaw] = useState(() => remembered(SCOPE_KEY));
  const setChosen = (v: string) => {
    setChosenRaw(v);
    remember(SCOPE_KEY, v);
  };
  const options = useQuery({ queryKey: ["encounter-areas"], queryFn: () => endpoints.encounterHistory(86_400_000, "world"), staleTime: 5 * 60_000 });
  const golbatAreas = options.data?.areas ?? [];
  // A remembered area Golbat no longer has (or none known yet) falls back to all of them.
  const known = (v: string) => golbatAreas.some((a) => a.area === v.split("\t")[0]);
  const scope = chosen && known(chosen) ? chosen : "world";
  const [scopeArea, scopeFence] = scope.split("\t");
  const q = useQuery({
    queryKey: ["encounter-history", range, scope],
    queryFn: () => endpoints.encounterHistory(Number(range), scopeArea, scopeFence),
    refetchInterval: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  // A point without encounters (or without Pokémon) leaves that line's gap, not a 0%.
  const points = (q.data?.points ?? [])
    .filter((p) => p.verified + p.unverified > 0 || p.pokemon > 0)
    .map((p) => {
      const row: Record<string, number> = { t: p.t };
      if (p.verified + p.unverified) row.verified = pct(p.verified, p.verified + p.unverified);
      if (p.pokemon) row.iv = pct(p.iv, p.pokemon);
      return row;
    });
  const sum = (q.data?.points ?? []).reduce(
    (acc, p) => ({ verified: acc.verified + p.verified, encounters: acc.encounters + p.verified + p.unverified, iv: acc.iv + p.iv, pokemon: acc.pokemon + p.pokemon }),
    { verified: 0, encounters: 0, iv: 0, pokemon: 0 },
  );
  // Encounters with up to 30 min left, and all of them, over the whole period.
  const spawnType = (q.data?.points ?? []).reduce(
    (acc, p) => ({ low: acc.low + p.tth.slice(0, 6).reduce((x, y) => x + y, 0), all: acc.all + p.tth.reduce((x, y) => x + y, 0) }),
    { low: 0, all: 0 },
  );
  const scopes = golbatAreas.flatMap((a) => [
    { value: a.area, label: a.area === "world" ? "All of Golbat's areas" : a.area },
    ...(a.fences.length > 1 ? a.fences.map((f) => ({ value: `${a.area}\t${f}`, label: `${a.area} · ${f}` })) : []),
  ]);
  return (
    <div className="animate-in flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex gap-2">
          <FilterMenu
            value={scope}
            onChange={setChosen}
            options={scopes.length ? scopes : [{ value: "world", label: "All of Golbat's areas" }]}
            label="Golbat area"
            icon={Layers}
            className="flex-1 sm:w-56 sm:flex-none"
          />
          <RangeMenu value={range} onChange={setRange} options={ENCOUNTER_RANGES} className="flex-1 sm:flex-none" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <CompactChart
          title="Verified despawn time and IV"
          figures={
            sum.encounters || sum.pokemon
              ? [
                  { value: fmt.pct(pct(sum.verified, sum.encounters)), label: "verified", color: ENCOUNTER_SERIES[0].color, hint: `${fmt.int(sum.verified)} of ${fmt.int(sum.encounters)} encounters` },
                  { value: fmt.pct(pct(sum.iv, sum.pokemon)), label: "with IV", color: ENCOUNTER_SERIES[1].color, hint: `${fmt.int(sum.iv)} of ${fmt.int(sum.pokemon)} Pokémon` },
                ]
              : []
          }
        >
          {q.error ? (
            <p className="grid h-[130px] place-items-center text-sm text-red-300">{(q.error as Error).message}</p>
          ) : !q.data ? (
            <div className="grid h-[130px] place-items-center">
              <Spinner />
            </div>
          ) : points.length < 2 ? (
            <p className="grid h-[130px] place-items-center px-6 text-center text-sm text-muted-foreground">
              {q.data.last && q.data.last < Date.now() - Number(range)
                ? `Nothing in this period: the newest data is from ${fmt.time(q.data.last)}. Choose a longer range.`
                : "No encounters for this area in this period yet. Nacli reads them every 5 minutes and keeps 90 days."}
            </p>
          ) : (
            <TimeChart data={points} series={ENCOUNTER_SERIES} format={(v) => `${fmt.dec(v)}%`} axisFormat={(v) => `${fmt.int(v)}%`} height={130} linear />
          )}
        </CompactChart>
        <CompactChart
          title="Spawnpoint type"
          figures={
            spawnType.all
              ? [
                  { value: fmt.pct(pct(spawnType.low, spawnType.all)), label: "30 min", color: GRAFANA.blue, hint: "encounters with up to 30 min left" },
                  { value: fmt.pct(pct(spawnType.all - spawnType.low, spawnType.all)), label: "60 min", color: GRAFANA.orange, hint: "encounters with over 30 min left" },
                ]
              : []
          }
        >
          {q.data ? (
            <TimeChart
              data={q.data.points.flatMap((p) => {
                const low = p.tth.slice(0, 6).reduce((a, b) => a + b, 0);
                const high = p.tth.slice(6).reduce((a, b) => a + b, 0);
                return low + high ? [{ t: p.t, m30: pct(low, low + high), m60: pct(high, low + high) }] : [];
              })}
              series={SPAWN_TYPE_SERIES}
              format={PCT}
              axisFormat={PCT_AXIS}
              height={130}
              stacked
              bars
              max={100}
            />
          ) : (
            <div className="grid h-[130px] place-items-center">
              <Spinner />
            </div>
          )}
        </CompactChart>
      </div>
      {q.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* As the Dragonite panels' stacked shares (e.g. "Retries until a successful GMO"): legend under the chart. */}
          <ChartCard title="Minutes left · 30 min" subtitle="of the encounters with up to 30 min left" series={LEFT_30_SERIES} actions={<span />}>
            <TimeChart data={shares(q.data.points, 0, 5)} series={LEFT_30_SERIES} format={PCT} axisFormat={PCT_AXIS} stacked bars max={100} />
          </ChartCard>
          <ChartCard title="Minutes left · 60 min" subtitle="of the encounters with over 30 min left" series={LEFT_60_SERIES} actions={<span />}>
            <TimeChart data={shares(q.data.points, 6, 11)} series={LEFT_60_SERIES} format={PCT} axisFormat={PCT_AXIS} stacked bars max={100} />
          </ChartCard>
        </div>
      ) : null}
    </div>
  );
}
