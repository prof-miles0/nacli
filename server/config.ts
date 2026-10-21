import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "smol-toml";

export interface UserConfig {
  username: string;
  password: string;
}

export interface RotomInstanceConfig {
  /** Stable id used in URLs, derived from the name. */
  id: string;
  name: string;
  url: string;
  apiSecret?: string;
  headers: Record<string, string>;
  /** True for `demo://` urls: synthetic data, no network. */
  demo: boolean;
  /** Value of the VictoriaMetrics instance label for this RotomNG. */
  vmInstance: string;
}

export interface DragoniteConfig {
  /** Stable id used in URLs, derived from the name. */
  id: string;
  name: string;
  /** Value of the VictoriaMetrics instance label for this Dragonite. */
  vmInstance: string;
  /** Id of the RotomNG of its own [[stack]], which it sends its controllers to. */
  rotom?: string;
  /**
   * Its HTTP API, for the accounts page: either Dragonite itself
   * (http://host:7272) or its admin plus "/api", which forwards the same paths.
   */
  api?: { url: string; headers: Record<string, string> };
}

export interface VictoriaMetricsConfig {
  url: string;
  headers: Record<string, string>;
  /** Label that identifies each RotomNG in the scraped series. */
  instanceLabel: string;
  /** Extra selector applied to every query, e.g. `job="unown"`. */
  selector: string;
  /**
   * Set instead of a real url when the queries are answered from memory
   * (local-metrics.ts), with VictoriaMetrics' JSON shapes.
   */
  local?: {
    query(q: string, tMs?: number): unknown;
    queryRange(q: string, startMs: number, endMs: number, stepMs: number): unknown;
    labelValues(label: string, match: string): string[];
  };
}

export interface AppConfig {
  path: string;
  title: string;
  host: string;
  port: number;
  sessionSecret: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  historyRetentionMs: number;
  /** When set, chart history comes from VictoriaMetrics instead of memory. */
  victoriaMetrics?: VictoriaMetricsConfig;
  /**
   * Golbat section: charts from VictoriaMetrics (`selector`) and, with `url`,
   * its API (device locations for the Dashboard map).
   */
  golbat?: {
    /** Its `instance` label in VictoriaMetrics, for the stored charts ("" = any). */
    vmInstance: string;
    /** PromQL matcher built from vmInstance and [victoriametrics] instance_label. */
    selector: string;
    /** Its API (url + api_secret): device locations and queries. */
    api?: { url: string; headers: Record<string, string> };
  };
  /** Basemap for the Dashboard map ([map]); sent to the browser, which draws it. */
  map?: { styleUrl?: string; styleUrlDark?: string; tilesUrl?: string; cartoKey?: string; attribution: string };
  /** Dragonite section (charts from VictoriaMetrics), one per [[stack]] with [stack.dragonite]. */
  dragonite: DragoniteConfig[];
  users: UserConfig[];
  instances: RotomInstanceConfig[];
}

const DURATION_RE = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: unknown, fallback: number): number {
  if (typeof value === "number") return value * 1000;
  if (typeof value !== "string" || value.trim() === "") return fallback;
  let total = 0;
  let matched = "";
  for (const m of value.matchAll(DURATION_RE)) {
    total += Number(m[1]) * UNIT_MS[m[2]];
    matched += m[0];
  }
  if (matched !== value.replace(/\s+/g, "")) {
    throw new Error(`invalid duration: "${value}" (use e.g. "10s", "5m", "24h")`);
  }
  return total;
}

function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rotom"
  );
}

// Generated once per process so a config without session_secret keeps
// sessions valid across reloads (but not restarts).
const fallbackSecret = randomBytes(32).toString("hex");

type Table = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

