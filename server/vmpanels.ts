// Shared engine for the chart pages ported from Grafana dashboards (Golbat,
// Dragonite): panel definitions live on the server, the browser only picks a
// panel id, range and filters, so it can never send arbitrary PromQL.

import type { ZapdosConfig } from "./config.ts";
import { parseDurationMs } from "./promql.ts";

interface QueryDef {
  /**
   * PromQL with placeholders: `$sel` → the base selector plus the area filter
   * (when the panel is `areaAware`), `$base` → the base selector alone,
   * `$inter` → the counting interval.
   */
  expr: string;
  /** Grafana-style legend: "{{label}}" pieces ("{{a|b}}": a, else b), or "__auto" for all labels. */
  legend: string;
  /** Plot on a second Y axis on the right (a different unit from the rest). */
  axis?: "right";
}

export interface PanelDef {
  id: string;
  row: string;
  title: string;
  /** Whether the area filter applies (only series with an area label). */
  areaAware: boolean;
  /** Label holding the area in this panel's series (default "area"). */
  areaLabel?: string;
  kind: "line" | "bars";
  stacked?: boolean;
  unit?: "minutes" | "seconds" | "percent";
  queries: QueryDef[];
}

export interface PanelSeries {
  name: string;
  points: { t: number; v: number }[];
  axis?: "right";
}

export interface PanelData {
  /** Every timestamp the chart should have, so missing points read as gaps. */
  start: number;
  end: number;
  stepMs: number;
  series: PanelSeries[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const promString = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** `label=~"a|b"` matching exactly the given values. */
export function anyOf(label: string, values: string[]): string {
  return `${label}=~"${promString(values.map(escapeRegex).join("|"))}"`;
}

function join(parts: string[]): string {
  const sel = parts.filter(Boolean).join(",");
  // `{,x="y"}` is invalid; a bare name with no matchers needs a harmless one.
  return sel || '__name__!=""';
}

function legendFor(template: string, labels: Record<string, string>): string {
  if (template === "__auto") {
    const rest = Object.entries(labels).filter(([k]) => k !== "__name__");
    return rest.length ? rest.map(([k, v]) => `${k}=${v}`).join(", ") : "valor";
  }
  // "{{a|b}}" falls back to label b when a is missing.
  return (
    template
      .replace(/\{\{\s*([\w|]+)\s*\}\}/g, (_, ks: string) => ks.split("|").map((k) => labels[k]).find(Boolean) ?? "")
      .replace(/\s+/g, " ")
      .trim() || "—"
  );
}

type VmJson = {
  status: string;
  error?: string;
  data?: { result: { metric: Record<string, string>; values?: [number, string][]; value?: [number, string] }[] };
};

export async function vmPost(vm: ZapdosConfig, path: string, params: Record<string, string>, timeoutMs: number) {
  if (vm.local) {
    if (path === "/api/v1/query_range") {
      const step = parseDurationMs(params.step ?? "30s");
      return vm.local.queryRange(params.query, Number(params.start) * 1000, Number(params.end) * 1000, step) as VmJson;
    }
    return vm.local.query(params.query, params.time ? Number(params.time) * 1000 : undefined) as VmJson;
  }
  const res = await fetch(`${vm.url}${path}`, {
    method: "POST",
    headers: { ...vm.headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Zapdos HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<VmJson>;
}

/** Instant query returning one number per value of `by` (or `""` without it). */
export async function vmScalars(
  vm: ZapdosConfig,
  query: string,
  by: string | undefined,
  timeoutMs: number,
): Promise<Map<string, number>> {
  const json = await vmPost(vm, "/api/v1/query", { query }, timeoutMs);
  const out = new Map<string, number>();
  for (const r of json.data?.result ?? []) {
    const v = Number(r.value?.[1]);
    if (Number.isFinite(v)) out.set(by ? (r.metric[by] ?? "") : "", v);
  }
  return out;
}

export async function vmLabelValues(
  vm: ZapdosConfig,
  label: string,
  match: string,
  timeoutMs: number,
  /** Look back to here (unix s); Zapdos' own default otherwise. */
  startS?: number,
): Promise<string[]> {
  if (vm.local) return vm.local.labelValues(label, match);
  const params = new URLSearchParams({ "match[]": match });
  if (startS) params.set("start", String(startS));
  const res = await fetch(`${vm.url}/api/v1/label/${label}/values?${params}`, {
    headers: vm.headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Zapdos HTTP ${res.status}`);
  const json = (await res.json()) as { data?: string[] };
  return json.data ?? [];
}

export async function runPanel(
  vm: ZapdosConfig,
  panel: PanelDef,
  opts: {
    /** Matchers every series of this source carries, e.g. `instance="golbat"`. */
    base: string;
    areas: string[];
    rangeMs: number;
    stepMs: number;
    inter: string;
    /**
     * Counter that grows whenever an area is being scanned. With areas
     * selected, an interval in which it did not grow was not scanned at all:
     * its zeros mean "no data", so those points are dropped and the chart
     * shows a gap instead of a line along the floor.
     */
    scanMetric: string;
  },
  timeoutMs: number,
): Promise<PanelData> {
  const end = Math.floor(Date.now() / opts.stepMs) * opts.stepMs;
  const start = end - Math.floor(opts.rangeMs / opts.stepMs) * opts.stepMs;
  const filtering = panel.areaAware && opts.areas.length > 0;
  const base = join([opts.base]);
  const sel = filtering ? join([opts.base, anyOf(panel.areaLabel ?? "area", opts.areas)]) : base;
  const range = { start: String(start / 1000), end: String(end / 1000), step: `${opts.stepMs / 1000}s` };

  let scanned: Set<number> | undefined;
  if (filtering) {
    const maskSel = join([opts.base, anyOf("area", opts.areas)]);
    const mask = await vmPost(
      vm,
      "/api/v1/query_range",
      { query: `sum(increase(${opts.scanMetric}{${maskSel}}[${opts.inter}])) > 0`, ...range },
      timeoutMs,
    );
    scanned = new Set((mask.data?.result?.[0]?.values ?? []).map(([ts]) => ts * 1000));
  }

  const results = await Promise.all(
    panel.queries.map(async (q) => {
      const query = q.expr.replaceAll("$sel", sel).replaceAll("$base", base).replaceAll("$inter", opts.inter);
      const json = await vmPost(vm, "/api/v1/query_range", { query, ...range }, timeoutMs);
      if (json.status !== "success") throw new Error(`Zapdos: ${json.error ?? "error"}`);
      return (json.data?.result ?? []).map((r) => ({
        name: legendFor(q.legend, r.metric),
        axis: q.axis,
        points: (r.values ?? [])
          .map(([ts, v]) => ({ t: ts * 1000, v: Number(v) }))
          .filter((p) => Number.isFinite(p.v) && (!scanned || scanned.has(p.t))),
      }));
    }),
  );
  // Same legend twice (e.g. two queries yielding "OK") would collide as chart keys.
  const seen = new Map<string, number>();
  const series = results.flat().map((s) => {
    const n = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, n);
    return n > 1 ? { ...s, name: `${s.name} (${n})` } : s;
  });
  return { start, end, stepMs: opts.stepMs, series };
}
