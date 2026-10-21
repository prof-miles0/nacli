// Golbat charts, ported from its Grafana dashboard ("Golbat" export) and run
// against the same VictoriaMetrics the RotomNG charts use. Panels are defined
// here, not sent by the browser, so the page can only run these queries.

import type { VictoriaMetricsConfig } from "./config.ts";
import { type PanelDef, type PanelData, runPanel, vmLabelValues, vmPost } from "./vmpanels.ts";

export interface GolbatConfig {
  /** Extra label matcher for every Golbat series, e.g. `instance="golbat"`. */
  selector: string;
}

// Titles say what is counted; "/ interval" because values are per $inter, as in Grafana.
export const GOLBAT_PANELS: PanelDef[] = [
  {
    id: "ttl",
    row: "Basic",
    title: "Verified Pokémon TTL and resets",
    areaAware: true,
    kind: "line",
    unit: "minutes",
    queries: [
      {
        legend: "TTL",
        expr: `avg(avg(increase(golbat_verified_pokemon_ttl{$sel,type="encounter",above30="0"}[$inter]), increase(golbat_verified_pokemon_ttl{$sel,type="encounter",above30="1"}[$inter])) / avg(increase(golbat_verified_pokemon_ttl_counter{$sel,type="encounter",above30="0"}[$inter]), increase(golbat_verified_pokemon_ttl_counter{$sel,type="encounter",above30="1"}[$inter])))`,
      },
      {
        legend: "TTL 30m",
        expr: `avg(increase(golbat_verified_pokemon_ttl{$sel,type="encounter",above30="0"}[$inter]) / increase(golbat_verified_pokemon_ttl_counter{$sel,type="encounter",above30="0"}[$inter]))`,
      },
      {
        legend: "TTL 60m",
        expr: `avg(increase(golbat_verified_pokemon_ttl{$sel,type="encounter",above30="1"}[$inter]) / increase(golbat_verified_pokemon_ttl_counter{$sel,type="encounter",above30="1"}[$inter]))`,
      },
      // As in Grafana: a count, not minutes, so it gets its own axis on the right.
      { legend: "Resets", axis: "right", expr: `sum(increase(golbat_pokemon_stats_reset_count{$sel}[$inter]))` },
    ],
  },
  {
    id: "perfect",
    row: "Basic",
    title: "Perfect Pokémon",
    areaAware: true,
    kind: "line",
    queries: [
      { legend: "100 %", expr: `sum(increase(golbat_pokemon_count_hundo{$sel}[$inter]))` },
      { legend: "0 %", expr: `sum(increase(golbat_pokemon_count_nundo{$sel}[$inter]))` },
    ],
  },
  {
    id: "raids-rate",
    row: "Basic",
    title: "Raids by level",
    areaAware: true,
    kind: "bars",
    stacked: true,
    queries: [{ legend: "Level {{level}}", expr: `sum by (level) (increase(golbat_raid_count{$sel}[$inter]))` }],
  },
  {
    id: "pokemon",
    row: "Details",
    title: "Pokémon",
    areaAware: true,
    kind: "line",
    queries: [
      { legend: "New", expr: `sum(increase(golbat_pokemon_count_new{$sel}[$inter]))` },
      { legend: "With IV", expr: `sum(increase(golbat_pokemon_count_iv{$sel}[$inter]))` },
    ],
  },
  {
    id: "decodes",
    row: "Details",
    title: "Decodes by type",
    areaAware: false,
    kind: "line",
    queries: [
      { legend: "Encounter ({{status}})", expr: `sum by (status) (increase(golbat_decode_encounter{$sel}[$inter]))` },
      { legend: "FortDetails ({{status}})", expr: `sum by (status) (increase(golbat_decode_fort_details{$sel}[$inter]))` },
      { legend: "GetGymInfo ({{status}})", expr: `sum by (status) (increase(golbat_decode_get_gym_info{$sel}[$inter]))` },
      { legend: "GetMapForts ({{status}})", expr: `sum by (status) (increase(golbat_decode_get_map_forts{$sel}[$inter]))` },
      {
        legend: "Social {{type}} ({{status}})",
        expr: `sum by (type, status) (increase(golbat_decode_social_action_with_request{$sel}[$inter]))`,
      },
      { legend: "DiskEncounter ({{status}})", expr: `sum by (status) (increase(golbat_decode_disk_encounter{$sel}[$inter]))` },
      { legend: "Quest ({{status}})", expr: `sum by (status) (increase(golbat_decode_quest{$sel}[$inter]))` },
      {
        legend: "GetFriendDetails ({{status}})",
        expr: `sum by (status) (increase(golbat_decode_get_friend_details{$sel}[$inter]))`,
      },
      { legend: "SearchPlayer ({{status}})", expr: `sum by (status) (increase(golbat_decode_search_player{$sel}[$inter]))` },
      { legend: "StartIncident ({{status}})", expr: `sum by (status) (increase(golbat_decode_start_incident{$sel}[$inter]))` },
      { legend: "OpenInvasion ({{status}})", expr: `sum by (status) (increase(golbat_decode_open_invasion{$sel}[$inter]))` },
    ],
  },
  {
    id: "quest-decodes",
    row: "Details",
    title: "Quest decoding",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{status}} {{message}}", expr: `sum by (status, message) (increase(golbat_decode_quest{$sel}[$inter]))` }],
  },
  {
    id: "gmo-types",
    row: "Details",
    title: "GMO subtypes",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{type}}", expr: `sum by (type) (increase(golbat_decode_gmo_type{$sel}[$inter]))` }],
  },
  {
    id: "incidents-rate",
    row: "Details",
    title: "Incidents",
    areaAware: true,
    kind: "line",
    queries: [{ legend: "Incidents", expr: `sum(increase(golbat_incident_count{$sel}[$inter]))` }],
  },
  {
    id: "raw-requests",
    row: "Details",
    title: "RAW requests",
    areaAware: false,
    kind: "line",
    queries: [
      { legend: "OK", expr: `sum(increase(golbat_raw_requests{$sel,status="ok"}[$inter]))` },
      { legend: "{{message}}", expr: `sum by (message) (increase(golbat_raw_requests{$sel,status!="ok"}[$inter]))` },
    ],
  },
  {
    id: "decode-methods",
    row: "Details",
    title: "Decoded methods",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{method}}", expr: `sum by (method) (increase(golbat_decode_methods{$sel,status="ok"}[$inter]))` }],
  },
  {
    // The Grafana panel was titled "Decode method rate" by mistake; it counts shinies.
    id: "shiny",
    row: "Details",
    title: "Shinies",
    areaAware: true,
    kind: "line",
    queries: [{ legend: "Shiny", expr: `sum(increase(golbat_pokemon_count_shiny{$sel}[$inter]))` }],
  },
  {
    id: "fort-changes",
    row: "Details",
    title: "PokéStop and gym changes",
    areaAware: false,
    kind: "line",
    queries: [{ legend: "{{change_type}}", expr: `sum by (change_type) (increase(golbat_fort_change{$sel}[$inter]))` }],
  },
];

