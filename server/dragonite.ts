// Dragonite charts, ported from its Grafana dashboard ("Dragonite" export) and
// run against the same Zapdos. Each [stack.dragonite] in config.toml is
// one scrape target (its `instance` label) and may name the RotomNG it feeds.

import type { DragoniteConfig, ZapdosConfig } from "./config.ts";
import { anyOf, type PanelDef, vmLabelValues, vmPost, vmScalars } from "./vmpanels.ts";

/** Share of each label value in the interval, as a percentage of the total. */
const share = (metric: string, by: string) =>
  `100 * sum by (${by}) (increase(${metric}{$sel}[$inter])) / scalar(sum(increase(${metric}{$sel}[$inter])))`;

/** Mean seconds per handled location of one job: total time / locations. */
const handled = (job: string, sel = "$sel") =>
  `sum(rate(dragonite_location_handled_sum{${sel},exported_job="${job}"}[$inter])) / ` +
  `sum(rate(dragonite_location_handled_counter{${sel},exported_job="${job}"}[$inter]))`;

const count = (metric: string, by: string) => `sum by (${by}) (increase(${metric}{$sel}[$inter]))`;

export const DRAGONITE_PANELS: PanelDef[] = [
  {
    id: "locations",
    row: "Scanning",
    title: "Locations handled",
    areaAware: true,
    kind: "line",
    stacked: true,
    queries: [
      { legend: "Pokémon", expr: `sum(increase(dragonite_location_handled_counter{$sel,exported_job="pokemon"}[$inter]))` },
      { legend: "Forts", expr: `sum(increase(dragonite_location_handled_counter{$sel,exported_job="fort"}[$inter]))` },
      { legend: "Quests", expr: `sum(increase(dragonite_location_handled_counter{$sel,exported_job="quest"}[$inter]))` },
      { legend: "Scout", expr: `sum(increase(dragonite_location_handled_counter{$base,exported_job="scout"}[$inter]))` },
    ],
  },
  {
    id: "location-time",
    row: "Scanning",
    title: "Time per location",
    areaAware: true,
    kind: "line",
    unit: "seconds",
    queries: [
      { legend: "Pokémon", expr: handled("pokemon") },
      { legend: "Forts", expr: handled("fort") },
      { legend: "Quests", expr: handled("quest") },
      // Scout locations carry area="scout", so the area filter never applies to them.
      { legend: "Scout", expr: handled("scout", "$base") },
    ],
  },
  {
    id: "rpc",
    row: "Scanning",
    title: "RPC responses",
    areaAware: false,
    kind: "bars",
    stacked: true,
    unit: "percent",
    queries: [{ legend: "{{status}}", expr: share("dragonite_rpc_response", "status") }],
  },
  {
    id: "gmo",
    row: "Scanning",
    title: "GMO results",
    areaAware: false,
    kind: "bars",
    stacked: true,
    unit: "percent",
    queries: [{ legend: "{{status}}", expr: share("dragonite_gmo_hits", "status") }],
  },
  {
    id: "gmo-tries",
    row: "Scanning",
    title: "Retries until a successful GMO",
    areaAware: true,
    areaLabel: "area_name",
    kind: "bars",
    stacked: true,
    unit: "percent",
    queries: [{ legend: "{{tries}} retries", expr: share("dragonite_gmo_success_tries", "tries") }],
  },
  {
    id: "quest-time",
    row: "Scanning",
    title: "Quest time per area",
    areaAware: true,
    kind: "line",
    unit: "seconds",
    queries: [
      {
        legend: "{{area}}",
        expr:
          `sum by (area) (rate(dragonite_location_handled_sum{$sel,exported_job="quest"}[$inter])) / ` +
          `sum by (area) (rate(dragonite_location_handled_counter{$sel,exported_job="quest"}[$inter]))`,
      },
    ],
  },
  {
    id: "accounts",
    row: "Accounts",
    title: "Account status",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{status}}", expr: count("dragonite_account_status", "status") }],
  },
  {
    id: "ws",
    row: "Accounts",
    title: "Rotom connection closes",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{status|status_code}}", expr: count("dragonite_ws_status", "status, status_code") }],
  },
  {
    id: "auth-ptc",
    row: "Accounts",
    title: "Login PTC",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{status}}", expr: count("dragonite_auth_ptc", "status") }],
  },
  {
    id: "auth-nia",
    row: "Accounts",
    title: "NIA authentication",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{mitm_status}}", expr: count("dragonite_auth_nia", "mitm_status") }],
  },
  {
    id: "invasions",
    row: "Invasions",
    title: "Invasion status",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{status}}", expr: count("dragonite_invasions_status", "status") }],
  },
  {
    id: "invasion-types",
    row: "Invasions",
    title: "Confirmed invasions by type",
    areaAware: false,
    kind: "line",
    queries: [
      // "*_confirmed" duplicates the plain type (e.g. giovanni_confirmed = giovanni).
      { legend: "{{type}}", expr: `sum by (type) (increase(dragonite_invasions_confirmed_types{$sel,type!~".*_confirmed"}[$inter]))` },
    ],
  },
  {
    id: "invasion-time-left",
    row: "Invasions",
    title: "Time left when confirmed",
    areaAware: false,
    kind: "line",
    unit: "minutes",
    queries: [
      {
        legend: "{{type}}",
        expr:
          `sum by (type) (rate(dragonite_invasions_time_left{$sel}[$inter])) / ` +
          `sum by (type) (rate(dragonite_invasions_confirmed_types{$sel}[$inter]))`,
      },
    ],
  },
  {
    id: "queues",
    row: "Queues and forts",
    title: "Queues",
    areaAware: false,
    kind: "line",
    queries: [
      { legend: "Scout", expr: `sum(avg_over_time(dragonite_scout_queue_size{$sel}[$inter]))` },
      { legend: "Invasions", expr: `sum(avg_over_time(dragonite_invasions_queue_size{$sel}[$inter]))` },
      { legend: "Rare Pokémon", expr: `sum(avg_over_time(dragonite_rare_pokemon_queue_size{$sel}[$inter]))` },
      { legend: "Pending ARBAN", expr: `sum(avg_over_time(dragonite_arban_pending_size{$sel}[$inter]))` },
      { legend: "Waiting on global limit", expr: `sum(avg_over_time(dragonite_global_rate_limit_waiters{$sel}[$inter]))` },
    ],
  },
  {
    id: "forts",
    row: "Queues and forts",
    title: "Fort inspections",
    areaAware: true,
    kind: "bars",
    stacked: true,
    queries: [{ legend: "{{fort_type}} · {{reason}}", expr: count("dragonite_fort_inspections", "fort_type, reason") }],
  },
];

