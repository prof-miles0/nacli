// Chart history read from VictoriaMetrics, which already scrapes every
// RotomNG's /api/metrics. Returns the same HistoryPoint shape the in-memory
// history uses, so the frontend does not care where it came from.

import type { HistoryPoint } from "../shared/types.ts";
import type { RotomInstanceConfig, VictoriaMetricsConfig } from "./config.ts";
import { vmPost } from "./vmpanels.ts";

interface RangeResult {
  metric: Record<string, string>;
  values: [number, string][];
}

/**
 * Same bucket width the frontend uses (range / 240, rounded up to 10s), so
 * each chart bucket holds exactly one VM sample and stacks never dip.
 */
export function stepFor(rangeMs: number): number {
  return Math.max(10_000, Math.ceil(rangeMs / 240 / 10_000) * 10_000);
}

/** A range query, to VictoriaMetrics or to the history kept in memory (vm.local). */
async function queryRange(
  vm: VictoriaMetricsConfig,
  query: string,
  start: number,
  end: number,
  stepS: number,
  timeoutMs: number,
): Promise<RangeResult[]> {
  const params = { query, start: String(start), end: String(end), step: `${stepS}s` };
  const json = (await vmPost(vm, "/api/v1/query_range", params, timeoutMs)) as unknown as {
    status: string;
    data?: { result: RangeResult[] };
    error?: string;
  };
  if (json.status !== "success") throw new Error(`VictoriaMetrics: ${json.error ?? "error"}`);
  return json.data?.result ?? [];
}

