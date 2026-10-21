// In-memory stand-in for VictoriaMetrics: it reads the /metrics of every
// RotomNG, Dragonite (with a url) and Golbat (with a url) whose charts come
// from memory (no [victoriametrics], no vm_instance, or no data for it there),
// keeps `history_retention` of their series, and answers the same PromQL the
// charts send (via promql.ts) in VictoriaMetrics' JSON.

import type { AppConfig } from "./config.ts";
import { rotomHeaders } from "./rotom.ts";
import { GOLBAT_SERIES } from "./golbat.ts";
import { parsePrometheus } from "./metrics.ts";
import {
  instantQuery,
  type Labels,
  type Matcher,
  matches,
  rangeQuery,
  type SeriesSource,
  type StoredSeries,
  selectorMatchers,
} from "./promql.ts";

/** How often the scraper looks for targets that are due. */
const TICK_MS = 2_000;
/** Old samples are dropped in batches, not on every scrape. */
const TRIM_BATCH = 60;

interface Series {
  labels: Labels;
  /** Index in the instance's `times` of this series' first value. */
  off: number;
  /** One value per scrape from `off` on; NaN where it was missing. */
  vs: number[];
}

/** Samples of one Dragonite, all series aligned on the scrape timestamps. */
class InstanceStore {
  times: number[] = [];
  series = new Map<string, Series>();
  byName = new Map<string, Series[]>();

  add(t: number, samples: { labels: Labels; v: number }[]) {
    this.times.push(t);
    const idx = this.times.length - 1;
    for (const smp of samples) {
      const key = Object.keys(smp.labels)
        .sort()
        .map((k) => `${k}=${smp.labels[k]}`)
        .join(",");
      let s = this.series.get(key);
      if (!s) {
        s = { labels: smp.labels, off: idx, vs: [] };
        this.series.set(key, s);
        const list = this.byName.get(smp.labels.__name__) ?? [];
        list.push(s);
        this.byName.set(smp.labels.__name__, list);
      }
      while (s.off + s.vs.length < idx) s.vs.push(NaN);
      s.vs.push(smp.v);
    }
  }

  trim(cutoff: number) {
    let n = 0;
    while (n < this.times.length && this.times[n] < cutoff) n++;
    if (n < TRIM_BATCH) return;
    this.times.splice(0, n);
    for (const [key, s] of this.series) {
      const drop = n - s.off;
      if (drop > 0) {
        s.vs.splice(0, drop);
        s.off = 0;
      } else s.off -= n;
      if (!s.vs.length) {
        this.series.delete(key);
        const list = this.byName.get(s.labels.__name__);
        if (list) this.byName.set(s.labels.__name__, list.filter((x) => x !== s));
      }
    }
  }

  view(s: Series): StoredSeries {
    const times = this.times;
    return {
      labels: s.labels,
      indexAt(t) {
        // Newest scrape at or before t, then the series' own index for it.
        let lo = 0;
        let hi = times.length - 1;
        let k = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] <= t) {
            k = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (k < s.off) return -1;
        return Math.min(k - s.off, s.vs.length - 1);
      },
      time: (i) => times[s.off + i],
      value: (i) => s.vs[i],
    };
  }
}

/** The `instance` label Golbat's series get here (there is one Golbat). */
export const LOCAL_GOLBAT = "golbat";
/**
 * The `instance` label a RotomNG's series get here; prefixed, because a
 * stack's Rotom and Dragonite share their id.
 */
export const localRotom = (id: string) => `rotom-${id}`;

/** Which instances read /metrics into memory: those VictoriaMetrics does not cover. */
export interface MemoryTargets {
  rotom: (id: string) => boolean;
  dragonite: (id: string) => boolean;
  golbat: boolean;
}

/** One /metrics to read: its series are kept under the `instance` label given. */
interface Target {
  key: string;
  /** For log lines, e.g. "[dragonite] Exeggcute". */
  who: string;
  /** Its full /metrics url. */
  url: string;
  everyMs: number;
  headers: Record<string, string>;
  instance: string;
  keep: (name: string) => boolean;
}

/** Golbat's histograms come as name_bucket / _sum / _count. */
const golbatKeep = (n: string) => GOLBAT_SERIES.has(n) || GOLBAT_SERIES.has(n.replace(/_(bucket|sum|count|total)$/, ""));

export class LocalMetrics implements SeriesSource {
  private stores = new Map<string, InstanceStore>();
  private targets: Target[] = [];
  private lastScrape = new Map<string, number>();
  private retentionMs = 24 * 3_600_000;
  private timeoutMs = 8000;
  private timer?: NodeJS.Timeout;
  private lastError = new Map<string, string>();

