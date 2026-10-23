import { createHash } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { serve } from "@hono/node-server";
import { unpackArchive } from "./archive.ts";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type {
  DragoniteProxies,
  DragoniteRateEvent,
  DragoniteStatus,
  StackGeofences,
  AreaStats,
  AreaStatsCounts,
  AreaStatsResponse,
  SystemStatus,
  ProxyEntry,
  ProxyImportResult,
  ProxyInstance,
  ProxyStackSummary,
  AccountLevelCounts,
  DragoniteAccount,
  DragoniteSummary,
  MapDevice,
  MapTrailPoint,
  AppInfo,
  Controller,
  HistoryPoint,
  MergedStatus,
  MeResponse,
  Tagged,
  Worker,
} from "../shared/types.ts";
import {
  checkCredentials,
  clearFailedLogins,
  createSession,
  loginAllowed,
  recordFailedLogin,
  SESSION_COOKIE,
  verifySession,
} from "./auth.ts";
import { type AppConfig, type DragoniteConfig, loadConfig, type RotomInstanceConfig, type ZapdosConfig } from "./config.ts";
import { RotomRegistry, rotomFetch } from "./rotom.ts";
import {
  controllerSource,
  DRAGONITE_PANELS,
  DRAGONITE_ROWS,
  dragoniteAreas,
  dragoniteBase,
  dragoniteStats,
  sourceMatches,
} from "./dragonite.ts";
import { runPanel, vmScalars } from "./vmpanels.ts";
import { LOCAL_GOLBAT, LocalMetrics, localRotom } from "./local-metrics.ts";
import {
  ACCOUNT_SORTS,
  accountLevelStats,
  accountList,
  accountStats,
  ACCOUNT_PROVIDERS,
  createAccount,
  importAccounts,
  areaGeofences,
  clearScoutQueue,
  createArea,
  questAction,
  recalculateRoute,
  KOJI_MODES,
  type KojiMode,
  getArea,
  saveArea,
  createMode,
  deleteMode,
  dragoniteAreas as dragoniteAreaList,
  getMode,
  DRAGONITE_CONTROLS,
  type DragoniteControl,
  dragoniteControl,
  instanceConfig,
  rateLimit,
  type RateLimit,
  DragoniteError,
  reloadDragonite,
  schedulerCall,
  levelStats,
  scoutJobs,
  MODE_TYPES,
  type ModeInput,
  type ModeType,
  unboundModes,
  updateMode,
  createProxies,
  createProxy,
  deleteProxy,
  listProxies,
  parseProxyLines,
  proxyIdentity,
  proxyStats,
  reloadProxies,
  setAreaEnabled,
  setProxyEnabled,
  transferArea,
} from "./dragonite-api.ts";
import { areaSpawnpoints, areaStats, limited, sumStats } from "./golbat-stats.ts";
import { GOLBAT_INTERVALS, GOLBAT_PANELS, golbatAreas, golbatPanel, golbatSummary } from "./golbat.ts";
import { DEVICE_METRICS, type DeviceMetric, vmControllerDemand, vmDeviceSeries, vmHistory } from "./vm.ts";

const CONFIG_PATH = process.env.CONFIG ?? process.argv[2] ?? "config.toml";
const STATIC_DIR = process.env.STATIC_DIR ?? "dist/web";

let cfg: AppConfig = loadConfig(CONFIG_PATH);
const registry = new RotomRegistry(cfg);
// History in memory, read from /metrics only for the instances whose charts
// Zapdos does not cover (no [zapdos], no zapdos_instance, or no
// data for it there). Set again after each Zapdos check.
const localMetrics = new LocalMetrics();
function applyMemory() {
  localMetrics.apply(cfg, {
    rotom: (id) => !onVm("rotom", cfg.instances.find((i) => i.id === id)?.zapdosInstance ?? ""),
    dragonite: (id) => !onVm("dragonite", cfg.dragonite.find((d) => d.id === id)?.zapdosInstance ?? ""),
    golbat: !onVm("golbat", cfg.golbat?.zapdosInstance ?? ""),
  });
}
/** The in-memory history, queried as if it were Zapdos. */
const LOCAL_VM: ZapdosConfig = { url: "memory", headers: {}, instanceLabel: "instance", selector: "", local: localMetrics };

// ---------- Which instances Zapdos has data for ----------

type VmKind = "rotom" | "dragonite" | "golbat";
/** A series each kind always exposes: seen in the last hour = Zapdos has that instance. */
const VM_PROBE: Record<VmKind, string> = {
  rotom: "rotom_ng_workers_connected",
  dragonite: "dragonite_location_handled_counter",
  golbat: "golbat_pokemon_count_new",
};
const VM_CHECK_MS = 5 * 60_000;
/** `${kind}:${zapdos_instance}` with recent data; undefined until the first check. */
let vmReady: Set<string> | undefined;

/**
 * Whether an instance's charts come from Zapdos: only with
 * [zapdos], a zapdos_instance, and data for it there. Before the first
 * check it is assumed, so charts do not start empty.
 */
function onVm(kind: VmKind, zapdosInstance: string) {
  if (!cfg.zapdos || !zapdosInstance) return false;
  return vmReady ? vmReady.has(`${kind}:${zapdosInstance}`) : true;
}

async function checkVm() {
  const vm = cfg.zapdos;
  const next = new Set<string>();
  if (vm) {
    const L = vm.instanceLabel;
    const wanted: Record<VmKind, string[]> = {
      rotom: cfg.instances.map((i) => i.zapdosInstance).filter(Boolean),
      dragonite: cfg.dragonite.map((d) => d.zapdosInstance).filter(Boolean),
      golbat: cfg.golbat?.zapdosInstance ? [cfg.golbat.zapdosInstance] : [],
    };
    for (const kind of Object.keys(wanted) as VmKind[]) {
      const names = wanted[kind];
      if (!names.length) continue;
      const re = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      // Rotom's queries add the global selector; the others never did.
      const extra = kind === "rotom" && vm.selector ? `,${vm.selector}` : "";
      try {
        const found = await vmScalars(vm, `count by (${L}) (last_over_time(${VM_PROBE[kind]}{${L}=~"${re}"${extra}}[1h]))`, L, 10_000);
        for (const n of names) if (found.has(n)) next.add(`${kind}:${n}`);
      } catch (e) {
        console.error(`[zapdos] could not check ${kind} data in Zapdos, using memory: ${(e as Error).message}`);
      }
    }
    // Say which instances fall back to memory, once per change.
    for (const kind of Object.keys(wanted) as VmKind[]) {
      for (const n of wanted[kind]) {
        const k = `${kind}:${n}`;
        const before = vmReady ? vmReady.has(k) : undefined;
        if (before !== next.has(k)) {
          console.log(`[zapdos] ${kind} "${n}": ${next.has(k) ? "data in Zapdos" : "no data in Zapdos, charts from memory"}`);
        }
      }
    }
  }
  vmReady = next;
  applyMemory();
}
applyMemory();
void checkVm();
setInterval(() => void checkVm(), VM_CHECK_MS).unref();

function reload(reason: string) {
  try {
    cfg = loadConfig(CONFIG_PATH);
    registry.apply(cfg);
    applyMemory();
    applyStatsHistory();
    void checkVm();
    console.log(`[config] reloaded (${reason}): ${cfg.instances.length} instances, ${cfg.users.length} users`);
  } catch (e) {
    console.error(`[config] reload failed, keeping the previous configuration: ${(e as Error).message}`);
  }
}

process.on("SIGHUP", () => reload("SIGHUP"));
let reloadTimer: NodeJS.Timeout | undefined;
// The folder is watched, not the file: editors that save by writing a new
// file and renaming it over the old one would leave a file watch behind.
watch(dirname(cfg.path), (_, name) => {
  if (name && name !== basename(cfg.path)) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reload("file changed"), 300);
});

type Env = { Variables: { user: string } };
const app = new Hono<Env>();

function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ---------- Auth ----------

app.get("/api/auth/me", (c) => {
  const user = verifySession(cfg, getCookie(c, SESSION_COOKIE));
  return c.json<MeResponse>({ authenticated: !!user, username: user ?? undefined, title: cfg.title });
});

app.post("/api/auth/login", async (c) => {
  const ip = clientIp(c);
  if (!loginAllowed(ip)) {
    return c.json({ error: "Too many attempts. Wait a few minutes." }, 429);
  }
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}));
  const username = (body as { username?: string }).username?.trim() ?? "";
  const password = (body as { password?: string }).password ?? "";
  if (!checkCredentials(cfg, username, password)) {
    recordFailedLogin(ip);
    console.warn(`[auth] failed login for "${username}" from ${ip}`);
    return c.json({ error: "Wrong username or password" }, 401);
  }
  clearFailedLogins(ip);
  const secure = cfg.secureCookies || c.req.header("x-forwarded-proto") === "https";
  setCookie(c, SESSION_COOKIE, createSession(cfg, username), {
    httpOnly: true,
    sameSite: "Strict",
    secure,
    path: "/",
    maxAge: Math.floor(cfg.sessionTtlMs / 1000),
  });
  return c.json({ ok: true, username });
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Everything else under /api needs a session.
app.use("/api/*", async (c, next) => {
  const user = verifySession(cfg, getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "not authenticated" }, 401);
  // A custom header is required so a cross-site form cannot ride the cookie.
  if (c.req.method !== "GET" && c.req.header("x-nacli") !== "1") {
    return c.json({ error: "missing X-Nacli header" }, 400);
  }
  c.set("user", user);
  await next();
});

// ---------- Dashboard data ----------

app.get("/api/app", async (c) => {
  await registry.fresh();
  return c.json<AppInfo>({
    title: cfg.title,
    pollIntervalMs: cfg.pollIntervalMs,
    historySource: cfg.instances.some((i) => onVm("rotom", i.zapdosInstance)) ? "zapdos" : "memory",
    golbat: !!golbatCtx(),
    golbatMap: !!cfg.golbat?.api,
    map: cfg.map,
    dragonite: cfg.dragonite.map(({ id, name, rotom, api, zapdosInstance }) => ({
      id,
      name,
      rotom,
      accounts: !!api,
      historyMs: dragoniteSource([id])?.maxRangeMs ?? 0,
      fromVm: onVm("dragonite", zapdosInstance),
    })),
    dragoniteHistory: (() => {
      const all = dragoniteSource();
      return all ? { source: all.source === "vm" ? "zapdos" : "memory", maxRangeMs: all.maxRangeMs } : undefined;
    })(),
    golbatHistoryMs: golbatCtx()?.maxRangeMs,
    golbatStats: !!cfg.golbat?.api && cfg.dragonite.some((d) => d.api),
    golbatStatsHistoryMs: statsEvery,
    instances: registry.list(),
  });
});

app.get("/api/status", async (c) => {
  await registry.fresh();
  const only = c.req.query("instance");
  const out: MergedStatus = { devices: [], workers: [], controllers: [] };
  for (const s of registry.all()) {
    if (only && only !== "all" && s.cfg.id !== only) continue;
    if (!s.status) continue;
    const tag = { instanceId: s.cfg.id, instanceName: s.cfg.name };
    for (const d of s.status.devices) {
      const { workers, ...rest } = d;
      out.devices.push({ ...rest, ...tag, workers });
      for (const w of workers ?? []) out.workers.push({ ...w, ...tag } as Tagged<Worker>);
    }
    for (const ctl of s.status.controllers) out.controllers.push({ ...ctl, ...tag } as Tagged<Controller>);
  }
  return c.json(out);
});

const MAX_VM_RANGE_MS = 30 * 86_400_000;
/** Short cache so several open tabs do not each hit Zapdos. */
const vmCache = new Map<string, { at: number; data: Promise<unknown> }>();

function cachedVm<T>(key: string, rangeMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  let hit = vmCache.get(key);
  if (!hit || now - hit.at > Math.max(10_000, rangeMs / 240)) {
    hit = { at: now, data: load() };
    vmCache.set(key, hit);
    hit.data.catch(() => vmCache.delete(key));
  }
  return hit.data as Promise<T>;
}

function rangeParam(raw: string | undefined, max: number) {
  return Math.min(Math.max(Number(raw) || 3_600_000, 60_000), max);
}

// ---------- Golbat (Zapdos) ----------

/** Golbat's stored metrics: need [zapdos] and its zapdos_instance there. */
/**
 * Where Golbat's charts come from: Zapdos when its zapdos_instance has
 * data there, else the history kept in memory from its /metrics (needs url).
 */