/** Label matcher for the configured instances plus the optional extra selector. */
function selector(vm: VictoriaMetricsConfig, instances: RotomInstanceConfig[]): string {
  const L = vm.instanceLabel;
  // Regex-escape each name, then escape the result for a PromQL string literal.
  const re = instances.map((i) => i.vmInstance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [`${L}=~"${re.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, vm.selector]
    .filter(Boolean)
    .join(",");
}

export async function vmHistory(
  vm: VictoriaMetricsConfig,
  instances: RotomInstanceConfig[],
  rangeMs: number,
  timeoutMs: number,
): Promise<Record<string, HistoryPoint[]>> {
  const L = vm.instanceLabel;
  const sel = selector(vm, instances);
  const stepMs = stepFor(rangeMs);
  const stepS = stepMs / 1000;
  // A rate window shorter than ~2 scrapes is empty; at long ranges it is the step.
  const win = `${Math.max(stepS, 60)}s`;
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  const start = end - Math.floor(rangeMs / stepMs) * stepMs;

  const queries = {
    workersInUse: `sum by (${L}) (rotom_ng_workers_in_use{${sel}})`,
    workersConnected: `sum by (${L}) (rotom_ng_workers_connected{${sel}})`,
    devicesConnected: `sum by (${L}) (rotom_ng_devices_connected{${sel}})`,
    controllers: `sum by (${L}) (rotom_ng_controller_connections{${sel}})`,
    requestRate: `sum by (${L}) (rate(rotom_ng_rpc_requests_total{${sel}}[${win}]))`,
    latencyMs: `1000 * sum by (${L}) (rate(rotom_ng_rpc_request_duration_seconds_sum{${sel}}[${win}])) / sum by (${L}) (rate(rotom_ng_rpc_request_duration_seconds_count{${sel}}[${win}]))`,
    responses: `sum by (${L}, status) (rate(rotom_ng_worker_responses_total{${sel}}[${win}]))`,
    // Controllers turned away for lack of a free worker, per hour: connections
    // that never led to a LOGIN (see vmControllerDemand).
    rejectedPerHour: `clamp_min(sum by (${L}) (rate(rotom_ng_controller_accepts_total{${sel}}[${win}])) - sum by (${L}) (rate(rotom_ng_worker_responses_total{${sel},method="LOGIN"}[${win}])), 0) * 3600`,
  } as const;

  const entries = await Promise.all(
    Object.entries(queries).map(
      async ([k, q]) => [k, await queryRange(vm, q, start / 1000, end / 1000, stepS, timeoutMs)] as const,
    ),
  );

  // instance label -> timestamp(ms) -> point
  const byInst = new Map<string, Map<number, HistoryPoint>>();
  const point = (inst: string, t: number) => {
    let m = byInst.get(inst);
    if (!m) byInst.set(inst, (m = new Map()));
    let p = m.get(t);
    if (!p) {
      // Gauges vanish when nothing is connected (they are labelled by origin),
      // so a missing value at a scraped timestamp means zero.
      p = { t, devicesConnected: 0, workersConnected: 0, workersInUse: 0, controllers: 0, requestRate: 0, latencyMs: 0, weightInUse: 0 };
      m.set(t, p);
    }
    return p;
  };

  for (const [key, results] of entries) {
    for (const r of results) {
      const inst = r.metric[L];
      if (!inst) continue;
      for (const [ts, raw] of r.values) {
        const v = Number(raw);
        if (!Number.isFinite(v)) continue;
        const p = point(inst, ts * 1000);
        if (key === "responses") {
          const status = r.metric.status || "?";
          (p.responseRates ??= {})[status] = v;
        } else {
          p[key as Exclude<keyof typeof queries, "responses">] = v;
        }
      }
    }
  }

  const out: Record<string, HistoryPoint[]> = {};
  for (const i of instances) {
    const m = byInst.get(i.vmInstance);
    out[i.id] = m ? [...m.values()].sort((a, b) => a.t - b.t) : [];
  }
  return out;
}

export interface DeviceSeries {
  origin: string;
  points: { t: number; v: number }[];
}

export type DeviceMetric = "memory" | "workers_in_use" | "workers_connected";

/**
 * How each per-device metric is reduced inside a bucket: memory keeps the
 * minimum so short dips are not averaged away; worker counts use the mean,
 * rounded to a whole number.
 */
const DEVICE_QUERIES: Record<DeviceMetric, (sel: string, L: string, win: string) => string> = {
  memory: (sel, L, win) => `min by (${L}, origin) (min_over_time(rotom_ng_device_memory_free{${sel}}[${win}]))`,
  // Worker counts are whole numbers: round the bucket's mean so a chart never shows "5,7 workers".
  workers_in_use: (sel, L, win) =>
    `sum by (${L}, origin) (round(avg_over_time(rotom_ng_workers_in_use{${sel}}[${win}])))`,
  workers_connected: (sel, L, win) =>
    `sum by (${L}, origin) (round(avg_over_time(rotom_ng_workers_connected{${sel}}[${win}])))`,
};

export const DEVICE_METRICS = Object.keys(DEVICE_QUERIES) as DeviceMetric[];

/** One series per device (by origin), keyed by instance id. Memory is in KB, as RotomNG reports it. */
export async function vmDeviceSeries(
  vm: VictoriaMetricsConfig,
  instances: RotomInstanceConfig[],
  metric: DeviceMetric,
  rangeMs: number,
  timeoutMs: number,
): Promise<Record<string, DeviceSeries[]>> {
  const L = vm.instanceLabel;
  const sel = selector(vm, instances);
  const stepMs = stepFor(rangeMs);
  const stepS = stepMs / 1000;
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  const start = end - Math.floor(rangeMs / stepMs) * stepMs;
  const results = await queryRange(
    vm,
    DEVICE_QUERIES[metric](sel, L, `${Math.max(stepS, 60)}s`),
    start / 1000,
    end / 1000,
    stepS,
    timeoutMs,
  );
  const out: Record<string, DeviceSeries[]> = {};
  for (const i of instances) out[i.id] = [];
  for (const r of results) {
    const inst = instances.find((i) => i.vmInstance === r.metric[L]);
    if (!inst) continue;
    out[inst.id].push({
      origin: r.metric.origin || "?",
      points: r.values.map(([ts, v]) => ({ t: ts * 1000, v: Number(v) })).filter((p) => Number.isFinite(p.v)),
    });
  }
  return out;
}

export interface ControllerDemand {
  /** Controller connections RotomNG accepted at the websocket level in the window. */
  attempts: number;
  /** Of those, how many got a worker (each assigned controller sends one LOGIN). */
  served: number;
  /** attempts - served: turned away with NO_WORKERS_AVAILABLE. */
  rejected: number;
}

/**
 * RotomNG closes a controller's connection when no worker is free instead of
 * keeping it waiting, so those controllers never appear in /api/status. The
 * only trace is that their connection is counted in controller_accepts_total
 * without a LOGIN following it; the gap estimates how many were turned away.
 */
export async function vmControllerDemand(
  vm: VictoriaMetricsConfig,
  instances: RotomInstanceConfig[],
  windowS: number,
  timeoutMs: number,
): Promise<Record<string, ControllerDemand>> {
  const L = vm.instanceLabel;
  const sel = selector(vm, instances);
  const instant = async (query: string) => {
    const json = (await vmPost(vm, "/api/v1/query", { query }, timeoutMs)) as unknown as {
      data?: { result: { metric: Record<string, string>; value: [number, string] }[] };
    };
    const out = new Map<string, number>();
    for (const r of json.data?.result ?? []) out.set(r.metric[L], Number(r.value[1]) || 0);
    return out;
  };
  const [attempts, served] = await Promise.all([
    instant(`sum by (${L}) (increase(rotom_ng_controller_accepts_total{${sel}}[${windowS}s]))`),
    instant(`sum by (${L}) (increase(rotom_ng_worker_responses_total{${sel},method="LOGIN"}[${windowS}s]))`),
  ]);
  const out: Record<string, ControllerDemand> = {};
  for (const i of instances) {
    const a = Math.round(attempts.get(i.vmInstance) ?? 0);
    const s = Math.round(served.get(i.vmInstance) ?? 0);
    out[i.id] = { attempts: a, served: s, rejected: Math.max(0, a - s) };
  }
  return out;
}
