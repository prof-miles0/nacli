import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { DragoniteSummary, VmPanelData } from "@shared/types";
import { AreaSelect } from "@/components/area-select";
import { ChartCard } from "@/components/charts";
import { RangeMenu } from "@/components/filter-menu";
import { Spinner } from "@/components/ui";
import { PanelChart } from "@/components/vm-panel";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { fmt } from "@/lib/utils";
import { type FolderTab, FolderPanel, FolderTabs } from "@/components/folder-tabs";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { REJECTED_NOISE_PER_HOUR } from "@/components/charts";
import { useChosenStack } from "@/lib/stack-choice";

const RANGES = [
  { value: String(3_600_000), label: "1h" },
  { value: String(6 * 3_600_000), label: "6h" },
  { value: String(24 * 3_600_000), label: "24h" },
  { value: String(7 * 86_400_000), label: "7d" },
  { value: String(30 * 86_400_000), label: "30d" },
];

/** The open tab's last hour, as in the Dashboard: summed (or weighted) over the stacks shown. */
function StackFigures({ rows }: { rows: DragoniteSummary["instances"] }) {
  if (!rows.length) return <Spinner />;
  const locations = rows.reduce((n, r) => n + r.locations, 0);
  // Averages weighted by how much each stack scanned, so a quiet one does not skew them.
  const weighted = (k: "locationSeconds" | "rpcOkPct" | "gmoOkPct") => {
    const xs = rows.filter((r) => r[k] != null);
    const w = xs.reduce((n, r) => n + Math.max(r.locations, 1), 0);
    return xs.length ? xs.reduce((n, r) => n + (r[k] as number) * Math.max(r.locations, 1), 0) / w : undefined;
  };
  const seconds = weighted("locationSeconds");
  const rpc = weighted("rpcOkPct");
  const gmo = weighted("gmoOkPct");
  const ok = rows.reduce((n, r) => n + r.accountsOk, 0);
  const limited = rows.reduce((n, r) => n + r.accountsLimited, 0);
  const noWorkers = rows.reduce((n, r) => n + r.noWorkers, 0);
  const pctTone = (v?: number) => (v != null && v < 95 ? "warn" : undefined);
  return (
    // Six figures: 2, 3 or 6 to a row, never one left alone.
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <HeadStat label="Locations · 1h" value={fmt.int(locations)} />
      <HeadStat label="Time/location" value={seconds != null ? `${fmt.dec2(seconds)} s` : "—"} />
      <HeadStat label="RPC OK" value={rpc != null ? `${fmt.dec(rpc)} %` : "—"} tone={pctTone(rpc)}>
        <MiniProgress value={rpc ?? 0} max={100} color={pctTone(rpc) ? "#f59e0b" : "#22c55e"} />
      </HeadStat>
      <HeadStat label="GMO OK" value={gmo != null ? `${fmt.dec(gmo)} %` : "—"} tone={pctTone(gmo)}>
        <MiniProgress value={gmo ?? 0} max={100} color={pctTone(gmo) ? "#f59e0b" : "#22c55e"} />
      </HeadStat>
      <HeadStat
        label="Accounts · 1h"
        value={fmt.int(ok)}
        tone={limited ? "warn" : undefined}
        hint={`${fmt.int(ok)} successful sessions · ${fmt.int(limited)} ${limited === 1 ? "account" : "accounts"} hit the limit`}
      >
        <span className="text-[11px] text-muted-foreground">{limited ? `${fmt.int(limited)} at limit` : "none at limit"}</span>
      </HeadStat>
      <HeadStat
        label="No worker · 1h"
        value={fmt.int(noWorkers)}
        tone={noWorkers > REJECTED_NOISE_PER_HOUR ? "warn" : undefined}
        hint="Connections Rotom closed because no workers were free"
      />
    </div>
  );
}

