import type {
  InstanceInfo,
  InstanceMetrics,
  InstanceSummary,
  RotomConfig,
  RotomStatus,
} from "../shared/types.ts";
import type { AppConfig, RotomInstanceConfig } from "./config.ts";
import { parsePrometheus, summarizeMetrics } from "./metrics.ts";

/**
 * Rotom is read on demand, like Dragonite: a page asking for its state gets
 * it fresh, shared by every request within this window.
 */
const STATUS_TTL_MS = 3000;
/** /metrics is heavier (~40KB) and only feeds the Instances page summary. */
const METRICS_TTL_MS = 30_000;

export class RotomError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function rotomHeaders(inst: RotomInstanceConfig): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", ...inst.headers };
  if (inst.apiSecret) h["X-Rotom-Secret"] = inst.apiSecret;
  return h;
}

export async function rotomFetch(
  inst: RotomInstanceConfig,
  path: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${inst.url}/api${path}`, {
      ...init,
      headers: { ...rotomHeaders(inst), ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    if (err.name === "TimeoutError") throw new RotomError(`no response in ${timeoutMs / 1000}s`);
    throw new RotomError(err.cause?.code ?? err.message);
  }
  return res;
}

async function getJson<T>(inst: RotomInstanceConfig, path: string, timeoutMs: number): Promise<T> {
  const res = await rotomFetch(inst, path, timeoutMs);
  if (res.status === 401) throw new RotomError("401 unauthorized (check api_secret / headers)", 401);
  if (res.status >= 300 && res.status < 400) {
    throw new RotomError(`redirect ${res.status} (authentication proxy in front?)`, res.status);
  }
  if (!res.ok) throw new RotomError(`HTTP ${res.status} on ${path}`, res.status);
  return (await res.json()) as T;
}

async function getText(inst: RotomInstanceConfig, path: string, timeoutMs: number): Promise<string> {
  const res = await rotomFetch(inst, path, timeoutMs, { headers: { Accept: "text/plain" } });
  if (!res.ok) throw new RotomError(`HTTP ${res.status} on ${path}`, res.status);
  return res.text();
}

export function summarize(status: RotomStatus): InstanceSummary {
  const workers = status.devices.flatMap((d) => d.workers ?? []);
  const g = status.global_stats;
  return {
    devices: status.devices.length,
    devicesConnected: status.devices.filter((d) => d.is_connected).length,
    devicesInUse: status.devices.filter((d) => d.is_in_use).length,
    devicesEnabled: status.devices.filter((d) => d.enabled).length,
    workers: workers.length,
    workersConnected: workers.filter((w) => w.is_connected).length,
    workersInUse: workers.filter((w) => w.is_in_use).length,
    weightInUse: status.devices.reduce((a, d) => a + (d.worker_in_use_weight ?? 0), 0),
    weightMax: status.devices.reduce((a, d) => a + (d.worker_max_weight ?? 0), 0),
    controllers: status.controllers.length,
    requestRate: g?.requests_rate_over_30_seconds ?? 0,
    latencyMs: g?.request_ms_avg_over_30_seconds ?? 0,
    rates: {
      "30s": g?.requests_rate_over_30_seconds ?? 0,
      "1m": g?.requests_rate_over_1_min ?? 0,
      "5m": g?.requests_rate_over_5_min ?? 0,
      "15m": g?.requests_rate_over_15_min ?? 0,
    },
    latencies: {
      "30s": g?.request_ms_avg_over_30_seconds ?? 0,
      "1m": g?.request_ms_avg_over_1_min ?? 0,
      "5m": g?.request_ms_avg_over_5_min ?? 0,
      "15m": g?.request_ms_avg_over_15_min ?? 0,
    },
  };
}

class InstanceState {
  status?: RotomStatus;
  config?: RotomConfig;
  metrics?: InstanceMetrics;
  reachable = false;
  lastError?: string;
  lastPollAt?: number;
  lastSuccessAt?: number;
  latencyMs?: number;
  private metricsAt = 0;
  private inFlight?: Promise<void>;

  constructor(public cfg: RotomInstanceConfig) {}

  /**
   * Its state as of at most `maxAgeMs` ago: read from its API when older,
   * once however many callers ask at the same time.
   */
  async fresh(app: AppConfig, maxAgeMs = STATUS_TTL_MS): Promise<void> {
    if (this.lastPollAt !== undefined && Date.now() - this.lastPollAt < maxAgeMs) return;
    this.inFlight ??= this.read(app).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Forget the cached state (after an action), so the next caller reads it again. */
  stale() {
    this.lastPollAt = undefined;
  }

  private async read(app: AppConfig): Promise<void> {
    const started = Date.now();
    const timeout = app.requestTimeoutMs;
    const wantMetrics = started - this.metricsAt >= METRICS_TTL_MS;
    try {
      const [status, config] = await Promise.all([
        getJson<RotomStatus>(this.cfg, "/status", timeout),
        getJson<{ config: RotomConfig }>(this.cfg, "/config", timeout).then((r) => r.config),
      ]);
      if (wantMetrics) {
        // Metrics are optional: a failure here must not mark the instance down.
        const text = await getText(this.cfg, "/metrics", timeout).catch(() => undefined);
        if (text) {
          this.metrics = summarizeMetrics(parsePrometheus(text));
          this.metricsAt = Date.now();
        }
      }
      this.status = { ...status, devices: status.devices ?? [], controllers: status.controllers ?? [] };
      this.config = config;
      this.reachable = true;
      this.lastError = undefined;
      this.lastSuccessAt = Date.now();
      this.latencyMs = Date.now() - started;
    } catch (e) {
      this.reachable = false;
      this.lastError = (e as Error).message;
    } finally {
      this.lastPollAt = Date.now();
    }
  }

  info(): InstanceInfo {
    return {
      id: this.cfg.id,
      name: this.cfg.name,
      // url deliberately omitted: instances often live on internal addresses
      // and the browser never talks to them directly.
      reachable: this.reachable,
      lastError: this.lastError,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      latencyMs: this.latencyMs,
      config: this.config,
      summary: this.status ? summarize(this.status) : undefined,
      metrics: this.metrics,
    };
  }
}

export class RotomRegistry {
  private states = new Map<string, InstanceState>();

  constructor(private app: AppConfig) {
    this.apply(app);
  }

  /** Applies a (re)loaded config, keeping state for instances that survive. */
  apply(app: AppConfig) {
    this.app = app;
    const next = new Map<string, InstanceState>();
    for (const cfg of app.instances) {
      const prev = [...this.states.values()].find((s) => s.cfg.url === cfg.url);
      if (prev) {
        prev.cfg = cfg;
        next.set(cfg.id, prev);
      } else {
        next.set(cfg.id, new InstanceState(cfg));
      }
    }
    this.states = next;
  }

  /** Every instance's state, read from its API when older than `maxAgeMs`. */
  async fresh(maxAgeMs?: number) {
    await Promise.all([...this.states.values()].map((s) => s.fresh(this.app, maxAgeMs)));
    return this;
  }

  list(): InstanceInfo[] {
    return [...this.states.values()].map((s) => s.info());
  }

  get(id: string) {
    return this.states.get(id);
  }

  all() {
    return [...this.states.values()];
  }
}
