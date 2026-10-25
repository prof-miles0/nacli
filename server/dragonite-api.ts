// Read-only client for a Dragonite's HTTP API (the calls its admin makes on
// the Accounts page). Account rows carry passwords, emails and refresh
// tokens: only the fields in ACCOUNT_FIELDS ever leave this server.

import type { DragoniteConfig } from "./config.ts";

/** What the stats endpoints count; the keys add up to `total`. */
export const ACCOUNT_STATUS_KEYS = [
  "good",
  "in_use",
  "disabled",
  "provider_disabled",
  "cooldown",
  "warned",
  "suspended",
  "banned",
  "auth_banned",
  "invalid",
  "missing_token",
  "zero_last_released",
] as const;

const ACCOUNT_FIELDS = [
  "username",
  "provider",
  "level",
  "warn",
  "warn_expiration",
  "suspended",
  "banned",
  "invalid",
  "auth_banned",
  "disabled",
  "in_use",
  "valid_refresh_token",
  "last_selected",
  "last_released",
  "last_disabled",
  "last_banned",
  "last_suspended",
  "last_refreshed",
  "consecutive_disabled",
] as const;

/** Columns the list may be sorted by (passed through to Dragonite). */
export const ACCOUNT_SORTS = ["username", "level", "provider", "last_selected", "last_released"] as const;