export function DragoniteMetricsPage() {
  const { data: app } = useAppInfo();
  const dragonites = app?.dragonite ?? [];
  const [chosenRange, setRange] = useState(RANGES[2].value);
  // One stack at a time: the one picked on any page, else the first.
  const [instance, setInstance] = useChosenStack();
  const [areas, setAreas] = useState<string[]>([]);
  const one = dragonites.find((d) => d.id === instance) ?? dragonites[0];
  const instances = one ? [one.id] : [];
  // How far back the charts shown go: 30 days from Zapdos, only
  // history_retention (24h by default) when they come from memory.
  const maxRange = one?.historyMs || Infinity;
  const ranges = RANGES.filter((r) => Number(r.value) <= maxRange);
  const range = ranges.some((r) => r.value === chosenRange) ? chosenRange : (ranges.at(-1)?.value ?? chosenRange);
  const rangeMs = Number(range);
  const meta = useQuery({ queryKey: ["dragonite-meta"], queryFn: endpoints.dragoniteMeta, staleTime: 300_000 });
  const panels = meta.data?.panels ?? [];
  const results = useQueries({
    queries: panels.map((p) => {
      const panelAreas = p.areaAware ? areas.filter((a) => !meta.data?.areasByStack || !instances.length || (meta.data.areasByStack[instances[0]] ?? []).includes(a)) : [];
      return {
        queryKey: ["dragonite-panel", p.id, rangeMs, instances.join(), [...panelAreas].sort().join("|")],
        queryFn: () => endpoints.dragonitePanel(p.id, rangeMs, instances, panelAreas),
        // Keep the previous chart on screen while a new selection loads.
        placeholderData: (prev: VmPanelData | undefined) => prev,
        refetchInterval: 60_000,
      };
    }),
  });

  const summary = useQuery({ queryKey: ["dragonite-summary"], queryFn: endpoints.dragoniteSummary, refetchInterval: 30_000 });
  const color = useInstanceColor();
  const current = one?.id ?? "";
  // The area filter offers the open stack's areas; a picked area it lacks is dropped.
  const stackAreas = (current ? meta.data?.areasByStack?.[current] : undefined) ?? meta.data?.areas ?? [];
  const pickedAreas = areas.filter((a) => stackAreas.includes(a));

  if (meta.error) return <p className="text-sm text-red-300">{(meta.error as Error).message}</p>;
  if (!meta.data) return <Spinner className="mx-auto mt-20" />;

  const rows = summary.data?.instances ?? [];
  const picked = rows.filter((r) => r.id === current);
  const tabs: FolderTab[] = dragonites.map((d) => {
    const r = rows.find((x) => x.id === d.id);
    return {
      id: d.id,
      label: d.name,
      color: d.rotom ? color(d.rotom) : undefined,
      summary: r ? `${fmt.int(r.locations)} loc./h` : undefined,
    };
  });
  const tabColor = tabs.find((t) => t.id === current)?.color;

  const loaded = panels.map((p, i) => ({ meta: p, q: results[i] }));
  const shown = dragonites.find((d) => d.id === current)?.name;

  return (
    <div className="animate-in flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* Same folder tabs as Areas; the panel shows that stack's last hour. */}
        <div className="flex flex-col">
          {dragonites.length > 1 ? <FolderTabs label="Stack" tabs={tabs} value={current} onChange={setInstance} /> : null}
          <FolderPanel color={tabColor} tabbed={dragonites.length > 1}>
            <StackFigures rows={picked} />
          </FolderPanel>
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          <AreaSelect areas={stackAreas} value={pickedAreas} onChange={setAreas} className="flex-1 sm:flex-none" />
          <RangeMenu value={range} onChange={setRange} options={ranges} className="flex-1 sm:flex-none" />
        </div>
      </div>

      {meta.data.rows.map((row) => {
        const items = loaded.filter((x) => x.meta.row === row);
        if (!items.length) return null;
        return (
          <section key={row} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{row}</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {items.map(({ meta: m, q }) =>
                q.error ? (
                  <ChartCard key={m.id} title={m.title} series={[]}>
                    <p className="py-8 text-center text-sm text-red-300">{(q.error as Error).message}</p>
                  </ChartCard>
                ) : !q.data ? (
                  <ChartCard key={m.id} title={m.title} series={[]}>
                    <div className="grid h-[220px] place-items-center">
                      <Spinner />
                    </div>
                  </ChartCard>
                ) : (
                  <PanelChart
                    key={m.id}
                    meta={m}
                    data={q.data}
                    areas={pickedAreas}
                    extra={dragonites.length > 1 ? (shown ?? "all instances") : undefined}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