export function loadConfig(path: string): AppConfig {
  const abs = resolve(path);
  const raw = parse(readFileSync(abs, "utf8")) as Table;

  const server = (raw.server ?? {}) as Table;
  const listen = str(server.listen, "0.0.0.0:7080");
  const lastColon = listen.lastIndexOf(":");
  const host = lastColon > 0 ? listen.slice(0, lastColon) : "0.0.0.0";
  const port = Number(lastColon >= 0 ? listen.slice(lastColon + 1) : listen);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid server.listen: "${listen}"`);
  }

  const users = ((raw.users ?? []) as Table[]).map((u, i) => {
    const username = str(u.username).trim();
    const password = str(u.password);
    if (!username || !password) {
      throw new Error(`[[users]] #${i + 1}: username and password are required`);
    }
    return { username, password };
  });
  if (users.length === 0) {
    throw new Error("config.toml: define at least one [[users]] with username and password");
  }

  // [[stack]] groups one deployment: its name, its RotomNG and its Dragonite.
  const stacks = ((raw.stack ?? []) as Table[]).map((st, i) => {
    const name = str(st.name).trim();
    if (!name) throw new Error(`[[stack]] #${i + 1}: missing name`);
    const rotom = st.rotom as Table | undefined;
    const dragonite = st.dragonite as Table | undefined;
    if (!rotom && !dragonite) throw new Error(`[[stack]] "${name}": add [stack.rotom] and/or [stack.dragonite]`);
    return { name, rotom, dragonite };
  });
  const rotomRaw = stacks.filter((st) => st.rotom).map((st) => ({ ...st.rotom, name: st.name }) as Table);

  const seen = new Set<string>();
  const instances = rotomRaw.map((r, i) => {
    const url = str(r.url).trim().replace(/\/+$/, "").replace(/\/api$/, "");
    if (!url) throw new Error(`[stack.rotom] of "${str(r.name)}": missing url`);
    const demo = url.startsWith("demo://");
    if (!demo && !/^https?:\/\//.test(url)) {
      throw new Error(`[stack.rotom] of "${str(r.name)}": url must start with http://, https:// or demo://`);
    }
    const name = str(r.name).trim() || url.replace(/^\w+:\/\//, "");
    let id = slugify(name);
    for (let n = 2; seen.has(id); n++) id = `${slugify(name)}-${n}`;
    seen.add(id);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((r.headers ?? {}) as Table)) {
      headers[k] = String(v);
    }
    const basic = r.basic_auth as Table | undefined;
    if (basic?.username) {
      headers.Authorization = `Basic ${Buffer.from(
        `${str(basic.username)}:${str(basic.password)}`,
      ).toString("base64")}`;
    }
    const apiSecret = str(r.api_secret) || undefined;
    // Its `instance` label in VictoriaMetrics. Required: guessing it from the
    // url breaks as soon as the url is an IP or goes through another proxy.
    const vmInstance = str(r.vm_instance).trim();
    if (!vmInstance && !demo) throw new Error(`[stack.rotom] of "${name}": missing vm_instance (its instance label in VictoriaMetrics)`);
    return { id, name, url, apiSecret, headers, demo, vmInstance };
  });

  const vm = parseVm(raw.victoriametrics as Table | undefined);
  return {
    path: abs,
    title: str(server.title, "Nacli"),
    host,
    port,
    sessionSecret: str(server.session_secret) || fallbackSecret,
    sessionTtlMs: parseDuration(server.session_ttl, 24 * 3_600_000),
    secureCookies: server.secure_cookies === true,
    pollIntervalMs: Math.max(2000, parseDuration(server.poll_interval, 10_000)),
    requestTimeoutMs: parseDuration(server.request_timeout, 8000),
    historyRetentionMs: parseDuration(server.history_retention, 24 * 3_600_000),
    victoriaMetrics: vm,
    golbat: raw.golbat ? parseGolbat(raw.golbat as Table, vm) : undefined,
    map: raw.map ? parseMap(raw.map as Table) : undefined,
    dragonite: parseDragonite(stacks, instances),
    users,
    instances,
  };
}

function parseDragonite(
  stacks: { name: string; rotom?: Table; dragonite?: Table }[],
  rotoms: RotomInstanceConfig[],
): DragoniteConfig[] {
  const seen = new Set<string>();
  return stacks
    .filter((st) => st.dragonite)
    .map(({ name, rotom, dragonite }) => {
      const d = dragonite!;
      let id = slugify(name);
      for (let n = 2; seen.has(id); n++) id = `${slugify(name)}-${n}`;
      seen.add(id);
      const url = str(d.url).trim().replace(/\/+$/, "");
      if (url && !/^https?:\/\//.test(url)) throw new Error(`[stack.dragonite] of "${name}": url must start with http:// or https://`);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((d.headers ?? {}) as Table)) headers[k] = String(v);
      if (str(d.api_secret)) headers["X-Dragonite-Admin-Secret"] = str(d.api_secret);
      const basic = d.basic_auth as Table | undefined;
      if (basic?.username) {
        headers.Authorization = `Basic ${Buffer.from(`${str(basic.username)}:${str(basic.password)}`).toString("base64")}`;
      }
      return {
        id,
        name,
        vmInstance: str(d.vm_instance).trim() || id,
        // It feeds the Rotom of its own stack.
        rotom: rotom ? rotoms.find((r) => r.name === name)?.id : undefined,
        api: url ? { url, headers } : undefined,
      };
    });
}

function parseMap(m: Table) {
  const styleUrl = str(m.style_url).trim() || undefined;
  const styleUrlDark = str(m.style_url_dark).trim() || undefined;
  const tilesUrl = str(m.tiles_url).trim() || undefined;
  for (const [k, v] of [["style_url", styleUrl], ["style_url_dark", styleUrlDark], ["tiles_url", tilesUrl]] as const) {
    if (v && !/^https?:\/\//.test(v)) throw new Error(`[map] ${k} must start with http:// or https://`);
  }
  if (!styleUrl && !tilesUrl) throw new Error("[map]: set style_url or tiles_url");
  return {
    styleUrl,
    styleUrlDark,
    tilesUrl,
    cartoKey: str(m.carto_key).trim() || undefined,
    attribution: str(m.tiles_attribution),
  };
}

function parseGolbat(g: Table, vm?: VictoriaMetricsConfig) {
  const url = str(g.url).trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//.test(url)) throw new Error("[golbat] url must start with http:// or https://");
  const headers: Record<string, string> = {};
  // Golbat checks its api_secret in this header.
  if (str(g.api_secret)) headers["X-Golbat-Secret"] = str(g.api_secret);
  const vmInstance = str(g.vm_instance).trim();
  const label = vm?.instanceLabel ?? "instance";
  const selector = vmInstance ? `${label}="${vmInstance.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";
  return { vmInstance, selector, api: url ? { url, headers } : undefined };
}

function parseVm(vm: Table | undefined): VictoriaMetricsConfig | undefined {
  const url = str(vm?.url).trim().replace(/\/+$/, "");
  if (!vm || !url) return undefined;
  if (!/^https?:\/\//.test(url)) throw new Error("[victoriametrics] url must start with http:// or https://");
  const headers: Record<string, string> = {};
  if (vm.username) {
    headers.Authorization = `Basic ${Buffer.from(`${str(vm.username)}:${str(vm.password)}`).toString("base64")}`;
  }
  if (vm.bearer_token) headers.Authorization = `Bearer ${str(vm.bearer_token)}`;
  return {
    url,
    headers,
    instanceLabel: str(vm.instance_label, "instance"),
    selector: str(vm.selector),
  };
}