async function call(
  d: DragoniteConfig,
  path: string,
  timeoutMs: number,
  /** For writes: method and JSON body; `json: false` when no JSON comes back. */
  write?: { method: "GET" | "PATCH" | "POST" | "DELETE"; body?: unknown; json?: boolean },
) {
  if (!d.api) throw new Error(`${d.name}: missing url in its [stack.dragonite]`);
  const res = await fetch(`${d.api.url}${path}`, {
    method: write?.method ?? "GET",
    headers: write?.body !== undefined ? { ...d.api.headers, "Content-Type": "application/json" } : d.api.headers,
    body: write?.body !== undefined ? JSON.stringify(write.body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${d.name}: the API requires authentication (HTTP ${res.status}); check api_secret or basic_auth`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`${d.name}: HTTP ${res.status}${detail && !detail.startsWith("<") ? ` · ${detail}` : ""}`);
  }
  if (write && write.json === false) return { json: undefined, headers: res.headers };
  // A login page or the admin's web app instead of the API: usually a proxy
  // asking to sign in, or an admin URL without "/api".
  // URLs stay out of the message: they may be internal addresses.
  if (!res.headers.get("content-type")?.includes("json")) {
    throw new Error(
      res.redirected
        ? `${d.name}: the proxy redirects to a login page; allow access without login or configure basic_auth`
        : `${d.name}: returned a web page, not the API (if it is an admin, its url is missing "/api")`,
    );
  }
  return { json: (await res.json()) as unknown, headers: res.headers };
}

function counts(raw: Record<string, unknown>) {
  const out: Record<string, number> = { total: Number(raw.total) || 0 };
  for (const k of ACCOUNT_STATUS_KEYS) out[k] = Number(raw[k]) || 0;
  return out;
}

export async function accountStats(d: DragoniteConfig, timeoutMs: number) {
  const { json } = await call(d, "/accounts/stats", timeoutMs);
  return counts(json as Record<string, unknown>);
}

export async function accountLevelStats(d: DragoniteConfig, provider: string, tokenStatus: number, timeoutMs: number) {
  const q = new URLSearchParams({ provider, "token-status": String(tokenStatus) });
  const { json } = await call(d, `/accounts/level-stats?${q}`, timeoutMs);
  return ((json as Record<string, unknown>[]) ?? []).map((r) => ({ level: Number(r.level) || 0, ...counts(r) }));
}

export async function accountList(
  d: DragoniteConfig,
  opts: {
    page: number;
    perPage: number;
    sortBy: string;
    order: "asc" | "desc";
    /** Text search on the username (Dragonite's `q`; its other filters are ignored). */
    search?: string;
  },
  timeoutMs: number,
) {
  const q = new URLSearchParams({
    page: String(opts.page),
    per_page: String(opts.perPage),
    sort_by: opts.sortBy,
    order: opts.order,
  });
  if (opts.search) q.set("q", opts.search);
  const { json, headers } = await call(d, `/v2/accounts/?${q}`, timeoutMs);
  const rows = ((json as Record<string, unknown>[]) ?? []).map((r) =>
    Object.fromEntries(ACCOUNT_FIELDS.map((k) => [k, r[k] ?? null])),
  );
  return {
    total: Number(headers.get("x-total-count")) || rows.length,
    pages: Number(headers.get("x-total-pages")) || 1,
    rows,
  };
}

/** The admin's account providers (its "Provider" choices). */
export const ACCOUNT_PROVIDERS = ["ptc", "nk", "g", "fb"] as const;

/**
 * One account, as the admin's "Create One Account" sends it (POST /v2/accounts/).
 * Only the username comes back: the response carries the password and token.
 */
export async function createAccount(
  d: DragoniteConfig,
  a: { username: string; password: string; provider: string; level: number },
  timeoutMs: number,
) {
  await call(d, "/v2/accounts/", timeoutMs, { method: "POST", body: a, json: false });
}

/**
 * Many accounts sharing provider, level and release time, as the admin's
 * "Import multiple accounts" sends them (POST /v2/accounts/bulk). Dragonite
 * ignores usernames it already has; returns how many it inserted.
 */
export async function importAccounts(
  d: DragoniteConfig,
  body: { accounts: { username: string; password: string }[]; default_level: number; provider: string; last_released: number },
  timeoutMs: number,
) {
  const { json } = await call(d, "/v2/accounts/bulk", timeoutMs, { method: "POST", body });
  return num(obj(json).inserted);
}

// ---- Areas: config from /v2/areas plus live workers from /status ----

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);

export interface LiveWorker {
  name: string;
  /** Rotom worker id ("<device>_002"), the link to the Rotom side. */
  deviceId: string;
  account: string;
  mode: string;
  /** Sub-mode Dragonite reports, e.g. RouteMode, with the route progress. */
  task?: { name: string; pos: number; total: number; part: number; seconds: number };
  lastData: number;
  status: string;
}

export interface LiveGroup {
  expected: number;
  active: number;
  workers: LiveWorker[];
}

function liveGroup(managers: unknown): LiveGroup {
  const out: LiveGroup = { expected: 0, active: 0, workers: [] };
  for (const m of (managers as Raw[]) ?? []) {
    out.expected += num(m.expected_workers);
    out.active += num(m.active_workers);
    for (const w of (m.workers as Raw[]) ?? []) {
      const ms = obj(w.mode_status);
      out.workers.push({
        name: String(w.worker_name ?? ""),
        deviceId: String(w.device_id ?? ""),
        account: String(w.account_name ?? ""),
        mode: String(w.current_mode ?? ""),
        task: ms.name
          ? {
              name: String(ms.name),
              pos: num(ms.route_pos),
              total: num(ms.total_route_points),
              part: num(ms.part_route_points),
              seconds: num(ms.current_route_time),
            }
          : undefined,
        lastData: num(w.last_data),
        status: String(w.connection_status ?? ""),
      });
    }
  }
  return out;
}

/** One area as the panel shows it; routes and geofences only as point counts. */
function summarizeArea(a: Raw, l?: Raw) {
  const pk = obj(a.pokemon_mode);
  const qm = obj(a.quest_mode);
  const fm = obj(a.fort_mode);
  const rm = obj(a.rare_pokemon_mode);
  return {
    id: num(a.id),
    name: String(a.name ?? ""),
    enabled: !!a.enabled,
    timezone: l ? String(l.timezone ?? "") : undefined,
    pokemon: {
      enabled: !!a.enable_pokemon,
      workers: num(pk.workers),
      routePoints: len(pk.route),
      scout: !!pk.enable_scout,
      invasion: !!pk.invasion,
    },
    quest: {
      enabled: !!a.enable_quests,
      workers: num(qm.workers),
      routePoints: len(qm.route),
      hours: Array.isArray(qm.hours) ? (qm.hours as unknown[]).map(num) : [],
    },
    fort: {
      enabled: !!a.enable_forts,
      workers: num(fm.workers),
      prioRaid: !!fm.prio_raid,
      showcase: !!fm.showcase,
      invasion: !!fm.invasion,
    },
    rare: { enabled: !!a.enable_rare_pokemon, workers: num(rm.workers), permyriad: num(rm.permyriad) },
    live: l ? liveGroup(l.worker_managers) : undefined,
  };
}

/** Everything the areas page shows; routes and geofences only as point counts. */
export async function dragoniteAreas(d: DragoniteConfig, timeoutMs: number) {
  const [list, status] = await Promise.all([
    call(d, "/v2/areas/?order=asc&page=0&per_page=500&sort_by=name", timeoutMs),
    call(d, "/status", timeoutMs),
  ]);
  const st = obj(status.json);
  const live = new Map(((st.areas as Raw[]) ?? []).map((a) => [num(a.id), a]));
  const areas = ((list.json as Raw[]) ?? []).map((a) => summarizeArea(a, live.get(num(a.id))));
  const unbounds = ((st.unbounds as Raw[]) ?? []).map((u) => ({
    name: String(u.name ?? ""),
    ...liveGroup([u]),
  }));
  const queues = ((st.queues as Raw[]) ?? []).map((q) => ({ name: String(q.name ?? ""), size: num(q.queue) }));
  return { areas, unbounds, queues };
}

/** The outlines of the enabled areas (each area's GeoJSON geofence). */
export async function areaGeofences(d: DragoniteConfig, timeoutMs: number, withDisabled = false) {
  const { json } = await call(d, "/v2/areas/?order=asc&page=0&per_page=500&sort_by=name", timeoutMs);
  return ((json as Raw[]) ?? []).flatMap((a) => {
    const g = obj(obj(a.geofence).geometry);
    if ((!a.enabled && !withDisabled) || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates)) return [];
    return [{ id: num(a.id), name: String(a.name ?? ""), enabled: !!a.enabled, geometry: { type: g.type, coordinates: g.coordinates } as const }];
  });
}

// ---- Area changes (the calls Dragonite's admin makes) ----

/** Turns an area on or off: the admin's toggle (GET /areas/{id}/enable|disable). */
export async function setAreaEnabled(d: DragoniteConfig, id: number, on: boolean, timeoutMs: number) {
  await call(d, `/areas/${id}/${on ? "enable" : "disable"}`, timeoutMs, { method: "GET", json: false });
}

// ---- Copying and moving areas between Dragonites ----

/**
 * Copies an area (routes and geofences included) into another Dragonite, as
 * its admin creates one (POST /v2/areas/). The copy starts disabled and is
 * enabled at the end only when asked. Moving also removes the original
 * (DELETE /v2/areas/{id}), and only once the copy exists.
 */
/**
 * Creates an area as the admin's "Create" does (POST /v2/areas/): it starts
 * disabled and is switched on afterwards only when asked, as copies are.
 */
export async function createArea(d: DragoniteConfig, area: Raw, enable: boolean, timeoutMs: number) {
  const created = await call(d, "/v2/areas/", timeoutMs, { method: "POST", body: { ...area, enabled: false } });
  const id = num(obj(created.json).id);
  if (!id) throw new Error(`${d.name}: did not return the id of the created area`);
  if (enable) {
    try {
      await setAreaEnabled(d, id, true, timeoutMs);
    } catch (e) {
      throw new Error(`created (id ${id}) but not enabled: ${(e as Error).message}`);
    }
  }
  return id;
}

/** One area exactly as Dragonite stores it: geofence, routes and every mode (no secrets in it). */
export async function getArea(d: DragoniteConfig, id: number, timeoutMs: number) {
  const { json } = await call(d, `/v2/areas/${id}`, timeoutMs);
  const { $schema: _schema, ...area } = obj(json);
  return area;
}

/**
 * Saves a whole area as the admin's "Edit" does (PATCH /v2/areas/{id} with
 * every field): name, geofence, routes, overrides and modes. Enabling is left
 * to the enable/disable calls, which also start or stop its workers.
 */
export async function saveArea(d: DragoniteConfig, id: number, area: Raw, timeoutMs: number) {
  const { id: _id, enabled: _enabled, $schema: _schema, ...body } = area;
  await call(d, `/v2/areas/${id}`, timeoutMs, { method: "PATCH", body, json: false });
}

export const KOJI_MODES = ["pokemon", "fort", "quest"] as const;
export type KojiMode = (typeof KOJI_MODES)[number];

/**
 * Has Dragonite ask Kōji for one mode's route of an area and store it, as the
 * admin's Kōji buttons do (GET /recalculate/{id}/{mode}?bootstrap=): the
 * saved route is replaced right away. `bootstrap` asks for a route that
 * covers the whole geofence (Pokémon and Fort only).
 */
export async function recalculateRoute(d: DragoniteConfig, id: number, mode: KojiMode, bootstrap: boolean, timeoutMs: number) {
  await call(d, `/recalculate/${id}/${mode}?bootstrap=${bootstrap}`, timeoutMs, { method: "GET", json: false });
}

/**
 * Starts or stops quest scanning, as the admin's quest buttons do: in one area
 * (POST /quest/{id}/start|stop) or in every active area ("all"). `clear`
 * clears the stored quests first (Dragonite's default when starting).
 */
export async function questAction(d: DragoniteConfig, area: number | "all", action: "start" | "stop", clear: boolean, timeoutMs: number) {
  const { json } = await call(d, `/quest/${area}/${action}?clear=${clear}`, timeoutMs, { method: "POST", body: {} });
  const r = obj(json);
  const errors = obj(r.errors);
  return {
    message: String(r.message ?? ""),
    // Per area for "all": which ones took it and why the rest did not.
    areas: Object.fromEntries(Object.entries(obj(r.areas)).map(([k, v]) => [k, v === true])),
    errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, String(v)])),
  };
}

export async function transferArea(
  from: DragoniteConfig,
  to: DragoniteConfig,
  id: number,
  opts: { name: string; move: boolean; enable: boolean },
  timeoutMs: number,
) {
  const { json } = await call(from, `/v2/areas/${id}`, timeoutMs);
  const src = obj(json);
  const { id: _id, $schema: _schema, ...rest } = src;
  const created = await call(to, "/v2/areas/", timeoutMs, {
    method: "POST",
    body: { ...rest, name: opts.name, enabled: false },
  });
  const copy = obj(created.json);
  const newId = num(copy.id);
  if (!newId) throw new Error(`${to.name}: did not return the id of the created area`);
  const steps: string[] = [`created in ${to.name} (id ${newId})`];
  try {
    if (opts.move && src.enabled) {
      // Stop it at the source first, so both never scan the same place at once.
      await setAreaEnabled(from, id, false, timeoutMs);
      steps.push(`disabled in ${from.name}`);
    }
    if (opts.enable) {
      await setAreaEnabled(to, newId, true, timeoutMs);
      steps.push(`enabled in ${to.name}`);
    }
    if (opts.move) {
      await call(from, `/v2/areas/${id}`, timeoutMs, { method: "DELETE", json: false });
      steps.push(`deleted from ${from.name}`);
    }
  } catch (e) {
    // Say what already happened, so nothing is left half-done unnoticed.
    throw new Error(`${(e as Error).message} (done so far: ${steps.join(", ")})`);
  }
  return { id: newId, steps };
}

// ---- Proxies (the admin's /proxies calls) ----
// Proxy URLs carry their username and password: they stay on this server.
// The browser gets host:port, whether there are credentials, and a key.

export interface ProxyRow {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
}

export interface ProxyProviderStatus {
  provider: string;
  good: boolean;
  lastStatus: string;
  /** Unix seconds of its last good login, if any. */
  lastSuccess?: number;
}

/** host:port plus the username, which together say "the same proxy" across instances. */
export function proxyIdentity(url: string) {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return { endpoint: `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`, user: decodeURIComponent(u.username), scheme: u.protocol.replace(":", "") };
  } catch {
    return { endpoint: url.replace(/^.*@/, ""), user: "", scheme: "http" };
  }
}

export async function listProxies(d: DragoniteConfig, timeoutMs: number): Promise<ProxyRow[]> {
  const out: ProxyRow[] = [];
  for (let page = 0; page < 20; page++) {
    const { json } = await call(d, `/proxies/?page=${page}&perPage=1000&sortBy=id&order=ASC`, timeoutMs);
    const o = obj(json);
    for (const r of (o.data as Raw[]) ?? []) {
      out.push({ id: num(r.id), name: String(r.name ?? ""), url: String(r.url ?? ""), enabled: !!r.enabled });
    }
    if (!obj(o.pagination).hasNext) break;
  }
  return out;
}

export async function proxyStats(d: DragoniteConfig, timeoutMs: number) {
  const { json } = await call(d, "/proxies/stats", timeoutMs);
  return ((json as Raw[]) ?? []).map((p) => ({
    id: num(p.id),
    name: String(p.name ?? ""),
    url: String(p.url ?? ""),
    providers: ((p.provider_status as Raw[]) ?? []).map(
      (s): ProxyProviderStatus => ({
        provider: String(s.provider ?? ""),
        good: !!s.good,
        lastStatus: String(s.last_status ?? ""),
        lastSuccess: num(s.last_success) || undefined,
      }),
    ),
  }));
}

/**
 * Parses pasted proxies, one per line, in the formats the admin accepts:
 * host:port, host:port:user:password, user:password@host:port (an http:// or
 * https:// prefix is allowed). Bad lines are reported, not guessed at.
 */
export function parseProxyLines(text: string) {
  const ok: { url: string; endpoint: string; user: string }[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/^https?:\/\//i, "");
    if (!line || line.startsWith("#")) return;
    let host = "";
    let port = "";
    let user = "";
    let pass = "";
    let m = /^([^:@\s]+):([^@\s]+)@([^:@\s]+):(\d{1,5})$/.exec(line);
    if (m) [, user, pass, host, port] = m;
    else if ((m = /^([^:@\s]+):(\d{1,5}):([^:\s]+):(\S+)$/.exec(line))) [, host, port, user, pass] = m;
    else if ((m = /^([^:@\s]+):(\d{1,5})$/.exec(line))) [, host, port] = m;
    if (!host || !port || Number(port) > 65535) {
      bad.push(i + 1);
      return;
    }
    const auth = user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : "";
    ok.push({ url: `http://${auth}${host}:${port}`, endpoint: `${host}:${port}`, user });
  });
  return { ok, bad };
}

/** Creates proxies in one Dragonite (POST /proxies/bulk, as the admin's import). */
export async function createProxies(d: DragoniteConfig, list: { name: string; url: string; enabled: boolean }[], timeoutMs: number) {
  await call(d, "/proxies/bulk", timeoutMs, {
    method: "POST",
    body: { proxies: list.map((p, index) => ({ index, ...p })) },
    json: false,
  });
}

/** Creates one proxy with its name (POST /proxies/, as the admin's "Create" form). */
export async function createProxy(d: DragoniteConfig, p: { name: string; url: string; enabled: boolean }, timeoutMs: number) {
  await call(d, "/proxies/", timeoutMs, { method: "POST", body: p, json: false });
}

export async function setProxyEnabled(d: DragoniteConfig, id: number, enabled: boolean, timeoutMs: number) {
  await call(d, `/proxies/${id}`, timeoutMs, { method: "PATCH", body: { enabled }, json: false });
}

export async function deleteProxy(d: DragoniteConfig, id: number, timeoutMs: number) {
  await call(d, `/proxies/${id}`, timeoutMs, { method: "DELETE", json: false });
}

/** Makes Dragonite pick up proxy changes (the admin's "Reload Proxies"). */
export async function reloadProxies(d: DragoniteConfig, timeoutMs: number) {
  await call(d, "/reload/proxy", timeoutMs, { method: "GET", json: false });
}

// ---- Unbound modes (the admin's Level, Invasion and Scout Mode pages) ----

export const MODE_TYPES = ["level", "invasion", "scout"] as const;
export type ModeType = (typeof MODE_TYPES)[number];

export interface RoutePoint {
  lat: number;
  lon: number;
}

/** A mode of one type, with its live workers from /status (matched by name). */
export interface UnboundMode {
  type: ModeType;
  id: number;
  name: string;
  workers: number;
  /** Level mode only: how many points its route has. */
  routePoints?: number;
  live?: LiveGroup;
}

async function modesOf(d: DragoniteConfig, type: ModeType, timeoutMs: number) {
  const out: Raw[] = [];
  for (let page = 0; page < 20; page++) {
    const { json } = await call(d, `/modes/${type}/?page=${page}&perPage=500&sortBy=id&order=ASC`, timeoutMs);
    const j = obj(json);
    out.push(...((j.data as Raw[]) ?? []));
    if (!obj(j.pagination).hasNext) break;
  }
  return out;
}

/** Every unbound mode of one Dragonite, plus the scout queue. */
export async function unboundModes(d: DragoniteConfig, timeoutMs: number) {
  const [lists, status, scout] = await Promise.all([
    Promise.all(MODE_TYPES.map((t) => modesOf(d, t, timeoutMs))),
    call(d, "/status", timeoutMs),
    call(d, "/modes/scout/stats", timeoutMs).catch(() => ({ json: [] as unknown })),
  ]);
  const live = ((obj(status.json).unbounds as Raw[]) ?? []).map((u) => ({ name: String(u.name ?? ""), group: liveGroup([u]) }));
  // Same name in two types: tell them apart by the mode their workers run (e.g. "InvasionMode").
  const liveFor = (type: ModeType, name: string) => {
    const same = live.filter((u) => u.name === name);
    if (same.length < 2) return same[0]?.group;
    return same.find((u) => u.group.workers.some((w) => w.mode.toLowerCase().startsWith(type)))?.group ?? same[0].group;
  };
  const modes: UnboundMode[] = MODE_TYPES.flatMap((type, i) =>
    lists[i].map((m) => ({
      type,
      id: num(m.id),
      name: String(m.name ?? ""),
      workers: num(m.workers),
      routePoints: type === "level" ? len(m.route) : undefined,
      live: liveFor(type, String(m.name ?? "")),
    })),
  );
  const jobs = Array.isArray(scout.json) ? (scout.json as Raw[]) : [];
  const scoutQueue = {
    total: jobs.length,
    fulfilled: jobs.filter((j) => num(j.fulfilled) > 0).length,
    failed: jobs.filter((j) => num(j.fulfilled) === -1).length,
    pending: jobs.filter((j) => !num(j.fulfilled)).length,
  };
  return { modes, scoutQueue };
}

/** One mode as Dragonite has it, route included (to edit or copy it). */
export async function getMode(d: DragoniteConfig, type: ModeType, id: number, timeoutMs: number) {
  const { json } = await call(d, `/modes/${type}/${id}`, timeoutMs);
  const m = obj(json);
  const route = Array.isArray(m.route) ? (m.route as Raw[]).map((p) => ({ lat: num(p.lat), lon: num(p.lon) })) : undefined;
  return { id: num(m.id), name: String(m.name ?? ""), workers: num(m.workers), route };
}

export interface ModeInput {
  name?: string;
  workers?: number;
  route?: RoutePoint[];
}

/** POST /modes/{type}/, as the admin's "Create". */
export async function createMode(d: DragoniteConfig, type: ModeType, m: ModeInput, timeoutMs: number) {
  const body = type === "level" ? { route: [], ...m } : { name: m.name, workers: m.workers };
  await call(d, `/modes/${type}/`, timeoutMs, { method: "POST", body, json: false });
}

/**
 * PATCH /modes/{type}/{id}. Dragonite replaces the whole mode (a field left out
 * comes back empty, a level route included), so the current one is read first
 * and the changes merged into it.
 */
export async function updateMode(d: DragoniteConfig, type: ModeType, id: number, m: ModeInput, timeoutMs: number) {
  const cur = await getMode(d, type, id, timeoutMs);
  const body =
    type === "level"
      ? { name: m.name ?? cur.name, workers: m.workers ?? cur.workers, route: m.route ?? cur.route ?? [] }
      : { name: m.name ?? cur.name, workers: m.workers ?? cur.workers };
  await call(d, `/modes/${type}/${id}`, timeoutMs, { method: "PATCH", body, json: false });
}

export async function deleteMode(d: DragoniteConfig, type: ModeType, id: number, timeoutMs: number) {
  await call(d, `/modes/${type}/${id}`, timeoutMs, { method: "DELETE", json: false });
}

/** The scout queue itself (the admin's Scout Mode map and table), newest first. */
export async function scoutJobs(d: DragoniteConfig, timeoutMs: number) {
  const { json } = await call(d, "/modes/scout/stats", timeoutMs);
  const jobs = (Array.isArray(json) ? (json as Raw[]) : []).map((j) => ({
    id: num(j.id),
    lat: num(j.lat),
    lon: num(j.lon),
    /** Unix seconds. */
    requested: num(j.requested),
    /** Unix seconds; 0 while pending, -1 when it failed. */
    fulfilled: num(j.fulfilled),
    account: String(j.username ?? ""),
  }));
  return jobs.sort((a, b) => b.requested - a.requested);
}

/**
 * Accounts levelling up now (the admin's Level Mode table): level, xp and time
 * as {start, last}, plus `stats`, more {start, last} counters (the admin's
 * per-minute table); anything else Dragonite adds comes along as plain values.
 */
export async function levelStats(d: DragoniteConfig, timeoutMs: number) {
  const { json } = await call(d, "/modes/level/stats", timeoutMs);
  const span = (v: unknown) => ({ start: num(obj(v).start), last: num(obj(v).last) });
  return (Array.isArray(json) ? (json as Raw[]) : []).map((r) => {
    const extra: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(r)) {
      if (["account_name", "status", "level", "xp", "time", "stats", "error"].includes(k) || /pass|token|secret/i.test(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") extra[k] = v;
    }
    return {
      account: String(r.account_name ?? ""),
      status: String(r.status ?? ""),
      level: span(r.level),
      xp: span(r.xp),
      /** Unix seconds. */
      time: span(r.time),
      error: r.error ? String(r.error) : undefined,
      stats: Object.fromEntries(
        Object.entries(obj(r.stats))
          .filter(([k, v]) => v && typeof v === "object" && !/pass|token|secret/i.test(k))
          .map(([k, v]) => [k, span(v)]),
      ),
      extra,
    };
  });
}

/** Empties the scout queue (the admin's "Clear Scout Queue"). */
export async function clearScoutQueue(d: DragoniteConfig, timeoutMs: number) {
  await call(d, "/scout/clear", timeoutMs, { method: "GET", json: false });
}

// ---- Scheduler (the admin's Schedules, Groups and Run Ledger pages) ----

/** A Dragonite answer that is not a 2xx: its status and Huma's readable detail. */
export class DragoniteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * One scheduler call, any method. Errors come as Huma ErrorModel
 * ({title, detail, errors:[{location, message}]}): joined into one line.
 */
export async function schedulerCall(d: DragoniteConfig, method: "GET" | "POST" | "PUT" | "DELETE", path: string, timeoutMs: number, body?: unknown) {
  if (!d.api) throw new DragoniteError(`${d.name}: missing url in its [stack.dragonite]`, 404);
  const res = await fetch(`${d.api.url}${path}`, {
    method,
    headers: body !== undefined ? { ...d.api.headers, "Content-Type": "application/json", Accept: "application/json" } : { ...d.api.headers, Accept: "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) {
    throw new DragoniteError(`${d.name}: the API requires authentication (HTTP ${res.status}); check api_secret or basic_auth`, 502);
  }
  const text = await res.text().catch(() => "");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const e = obj(json);
    const parts = [String(e.detail ?? e.title ?? "")].filter(Boolean);
    for (const x of (e.errors as Raw[]) ?? []) parts.push([x.location, x.message].filter(Boolean).join(": "));
    const msg = parts.join(" — ") || (text.startsWith("<") ? "" : text.slice(0, 200).replace(/\s+/g, " "));
    throw new DragoniteError(`${d.name}: ${msg || `HTTP ${res.status}`}`, res.status);
  }
  return json;
}

/** The admin's top-right controls, one Dragonite at a time. */
export const DRAGONITE_CONTROLS = {
  "pause-limit": "pause the global rate limit",
  "reset-limit": "reset the global rate limit",
  "reload-proxies": "reload proxies",
  "reload-accounts": "reload accounts",
  "reload-dragonite": "reload Dragonite",
} as const;
export type DragoniteControl = keyof typeof DRAGONITE_CONTROLS;

export async function dragoniteControl(d: DragoniteConfig, action: DragoniteControl, timeoutMs: number, seconds?: number) {
  const path =
    action === "pause-limit"
      ? `/global-rate-limit/pause?seconds=${seconds}`
      : action === "reset-limit"
        ? "/global-rate-limit/reset"
        : action === "reload-proxies"
          ? "/reload/proxy"
          : action === "reload-accounts"
            ? "/reload/accounts"
            : "/reload";
  await call(d, path, timeoutMs, { method: "GET", json: false });
}

/** Makes Dragonite reload its configuration (the admin's "Reload Dragonite"). */
export async function reloadDragonite(d: DragoniteConfig, timeoutMs: number) {
  await call(d, "/reload", timeoutMs, { method: "GET", json: false });
}

// ---- Status (what the admin's dashboard sidebar and banners show) ----

export interface RateLimit {
  allowedPerSecond: number;
  /** 1 = at its base rate; lower = Dragonite slowed itself down. */
  ratio: number;
  /** Unix seconds. */
  lastDecreaseAt?: number;
  lastDecreaseReason: string;
  lastRecoveryAt?: number;
  waiters: number;
  pauseSecondsRemaining?: number;
}

export async function rateLimit(d: DragoniteConfig, timeoutMs: number): Promise<RateLimit> {
  const { json } = await call(d, "/global-rate-limit", timeoutMs);
  const r = obj(json);
  return {
    allowedPerSecond: num(r.allowed_per_second),
    ratio: r.ratio_from_base_rate == null ? 1 : num(r.ratio_from_base_rate),
    lastDecreaseAt: num(r.last_decrease_at) || undefined,
    lastDecreaseReason: String(r.last_decrease_reason ?? ""),
    lastRecoveryAt: num(r.last_recovery_at) || undefined,
    waiters: num(r.waiters),
    pauseSecondsRemaining: num(r.pause_seconds_remaining) || undefined,
  };
}

/** Version, build and whether a Kōji is configured (GET /config/). */
export async function instanceConfig(d: DragoniteConfig, timeoutMs: number) {
  const { json } = await call(d, "/config/", timeoutMs);
  const c = obj(json);
  return { version: String(c.version ?? ""), gitSha: c.git_sha ? String(c.git_sha) : undefined, hasKoji: !!c.has_koji, instance: String(c.instance ?? "") };
}