export const DRAGONITE_ROWS = ["Scanning", "Accounts", "Invasions", "Queues and forts"];

/** Base selector for the chosen Dragonites (all configured ones when none is chosen). */
export function dragoniteBase(all: DragoniteConfig[], ids: string[]): string {
  const chosen = ids.length ? all.filter((d) => ids.includes(d.id)) : all;
  return anyOf("instance", chosen.map((d) => d.zapdosInstance));
}

/** Areas seen in the series of the given Dragonites (all of them when `ids` is empty). */
export async function dragoniteAreas(vm: ZapdosConfig, all: DragoniteConfig[], timeoutMs: number, ids: string[] = []) {
  const areas = await vmLabelValues(vm, "area", `dragonite_location_handled_counter{${dragoniteBase(all, ids)}}`, timeoutMs);
  return areas.filter((a) => a && a !== "scout").sort((a, b) => a.localeCompare(b, "en"));
}

export interface DragoniteStats {
  id: string;
  version?: string;
  /** Seconds since its metrics were last scraped. */
  lastSeenS?: number;
  /** Last-hour figures. */
  locations: number;
  locationSeconds?: number;
  rpcOkPct?: number;
  gmoOkPct?: number;
  accountsOk: number;
  accountsLimited: number;
  /** Connections Rotom closed because it had no free worker. */
  noWorkers: number;
  invasions: number;
}

