// In-memory stand-in for VictoriaMetrics, for the Dragonite section when no
// [victoriametrics] is configured: every SCRAPE_MS it reads each Dragonite's
// /metrics, keeps `history_retention` of its dragonite_* series, and answers
// the same PromQL the charts send (via promql.ts) in VictoriaMetrics' JSON.

import type { AppConfig, DragoniteConfig } from "./config.ts";
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

const SCRAPE_MS = 30_000;
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

export class LocalMetrics implements SeriesSource {
  private stores = new Map<string, InstanceStore>();
  private targets: DragoniteConfig[] = [];
  private retentionMs = 24 * 3_600_000;
  private timeoutMs = 8000;
  private timer?: NodeJS.Timeout;
  private lastError = new Map<string, string>();

  /** (Re)configures from config.toml: scrapes only without VictoriaMetrics. */
  apply(cfg: AppConfig) {
    this.retentionMs = cfg.historyRetentionMs;
    this.timeoutMs = cfg.requestTimeoutMs;
    this.targets = cfg.victoriaMetrics ? [] : cfg.dragonite.filter((d) => d.api);
    const keep = new Set(this.targets.map((d) => d.vmInstance));
    for (const inst of this.stores.keys()) if (!keep.has(inst)) this.stores.delete(inst);
    if (this.targets.length && !this.timer) {
      void this.scrapeAll();
      this.timer = setInterval(() => void this.scrapeAll(), SCRAPE_MS);
    } else if (!this.targets.length && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get active() {
    return this.targets.length > 0;
  }

  private async scrapeAll() {
    await Promise.all(this.targets.map((d) => this.scrape(d)));
  }

  private async scrape(d: DragoniteConfig) {
    try {
      const res = await fetch(`${d.api!.url}/metrics`, {
        headers: d.api!.headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const now = Date.now();
      const samples = parsePrometheus(await res.text())
        .filter((s) => s.name.startsWith("dragonite_") && Number.isFinite(s.value))
        // The same labels VictoriaMetrics would leave, so the queries need no
        // change: its own instance/job, and the target's renamed exported_*.
        .map((s) => {
          const { job, instance, ...rest } = s.labels;
          const labels: Labels = { ...rest, __name__: s.name, instance: d.vmInstance, job: "nacli" };
          if (job !== undefined) labels.exported_job = job;
          if (instance !== undefined) labels.exported_instance = instance;
          return { labels, v: s.value };
        });
      this.ingest(d.vmInstance, now, samples);
      if (this.lastError.delete(d.id)) console.log(`[dragonite] ${d.name}: /metrics is responding again`);
    } catch (e) {
      const msg = (e as Error).message;
      if (this.lastError.get(d.id) !== msg) console.error(`[dragonite] ${d.name}: could not read /metrics (${msg})`);
      this.lastError.set(d.id, msg);
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
