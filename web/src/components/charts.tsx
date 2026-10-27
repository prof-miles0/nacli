import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Fragment, useId } from "react";
import { cn, fmt } from "@/lib/utils";
import { Card, Dot } from "./ui";

export interface Series {
  key: string;
  name: string;
  color: string;
  /** "area": dashed outline over a faint fill, for a capacity drawn behind a solid line. */
  variant?: "line" | "area";
  /** Plotted against a second Y axis on the right; drawn dashed so it reads as "the other scale". */
  axis?: "right";
  /** Tooltip/axis format for this series when it differs from the chart's. */
  format?: (n: number) => string;
}

const axisProps = {
  stroke: "var(--muted-foreground)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function timeTick(t: number, spanMs: number) {
  const d = new Date(t);
  if (spanMs > 2 * 86_400_000) return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    // Short spans would otherwise repeat the same minute on several ticks.
    ...(spanMs < 20 * 60_000 ? { second: "2-digit" } : {}),
  });
}

/**
 * The rows with an empty one wherever the time to the next is well over the
 * usual step, so no line or area is drawn across a stretch without data.
 * The usual step is the lower quartile of the spacing: with many holes the
 * median could be a hole itself.
 */
export function withBreaks(rows: Record<string, number>[]): Record<string, number>[] {
  if (rows.length < 3) return rows;
  const diffs = rows
    .slice(1)
    .map((r, i) => r.t - rows[i].t)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const step = diffs[Math.floor(diffs.length / 4)];
  if (!step) return rows;
  const out = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].t - rows[i - 1].t;
    if (gap > step * 2.5) out.push({ t: rows[i - 1].t + gap / 2 });
    out.push(rows[i]);
  }
  return out;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
  series,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string; name: string }[];
  label?: number;
  format: (n: number) => string;
  series?: Series[];
}) {
  // A break row (see withBreaks) has no values: nothing to show.
  const shown = (payload ?? []).filter((p) => p.value != null);
  if (!active || !shown.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 text-muted-foreground">{label ? fmt.time(label) : ""}</div>
      {shown
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <Dot color={p.color} />
            <span className="flex-1 text-muted-foreground">{p.name}</span>
            <span className="font-semibold tabular-nums">
              {(series?.find((s) => s.key === p.dataKey)?.format ?? format)(p.value)}
            </span>
          </div>
        ))}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
          {s.variant === "area" ? (
            <span
              className="h-2.5 w-3 rounded-[2px] border border-dashed"
              style={{ borderColor: s.color, background: `color-mix(in oklab, ${s.color} 18%, transparent)` }}
            />
          ) : s.axis === "right" ? (
            <span className="w-3 border-t-2 border-dashed" style={{ borderColor: s.color }} />
          ) : (
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
          )}
          {s.name}
          {s.axis === "right" ? <span className="text-muted-foreground/60">(right axis)</span> : null}
        </span>
      ))}
    </div>
  );
}

