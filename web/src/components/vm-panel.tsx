import type { VmPanelData, VmPanelMeta } from "@shared/types";
import { ChartCard, type Series, TimeChart } from "@/components/charts";
import { fmt, SERIES } from "@/lib/utils";

/**
 * Turns Zapdos series into chart rows on a full time grid, so a
 * missing point leaves a gap instead of the line jumping across it. Past 8
 * series the colours would repeat, so the smallest (by total) fold into "Others".
 */
export function toChart(
  panel: VmPanelData,
  { dropZero = false }: { dropZero?: boolean } = {},
): { data: Record<string, number>[]; series: Series[] } {
  const ranked = panel.series
    .map((s) => ({ ...s, total: s.points.reduce((a, p) => a + Math.abs(p.v), 0) }))
    // In a stack an all-zero series only draws its outline over the top layer.
    .filter((s) => s.points.length && (!dropZero || s.total > 0));
  let shown = ranked;
  let others: typeof ranked = [];
  if (ranked.length > SERIES.length) {
    const byTotal = [...ranked].sort((a, b) => b.total - a.total);
    shown = byTotal.slice(0, SERIES.length - 1);
    others = byTotal.slice(SERIES.length - 1);
  }
  const rows = new Map<number, Record<string, number>>();
  for (let t = panel.start; t <= panel.end; t += panel.stepMs) rows.set(t, { t });
  shown.forEach((s, i) => {
    for (const p of s.points) {
      const row = rows.get(p.t) ?? { t: p.t };
      row[`s${i}`] = p.v;
      rows.set(p.t, row);
    }
  });
  for (const s of others) {
    for (const p of s.points) {
      const row = rows.get(p.t) ?? { t: p.t };
      row.other = (row.other ?? 0) + p.v;
      rows.set(p.t, row);
    }
  }
  const chartSeries: Series[] = shown.map((s, i) => ({
    key: `s${i}`,
    name: s.name,
    color: SERIES[i],
    // Right-axis series are counts whatever the panel's unit is.
    ...(s.axis === "right" ? { axis: "right" as const, format: fmt.int } : {}),
  }));
  if (others.length) {
    chartSeries.push({ key: "other", name: `Others (${others.length})`, color: "var(--muted-foreground)" });
  }
  return { data: [...rows.values()].sort((a, b) => a.t - b.t), series: chartSeries };
}

const UNITS: Record<
  NonNullable<VmPanelMeta["unit"]> | "count",
  { format: (n: number) => string; axis: (n: number) => string; every: string; integer: boolean }
> = {
  count: { format: fmt.int, axis: fmt.dec, every: "every 10 min", integer: true },
  minutes: { format: (n) => `${fmt.dec(n)} min`, axis: (n) => `${fmt.dec(n)}m`, every: "average every 10 min", integer: false },
  seconds: { format: (n) => `${fmt.dec2(n)} s`, axis: (n) => `${fmt.dec(n)}s`, every: "average every 10 min", integer: false },
  percent: { format: (n) => `${fmt.dec(n)} %`, axis: (n) => `${fmt.int(n)}%`, every: "% every 10 min", integer: false },
};

/** Subtitle text for the area filter of an area-aware panel. */
export function areaText(areas: string[]) {
  if (areas.length === 0) return "all areas";
  if (areas.length <= 2) return `area${areas.length > 1 ? "s" : ""} ${areas.join(", ")}`;
  return `${areas.length} areas`;
}

/** One Grafana-ported panel; `extra` adds to the subtitle (e.g. the instance shown). */
export function PanelChart({
  meta,
  data: panel,
  areas,
  extra,
  bare,
}: {
  meta: VmPanelMeta;
  data: VmPanelData;
  areas: string[];
  extra?: string;
  /** Without title and subtitle, for a chart its section already names. */
  bare?: boolean;
}) {
  const { data, series } = toChart(panel, { dropZero: meta.stacked });
  const unit = UNITS[meta.unit ?? "count"];
  const subtitle = [unit.every, meta.areaAware ? areaText(areas) : null, extra].filter(Boolean).join(" · ");
  return (
    <ChartCard title={bare ? undefined : meta.title} subtitle={bare ? undefined : subtitle} series={series} actions={<span />}>
      <TimeChart
        data={data}
        series={series}
        format={unit.format}
        axisFormat={unit.axis}
        stacked={meta.stacked}
        integer={unit.integer}
        gaps
      />
    </ChartCard>
  );
}
