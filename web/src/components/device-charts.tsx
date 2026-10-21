import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { endpoints } from "@/lib/api";
import { fmt, SERIES } from "@/lib/utils";
import { ChartCard, type Series, TimeChart } from "./charts";
import { Toggle } from "./table-tools";
import { Spinner } from "./ui";

const RANGES = [
  { value: String(3_600_000), label: "1h" },
  { value: String(6 * 3_600_000), label: "6h" },
  { value: String(24 * 3_600_000), label: "24h" },
  { value: String(7 * 86_400_000), label: "7d" },
  { value: String(30 * 86_400_000), label: "30d" },
];

type DeviceMetric = Parameters<typeof endpoints.deviceSeries>[0];

const MAX_DEVICE_SERIES = SERIES.length;

/**
 * One chart per instance with a line per device. Instances are kept apart
 * because their devices can report on very different scales (memory in
 * particular), and a shared axis would flatten the smaller ones.
 */
function DeviceSeriesSection({
  title,
  metrics,
  instanceIds,
  names,
  format,
  reduction,
  fewestLabel,
  rangeMs: fixedRange,
  integer,
}: {
  title: string;
  metrics: { value: DeviceMetric; label: string }[];
  instanceIds: string[];
  names: Record<string, string>;
  format: (n: number) => string;
  /** How a bucket is reduced server-side, shown in the subtitle. */
  reduction: string;
  /** What "the 8 lowest" means for this metric, e.g. "least memory". */
  fewestLabel: string;
  /** When given, the page owns the time range and the section hides its own selector. */
  rangeMs?: number;
  integer?: boolean;
}) {
  const [range, setRange] = useState(RANGES[2].value);
  const [metric, setMetric] = useState<DeviceMetric>(metrics[0].value);
  const rangeMs = fixedRange ?? Number(range);
  const controls =
    metrics.length > 1 || !fixedRange ? (
      <div className="flex flex-wrap gap-2">
        {metrics.length > 1 ? (
          <Toggle value={metric} onChange={(v) => setMetric(v as DeviceMetric)} options={metrics} />
        ) : null}
        {fixedRange ? null : <Toggle value={range} onChange={setRange} options={RANGES} />}
      </div>
    ) : undefined;
  const q = useQuery({
    queryKey: ["device-series", metric, rangeMs],
    queryFn: () => endpoints.deviceSeries(metric, rangeMs),
    refetchInterval: 30_000,
  });

  return (
    <section className="flex flex-col gap-4">
      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Spinner />
      ) : (
        (() => {
          // Every device of every instance in one chart, named "device · instance".
          const multi = instanceIds.filter((id) => q.data[id]?.length).length > 1;
          const all = instanceIds
            .flatMap((id) =>
              (q.data[id] ?? []).map((d) => ({ ...d, name: multi ? `${d.origin} · ${names[id] ?? id}` : d.origin })),
            )
            .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
          if (!all.length) return <p className="text-sm text-muted-foreground">No data for this period.</p>;
          const last = (d: (typeof all)[number]) => d.points[d.points.length - 1]?.v ?? Number.POSITIVE_INFINITY;
          // Past 8 lines colours would repeat; keep the devices with the lowest current value.
          const shown =
            all.length > MAX_DEVICE_SERIES
              ? new Set([...all].sort((a, b) => last(a) - last(b)).slice(0, MAX_DEVICE_SERIES).map((d) => d.name))
              : null;
          const devices = shown ? all.filter((d) => shown.has(d.name)) : all;
          const series: Series[] = devices.map((d, i) => ({ key: `d${i}`, name: d.name, color: SERIES[i] }));
          const rows = new Map<number, Record<string, number>>();
          devices.forEach((d, i) => {
            for (const p of d.points) {
              const row = rows.get(p.t) ?? { t: p.t };
              row[`d${i}`] = p.v;
              rows.set(p.t, row);
            }
          });
          const data = [...rows.values()].sort((a, b) => a.t - b.t);
          return (
            <ChartCard
              title={title}
              subtitle={
                shown
                  ? `The ${MAX_DEVICE_SERIES} with the ${fewestLabel} of ${all.length} devices · ${reduction}`
                  : `${all.length} device${all.length === 1 ? "" : "s"} · ${reduction}`
              }
              series={series}
              // Always pass something so the (long) device legend goes under the chart.
              actions={controls ?? <span />}
            >
              <TimeChart data={data} series={series} format={format} axisFormat={format} height={260} integer={integer} />
            </ChartCard>
          );
        })()
      )}
    </section>
  );
}

type SectionProps = { instanceIds: string[]; names: Record<string, string>; rangeMs?: number };

export function DeviceMemorySection(p: SectionProps) {
  return (
    <DeviceSeriesSection
      {...p}
      title="Free memory"
      metrics={[{ value: "memory", label: "Free" }]}
      format={fmt.kb}
      reduction="minimum per interval"
      fewestLabel="least memory"
    />
  );
}

export function DeviceWorkersSection(p: SectionProps) {
  return (
    <DeviceSeriesSection
      {...p}
      title="Workers per device"
      metrics={[
        { value: "workers_in_use", label: "In use" },
        { value: "workers_connected", label: "Connected" },
      ]}
      format={fmt.int}
      integer
      reduction="rounded average per interval"
      fewestLabel="fewest workers"
    />
  );
}