function golbatCtx() {
  const golbat = cfg.golbat;
  if (!golbat) return undefined;
  if (cfg.zapdos && onVm("golbat", golbat.zapdosInstance)) {
    return { vm: cfg.zapdos, golbat, source: "vm" as const, maxRangeMs: MAX_VM_RANGE_MS };
  }
  if (localMetrics.has(LOCAL_GOLBAT)) {
    return { vm: LOCAL_VM, golbat: { ...golbat, selector: `instance="${LOCAL_GOLBAT}"` }, source: "memory" as const, maxRangeMs: localMetrics.retention };
  }
  return undefined;
}

const NO_GOLBAT = { error: "requires url in [golbat] (or zapdos_instance with [zapdos])" };

app.get("/api/golbat/meta", async (c) => {
  const ctx = golbatCtx();
  if (!ctx) return c.json(NO_GOLBAT, 404);
  const areas = await cachedVm(`golbat:${ctx.source}:areas`, 60_000 * 240 * 5, () => golbatAreas(ctx.vm, ctx.golbat, 20_000)).catch(
    () => [] as string[],
  );
  return c.json({
    intervals: GOLBAT_INTERVALS,
    areas,
    panels: GOLBAT_PANELS.map(({ queries, ...p }) => p),
  });
});

app.get("/api/golbat/panel/:id", async (c) => {
  const ctx = golbatCtx();
  if (!ctx) return c.json(NO_GOLBAT, 404);
  const panel = GOLBAT_PANELS.find((p) => p.id === c.req.param("id"));
  if (!panel) return c.json({ error: "unknown chart" }, 404);
  const inter = c.req.query("inter") ?? "10m";
  if (!(GOLBAT_INTERVALS as readonly string[]).includes(inter)) return c.json({ error: "invalid interval" }, 400);
  // Repeated ?area=… params; sorted so the cache key does not depend on click order.
  const areas = [...new Set((c.req.queries("area") ?? []).filter(Boolean))].sort();
  if (areas.length > 50) return c.json({ error: "too many areas" }, 400);
  const rangeMs = rangeParam(c.req.query("range"), ctx.maxRangeMs);
  const stepMs = Math.max(30_000, Math.ceil(rangeMs / 240 / 10_000) * 10_000);
  try {
    const data = await cachedVm(`golbat:${ctx.source}:${panel.id}:${rangeMs}:${inter}:${areas.join("|")}`, rangeMs, () =>
      golbatPanel(ctx.vm, ctx.golbat, panel, { rangeMs, stepMs, inter, areas }, 20_000),
    );
    return c.json(data);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/golbat/summary", async (c) => {
  const ctx = golbatCtx();
  if (!ctx) return c.json(NO_GOLBAT, 404);
  try {
    return c.json(await cachedVm(`golbat:${ctx.source}:summary`, 60_000 * 240 / 2, () => golbatSummary(ctx.vm, ctx.golbat, 20_000)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------- Dragonite (Zapdos + Rotom controllers) ----------

const NO_DRAGONITE = {
  error: "requires [stack.dragonite] with its API url (or zapdos_instance with [zapdos])",
};

/**
 * Where the charts of these Dragonites (every one when `ids` is empty) get
 * their series: Zapdos when each of them has data there under its
 * zapdos_instance, else the samples kept in memory from their /metrics. A chart
 * adds several Dragonites together, so it never mixes the two: one Dragonite
 * without data in Zapdos puts the whole chart on memory. `all` is the
 * stack list to build selectors from (in memory they are kept under their id).
 */
function dragoniteSource(ids: string[] = []) {
  if (!cfg.dragonite.length) return undefined;
  const chosen = ids.length ? cfg.dragonite.filter((d) => ids.includes(d.id)) : cfg.dragonite;
  if (cfg.zapdos && chosen.every((d) => onVm("dragonite", d.zapdosInstance))) {
    return { vm: cfg.zapdos, all: cfg.dragonite, source: "vm" as const, maxRangeMs: MAX_VM_RANGE_MS };
  }
  if (chosen.every((d) => localMetrics.has(d.id))) {
    return { vm: LOCAL_VM, all: cfg.dragonite.map((d) => ({ ...d, zapdosInstance: d.id })), source: "memory" as const, maxRangeMs: localMetrics.retention };
  }
  return undefined;
}

app.get("/api/dragonite/meta", async (c) => {
  const src = dragoniteSource();
  if (!src) return c.json(NO_DRAGONITE, 404);
  const areas = await cachedVm(`dragonite:${src.source}:areas`, 60_000 * 240 * 5, () => dragoniteAreas(src.vm, src.all, 20_000)).catch(
    () => [] as string[],
  );
  // Each stack's own areas, so the filter offers only those of the stack shown.
  const byStack = Object.fromEntries(
    await Promise.all(
      cfg.dragonite.map(async (d) => {
        const one = dragoniteSource([d.id]);
        const list = one
          ? await cachedVm(`dragonite:${one.source}:areas:${d.id}`, 60_000 * 240 * 5, () => dragoniteAreas(one.vm, one.all, 20_000, [d.id])).catch(
              () => [] as string[],
            )
          : [];
        return [d.id, list];
      }),
    ),
  );
  return c.json({ rows: DRAGONITE_ROWS, areas, areasByStack: byStack, panels: DRAGONITE_PANELS.map(({ queries, ...p }) => p) });
});

app.get("/api/dragonite/panel/:id", async (c) => {
  const panel = DRAGONITE_PANELS.find((p) => p.id === c.req.param("id"));
  if (!panel) return c.json({ error: "unknown chart" }, 404);
  const areas = [...new Set((c.req.queries("area") ?? []).filter(Boolean))].sort();
  if (areas.length > 50) return c.json({ error: "too many areas" }, 400);
  // Repeated ?instance=<dragonite id>; unknown ids are ignored, none means all.
  const ids = [...new Set(c.req.queries("instance") ?? [])].filter((id) => cfg.dragonite.some((d) => d.id === id)).sort();
  const src = dragoniteSource(ids);
  if (!src) return c.json(NO_DRAGONITE, 404);
  const rangeMs = rangeParam(c.req.query("range"), src.maxRangeMs);
  const stepMs = Math.max(30_000, Math.ceil(rangeMs / 240 / 10_000) * 10_000);
  const base = dragoniteBase(src.all, ids);
  try {
    const data = await cachedVm(`dragonite:${src.source}:${panel.id}:${rangeMs}:${ids.join("|")}:${areas.join("|")}`, rangeMs, () =>
      runPanel(
        src.vm,
        panel,
        { base, areas, rangeMs, stepMs, inter: "10m", scanMetric: "dragonite_location_handled_counter" },
        20_000,
      ),
    );
    return c.json(data);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite/summary", async (c) => {
  if (!dragoniteSource() && !cfg.dragonite.some((d) => dragoniteSource([d.id]))) return c.json(NO_DRAGONITE, 404);
  const all = cfg.dragonite;
  try {
    // These figures are per Dragonite, so each one can come from its own source.
    const groups = new Map<string, { vm: ZapdosConfig; list: DragoniteConfig[] }>();
    for (const d of all) {
      const one = dragoniteSource([d.id]);
      if (!one) continue;
      const g = groups.get(one.source) ?? { vm: one.vm, list: [] };
      g.list.push(one.all.find((x) => x.id === d.id)!);
      groups.set(one.source, g);
    }
    const key = [...groups].map(([k, g]) => `${k}=${g.list.map((d) => d.id).join(",")}`).join(";");
    const stats = await cachedVm(`dragonite:stats:${key}`, 60_000 * 240 / 2, async () =>
      (await Promise.all([...groups.values()].map((g) => dragoniteStats(g.vm, g.list, 20_000)))).flat(),
    );
    // Live links come from the Rotoms: each controller names its Dragonite in its
    // user agent, the same name each Dragonite reports in its config.
    const [, instances] = await Promise.all([
      registry.fresh(),
      Promise.all(
        all.map((d) =>
          d.api
            ? cachedVm(`dragonite-config:${d.id}`, 60_000 * 240, () => instanceConfig(d, cfg.requestTimeoutMs))
                .then((x) => x.instance || undefined)
                .catch(() => undefined)
            : undefined,
        ),
      ),
    ]);
    const links = new Map<string, Map<string, number>>();
    const unmatched: DragoniteSummary["unmatched"] = [];
    for (const s of registry.all()) {
      const bySource = new Map<string, number>();
      for (const ctl of s.status?.controllers ?? []) {
        const src = controllerSource(ctl.user_agent);
        if (src) bySource.set(src, (bySource.get(src) ?? 0) + 1);
      }
      for (const [source, n] of bySource) {
        const d = all.find((x, i) => sourceMatches(source, x, instances[i]));
        if (!d) {
          unmatched.push({ rotomId: s.cfg.id, source, controllers: n });
          continue;
        }
        const m = links.get(d.id) ?? new Map<string, number>();
        m.set(s.cfg.id, (m.get(s.cfg.id) ?? 0) + n);
        links.set(d.id, m);
      }
    }
    return c.json<DragoniteSummary>({
      instances: all.map((d) => ({
        ...(stats.find((x) => x.id === d.id) ?? { id: d.id, locations: 0, accountsOk: 0, accountsLimited: 0, noWorkers: 0, invasions: 0 }),
        name: d.name,
        rotom: d.rotom,
        links: [...(links.get(d.id) ?? [])].map(([rotomId, controllers]) => ({ rotomId, controllers })),
      })),
      unmatched,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// Accounts, read from each Dragonite's own API (same calls as its admin).

function dragoniteWithApi(id: string) {
  const d = cfg.dragonite.find((x) => x.id === id);
  return d?.api ? d : undefined;
}

app.get("/api/dragonite/:id/accounts/stats", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "Dragonite has no url in its [stack.dragonite]" }, 404);
  try {
    return c.json(await cachedVm(`dragonite-acc:${d.id}`, 0, () => accountStats(d, cfg.requestTimeoutMs)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite/:id/accounts/level-stats", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "Dragonite has no url in its [stack.dragonite]" }, 404);
  const provider = /^[a-z]{0,10}$/.test(c.req.query("provider") ?? "") ? (c.req.query("provider") ?? "") : "";
  try {
    return c.json(
      await cachedVm(`dragonite-lvl:${d.id}:${provider}`, 0, () =>
        accountLevelStats(d, provider, 0, cfg.requestTimeoutMs),
      ),
    );
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite/:id/accounts", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "Dragonite has no url in its [stack.dragonite]" }, 404);
  const q = (k: string) => c.req.query(k);
  const sortBy = (ACCOUNT_SORTS as readonly string[]).includes(q("sort_by") ?? "") ? q("sort_by")! : "username";
  try {
    return c.json(
      await accountList(
        d,
        {
          page: Math.max(0, Math.min(Number(q("page")) || 0, 100_000)),
          perPage: Math.max(10, Math.min(Number(q("per_page")) || 25, 100)),
          sortBy,
          order: q("order") === "desc" ? "desc" : "asc",
          search: (q("q") ?? "").trim().slice(0, 64) || undefined,
        },
        cfg.requestTimeoutMs,
      ),
    );
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// Accounts of every stack together: the levels summed, and one list that is
// sorted, searched and paginated across all of them.

const accountApis = () => cfg.dragonite.filter((d) => d.api);

/** Every account of one Dragonite (Dragonite pages of up to 1000). */
async function allAccountsOf(d: (typeof cfg.dragonite)[number]) {
  return cachedVm(`dragonite-acc-all:${d.id}`, 0, async () => {
    const rows: DragoniteAccount[] = [];
    for (let page = 0; page < 50; page++) {
      const r = await accountList(d, { page, perPage: 1000, sortBy: "username", order: "asc" }, cfg.requestTimeoutMs);
      rows.push(...(r.rows as unknown as DragoniteAccount[]).map((a) => ({ ...a, stack: d.id })));
      if (page + 1 >= r.pages) break;
    }
    return rows;
  });
}

/** Forget what was read about one stack's accounts, after adding some. */
function forgetAccounts(id: string) {
  for (const k of vmCache.keys()) {
    if (k === `dragonite-acc:${id}` || k === `dragonite-acc-all:${id}` || k.startsWith(`dragonite-lvl:${id}:`)) vmCache.delete(k);
  }
}

/** Which stack has each username (lower-cased: PTC usernames ignore case); several when duplicated. */
async function accountOwners() {
  const owners = new Map<string, { username: string; stacks: string[] }>();
  for (const d of accountApis()) {
    for (const a of await allAccountsOf(d)) {
      const k = a.username.toLowerCase();
      const o = owners.get(k) ?? { username: a.username, stacks: [] };
      if (!o.stacks.includes(d.id)) o.stacks.push(d.id);
      owners.set(k, o);
    }
  }
  return owners;
}

/** Accounts present in more than one stack: an account belongs to one only. */
app.get("/api/dragonite-accounts/duplicates", async (c) => {
  if (accountApis().length < 2) return c.json([]);
  try {
    const dup = [...(await accountOwners()).values()].filter((o) => o.stacks.length > 1);
    return c.json(dup.sort((a, b) => a.username.localeCompare(b.username)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

const ACCOUNT_LEVEL_MAX = 100;
const ACCOUNT_IMPORT_MAX = 20_000;
/** A username or password as Dragonite takes them: no spaces, no line breaks. */
const accountText = (v: unknown, max: number) => (typeof v === "string" && v.length <= max && v.trim() === v && v && !/\s/.test(v) ? v : undefined);
const accountLevel = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= ACCOUNT_LEVEL_MAX ? (v as number) : undefined);
const accountProvider = (v: unknown) => ((ACCOUNT_PROVIDERS as readonly unknown[]).includes(v) ? (v as string) : undefined);

/** The admin's "Create One Account", in one stack only (refused when another stack has it). */
app.post("/api/dragonite/:id/accounts", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const username = accountText(b.username, 128);
  const password = accountText(b.password, 256);
  const provider = accountProvider(b.provider);
  const level = accountLevel(b.level);
  if (!username || !password) return c.json({ error: "username and password are required, without spaces" }, 400);
  if (!provider) return c.json({ error: `provider must be one of ${ACCOUNT_PROVIDERS.join(", ")}` }, 400);
  if (level === undefined) return c.json({ error: `level must be a whole number from 0 to ${ACCOUNT_LEVEL_MAX}` }, 400);
  try {
    const owner = (await accountOwners()).get(username.toLowerCase());
    if (owner) {
      const names = owner.stacks.map((id) => cfg.dragonite.find((x) => x.id === id)?.name ?? id);
      return c.json({ error: `${owner.username} is already in ${names.join(", ")}` }, 409);
    }
    await createAccount(d, { username, password, provider, level }, cfg.requestTimeoutMs);
    forgetAccounts(d.id);
    console.log(`[dragonite] ${c.get("user")} creates account ${username} (${provider}, level ${level}) in ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * The admin's "Import multiple accounts", in one stack only. Usernames another
 * stack already has are left out (and listed); Dragonite skips the ones this
 * stack already has.
 */
app.post("/api/dragonite/:id/accounts/import", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = accountProvider(b.provider);
  const level = accountLevel(b.level);
  const lastReleased = Number.isInteger(b.last_released) && (b.last_released as number) >= 1 ? (b.last_released as number) : undefined;
  if (!provider) return c.json({ error: `provider must be one of ${ACCOUNT_PROVIDERS.join(", ")}` }, 400);
  if (level === undefined) return c.json({ error: `level must be a whole number from 0 to ${ACCOUNT_LEVEL_MAX}` }, 400);
  if (lastReleased === undefined) return c.json({ error: "last_released must be unix seconds (1 = use immediately)" }, 400);
  if (!Array.isArray(b.accounts) || !b.accounts.length || b.accounts.length > ACCOUNT_IMPORT_MAX) {
    return c.json({ error: `send between 1 and ${ACCOUNT_IMPORT_MAX} accounts` }, 400);
  }
  const accounts: { username: string; password: string }[] = [];
  for (const [i, raw] of (b.accounts as Record<string, unknown>[]).entries()) {
    const username = accountText(raw?.username, 128);
    const password = accountText(raw?.password, 256);
    if (!username || !password) return c.json({ error: `line ${i + 1}: username and password are required, without spaces` }, 400);
    accounts.push({ username, password });
  }
  try {
    const owners = await accountOwners();
    const elsewhere: { username: string; stacks: string[] }[] = [];
    const seen = new Set<string>();
    let here = 0;
    let repeated = 0;
    const send = accounts.filter((a) => {
      const k = a.username.toLowerCase();
      if (seen.has(k)) return (repeated++, false);
      seen.add(k);
      const o = owners.get(k);
      if (!o) return true;
      if (o.stacks.some((id) => id !== d.id)) elsewhere.push({ username: a.username, stacks: o.stacks });
      else here++;
      return false;
    });
    const inserted = send.length
      ? await importAccounts(d, { accounts: send, default_level: level, provider, last_released: lastReleased }, cfg.requestTimeoutMs)
      : 0;
    forgetAccounts(d.id);
    console.log(
      `[dragonite] ${c.get("user")} imports ${accounts.length} accounts (${provider}, level ${level}) into ${d.name}: ` +
        `${inserted} inserted, ${here} already there, ${elsewhere.length} in another stack, ${repeated} repeated`,
    );
    return c.json({ inserted, alreadyHere: here + (send.length - inserted), repeated, elsewhere });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite-accounts/levels", async (c) => {
  const list = accountApis();
  if (!list.length) return c.json({ error: "no [stack.dragonite] has a url" }, 404);
  try {
    const per = await Promise.all(
      list.map(async (d) => ({
        id: d.id,
        levels: await cachedVm(`dragonite-lvl:${d.id}:`, 0, () => accountLevelStats(d, "", 0, cfg.requestTimeoutMs)),
      })),
    );
    const byLevel = new Map<number, AccountLevelCounts>();
    for (const { id, levels } of per) {
      for (const l of levels) {
        const acc = byLevel.get(l.level) ?? ({ level: l.level, byStack: {} } as unknown as AccountLevelCounts);
        for (const [k, v] of Object.entries(l)) {
          if (k !== "level") (acc as unknown as Record<string, number>)[k] = ((acc as unknown as Record<string, number>)[k] ?? 0) + (v as number);
        }
        acc.byStack![id] = (acc.byStack![id] ?? 0) + (l as unknown as AccountLevelCounts).total;
        byLevel.set(l.level, acc);
      }
    }
    return c.json([...byLevel.values()].sort((a, b) => a.level - b.level));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite-accounts", async (c) => {
  const q = (k: string) => c.req.query(k);
  const only = q("stack");
  const list = accountApis().filter((d) => !only || d.id === only);
  if (!list.length) return c.json({ error: "no [stack.dragonite] has a url" }, 404);
  const sortBy = [...ACCOUNT_SORTS, "stack"].includes(q("sort_by") ?? "") ? q("sort_by")! : "username";
  const desc = q("order") === "desc";
  const page = Math.max(0, Math.min(Number(q("page")) || 0, 100_000));
  const perPage = Math.max(10, Math.min(Number(q("per_page")) || 25, 100));
  const needle = (q("q") ?? "").trim().toLowerCase().slice(0, 64);
  try {
    let rows = (await Promise.all(list.map(allAccountsOf))).flat();
    if (needle) rows = rows.filter((a) => a.username.toLowerCase().includes(needle));
    // ?in_use=true|false: the accounts a worker is using now, or the rest.
    if (q("in_use") === "true" || q("in_use") === "false") rows = rows.filter((a) => a.in_use === (q("in_use") === "true"));
    const val = (a: DragoniteAccount) => (a as unknown as Record<string, unknown>)[sortBy];
    rows.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      // Missing values (never used, never released) always sort last.
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true });
      return desc ? -r : r;
    });
    return c.json({
      total: rows.length,
      pages: Math.max(1, Math.ceil(rows.length / perPage)),
      rows: rows.slice(page * perPage, (page + 1) * perPage),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

const areaId = (raw: string) => (/^\d{1,9}$/.test(raw) ? Number(raw) : undefined);

app.post("/api/dragonite/:id/areas/:area/:action{enable|disable}", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  const id = areaId(c.req.param("area"));
  if (!d || id === undefined) return c.json({ error: "unknown area" }, 404);
  try {
    await setAreaEnabled(d, id, c.req.param("action") === "enable", cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-areas:${d.id}`);
    vmCache.delete(`dragonite-geofences:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} ${c.req.param("action") === "enable" ? "enables" : "disables"} area ${id} of ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * A new area (the admin's "Create", same fields) in one or several stacks.
 * At most one of them gets it enabled: two stacks scanning the same place
 * just repeat each other's work.
 */
app.post("/api/dragonite-areas/create", async (c) => {
  const raw = await c.req.text();
  if (raw.length > 5_000_000) return c.json({ error: "area too large" }, 413);
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const ids = Array.isArray(b.stacks) ? [...new Set(b.stacks.filter((x): x is string => typeof x === "string"))] : [];
  const stacks = ids.map(dragoniteWithApi);
  if (!stacks.length || stacks.some((d) => !d)) return c.json({ error: "pick one or more stacks with an API" }, 400);
  const enabledIn = typeof b.enabledIn === "string" ? b.enabledIn : undefined;
  if (enabledIn !== undefined && !ids.includes(enabledIn)) return c.json({ error: "enabledIn must be one of the chosen stacks" }, 400);
  const area = b.area && typeof b.area === "object" && !Array.isArray(b.area) ? { ...(b.area as Record<string, unknown>) } : undefined;
  if (!area) return c.json({ error: "missing area" }, 400);
  const name = typeof area.name === "string" ? area.name.trim() : "";
  if (!name || name.length > 128) return c.json({ error: "the area needs a name (up to 128 characters)" }, 400);
  if (!area.geofence) return c.json({ error: "the area needs a geofence" }, 400);
  delete area.id;
  delete area.enabled;
  area.name = name;
  const results: { stack: string; id?: number; enabled?: boolean; error?: string }[] = [];
  // One after the other, so a mistake in the area shows on the first stack.
  for (const d of stacks as NonNullable<(typeof stacks)[number]>[]) {
    try {
      const id = await createArea(d, area, d.id === enabledIn, cfg.requestTimeoutMs);
      results.push({ stack: d.id, id, enabled: d.id === enabledIn });
    } catch (e) {
      results.push({ stack: d.id, error: (e as Error).message });
    }
    vmCache.delete(`dragonite-areas:${d.id}`);
    vmCache.delete(`dragonite-geofences:${d.id}`);
  }
  console.log(
    `[dragonite] ${c.get("user")} creates area "${name}": ` +
      results.map((r) => `${r.stack} ${r.error ? `failed (${r.error})` : `id ${r.id}${r.enabled ? ", enabled" : ""}`}`).join("; "),
  );
  return c.json({ results });
});

/** One area in full (geofence, routes, overrides, modes), for its View and Edit. */
app.get("/api/dragonite/:id/areas/:area/full", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  const id = areaId(c.req.param("area"));
  if (!d || id === undefined) return c.json({ error: "unknown area" }, 404);
  try {
    return c.json(await getArea(d, id, cfg.requestTimeoutMs));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * The area's spawnpoints from Golbat (only with [golbat] url): the ones with
 * a Pokémon right now, as its API lists no spawnpoints. Shared for a minute.
 */
app.get("/api/dragonite/:id/areas/:area/spawnpoints", async (c) => {
  const golbat = cfg.golbat?.api;
  if (!golbat) return c.json({ error: "requires url in [golbat]" }, 404);
  const d = dragoniteWithApi(c.req.param("id"));
  const id = areaId(c.req.param("area"));
  if (!d || id === undefined) return c.json({ error: "unknown area" }, 404);
  try {
    const data = await cachedVm(`golbat:spawnpoints:${d.id}:${id}`, 60_000 * 240, async () => {
      const area = await getArea(d, id, cfg.requestTimeoutMs);
      const g = area.geofence as { type?: string; geometry?: unknown } | undefined;
      const geometry = (g?.type === "Feature" ? g.geometry : g) as { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | undefined;
      if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return { points: [], partial: false };
      return areaSpawnpoints(golbat, geometry, 30_000);
    });
    return c.json(data);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Whether this Dragonite has a Kōji to ask for routes (its config says so). */
app.get("/api/dragonite/:id/koji", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown Dragonite" }, 404);
  try {
    const conf = await cachedVm(`dragonite-config:${d.id}`, 60_000 * 240, () => instanceConfig(d, cfg.requestTimeoutMs));
    return c.json({ available: conf.hasKoji });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * Asks Kōji (through Dragonite) for one mode's route of an area, as the
 * admin's "Get 70m Route" and alike: Dragonite stores it at once. Answers
 * with the new route, read back from the area.
 */
app.post("/api/dragonite/:id/areas/:area/koji/:mode{pokemon|fort|quest}", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  const id = areaId(c.req.param("area"));
  if (!d || id === undefined) return c.json({ error: "unknown area" }, 404);
  const mode = c.req.param("mode") as KojiMode;
  if (!KOJI_MODES.includes(mode)) return c.json({ error: "unknown mode" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { bootstrap?: unknown };
  // The quest route has no bootstrap in the admin.
  const bootstrap = mode !== "quest" && body.bootstrap === true;
  try {
    // Kōji can take a while on big areas.
    await recalculateRoute(d, id, mode, bootstrap, Math.max(cfg.requestTimeoutMs, 120_000));
    const area = await getArea(d, id, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-areas:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} asks Kōji for the ${mode}${bootstrap ? " bootstrap" : ""} route of area ${id} of ${d.name}`);
    const route = ((area[`${mode}_mode`] ?? {}) as { route?: unknown }).route;
    return c.json({ route: Array.isArray(route) ? route : [] });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Saves a whole area, as the admin's Edit (and switches it on or off when `enabled` changes). */
app.put("/api/dragonite/:id/areas/:area/full", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  const id = areaId(c.req.param("area"));
  if (!d || id === undefined) return c.json({ error: "unknown area" }, 404);
  const raw = await c.req.text();
  if (raw.length > 5_000_000) return c.json({ error: "area too large" }, 413);
  let area: Record<string, unknown>;
  try {
    area = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  if (!area || typeof area !== "object" || Array.isArray(area)) return c.json({ error: "missing area" }, 400);
  const name = typeof area.name === "string" ? area.name.trim() : "";
  if (!name || name.length > 128) return c.json({ error: "the area needs a name (up to 128 characters)" }, 400);
  if (!area.geofence) return c.json({ error: "the area needs a geofence" }, 400);
  try {
    const before = await getArea(d, id, cfg.requestTimeoutMs);
    await saveArea(d, id, { ...area, name }, cfg.requestTimeoutMs);
    const steps = ["saved"];
    if (typeof area.enabled === "boolean" && area.enabled !== !!before.enabled) {
      await setAreaEnabled(d, id, area.enabled, cfg.requestTimeoutMs);
      steps.push(area.enabled ? "enabled" : "disabled");
    }
    vmCache.delete(`dragonite-areas:${d.id}`);
    vmCache.delete(`dragonite-geofences:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} edits area ${id} ("${name}") of ${d.name}: ${steps.join(", ")}`);
    return c.json({ ok: true, steps });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/**
 * Start or stop quest scanning, as the admin's quest buttons: in one area
 * (body { area }) or in every active area of the stack (no area).
 */
app.post("/api/dragonite/:id/quests/:action{start|stop}", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  const action = c.req.param("action") as "start" | "stop";
  const b = (await c.req.json().catch(() => ({}))) as { area?: unknown; clear?: unknown };
  const area = b.area === undefined ? "all" : areaId(String(b.area));
  if (area === undefined) return c.json({ error: "invalid area" }, 400);
  // Dragonite clears the stored quests unless told not to.
  const clear = b.clear !== false;
  try {
    const r = await questAction(d, area, action, clear, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-areas:${d.id}`);
    console.log(
      `[dragonite] ${c.get("user")} ${action}s quests in ${area === "all" ? "every active area" : `area ${area}`} of ${d.name}` +
        `${action === "start" ? (clear ? " (clearing quests)" : " (keeping quests)") : ""}: ${r.message || "ok"}`,
    );
    return c.json(r);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.post("/api/dragonite/:id/areas/:area/transfer", async (c) => {
  const from = dragoniteWithApi(c.req.param("id"));
  const id = areaId(c.req.param("area"));
  if (!from || id === undefined) return c.json({ error: "unknown area" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof body.to === "string" ? dragoniteWithApi(body.to) : undefined;
  if (!to) return c.json({ error: "target stack unknown or has no url" }, 400);
  if (to.id === from.id) return c.json({ error: "the target is the same stack" }, 400);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) return c.json({ error: "name: 1–64 characters" }, 400);
  const move = body.mode === "move";
  const enable = body.enable === true;
  try {
    // Only a disabled area may move: one that scans has workers on its route.
    if (move) {
      const source = await dragoniteAreaList(from, cfg.requestTimeoutMs);
      if (source.areas.find((a) => a.id === id)?.enabled) {
        return c.json({ error: "the area is enabled: disable it before moving it" }, 409);
      }
    }
    // Two areas with one name in the same Dragonite would be confusing (or refused).
    const target = await dragoniteAreaList(to, cfg.requestTimeoutMs);
    if (target.areas.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      return c.json({ error: `${to.name} already has an area named "${name}"` }, 409);
    }
    const r = await transferArea(from, to, id, { name, move, enable }, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-areas:${from.id}`);
    vmCache.delete(`dragonite-geofences:${from.id}`);
    vmCache.delete(`dragonite-areas:${to.id}`);
    vmCache.delete(`dragonite-geofences:${to.id}`);
    console.log(`[dragonite] ${c.get("user")} ${move ? "moves" : "copies"} area ${id} from ${from.name} to ${to.name} as "${name}": ${r.steps.join(", ")}`);
    return c.json(r);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------- Dragonite proxies, every stack together ----------

const proxyKey = (endpoint: string, user: string) =>
  createHash("sha256").update(`${endpoint}|${user}`).digest("hex").slice(0, 16);

/** Each stack's proxies (database list + login stats), with their full URLs (server only). */
async function loadProxies() {
  return Promise.all(
    accountApis().map(async (d) => {
      const [list, stats] = await Promise.allSettled([listProxies(d, cfg.requestTimeoutMs), proxyStats(d, cfg.requestTimeoutMs)]);
      return {
        d,
        list: list.status === "fulfilled" ? list.value : [],
        stats: stats.status === "fulfilled" ? stats.value : [],
        error: list.status === "rejected" ? (list.reason as Error).message : stats.status === "rejected" ? (stats.reason as Error).message : undefined,
      };
    }),
  );
}

app.get("/api/dragonite-proxies", async (c) => {
  if (!accountApis().length) return c.json({ error: "no [stack.dragonite] has a url" }, 404);
  const per = await cachedVm("dragonite-proxies", 0, loadProxies);
  const byKey = new Map<string, ProxyEntry>();
  const stacks: ProxyStackSummary[] = [];
  for (const { d, list, stats, error } of per) {
    const statsById = new Map(stats.map((x) => [x.id, x]));
    const seen = new Set<number>();
    const add = (url: string, inst: ProxyInstance) => {
      const id = proxyIdentity(url);
      const key = proxyKey(id.endpoint, id.user);
      const e = byKey.get(key) ?? { key, endpoint: id.endpoint, auth: !!id.user, instances: [] };
      e.instances.push(inst);
      byKey.set(key, e);
      return inst;
    };
    const insts: ProxyInstance[] = [];
    for (const p of list) {
      seen.add(p.id);
      insts.push(add(p.url, { stack: d.id, id: p.id, name: p.name, enabled: p.enabled, providers: statsById.get(p.id)?.providers ?? [] }));
    }
    // Proxies Dragonite uses that are not in its database (from its config file).
    for (const st of stats) {
      if (!seen.has(st.id)) insts.push(add(st.url, { stack: d.id, name: st.name || "config", enabled: true, providers: st.providers }));
    }
    stacks.push({
      stack: d.id,
      total: insts.length,
      enabled: insts.filter((x) => x.enabled).length,
      good: insts.filter((x) => x.providers.some((p) => p.good)).length,
      failing: insts.filter((x) => x.providers.length && x.providers.every((p) => !p.good)).length,
      error,
    });
  }
  const proxies = [...byKey.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint, "en", { numeric: true }));
  return c.json<DragoniteProxies>({ stacks, proxies });
});

/** The next free number for names with this prefix ("001", "002"… as the admin does). */
function nextNames(existing: string[], prefix: string, count: number) {
  let max = 0;
  for (const n of existing) {
    const m = n.startsWith(prefix) ? /^(\d+)$/.exec(n.slice(prefix.length)) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  const width = Math.max(3, String(max + count).length);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + i + 1).padStart(width, "0")}`);
}

/**
 * Adds proxies (full URLs) to one stack, skipping those it already has; optionally reloads.
 * Items with a name keep it (one by one, as the admin's "Create"); the rest are numbered.
 */
async function addProxiesTo(
  d: (typeof cfg.dragonite)[number],
  items: { url: string; endpoint: string; user: string; name?: string }[],
  opts: { prefix: string; enabled: boolean; skipExisting: boolean; reload: boolean },
): Promise<ProxyImportResult> {
  let created = 0;
  let skipped = 0;
  const conflicts: string[] = [];
  try {
    const current = await listProxies(d, cfg.requestTimeoutMs);
    const have = new Set(current.map((p) => { const id = proxyIdentity(p.url); return proxyKey(id.endpoint, id.user); }));
    const fresh = opts.skipExisting ? items.filter((x) => !have.has(proxyKey(x.endpoint, x.user))) : items;
    skipped = items.length - fresh.length;
    // Named ones keep their name unless that stack already uses it for another proxy.
    const taken = new Set(current.map((p) => p.name));
    for (const x of fresh.filter((x) => x.name)) {
      if (taken.has(x.name!)) {
        conflicts.push(x.name!);
        continue;
      }
      await createProxy(d, { name: x.name!, url: x.url, enabled: opts.enabled }, cfg.requestTimeoutMs);
      taken.add(x.name!);
      created++;
    }
    const numbered = fresh.filter((x) => !x.name);
    const names = nextNames([...taken], opts.prefix, numbered.length);
    if (numbered.length) {
      await createProxies(d, numbered.map((x, i) => ({ name: names[i], url: x.url, enabled: opts.enabled })), cfg.requestTimeoutMs);
      created += numbered.length;
    }
    let reloaded = false;
    if (created && opts.reload) {
      await reloadProxies(d, cfg.requestTimeoutMs);
      reloaded = true;
    }
    return { stack: d.id, created, skipped, reloaded, conflicts: conflicts.length ? conflicts : undefined };
  } catch (e) {
    // Report what did go in before the failure.
    return { stack: d.id, created, skipped, reloaded: false, conflicts: conflicts.length ? conflicts : undefined, error: (e as Error).message };
  }
}

/** Creates one named proxy in the chosen stacks (the "New proxy" modal). */
app.post("/api/dragonite-proxies/create", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const targets = accountApis().filter((d) => Array.isArray(body.stacks) && (body.stacks as unknown[]).includes(d.id));
  if (!targets.length) return c.json({ error: "choose at least one stack" }, 400);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64 || /[\u0000-\u001f]/.test(name)) return c.json({ error: "invalid name" }, 400);
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const [address, user, pass] = [str("address"), str("user"), typeof body.password === "string" ? body.password : ""];
  if (/[\s:@]/.test(user) || /[\r\n]/.test(pass) || !user !== !pass) return c.json({ error: "username and password go together, without spaces" }, 400);
  const { ok } = parseProxyLines(user ? `${address}:${user}:${pass}` : address);
  if (ok.length !== 1) return c.json({ error: "the address must be host:port" }, 400);
  const opts = { prefix: "", enabled: body.enabled !== false, skipExisting: true, reload: body.reload !== false };
  const results: ProxyImportResult[] = (await Promise.all(targets.map((d) => addProxiesTo(d, [{ ...ok[0], name }], opts)))).map((r) =>
    r.conflicts && !r.error ? { ...r, error: `there is already a proxy named "${name}"` } : r,
  );
  vmCache.delete("dragonite-proxies");
  console.log(`[dragonite] ${c.get("user")} creates proxy ${ok[0].endpoint} ("${name}") on ${targets.map((d) => d.name).join(", ")}: ${results.map((r) => `${r.stack} ${r.error ?? (r.created ? "ok" : "already existed")}`).join(" · ")}`);
  return c.json({ results });
});

app.post("/api/dragonite-proxies/import", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.slice(0, 500_000) : "";
  const targets = accountApis().filter((d) => Array.isArray(body.stacks) && (body.stacks as unknown[]).includes(d.id));
  if (!targets.length) return c.json({ error: "choose at least one stack" }, 400);
  const prefix = typeof body.prefix === "string" ? body.prefix.trim().slice(0, 20) : "";
  const { ok, bad } = parseProxyLines(text);
  if (!ok.length) return c.json({ error: bad.length ? `no valid lines (check line ${bad[0]})` : "no proxies" }, 400);
  const opts = { prefix, enabled: body.enabled !== false, skipExisting: body.skipExisting !== false, reload: body.reload !== false };
  const results: ProxyImportResult[] = await Promise.all(targets.map((d) => addProxiesTo(d, ok, opts)));
  vmCache.delete("dragonite-proxies");
  console.log(`[dragonite] ${c.get("user")} imports ${ok.length} proxies on ${targets.map((d) => d.name).join(", ")}: ${results.map((r) => `${r.stack} +${r.created}/${r.skipped} skipped${r.error ? ` (${r.error})` : ""}`).join(" · ")}`);
  return c.json({ parsed: ok.length, badLines: bad, results });
});

/**
 * Copies proxies (by key) to other stacks, keeping their names. Each one's URL
 * and name come from the first stack that has it in its database.
 */
app.post("/api/dragonite-proxies/copy", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const keys = new Set(
    (Array.isArray(body.keys) ? body.keys : typeof body.key === "string" ? [body.key] : []).filter((k): k is string => typeof k === "string").slice(0, 5000),
  );
  const targets = accountApis().filter((d) => Array.isArray(body.to) && (body.to as unknown[]).includes(d.id));
  if (!keys.size || !targets.length) return c.json({ error: "missing the proxies or the targets" }, 400);
  const found = new Map<string, { url: string; endpoint: string; user: string; name?: string }>();
  // The database list first: a proxy from a config file is copied only if no stack has it in its database.
  const per = await loadProxies();
  for (const p of [...per.flatMap((x) => x.list), ...per.flatMap((x) => x.stats)]) {
    {
      const id = proxyIdentity(p.url);
      const key = proxyKey(id.endpoint, id.user);
      if (keys.has(key) && !found.has(key) && id.endpoint) found.set(key, { url: p.url, endpoint: id.endpoint, user: id.user, name: p.name || undefined });
    }
  }
  if (!found.size) return c.json({ error: "proxies not found" }, 404);
  const items = [...found.values()];
  const results = await Promise.all(targets.map((d) => addProxiesTo(d, items, { prefix: "", enabled: true, skipExisting: true, reload: true })));
  vmCache.delete("dragonite-proxies");
  console.log(
    `[dragonite] ${c.get("user")} copies ${items.length} prox${items.length === 1 ? "y" : "ies"} (${items.map((x) => x.name ?? x.endpoint).join(", ").slice(0, 300)}) to ${targets.map((d) => d.name).join(", ")}: ${results.map((r) => `${r.stack} +${r.created}${r.conflicts ? ` · ${r.conflicts.length} name conflicts` : ""}${r.error ? ` (${r.error})` : ""}`).join(" · ")}`,
  );
  return c.json({ results, missing: keys.size - found.size });
});

app.post("/api/dragonite-proxies/:stack/:id/:action{enable|disable}", async (c) => {
  const d = dragoniteWithApi(c.req.param("stack"));
  const id = areaId(c.req.param("id"));
  if (!d || id === undefined) return c.json({ error: "unknown proxy" }, 404);
  try {
    const on = c.req.param("action") === "enable";
    await setProxyEnabled(d, id, on, cfg.requestTimeoutMs);
    await reloadProxies(d, cfg.requestTimeoutMs).catch(() => undefined);
    vmCache.delete("dragonite-proxies");
    console.log(`[dragonite] ${c.get("user")} ${on ? "enables" : "disables"} proxy ${id} of ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.delete("/api/dragonite-proxies/:stack/:id", async (c) => {
  const d = dragoniteWithApi(c.req.param("stack"));
  const id = areaId(c.req.param("id"));
  if (!d || id === undefined) return c.json({ error: "unknown proxy" }, 404);
  try {
    await deleteProxy(d, id, cfg.requestTimeoutMs);
    await reloadProxies(d, cfg.requestTimeoutMs).catch(() => undefined);
    vmCache.delete("dragonite-proxies");
    console.log(`[dragonite] ${c.get("user")} removes proxy ${id} from ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite/:id/areas", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "Dragonite has no url in its [stack.dragonite]" }, 404);
  try {
    const [data] = await Promise.all([cachedVm(`dragonite-areas:${d.id}`, 0, () => dragoniteAreaList(d, cfg.requestTimeoutMs)), registry.fresh()]);
    // Name each worker's device as Rotom knows it (the device_id is Rotom's worker id).
    const devices = new Map<string, { rotomId: string; device: string }>();
    for (const s of registry.all()) {
      for (const dev of s.status?.devices ?? []) {
        for (const w of dev.workers ?? []) devices.set(w.id, { rotomId: s.cfg.id, device: dev.origin });
      }
    }
    const tag = <T extends { deviceId: string }>(w: T) => ({ ...w, rotom: devices.get(w.deviceId) });
    return c.json({
      ...data,
      areas: data.areas.map((a) => (a.live ? { ...a, live: { ...a.live, workers: a.live.workers.map(tag) } } : a)),
      unbounds: data.unbounds.map((u) => ({ ...u, workers: u.workers.map(tag) })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Every stack's enabled area outlines, for the Dashboard map. */
app.get("/api/dragonite-geofences", async (c) => {
  const out: StackGeofences[] = await Promise.all(
    cfg.dragonite
      .filter((d) => d.api)
      .map(async (d) => {
        const base = { id: d.id, name: d.name, rotom: d.rotom };
        try {
          // Outlines rarely change: one read a minute is plenty.
          const areas = await cachedVm(`dragonite-geofences:${d.id}`, 240 * 60_000, () => areaGeofences(d, cfg.requestTimeoutMs));
          return { ...base, areas };
        } catch (e) {
          return { ...base, areas: [], error: (e as Error).message };
        }
      }),
  );
  return c.json(out);
});

// ---------- Dragonite unbound modes (Level, Invasion, Scout) ----------

/** Names each worker's device as Rotom knows it (the device_id is Rotom's worker id). */
function rotomDeviceTagger() {
  const devices = new Map<string, { rotomId: string; device: string }>();
  for (const s of registry.all()) {
    for (const dev of s.status?.devices ?? []) {
      for (const w of dev.workers ?? []) devices.set(w.id, { rotomId: s.cfg.id, device: dev.origin });
    }
  }
  return <T extends { deviceId: string }>(w: T) => ({ ...w, rotom: devices.get(w.deviceId) });
}

// An alternation here would also match longer paths; the handlers check the type.
const MODE_TYPE = "{[a-z]+}";
const MODE_ARTICLE: Record<ModeType, string> = { level: "a level", invasion: "an invasion", scout: "a scout" };

/** Checks a mode from the browser; a string is the reason it is refused. */
function parseModeInput(type: ModeType, raw: unknown, creating: boolean): ModeInput | string {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ModeInput = {};
  if (b.name !== undefined || creating) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 64 || /[\u0000-\u001f]/.test(name)) return "name: 1–64 characters";
    out.name = name;
  }
  if (b.workers !== undefined || creating) {
    const w = Number(b.workers ?? 0);
    if (!Number.isInteger(w) || w < 0 || w > 1000) return "workers: a whole number from 0 to 1000";
    out.workers = w;
  }
  if (b.route !== undefined) {
    if (type !== "level") return "only level modes have a route";
    if (!Array.isArray(b.route) || b.route.length > 50_000) return "route: a list of up to 50 000 points";
    const route = [];
    for (const p of b.route as unknown[]) {
      const lat = Number((p as Record<string, unknown>)?.lat);
      const lon = Number((p as Record<string, unknown>)?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return "route: every point needs a valid lat and lon";
      route.push({ lat, lon });
    }
    out.route = route;
  }
  return out;
}

const modeTarget = (c: Context) => {
  const type = c.req.param("type") as ModeType;
  const known = (MODE_TYPES as readonly string[]).includes(type);
  const d = known ? dragoniteWithApi(c.req.param("id") ?? "") : undefined;
  return { d, type, id: areaId(c.req.param("mid") ?? "") };
};

app.get("/api/dragonite/:id/modes", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "Dragonite has no url in its [stack.dragonite]" }, 404);
  try {
    const [data] = await Promise.all([cachedVm(`dragonite-modes:${d.id}`, 0, () => unboundModes(d, cfg.requestTimeoutMs)), registry.fresh()]);
    const tag = rotomDeviceTagger();
    return c.json({ ...data, modes: data.modes.map((m) => (m.live ? { ...m, live: { ...m.live, workers: m.live.workers.map(tag) } } : m)) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get(`/api/dragonite/:id/modes/:type${MODE_TYPE}/:mid`, async (c) => {
  const { d, type, id } = modeTarget(c);
  if (!d || id === undefined) return c.json({ error: "unknown mode" }, 404);
  try {
    return c.json(await getMode(d, type, id, cfg.requestTimeoutMs));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.post(`/api/dragonite/:id/modes/:type${MODE_TYPE}`, async (c) => {
  const { d, type } = modeTarget(c);
  if (!d) return c.json({ error: "unknown stack" }, 404);
  const input = parseModeInput(type, await c.req.json().catch(() => ({})), true);
  if (typeof input === "string") return c.json({ error: input }, 400);
  try {
    const { modes } = await unboundModes(d, cfg.requestTimeoutMs);
    if (modes.some((m) => m.type === type && m.name === input.name)) return c.json({ error: `${d.name} already has ${MODE_ARTICLE[type]} mode named "${input.name}"` }, 409);
    await createMode(d, type, input, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-modes:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} creates ${type} mode "${input.name}" on ${d.name} (${input.workers} workers${input.route ? `, ${input.route.length} route points` : ""})`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.patch(`/api/dragonite/:id/modes/:type${MODE_TYPE}/:mid`, async (c) => {
  const { d, type, id } = modeTarget(c);
  if (!d || id === undefined) return c.json({ error: "unknown mode" }, 404);
  const input = parseModeInput(type, await c.req.json().catch(() => ({})), false);
  if (typeof input === "string") return c.json({ error: input }, 400);
  if (!Object.keys(input).length) return c.json({ error: "nothing to change" }, 400);
  try {
    if (input.name) {
      const { modes } = await unboundModes(d, cfg.requestTimeoutMs);
      if (modes.some((m) => m.type === type && m.name === input.name && m.id !== id)) return c.json({ error: `${d.name} already has ${MODE_ARTICLE[type]} mode named "${input.name}"` }, 409);
    }
    await updateMode(d, type, id, input, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-modes:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} edits ${type} mode ${id} of ${d.name}: ${JSON.stringify({ ...input, route: input.route ? `${input.route.length} points` : undefined })}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.delete(`/api/dragonite/:id/modes/:type${MODE_TYPE}/:mid`, async (c) => {
  const { d, type, id } = modeTarget(c);
  if (!d || id === undefined) return c.json({ error: "unknown mode" }, 404);
  try {
    await deleteMode(d, type, id, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-modes:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} deletes ${type} mode ${id} of ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Copies a mode (route included) to another stack, under the same or a new name. */
app.post(`/api/dragonite/:id/modes/:type${MODE_TYPE}/:mid/copy`, async (c) => {
  const { d, type, id } = modeTarget(c);
  if (!d || id === undefined) return c.json({ error: "unknown mode" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof body.to === "string" ? dragoniteWithApi(body.to) : undefined;
  if (!to || to.id === d.id) return c.json({ error: "choose another stack" }, 400);
  try {
    const src = await getMode(d, type, id, cfg.requestTimeoutMs);
    const input = parseModeInput(type, { name: typeof body.name === "string" ? body.name : src.name, workers: body.workers ?? src.workers, route: src.route }, true);
    if (typeof input === "string") return c.json({ error: input }, 400);
    const { modes } = await unboundModes(to, cfg.requestTimeoutMs);
    if (modes.some((m) => m.type === type && m.name === input.name)) return c.json({ error: `${to.name} already has ${MODE_ARTICLE[type]} mode named "${input.name}"` }, 409);
    await createMode(to, type, input, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-modes:${to.id}`);
    console.log(`[dragonite] ${c.get("user")} copies ${type} mode "${src.name}" of ${d.name} to ${to.name} as "${input.name}"`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite/:id/level", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  try {
    return c.json(await cachedVm(`dragonite-level:${d.id}`, 0, () => levelStats(d, cfg.requestTimeoutMs)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/dragonite/:id/scout", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  try {
    const jobs = await cachedVm(`dragonite-scout:${d.id}`, 0, () => scoutJobs(d, cfg.requestTimeoutMs));
    // A long queue is cut to the newest; the counts still cover all of it.
    return c.json({ total: jobs.length, jobs: jobs.slice(0, 5000) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.post("/api/dragonite/:id/scout/clear", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  try {
    await clearScoutQueue(d, cfg.requestTimeoutMs);
    vmCache.delete(`dragonite-modes:${d.id}`);
    vmCache.delete(`dragonite-scout:${d.id}`);
    console.log(`[dragonite] ${c.get("user")} clears the scout queue of ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------- Dragonite scheduler (Schedules, Groups, Run Ledger) ----------
// Each route maps to one Dragonite call; bodies go through as JSON (Dragonite
// checks them strictly: unknown fields are refused) and its errors come back
// with their status, so the page can say what to fix.

const schedId = (raw: string | undefined) => (raw && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined);

async function schedulerRoute(c: Context, method: "GET" | "POST" | "PUT" | "DELETE", path: string, opts: { body?: boolean; log?: string } = {}) {
  const d = dragoniteWithApi(c.req.param("id") ?? "");
  if (!d) return c.json({ error: "Dragonite has no url in its [stack.dragonite]" }, 404);
  let body: unknown;
  if (opts.body) {
    const raw = await c.req.text();
    if (raw.length > 500_000) return c.json({ error: "too large" }, 413);
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "the body must be JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "the body must be an object" }, 400);
  }
  try {
    const json = await schedulerCall(d, method, path, cfg.requestTimeoutMs, body);
    if (opts.log) console.log(`[dragonite] ${c.get("user")} ${opts.log} on ${d.name}${body && "name" in (body as object) ? ` ("${String((body as { name: unknown }).name).slice(0, 80)}")` : ""}`);
    return c.json(json ?? { ok: true });
  } catch (e) {
    const status = e instanceof DragoniteError && e.status >= 400 && e.status < 600 ? e.status : 502;
    return c.json({ error: (e as Error).message }, status as 400);
  }
}

for (const what of ["active", "areas", "diagnostics"] as const) {
  app.get(`/api/dragonite/:id/scheduler/${what}`, (c) => schedulerRoute(c, "GET", `/scheduler/${what}`));
}
app.get("/api/dragonite/:id/scheduler/schedules", (c) => schedulerRoute(c, "GET", "/scheduler/schedules"));
app.get("/api/dragonite/:id/scheduler/groups", (c) => schedulerRoute(c, "GET", "/scheduler/groups"));
// Dragonite only gives the newest N runs (up to 1000), optionally for one schedule.
app.get("/api/dragonite/:id/scheduler/runs", async (c) => {
  const sid = schedId(c.req.query("schedule_id"));
  return schedulerRoute(c, "GET", `/scheduler/runs?limit=1000${sid ? `&schedule_id=${sid}` : ""}`);
});

app.post("/api/dragonite/:id/scheduler/schedules", (c) => schedulerRoute(c, "POST", "/scheduler/schedules", { body: true, log: "creates schedule" }));
app.put("/api/dragonite/:id/scheduler/schedules/:sid", async (c) => {
  const sid = schedId(c.req.param("sid"));
  return sid ? schedulerRoute(c, "PUT", `/scheduler/schedules/${sid}`, { body: true, log: `edits schedule ${sid}` }) : c.json({ error: "unknown schedule" }, 404);
});
app.delete("/api/dragonite/:id/scheduler/schedules/:sid", async (c) => {
  const sid = schedId(c.req.param("sid"));
  return sid ? schedulerRoute(c, "DELETE", `/scheduler/schedules/${sid}`, { log: `deletes schedule ${sid}` }) : c.json({ error: "unknown schedule" }, 404);
});
app.post("/api/dragonite/:id/scheduler/schedules/:sid/:action{enable|disable}", async (c) => {
  const sid = schedId(c.req.param("sid"));
  const action = c.req.param("action");
  return sid ? schedulerRoute(c, "POST", `/scheduler/schedules/${sid}/${action}`, { log: `${action}s schedule ${sid}` }) : c.json({ error: "unknown schedule" }, 404);
});

app.post("/api/dragonite/:id/scheduler/groups", (c) => schedulerRoute(c, "POST", "/scheduler/groups", { body: true, log: "creates group" }));
app.put("/api/dragonite/:id/scheduler/groups/:gid", async (c) => {
  const gid = schedId(c.req.param("gid"));
  return gid ? schedulerRoute(c, "PUT", `/scheduler/groups/${gid}`, { body: true, log: `edits group ${gid}` }) : c.json({ error: "unknown group" }, 404);
});
app.delete("/api/dragonite/:id/scheduler/groups/:gid", async (c) => {
  const gid = schedId(c.req.param("gid"));
  return gid ? schedulerRoute(c, "DELETE", `/scheduler/groups/${gid}`, { log: `deletes group ${gid}` }) : c.json({ error: "unknown group" }, 404);
});

/** "Run now": one job action of a schedule, for one area, outside its window. */
app.post("/api/dragonite/:id/scheduler/runs", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ints = ["schedule_id", "action_idx", "area_id"].map((k) => Number(b[k]));
  if (ints.some((n) => !Number.isInteger(n) || n < 0)) return c.json({ error: "schedule_id, action_idx and area_id must be whole numbers" }, 400);
  const [schedule_id, action_idx, area_id] = ints;
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  try {
    const json = await schedulerCall(d, "POST", "/scheduler/runs", cfg.requestTimeoutMs, { schedule_id, action_idx, area_id });
    console.log(`[dragonite] ${c.get("user")} runs action ${action_idx} of schedule ${schedule_id} for area ${area_id} on ${d.name}`);
    return c.json(json ?? { ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, (e instanceof DragoniteError ? e.status : 502) as 400);
  }
});

/** Legacy quest hours to schedules; dry_run only previews (Dragonite takes it as a POST either way). */
app.post("/api/dragonite/:id/scheduler/quest-migration", async (c) => {
  const dry = c.req.query("dry_run") !== "false";
  const past = Math.min(59, Math.max(0, Number(c.req.query("past_minutes") ?? 5) || 0));
  return schedulerRoute(c, "POST", `/scheduler/quest-migration?dry_run=${dry}&past_minutes=${past}`, dry ? {} : { log: "migrates quest hours to schedules" });
});

app.post("/api/dragonite/:id/reload", async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  try {
    await reloadDragonite(d, cfg.requestTimeoutMs);
    console.log(`[dragonite] ${c.get("user")} reloads ${d.name}`);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------- Status page ----------

/** Dragonite releases (UnownHash/Dragonite-Public tags): newest stable and testing, checked hourly. */
let releases: SystemStatus["releases"];
const semver = (v: string) => {
  const m = /(\d+)\.(\d+)\.(\d+)(-testing)?/.exec(v);
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], testing: !!m[4], text: m[0] } : undefined;
};
const newer = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
async function checkReleases() {
  try {
    const res = await fetch("https://api.github.com/repos/UnownHash/Dragonite-Public/tags?per_page=100", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "nacli" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
    const tags = ((await res.json()) as { name: string }[]).map((t) => semver(t.name)).filter((v) => !!v);
    const best = (testing: boolean) => tags.filter((t) => t.testing === testing).sort((a, b) => newer(b.n, a.n))[0]?.text;
    releases = { stable: best(false), testing: best(true), checkedAt: Date.now() };
  } catch (e) {
    releases = { ...releases, checkedAt: Date.now(), error: (e as Error).message };
  }
}
/**
 * RotomNG releases (UnownHash/RotomNG tags, e.g. rotom-ng-v1.0.0, rotom-ng-v1.0.1beta1):
 * versions order as x.y.z, then alpha < beta < rc < the release itself.
 */
let rotomReleases: SystemStatus["rotomReleases"];
const PRE_RANK: Record<string, number> = { alpha: 0, beta: 1, rc: 2 };
const rotomVersion = (v: string) => {
  const m = /(\d+)\.(\d+)\.(\d+)(?:[-.]?(alpha|beta|rc)(\d*))?/i.exec(v);
  if (!m) return undefined;
  const pre = m[4]?.toLowerCase();
  return {
    key: [Number(m[1]), Number(m[2]), Number(m[3]), pre ? PRE_RANK[pre] : 3, Number(m[5] || 0)],
    pre: !!pre,
    text: m[0],
  };
};
const compareKeys = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
async function checkRotomReleases() {
  try {
    const res = await fetch("https://api.github.com/repos/UnownHash/RotomNG/tags?per_page=100", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "nacli" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
    const tags = ((await res.json()) as { name: string }[]).map((t) => rotomVersion(t.name)).filter((v) => !!v);
    const best = (list: typeof tags) => [...list].sort((a, b) => compareKeys(b.key, a.key))[0]?.text;
    rotomReleases = { stable: best(tags.filter((t) => !t.pre)), latest: best(tags), checkedAt: Date.now() };
  } catch (e) {
    rotomReleases = { ...rotomReleases, checkedAt: Date.now(), error: (e as Error).message };
  }
}

const checkAllReleases = () => Promise.all([checkReleases(), checkRotomReleases()]);
checkAllReleases();
setInterval(checkAllReleases, 3_600_000).unref();

/**
 * Whether a Rotom is behind: one on a stable version is only told about newer
 * stable ones (a newer pre-release is mentioned, not pushed); one already on a
 * pre-release is compared with the newest of all.
 */
function rotomUpdate(version?: string) {
  const v = version ? rotomVersion(version) : undefined;
  if (!v || !rotomReleases) return {};
  const target = v.pre ? rotomReleases.latest : rotomReleases.stable;
  const t = target ? rotomVersion(target) : undefined;
  const latest = rotomReleases.latest ? rotomVersion(rotomReleases.latest) : undefined;
  return {
    update: t && compareKeys(t.key, v.key) > 0 ? t.text : undefined,
    preRelease: !v.pre && latest?.pre && compareKeys(latest.key, v.key) > 0 ? latest.text : undefined,
  };
}

/** Each Dragonite's last rate limit, and the drops seen since Nacli started (polled every 30 s). */
const rateSeen = new Map<string, { last?: RateLimit; events: DragoniteRateEvent[] }>();
async function pollRateLimits() {
  await Promise.all(
    cfg.dragonite
      .filter((d) => d.api)
      .map(async (d) => {
        const entry = rateSeen.get(d.id) ?? { events: [] };
        rateSeen.set(d.id, entry);
        try {
          const r = await rateLimit(d, cfg.requestTimeoutMs);
          if (r.lastDecreaseAt && r.lastDecreaseAt !== entry.events[0]?.at) {
            entry.events.unshift({ at: r.lastDecreaseAt, reason: r.lastDecreaseReason, allowedPerSecond: r.allowedPerSecond, ratio: r.ratio });
            entry.events.length = Math.min(entry.events.length, 50);
          }
          entry.last = r;
        } catch {
          // Shown as unreachable by the status call itself.
        }
      }),
  );
}
pollRateLimits();
setInterval(pollRateLimits, 30_000).unref();

/** The rate limits polled above, for the alert box on every page (no new calls to Dragonite). */
app.get("/api/dragonite-rate-limits", (c) =>
  c.json(
    cfg.dragonite
      .filter((d) => d.api && rateSeen.get(d.id)?.last)
      .map((d) => ({ id: d.id, name: d.name, rateLimit: rateSeen.get(d.id)!.last! })),
  ),
);

/** Pause or reset the global rate limit, or reload proxies, accounts or the whole Dragonite. */
app.post(`/api/dragonite/:id/control/:action{${Object.keys(DRAGONITE_CONTROLS).join("|")}}`, async (c) => {
  const d = dragoniteWithApi(c.req.param("id"));
  if (!d) return c.json({ error: "unknown stack" }, 404);
  const action = c.req.param("action") as DragoniteControl;
  let seconds: number | undefined;
  if (action === "pause-limit") {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    seconds = Number(b.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return c.json({ error: "seconds: a whole number from 1 to 86 400" }, 400);
  }
  try {
    await dragoniteControl(d, action, cfg.requestTimeoutMs, seconds);
    console.log(`[dragonite] ${c.get("user")} ${DRAGONITE_CONTROLS[action]}${seconds ? ` for ${seconds}s` : ""} on ${d.name}`);
    // The status page shows the new limit right away.
    if (action.endsWith("-limit")) await pollRateLimits();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/system-status", async (c) => {
  await registry.fresh();
  const dragonite = await Promise.all(
    cfg.dragonite.map(async (d): Promise<DragoniteStatus> => {
      const base: DragoniteStatus = { id: d.id, name: d.name, rotom: d.rotom, reachable: false, rateEvents: rateSeen.get(d.id)?.events ?? [] };
      if (!d.api) return { ...base, error: "no url in its [stack.dragonite]" };
      const t0 = Date.now();
      const [conf, rate, raw] = await Promise.allSettled([
        instanceConfig(d, cfg.requestTimeoutMs),
        rateLimit(d, cfg.requestTimeoutMs),
        (() => {
          const src = dragoniteSource([d.id]);
          return src
            ? vmScalars(src.vm, `sum by (reason) (increase(dragonite_raw_sends_discarded{${dragoniteBase(src.all, [d.id])}}[15m]))`, "reason", 10_000)
            : Promise.reject(new Error("no metrics"));
        })(),
      ]);
      const out: DragoniteStatus = { ...base, latencyMs: Date.now() - t0 };
      if (conf.status === "fulfilled") {
        const v = semver(conf.value.version);
        const latest = v ? (v.testing ? releases?.testing : releases?.stable) : undefined;
        const lv = latest ? semver(latest) : undefined;
        Object.assign(out, {
          reachable: true,
          version: conf.value.version,
          gitSha: conf.value.gitSha,
          hasKoji: conf.value.hasKoji,
          channel: v ? (v.testing ? "testing" : "stable") : undefined,
          update: v && lv && newer(lv.n, v.n) > 0 ? lv.text : undefined,
        });
        // On stable, a newer version that is only out on testing.
        const tv = v && !v.testing && releases?.testing ? semver(releases.testing) : undefined;
        if (v && tv && newer(tv.n, v.n) > 0) out.testing = tv.text;
      } else out.error = (conf.reason as Error).message;
      if (rate.status === "fulfilled") out.rateLimit = rate.value;
      if (raw.status === "fulfilled") {
        out.golbat = { configured: raw.value.size > 0, discarded: Object.fromEntries([...raw.value].map(([k, n]) => [k, Math.round(n)])) };
      }
      return out;
    }),
  );
  // Golbat: its metrics (when charted) and, with a url, whether its API answers.
  let golbat: SystemStatus["golbat"];
  if (cfg.golbat) {
    const ctx = golbatCtx();
    const [summary, health] = await Promise.allSettled([
      ctx ? cachedVm(`golbat:${ctx.source}:summary`, 60_000 * 240 / 2, () => golbatSummary(ctx.vm, ctx.golbat, 20_000)) : Promise.reject(new Error("no metrics")),
      cfg.golbat.api
        ? fetch(`${cfg.golbat.api.url}/health`, { headers: cfg.golbat.api.headers, signal: AbortSignal.timeout(cfg.requestTimeoutMs) }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
          })
        : Promise.reject(new Error("no url")),
    ]);
    const sm = summary.status === "fulfilled" ? summary.value : undefined;
    golbat = {
      metrics: !!ctx,
      lastSeenS: sm?.lastSeenS,
      rawOk: sm?.rawOk,
      rawErrors: sm?.rawErrors,
      api: !!cfg.golbat.api,
      apiOk: cfg.golbat.api ? health.status === "fulfilled" : undefined,
      apiError: cfg.golbat.api && health.status === "rejected" ? (health.reason as Error).message : undefined,
    };
  }
  // Zapdos: its VictoriaMetrics' /health, and which instances it has data for (checked every 5 min).
  let zapdosHealth: SystemStatus["zapdos"]["health"];
  if (cfg.zapdos) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${cfg.zapdos.url}/health`, { headers: cfg.zapdos.headers, signal: AbortSignal.timeout(cfg.requestTimeoutMs) });
      zapdosHealth = r.ok ? { ok: true, latencyMs: Date.now() - t0 } : { ok: false, error: `HTTP ${r.status}` };
    } catch (e) {
      zapdosHealth = { ok: false, error: (e as Error).message };
    }
  }
  const zapdosInstances: SystemStatus["zapdos"]["instances"] = cfg.zapdos
    ? [
        ...cfg.instances.filter((i) => i.zapdosInstance).map((i) => ({ kind: "rotom" as const, name: i.name, zapdosInstance: i.zapdosInstance })),
        ...cfg.dragonite.filter((d) => d.zapdosInstance).map((d) => ({ kind: "dragonite" as const, name: d.name, zapdosInstance: d.zapdosInstance })),
        ...(cfg.golbat?.zapdosInstance ? [{ kind: "golbat" as const, name: "Golbat", zapdosInstance: cfg.golbat.zapdosInstance }] : []),
      ].map((x) => ({ ...x, hasData: vmReady ? vmReady.has(`${x.kind}:${x.zapdosInstance}`) : undefined }))
    : [];
  return c.json<SystemStatus>({
    checkedAt: Date.now(),
    releases,
    dragonite,
    golbat,
    zapdos: { configured: !!cfg.zapdos, local: localMetrics.active, health: zapdosHealth, instances: zapdosInstances },
    rotomReleases,
    rotom: registry.list().map((i) => ({ id: i.id, name: i.name, version: i.config?.version, ...rotomUpdate(i.config?.version) })),
  });
});

/** Last controller seen on each Rotom worker id, so a point left idle still has a name. */
const lastController = new Map<string, { name: string; at: number }>();

// Keep it filled from what the Rotoms report. Rotom is read on demand, so only
// a recent read counts: an old one would keep vouching for controllers gone.
setInterval(() => {
  const now = Date.now();
  for (const s of registry.all()) {
    if (!s.lastSuccessAt || now - s.lastSuccessAt > 15_000) continue;
    for (const ctl of s.status?.controllers ?? []) if (ctl.worker_id) lastController.set(ctl.worker_id, { name: ctl.id, at: now });
  }
  // A day without that controller is long enough to forget it.
  for (const [k, v] of lastController) if (now - v.at > 86_400_000) lastController.delete(k);
}, 10_000).unref();

function controllerOf(id: string, now?: string): Pick<MapDevice, "controller" | "controllerLeftAt"> {
  if (now) {
    lastController.set(id, { name: now, at: Date.now() });
    return { controller: now };
  }
  const prev = lastController.get(id);
  return prev ? { controller: prev.name, controllerLeftAt: prev.at } : {};
}

// Device locations for the Dashboard map: Golbat knows where each device last
// sent data from; Rotom and Dragonite say which device, worker and controller it is.
/** Golbat's device locations joined with Rotom and Dragonite (the map's data). */
async function mapDevices(golbat: { url: string; headers: Record<string, string> }): Promise<MapDevice[]> {
  await registry.fresh();
  const devices = await cachedVm("golbat:devices", 0, async () => {
    const res = await fetch(`${golbat.url}/api/devices/all`, {
      headers: golbat.headers,
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
    });
    if (res.status === 401) throw new Error("Golbat rejects the api_secret in [golbat]");
    if (!res.ok) throw new Error(`Golbat: HTTP ${res.status}`);
    const json = (await res.json()) as {
      devices?: Record<string, { latitude: number; longitude: number; last_update: number; scan_context: string }>;
    };
    return json.devices ?? {};
  });

  const rotom = new Map<string, MapDevice["rotom"]>();
  // A controller's id is its name (e.g. "Barakaldo_04"); worker_id is the Rotom worker it is on.
  const controllerName = new Map<string, string>();
  for (const s of registry.all()) {
    for (const ctl of s.status?.controllers ?? []) if (ctl.worker_id) controllerName.set(ctl.worker_id, ctl.id);
    for (const dev of s.status?.devices ?? []) {
      for (const w of dev.workers ?? []) {
        rotom.set(w.id, { instanceId: s.cfg.id, device: dev.origin, connected: w.is_connected });
      }
    }
  }
  const dragonite = new Map<string, MapDevice["dragonite"]>();
  await Promise.all(
    cfg.dragonite
      .filter((d) => d.api)
      .map(async (d) => {
        const data = await cachedVm(`dragonite-areas:${d.id}`, 0, () => dragoniteAreaList(d, cfg.requestTimeoutMs)).catch(
          () => undefined,
        );
        const groups = [
          ...(data?.areas ?? []).map((a) => ({ name: a.name, workers: a.live?.workers ?? [] })),
          ...(data?.unbounds ?? []).map((u) => ({ name: u.name, workers: u.workers })),
        ];
        for (const g of groups) {
          for (const w of g.workers) {
            dragonite.set(w.deviceId, { id: d.id, name: d.name, area: g.name, controller: w.name, mode: w.mode });
          }
        }
      }),
  );

  // Where each controller runs right now (Rotom worker id), to spot points
  // left behind by a controller that moved to another Rotom worker.
  // Controller names are unique only within one Dragonite/Rotom (two can have a
  // "Rocket_01"), so they are keyed by the Rotom instance they run on.
  const runningOn = new Map<string, string>();
  const key = (rotomWorker: string, name: string) => `${rotom.get(rotomWorker)?.instanceId ?? "?"}\u0000${name}`;
  for (const [id, name] of controllerName) runningOn.set(key(id, name), id);
  for (const [id, d] of dragonite) if (d?.controller) runningOn.set(key(id, d.controller), id);

  const out: MapDevice[] = Object.entries(devices)
    .filter(([, v]) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude) && (v.latitude || v.longitude))
    .map(([id, v]) => ({
      id,
      lat: v.latitude,
      lon: v.longitude,
      lastUpdate: v.last_update * 1000,
      scanContext: v.scan_context,
      rotom: rotom.get(id),
      dragonite: dragonite.get(id),
      ...controllerOf(id, dragonite.get(id)?.controller || controllerName.get(id)),
    }))
    .map((d) => {
      // With a controller on it now, the point is that controller's.
      if (!d.controllerLeftAt && d.controller) return d;
      // Left by its controller: hidden, wherever that controller went…
      const elsewhere = d.controller ? runningOn.get(key(d.id, d.controller)) : undefined;
      if (elsewhere && elsewhere !== d.id) return { ...d, relocatedTo: elsewhere };
      // …unless we know who it was and it runs nowhere: that one really stopped.
      if (d.controller) return d;
      return { ...d, relocatedTo: "unknown" };
    });
  return out;
}

/**
 * Golbat's figures for every enabled area of every stack (quests, Pokémon,
 * invasions, raids, lures, stations). Heavy (Golbat lists every Pokémon in
 * each area), so computed only when asked and shared for two minutes.
 */
/** Every enabled area's statistics from Golbat, as the Statistics page shows them. */
async function collectAreaStats(golbat: { url: string; headers: Record<string, string> }, stacks: typeof cfg.dragonite): Promise<AreaStatsResponse> {
  const perStack = await Promise.all(
    stacks.map(async (d) => {
      const areas = await cachedVm(`dragonite-geofences:${d.id}`, 240 * 60_000, () => areaGeofences(d, cfg.requestTimeoutMs));
      return areas.map((a) => ({ d, a }));
    }),
  );
  const areas = await limited(perStack.flat(), 3, async ({ d, a }): Promise<AreaStats> => {
    const base = { stack: d.id, stackName: d.name, rotom: d.rotom, areaId: a.id, area: a.name };
    try {
      const { partial, ...stats } = await areaStats(golbat, a.geometry, 30_000);
      return { ...base, stats, partial };
    } catch (e) {
      return { ...base, error: (e as Error).message };
    }
  });
  return { checkedAt: Date.now(), areas, totals: sumStats(areas.flatMap((x) => (x.stats ? [x.stats] : []))) };
}

const statsSetup = () => {
  const golbat = cfg.golbat?.api;
  const stacks = cfg.dragonite.filter((d) => d.api);
  return golbat && stacks.length ? { golbat, stacks } : undefined;
};

app.get("/api/golbat/area-stats", async (c) => {
  const setup = statsSetup();
  if (!setup) return c.json({ error: "requires url in [golbat] and a [stack.dragonite] with url" }, 404);
  try {
    return c.json(await cachedVm(STATS_CACHE, 2 * 60_000 * 240, () => collectAreaStats(setup.golbat, setup.stacks)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---- Statistics history ([golbat] stats_poll_interval): 24 h in memory ----

const STATS_CACHE = "golbat:area-stats";
const STATS_KEEP_MS = 24 * 3_600_000;
/** One take: the totals and each area's figures, by "stack:areaId". */
let statsHistory: { t: number; totals: AreaStatsCounts; areas: Record<string, AreaStatsCounts> }[] = [];
let statsTimer: NodeJS.Timeout | undefined;
let statsEvery: number | undefined;
let statsBusy = false;

async function takeStats() {
  const setup = statsSetup();
  if (!setup || statsBusy) return;
  statsBusy = true;
  try {
    const data = await collectAreaStats(setup.golbat, setup.stacks);
    // The Statistics page shows this same take instead of asking Golbat again.
    vmCache.set(STATS_CACHE, { at: data.checkedAt, data: Promise.resolve(data) });
    statsHistory.push({
      t: data.checkedAt,
      totals: data.totals,
      areas: Object.fromEntries(data.areas.flatMap((a) => (a.stats ? [[`${a.stack}:${a.areaId}`, a.stats]] : []))),
    });
    statsHistory = statsHistory.filter((x) => x.t >= Date.now() - STATS_KEEP_MS);
  } catch (e) {
    console.error(`[golbat] statistics history: ${(e as Error).message}`);
  } finally {
    statsBusy = false;
  }
}

/** Starts, stops or re-times the history to match config.toml (at start and on every reload). */
function applyStatsHistory() {
  const every = statsSetup() ? cfg.golbat?.statsPollIntervalMs : undefined;
  if (every === statsEvery) return;
  clearInterval(statsTimer);
  statsTimer = undefined;
  statsEvery = every;
  if (!every) {
    statsHistory = [];
    return;
  }
  void takeStats();
  statsTimer = setInterval(() => void takeStats(), every);
  statsTimer.unref();
}
applyStatsHistory();

/** The totals' history, or one area's (?area=stack:areaId). */
app.get("/api/golbat/area-stats/history", (c) => {
  if (!statsEvery) return c.json({ error: "set stats_poll_interval in [golbat] to keep a history" }, 404);
  const area = c.req.query("area");
  const points = statsHistory.flatMap((x) => {
    const stats = area ? x.areas[area] : x.totals;
    return stats ? [{ t: x.t, stats }] : [];
  });
  return c.json({ intervalMs: statsEvery, points });
});

app.get("/api/golbat/devices", async (c) => {
  const golbat = cfg.golbat?.api;
  if (!golbat) return c.json({ error: "requires a url in [golbat]" }, 404);
  try {
    return c.json(await mapDevices(golbat));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------- Controller trails (where each controller has been) ----------

/** How far back a trail goes, and its cap so a busy controller stays light. */
const TRAIL_MS = 30 * 60_000;
const TRAIL_MAX = 2000;
/** A trail point, noting whether the controller was in a mode that roams. */
type TrailPoint = MapTrailPoint & { roams: boolean };
const trails = new Map<string, TrailPoint[]>();
/** Same key the map uses: controller names are unique per Rotom instance. */
const trailKey = (instanceId: string, controller: string) => `${instanceId}\u0000${controller}`;

/** Two positions further apart than this are a jump, not a walk. */
const JUMP_KM = 50;
/** A stretch with fewer points than this, far from the rest, is a bad reading. */
const BLIP_POINTS = 5;
/** Modes that hop between far-off places (Rocket stops, scout requests): their jumps are real. */
const ROAMING_MODES = new Set(["InvasionMode", "ScoutMode"]);

/** Great-circle distance in km. */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/**
 * The trail without jumps of more than JUMP_KM: it is cut into stretches at
 * each jump and short stretches (a few far-off readings) are dropped. If a
 * jump is still left (the controller really moved to another place) only what
 * comes after the last one is kept. A move shows once the new place has
 * BLIP_POINTS readings; until then it looks like any other blip. A jump to or
 * from a point in a roaming mode (Invasions, Scout) is not cut: those really
 * travel far.
 */
function withoutJumps(list: TrailPoint[]): MapTrailPoint[] {
  const joins = (a: TrailPoint, b: TrailPoint) => a.roams || b.roams || distanceKm(a, b) <= JUMP_KM;
  const stretches: TrailPoint[][] = [];
  for (const p of list) {
    const cur = stretches.at(-1);
    if (cur && joins(cur.at(-1)!, p)) cur.push(p);
    else stretches.push([p]);
  }
  const solid = stretches.filter((s) => s.length >= BLIP_POINTS);
  // With the blips gone, neighbouring stretches may join up again.
  let out: TrailPoint[] = [];
  for (const s of solid) out = out.length && joins(out.at(-1)!, s[0]) ? [...out, ...s] : s;
  // Only blips (a young trail): its newest stretch.
  if (!solid.length) out = stretches.at(-1) ?? [];
  return out.map(({ t, lat, lon }) => ({ t, lat, lon }));
}

// Every 10 s, while Golbat is configured, note where each controller is.
setInterval(async () => {
  const golbat = cfg.golbat?.api;
  if (!golbat) return;
  try {
    const now = Date.now();
    // While a controller moves to another Rotom worker, both workers can name
    // it for a moment: follow the controller, taking its freshest position.
    const latest = new Map<string, MapDevice>();
    for (const d of await mapDevices(golbat)) {
      if (!d.controller || d.controllerLeftAt || d.relocatedTo || !d.rotom) continue;
      const key = trailKey(d.rotom.instanceId, d.controller);
      if ((latest.get(key)?.lastUpdate ?? -1) < d.lastUpdate) latest.set(key, d);
    }
    for (const [key, d] of latest) {
      const list = trails.get(key) ?? [];
      const last = list.at(-1);
      // A new point only when Golbat has a newer position that is elsewhere.
      if (!last || (d.lastUpdate > last.t && (last.lat !== d.lat || last.lon !== d.lon))) {
        list.push({ t: d.lastUpdate, lat: d.lat, lon: d.lon, roams: ROAMING_MODES.has(d.dragonite?.mode ?? "") });
      }
      while (list.length > TRAIL_MAX || (list.length && now - list[0].t > TRAIL_MS)) list.shift();
      trails.set(key, list);
    }
    for (const [k, list] of trails) if (!list.length || now - list.at(-1)!.t > TRAIL_MS) trails.delete(k);
  } catch {
    // Golbat unreachable this round: the map endpoint reports it.
  }
}, 10_000).unref();

app.get("/api/golbat/trail", (c) => {
  const instance = c.req.query("instance") ?? "";
  const controller = c.req.query("controller") ?? "";
  if (!instance || !controller) return c.json({ error: "missing instance and controller" }, 400);
  // Trimmed again here: a controller that stopped is no longer trimmed by the recorder.
  const since = Date.now() - TRAIL_MS;
  return c.json(withoutJumps((trails.get(trailKey(instance, controller)) ?? []).filter((p) => p.t >= since)));
});

/** The Rotom instances whose charts come from Zapdos (data there under their zapdos_instance). */
/** The Rotom instances whose charts come from Zapdos (data there under their zapdos_instance). */
const rotomOnVm = () => cfg.instances.filter((i) => onVm("rotom", i.zapdosInstance));
/** The rest, kept in memory: under localRotom(id) there, so their queries use that. */
const rotomInMemory = () =>
  cfg.instances.filter((i) => !onVm("rotom", i.zapdosInstance) && localMetrics.has(localRotom(i.id))).map((i) => ({ ...i, zapdosInstance: localRotom(i.id) }));

/**
 * Runs one Rotom chart query on both sources, each with its own instances,
 * and joins the per-instance results (they never overlap).
 */
async function rotomBoth<T>(
  key: string,
  rangeMs: number,
  run: (vm: ZapdosConfig, list: RotomInstanceConfig[]) => Promise<Record<string, T>>,
): Promise<Record<string, T>> {
  const vm = cfg.zapdos;
  const fromVm = vm ? rotomOnVm() : [];
  const fromMemory = rotomInMemory();
  const [a, b] = await Promise.all([
    vm && fromVm.length
      ? cachedVm(`${key}:vm:${fromVm.map((i) => i.id).join(",")}`, rangeMs, () => run(vm, fromVm)).catch((e) => {
          // Zapdos failing: the other instances still show.
          console.error(`[zapdos] ${key}: ${(e as Error).message}`);
          return {} as Record<string, T>;
        })
      : ({} as Record<string, T>),
    fromMemory.length ? run(LOCAL_VM, fromMemory) : ({} as Record<string, T>),
  ]);
  return { ...a, ...b };
}

const NO_ROTOM_HISTORY = { error: "no RotomNG has history yet" };

// Each instance has its own series here, so they can mix: Zapdos for
// those with data there, the history kept in memory for the rest.
app.get("/api/history", async (c) => {
  const rangeMs = rangeParam(c.req.query("range"), rotomOnVm().length ? MAX_VM_RANGE_MS : cfg.historyRetentionMs);
  try {
    return c.json(await rotomBoth(`hist:${rangeMs}`, rangeMs, (vm, list) => vmHistory(vm, list, rangeMs, 20_000)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/controller-demand", async (c) => {
  if (!rotomOnVm().length && !rotomInMemory().length) return c.json(NO_ROTOM_HISTORY, 404);
  const windowS = 3600;
  try {
    const data = await rotomBoth("demand", 60_000 * 240, (vm, list) => vmControllerDemand(vm, list, windowS, 20_000));
    return c.json({ windowS, instances: data });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.get("/api/history/device/:metric", async (c) => {
  if (!rotomOnVm().length && !rotomInMemory().length) return c.json(NO_ROTOM_HISTORY, 404);
  const metric = c.req.param("metric") as DeviceMetric;
  if (!DEVICE_METRICS.includes(metric)) return c.json({ error: "unknown metric" }, 400);
  const rangeMs = rangeParam(c.req.query("range"), rotomOnVm().length ? MAX_VM_RANGE_MS : cfg.historyRetentionMs);
  try {
    return c.json(await rotomBoth(`dev:${metric}:${rangeMs}`, rangeMs, (vm, list) => vmDeviceSeries(vm, list, metric, rangeMs, 20_000)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// ---------- Proxy to a RotomNG instance (actions, jobs) ----------

const ALLOWED = [
  /^\/device\/[^/]+\/action\/(restart|reboot|enable|disable|disconnect|delete|logcat)$/,
  /^\/controller\/[^/]+\/action\/(disconnect|reconnect)$/,
  /^\/job$/,
  /^\/job\/-\/reload$/,
  /^\/job\/[^/]+\/run$/,
  /^\/job-instance$/,
  /^\/job-instance\/[^/]+\/clear$/,
  /^\/config\/reload$/,
];

/** Most a log view returns; older lines are dropped (the ZIP download has everything). */
const LOG_VIEW_MAX_BYTES = 4 * 1024 * 1024;

// Fetches a device's logcat ZIP and returns its text files, so the UI can show
// the log in place instead of downloading an archive.
app.post("/api/rotom/:id/device/:device/logcat-view", async (c) => {
  const state = registry.get(c.req.param("id"));
  if (!state) return c.json({ error: "instance not configured" }, 404);
  const device = c.req.param("device");
  console.log(`[proxy] ${c.get("user")} logcat-view ${state.cfg.name}/${device}`);

  let res: Response;
  try {
    res = await rotomFetch(state.cfg, `/device/${encodeURIComponent(device)}/action/logcat`, 120_000, {
      method: "PUT",
    });
  } catch (e) {
    return c.json({ error: `${state.cfg.name}: ${(e as Error).message}` }, 502);
  }
  if (!res.ok) {
    const body = await res.text();
    let msg = body.slice(0, 300);
    try {
      msg = JSON.parse(body).error ?? msg;
    } catch {}
    return c.json({ error: msg || `HTTP ${res.status}` }, res.status as 400);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  let raw: { name: string; data: Uint8Array }[];
  try {
    const fallback = /filename="?([^";]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "logcat";
    raw = unpackArchive(fallback, buf);
  } catch (e) {
    return c.json({ error: `could not unpack the logcat: ${(e as Error).message}` }, 502);
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const files = raw
    .filter(({ data }) => data.length > 0)
    .map(({ name, data }) => {
      const truncated = data.length > LOG_VIEW_MAX_BYTES;
      let text = decoder.decode(truncated ? data.subarray(data.length - LOG_VIEW_MAX_BYTES) : data);
      // Drop the partial first line left by truncation.
      if (truncated) text = text.slice(text.indexOf("\n") + 1);
      return { name, text, truncated, bytes: data.length };
    });
  return c.json({ files });
});

app.all("/api/rotom/:id/*", async (c) => {
  const state = registry.get(c.req.param("id"));
  if (!state) return c.json({ error: "instance not configured" }, 404);
  const path = c.req.path.slice(`/api/rotom/${c.req.param("id")}`.length);
  if (!ALLOWED.some((re) => re.test(path))) return c.json({ error: "operation not allowed" }, 403);
  const method = c.req.method;
  if (method !== "GET" && method !== "PUT") return c.json({ error: "method not allowed" }, 405);

  console.log(`[proxy] ${c.get("user")} ${method} ${state.cfg.name}${path}`);

  try {
    const res = await rotomFetch(state.cfg, path, 60_000, {
      method,
      body: method === "PUT" ? await c.req.text() : undefined,
      headers: method === "PUT" ? { "Content-Type": "application/json" } : {},
    });
    const headers = new Headers();
    for (const h of ["content-type", "content-disposition"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    // The next read asks Rotom again, so the UI reflects the action.
    if (method === "PUT") state.stale();
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return c.json({ error: `${state.cfg.name}: ${(e as Error).message}` }, 502);
  }
});

// ---------- Static frontend ----------

if (existsSync(STATIC_DIR)) {
  app.use("/*", serveStatic({ root: STATIC_DIR }));
  app.get("*", serveStatic({ path: `${STATIC_DIR}/index.html` }));
}

const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  console.log(`[nacli] listening on http://${info.address}:${info.port} — config: ${cfg.path}`);
  for (const i of cfg.instances) console.log(`  · ${i.name} → ${i.url}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