/** One instant query per figure, each `by (instance)` across all Dragonites. */
export async function dragoniteStats(
  vm: ZapdosConfig,
  all: DragoniteConfig[],
  timeoutMs: number,
): Promise<DragoniteStats[]> {
  const s = dragoniteBase(all, []);
  const inc = (metric: string, extra = "") => `sum by (instance) (increase(${metric}{${s}${extra}}[1h]))`;
  const pct = (metric: string) =>
    `100 * ${inc(metric, ',status="Success"')} / ${inc(metric)}`;
  const queries = {
    lastSeenS: `time() - max by (instance) (timestamp(dragonite_build_info{${s}}))`,
    locations: inc("dragonite_location_handled_counter", ',exported_job="pokemon"'),
    locationSeconds:
      `sum by (instance) (rate(dragonite_location_handled_sum{${s},exported_job="pokemon"}[1h])) / ` +
      `sum by (instance) (rate(dragonite_location_handled_counter{${s},exported_job="pokemon"}[1h]))`,
    rpcOkPct: pct("dragonite_rpc_response"),
    gmoOkPct: pct("dragonite_gmo_hits"),
    accountsOk: inc("dragonite_account_status", ',status="Success"'),
    accountsLimited: inc("dragonite_account_status", ',status="LimitReached"'),
    noWorkers: inc("dragonite_ws_status", ',status="no workers available"'),
    invasions: inc("dragonite_invasions_status", ',status="confirmed"'),
  };
  const [versions, ...values] = await Promise.all([
    versionsOf(vm, s, timeoutMs),
    ...Object.values(queries).map((q) => vmScalars(vm, q, "instance", timeoutMs)),
  ]);
  const keys = Object.keys(queries) as (keyof typeof queries)[];
  return all.map((d) => {
    const get = (k: keyof typeof queries) => values[keys.indexOf(k)].get(d.zapdosInstance);
    return {
      id: d.id,
      version: versions.get(d.zapdosInstance),
      lastSeenS: get("lastSeenS"),
      locations: get("locations") ?? 0,
      locationSeconds: get("locationSeconds"),
      rpcOkPct: get("rpcOkPct"),
      gmoOkPct: get("gmoOkPct"),
      accountsOk: get("accountsOk") ?? 0,
      accountsLimited: get("accountsLimited") ?? 0,
      noWorkers: get("noWorkers") ?? 0,
      invasions: get("invasions") ?? 0,
    };
  });
}

/** Version per instance, read from the `version` label of dragonite_build_info. */
async function versionsOf(vm: ZapdosConfig, sel: string, timeoutMs: number) {
  const json = await vmPost(vm, "/api/v1/query", { query: `dragonite_build_info{${sel}}` }, timeoutMs);
  return new Map((json.data?.result ?? []).map((r) => [r.metric.instance ?? "", r.metric.version ?? ""] as const));
}

/**
 * Which Dragonite a Rotom controller belongs to, from its user agent, e.g.
 * "Dragonite/1.20.16-testing (Dragonite - Exeggcute)" → "Dragonite - Exeggcute".
 */
export function controllerSource(userAgent: string | undefined): string | undefined {
  if (!userAgent?.startsWith("Dragonite/")) return undefined;
  return userAgent.match(/\(([^)]+)\)/)?.[1]?.trim() || "Dragonite";
}

/** Does a controller's source name (from its user agent) refer to this Dragonite? */
export function sourceMatches(source: string, d: DragoniteConfig, instance?: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/^dragonite\s*-\s*/, "").trim();
  // The name Dragonite reports itself (its config's `instance`), when its API is
  // configured; otherwise the stack's own name.
  if (instance) return norm(source) === norm(instance);
  return norm(source) === norm(d.name) || norm(source) === d.id;
}