export const GOLBAT_INTERVALS = ["1m", "10m", "30m", "1h", "6h", "12h", "1d"] as const;

export function golbatPanel(
  vm: VictoriaMetricsConfig,
  golbat: GolbatConfig,
  panel: PanelDef,
  opts: { rangeMs: number; stepMs: number; inter: string; areas: string[] },
  timeoutMs: number,
): Promise<PanelData> {
  return runPanel(vm, panel, { ...opts, base: golbat.selector, scanMetric: "golbat_pokemon_count_new" }, timeoutMs);
}

export async function golbatAreas(vm: VictoriaMetricsConfig, golbat: GolbatConfig, timeoutMs: number) {
  const match = `golbat_pokemon_count_new${golbat.selector ? `{${golbat.selector}}` : ""}`;
  const areas = await vmLabelValues(vm, "area", match, timeoutMs);
  return areas.filter((a) => a && a !== "unmatched").sort((a, b) => a.localeCompare(b, "en"));
}

export interface GolbatSummary {
  /** Totals over the last hour. */
  pokemonNew: number;
  pokemonIv: number;
  hundos: number;
  shinies: number;
  raids: number;
  rawOk: number;
  rawErrors: number;
  /** Mean verified TTL (minutes) over the last hour. */
  ttlMinutes?: number;
  /** Current queue sizes. */
  workerBacklog?: number;
  rawWaiting?: number;
  writeQueue?: number;
  /** Seconds since Golbat's metrics were last scraped. */
  lastSeenS?: number;
}

export async function golbatSummary(
  vm: VictoriaMetricsConfig,
  golbat: GolbatConfig,
  timeoutMs: number,
): Promise<GolbatSummary> {
  const s = golbat.selector || '__name__!=""';
  const queries: Record<keyof GolbatSummary, string> = {
    pokemonNew: `sum(increase(golbat_pokemon_count_new{${s}}[1h]))`,
    pokemonIv: `sum(increase(golbat_pokemon_count_iv{${s}}[1h]))`,
    hundos: `sum(increase(golbat_pokemon_count_hundo{${s}}[1h]))`,
    shinies: `sum(increase(golbat_pokemon_count_shiny{${s}}[1h]))`,
    raids: `sum(increase(golbat_raid_count{${s}}[1h]))`,
    rawOk: `sum(increase(golbat_raw_requests{${s},status="ok"}[1h]))`,
    rawErrors: `sum(increase(golbat_raw_requests{${s},status!="ok"}[1h]))`,
    ttlMinutes: `sum(increase(golbat_verified_pokemon_ttl{${s},type="encounter"}[1h])) / sum(increase(golbat_verified_pokemon_ttl_counter{${s},type="encounter"}[1h]))`,
    workerBacklog: `sum(golbat_worker_backlog{${s}})`,
    rawWaiting: `sum(golbat_raw_processing_waiting{${s}})`,
    writeQueue: `sum(golbat_write_behind_queue_depth{${s}})`,
    lastSeenS: `time() - max(timestamp(golbat_raw_requests{${s}}))`,
  };
  const entries = await Promise.all(
    Object.entries(queries).map(async ([k, query]) => {
      const json = await vmPost(vm, "/api/v1/query", { query }, timeoutMs);
      const v = Number(json.data?.result?.[0]?.value?.[1]);
      return [k, Number.isFinite(v) ? v : undefined] as const;
    }),
  );
  const out = Object.fromEntries(entries) as Partial<GolbatSummary>;
  return {
    pokemonNew: out.pokemonNew ?? 0,
    pokemonIv: out.pokemonIv ?? 0,
    hundos: out.hundos ?? 0,
    shinies: out.shinies ?? 0,
    raids: out.raids ?? 0,
    rawOk: out.rawOk ?? 0,
    rawErrors: out.rawErrors ?? 0,
    ttlMinutes: out.ttlMinutes,
    workerBacklog: out.workerBacklog,
    rawWaiting: out.rawWaiting,
    writeQueue: out.writeQueue,
    lastSeenS: out.lastSeenS,
  };
}
