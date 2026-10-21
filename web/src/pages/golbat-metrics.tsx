import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { GolbatPanelData } from "@shared/types";
import { ChartCard } from "@/components/charts";
import { PanelChart } from "@/components/vm-panel";
import { Toggle } from "@/components/table-tools";
import { AreaSelect } from "@/components/area-select";
import { Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo } from "@/lib/state";

const RANGES = [
  { value: String(3_600_000), label: "1h" },
  { value: String(6 * 3_600_000), label: "6h" },
  { value: String(24 * 3_600_000), label: "24h" },
  { value: String(7 * 86_400_000), label: "7d" },
  { value: String(30 * 86_400_000), label: "30d" },
];

const ROWS = ["Basic", "Details"];

const INTERVAL = "10m";

export function GolbatMetricsPage() {
  const { data: app } = useAppInfo();
  // 30 days from VictoriaMetrics; only history_retention when from memory.
  const ranges = RANGES.filter((r) => Number(r.value) <= (app?.golbatHistoryMs || Infinity));
  const [chosenRange, setRange] = useState(RANGES[2].value);
  const range = ranges.some((r) => r.value === chosenRange) ? chosenRange : (ranges.at(-1)?.value ?? chosenRange);
  // Fixed 10-minute counting interval: steady, comparable values on every range.
  const inter = INTERVAL;
  const [areas, setAreas] = useState<string[]>([]);
  const rangeMs = Number(range);
  const meta = useQuery({ queryKey: ["golbat-meta"], queryFn: endpoints.golbatMeta, staleTime: 300_000 });
  const panels = meta.data?.panels ?? [];
  const results = useQueries({
    queries: panels.map((p) => ({
      queryKey: ["golbat-panel", p.id, rangeMs, inter, p.areaAware ? [...areas].sort().join("|") : ""],
      queryFn: () => endpoints.golbatPanel(p.id, rangeMs, inter, p.areaAware ? areas : []),
      // Keep the previous chart on screen while a new area selection loads.
      placeholderData: (prev: GolbatPanelData | undefined) => prev,
      refetchInterval: 60_000,
    })),
  });

  if (meta.error) {
    return <p className="text-sm text-red-300">{(meta.error as Error).message}</p>;
  }
  if (!meta.data) return <Spinner className="mx-auto mt-20" />;

  const loaded = panels.map((p, i) => ({ meta: p, q: results[i] }));

  return (
    <div className="animate-in flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AreaSelect areas={meta.data.areas} value={areas} onChange={setAreas} />
        <Toggle value={range} onChange={setRange} options={ranges} />
      </div>

      {ROWS.map((row) => {
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
                  <PanelChart key={m.id} meta={m} data={q.data} areas={areas} />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