  /**
   * (Re)configures from config.toml and from which instances need memory.
   * Dragonites are kept under their id, RotomNGs under localRotom(id); an
   * instance that moves to VictoriaMetrics drops what was kept for it.
   */
  apply(cfg: AppConfig, need: MemoryTargets) {
    this.retentionMs = cfg.historyRetentionMs;
    this.timeoutMs = cfg.requestTimeoutMs;
    this.targets = [
      ...cfg.instances
        .filter((i) => need.rotom(i.id))
        .map((i) => ({
          key: `rotom:${i.id}`,
          who: `[rotom] ${i.name}`,
          url: `${i.url}/api/metrics`,
          headers: { ...rotomHeaders(i), Accept: "text/plain" },
          everyMs: cfg.pollIntervalMs,
          instance: localRotom(i.id),
          // Its own series; not the Go runtime ones nor its HTTP server's.
          keep: (n: string) => n.startsWith("rotom_ng_") && !/^rotom_ng_(go|process|gin)_/.test(n),
        })),
      ...cfg.dragonite
        .filter((d) => d.api && need.dragonite(d.id))
        .map((d) => ({
          key: `dragonite:${d.id}`,
          who: `[dragonite] ${d.name}`,
          url: `${d.api!.url}/metrics`,
          headers: d.api!.headers,
          everyMs: cfg.pollIntervalMs,
          instance: d.id,
          keep: (n: string) => n.startsWith("dragonite_"),
        })),
    ];
    if (cfg.golbat?.api && need.golbat) {
      this.targets.push({
        key: "golbat",
        who: "[golbat]",
        url: `${cfg.golbat.api.url}/metrics`,
        headers: cfg.golbat.api.headers,
        everyMs: cfg.pollIntervalMs,
        instance: LOCAL_GOLBAT,
        keep: golbatKeep,
      });
    }
    const keep = new Set(this.targets.map((t) => t.instance));
    for (const inst of this.stores.keys()) if (!keep.has(inst)) this.stores.delete(inst);
    for (const k of this.lastScrape.keys()) if (!this.targets.some((t) => t.key === k)) this.lastScrape.delete(k);
    if (this.targets.length && !this.timer) {
      void this.scrapeDue();
      this.timer = setInterval(() => void this.scrapeDue(), TICK_MS);
    } else if (!this.targets.length && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get active() {
    return this.targets.length > 0;
  }

  /** Whether this Dragonite (by id), RotomNG (localRotom) or Golbat (LOCAL_GOLBAT) is being kept. */
  has(instance: string) {
    return this.targets.some((t) => t.instance === instance);
  }

  /** Reads every target whose turn has come (each has its own interval). */
  private async scrapeDue() {
    const now = Date.now();
    const due = this.targets.filter((t) => now - (this.lastScrape.get(t.key) ?? 0) >= t.everyMs - TICK_MS / 2);
    for (const t of due) this.lastScrape.set(t.key, now);
    await Promise.all(due.map((t) => this.scrape(t)));
  }

  private async scrape(d: Target) {
    try {
      const res = await fetch(d.url, {
        headers: d.headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const now = Date.now();
      const samples = parsePrometheus(await res.text())
        .filter((s) => d.keep(s.name) && Number.isFinite(s.value))
        // The same labels VictoriaMetrics would leave, so the queries need no
        // change: its own instance/job, and the target's renamed exported_*.
        .map((s) => {
          const { job, instance, ...rest } = s.labels;
          const labels: Labels = { ...rest, __name__: s.name, instance: d.instance, job: "nacli" };
          if (job !== undefined) labels.exported_job = job;
          if (instance !== undefined) labels.exported_instance = instance;
          return { labels, v: s.value };
        });
      this.ingest(d.instance, now, samples);
      if (this.lastError.delete(d.key)) console.log(`${d.who}: /metrics is responding again`);
    } catch (e) {
      const msg = (e as Error).message;
      if (this.lastError.get(d.key) !== msg) console.error(`${d.who}: could not read /metrics (${msg})`);
      this.lastError.set(d.key, msg);
    }
  }

  /** Adds one scrape's samples (labels include __name__ and instance). */
  ingest(instance: string, t: number, samples: { labels: Labels; v: number }[]) {
    let store = this.stores.get(instance);
    if (!store) {
      store = new InstanceStore();
      this.stores.set(instance, store);
    }
    store.add(t, samples);
    store.trim(t - this.retentionMs - 3_600_000);
  }

  select(ms: Matcher[]): StoredSeries[] {
    const name = ms.find((m) => m.label === "__name__" && m.op === "=")?.value;
    const out: StoredSeries[] = [];
    for (const store of this.stores.values()) {
      const pool = name ? (store.byName.get(name) ?? []) : store.series.values();
      for (const s of pool) if (matches(s.labels, ms)) out.push(store.view(s));
    }
    return out;
  }

  // VictoriaMetrics-shaped answers (see vmPost in vmpanels.ts).
  query(q: string, tMs = Date.now()) {
    return instantQuery(this, q, tMs);
  }
  queryRange(q: string, startMs: number, endMs: number, stepMs: number) {
    return rangeQuery(this, q, startMs, endMs, stepMs);
  }
  labelValues(label: string, match: string) {
    const out = new Set<string>();
    for (const s of this.select(selectorMatchers(match))) if (s.labels[label]) out.add(s.labels[label]);
    return [...out];
  }

  /** How far back the stored samples go, for the UI's range buttons. */
  get retention() {
    return this.retentionMs;
  }
}