/** Multi-series time chart: one line per series, shared crosshair tooltip. */
export function TimeChart({
  data,
  series,
  format = fmt.dec2,
  axisFormat = fmt.dec,
  height = 220,
  stacked,
  integer,
  max,
  linear,
  bars,
}: {
  data: Record<string, number>[];
  series: Series[];
  format?: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  stacked?: boolean;
  /** Counts (workers, devices…): whole-number axis ticks only. */
  integer?: boolean;
  /** A fixed top for the left axis, e.g. 100 for shares that add up to 100%. */
  max?: number;
  /** Straight segments between points instead of smoothed curves. */
  linear?: boolean;
  /** With `stacked`: stacked bars in the areas' colours (an even, translucent fill and a line of its colour on top). */
  bars?: boolean;
}) {
  // Unique per chart: gradient ids live in the page-wide SVG id space.
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (data.length < 2) {
    return (
      <div className="grid place-items-center text-sm text-muted-foreground" style={{ height }}>
        No data for this period yet
      </div>
    );
  }
  // Missing points are always gaps: nothing joins two points across a stretch without data.
  const common = {
    data: withBreaks(data),
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={["dataMin", "dataMax"]}
      tickFormatter={(t) => timeTick(t, data[data.length - 1].t - data[0].t)}
      minTickGap={48}
      {...axisProps}
    />
  );
  // Size the axis to its widest label instead of a fixed gutter: estimate the
  // top tick from the data (summed when stacked) and measure its text.
  const leftSeries = series.filter((sr) => sr.axis !== "right");
  const rightSeries = series.filter((sr) => sr.axis === "right");
  const widthFor = (list: Series[], f: (n: number) => string, sum: boolean) => {
    let top = 0;
    for (const row of data) {
      const vals = list.map((sr) => row[sr.key] ?? 0);
      top = Math.max(top, sum ? vals.reduce((x, y) => x + y, 0) : Math.max(0, ...vals));
    }
    const longest = Math.max(f(top * 1.25).length, f(top).length, 1);
    return Math.min(80, Math.max(24, Math.ceil(longest * 6.6) + 8));
  };
  const rightFormat = rightSeries[0]?.format ?? fmt.int;
  const yAxis = (
    <>
      <YAxis
        yAxisId="left"
        domain={max === undefined ? undefined : [0, max]}
        allowDataOverflow={max !== undefined}
        width={widthFor(leftSeries, axisFormat, !!stacked)}
        allowDecimals={!integer}
        tickFormatter={(v) => axisFormat(v)}
        {...axisProps}
      />
      {rightSeries.length ? (
        <YAxis
          yAxisId="right"
          orientation="right"
          width={widthFor(rightSeries, rightFormat, false)}
          allowDecimals={false}
          tickFormatter={(v) => rightFormat(v)}
          {...axisProps}
        />
      ) : null}
    </>
  );
  const grid = <CartesianGrid yAxisId="left" stroke="var(--border)" vertical={false} />;
  const tooltip = (
    <Tooltip
      content={<ChartTooltip format={format} series={series} />}
      cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
      isAnimationActive={false}
    />
  );

  const gradients = (
    <defs>
      {series.map((s, i) => (
        <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={s.color} stopOpacity={0.06} />
        </linearGradient>
      ))}
    </defs>
  );

  if (stacked && bars) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart {...common} barCategoryGap={1}>
          {grid}
          {/* Bars need a category axis: one slot per point. */}
          <XAxis dataKey="t" tickFormatter={(t) => timeTick(t, data[data.length - 1].t - data[0].t)} minTickGap={48} {...axisProps} />
          {yAxis}
          <Tooltip content={<ChartTooltip format={format} series={series} />} cursor={{ fill: "var(--muted-foreground)", fillOpacity: 0.1 }} isAnimationActive={false} />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="1"
              yAxisId="left"
              isAnimationActive={false}
              shape={(p: unknown) => {
                const { x, y, width, height: h } = p as { x: number; y: number; width: number; height: number };
                if (!h || h < 0) return <g />;
                return (
                  <g>
                    <rect x={x} y={y} width={width} height={h} fill={s.color} fillOpacity={0.3} />
                    <line x1={x} x2={x + width} y1={y} y2={y} stroke={s.color} strokeWidth={2} />
                  </g>
                );
              }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {stacked ? (
        <AreaChart {...common}>
          {gradients}
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {series.map((s, i) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="1"
              yAxisId="left"
              type={linear ? "linear" : "monotone"}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#${gid}-${i})`}
              fillOpacity={1}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      ) : (
        <ComposedChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {/* Areas first so solid lines are drawn on top of them. */}
          {series
            .filter((s) => s.variant === "area")
            .map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                name={s.name}
                yAxisId={s.axis === "right" ? "right" : "left"}
                type={linear ? "linear" : "monotone"}
                stroke={s.color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill={s.color}
                fillOpacity={0.1}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          {series.filter((s) => s.variant !== "area").map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              yAxisId={s.axis === "right" ? "right" : "left"}
              type={linear ? "linear" : "monotone"}
              stroke={s.color}
              strokeWidth={s.axis === "right" ? 1.5 : 2}
              strokeDasharray={s.axis === "right" ? "4 3" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      )}
    </ResponsiveContainer>
  );
}

export function Sparkline({ values, color, height = 36 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} />;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <YAxis hide domain={[0, "dataMax"]} />
        <Area
          dataKey="v"
          type="monotone"
          stroke={color}
          strokeWidth={2}
          fill={color}
          fillOpacity={0.15}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
  series,
  actions,
}: {
  /** Leave out (with no subtitle) for a chart whose section already names it. */
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  series: Series[];
  /** Controls for the header's right side; the legend then moves under the chart. */
  actions?: React.ReactNode;
}) {
  return (
    <Card className="gap-3 p-4">
      {title || subtitle || !actions ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions ?? <Legend series={series} />}
        </div>
      ) : null}
      {children}
      {actions ? <Legend series={series} /> : null}
    </Card>
  );
}

export interface CapacityRow {
  t: number;
  used: number;
  free: number;
  rejected?: number;
}

/** Rejections per hour below this are counter noise, not a real shortage. */
export const REJECTED_NOISE_PER_HOUR = 20;

export interface OccupancyInstance {
  id: string;
  name: string;
  color: string;
  rows: CapacityRow[];
}

function OccupancyTooltip({
  active,
  label,
  instances,
}: {
  active?: boolean;
  label?: number;
  instances: OccupancyInstance[];
}) {
  if (!active || label == null) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 text-muted-foreground">{fmt.time(label)}</div>
      <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-0.5 tabular-nums">
        {instances.map((i) => {
          const r = i.rows.find((x) => x.t === label);
          if (!r) return null;
          const total = r.used + r.free;
          const rejecting = r.free === 0 && (r.rejected ?? 0) >= REJECTED_NOISE_PER_HOUR;
          return (
            <Fragment key={i.id}>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Dot color={i.color} />
                {i.name}
              </span>
              <span className="text-right font-semibold">{total ? fmt.pct((r.used / total) * 100) : "—"}</span>
              <span className="text-muted-foreground">
                {r.used}/{total}
                {rejecting ? <span className="text-red-400"> · {fmt.int(r.rejected)} rejected/h</span> : null}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Worker occupancy (in use ÷ connected) per instance on one 0–100 % axis, so
 * instances of different sizes compare directly. Under the plot, one strip per
 * instance turns red while controllers were being turned away.
 */
export function OccupancyChart({ instances, height = 240 }: { instances: OccupancyInstance[]; height?: number }) {
  const withRows = instances.filter((i) => i.rows.some((r) => r.used + r.free > 0));
  const rows = new Map<number, Record<string, number>>();
  for (const i of withRows) {
    for (const r of i.rows) {
      const total = r.used + r.free;
      if (!total) continue;
      const row = rows.get(r.t) ?? { t: r.t };
      row[i.id] = (r.used / total) * 100;
      rows.set(r.t, row);
    }
  }
  const data = withBreaks([...rows.values()].sort((a, b) => a.t - b.t));
  if (data.length < 2) {
    return (
      <div className="grid place-items-center text-sm text-muted-foreground" style={{ height }}>
        No data for this period yet
      </div>
    );
  }
  const t0 = data[0].t;
  const span = data[data.length - 1].t - t0;
  const pct = (t: number) => ((t - t0) / Math.max(1, span)) * 100;
  const yWidth = 40;

  const bandsFor = (i: OccupancyInstance) => {
    const out: { x1: number; x2: number }[] = [];
    let start: number | undefined;
    i.rows.forEach((r, idx) => {
      const on = r.free === 0 && (r.rejected ?? 0) >= REJECTED_NOISE_PER_HOUR;
      if (on && start === undefined) start = r.t;
      if ((!on || idx === i.rows.length - 1) && start !== undefined) {
        out.push({ x1: start, x2: on ? r.t : i.rows[idx - 1].t });
        start = undefined;
      }
    });
    return out;
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => timeTick(t, span)}
            minTickGap={48}
            {...axisProps}
          />
          <YAxis
            width={yWidth}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            {...axisProps}
          />
          <Tooltip
            content={<OccupancyTooltip instances={withRows} />}
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            isAnimationActive={false}
          />
          {withRows.map((i) => (
            <Line
              key={i.id}
              dataKey={i.id}
              name={i.name}
              type="stepAfter"
              stroke={i.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      {/* One rejection strip per instance, aligned with the plot area. */}
      <div className="mt-2 flex flex-col gap-1">
        {withRows.map((i) => (
          <div key={i.id} className="flex items-center" style={{ paddingRight: 6 }}>
            <span className="flex shrink-0 justify-end pr-2" style={{ width: yWidth }} title={i.name}>
              <Dot color={i.color} />
            </span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
              {bandsFor(i).map((b) => (
                <div
                  key={b.x1}
                  className="absolute inset-y-0 bg-red-500"
                  style={{ left: `${pct(b.x1)}%`, width: `${Math.max(0.6, pct(b.x2) - pct(b.x1))}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
