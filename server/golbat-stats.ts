// What Golbat knows about each Dragonite area right now: quests (as the
// admin's dashboard shows them, via /api/quest-status), active Pokémon,
// invasions, raids, lures and stations. Golbat answers by bounding box, so
// every count is then narrowed to the area's own geofence.

import type { AreaStats, AreaStatsCounts } from "../shared/types.ts";

type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
type Golbat = { url: string; headers: Record<string, string> };

/** Asks for every result at once; Golbat clamps it to its own tuning limits. */
const NO_LIMIT = 100_000;

/** Invasion characters (Golbat's incident `character`): leaders, Giovanni, and decoy grunts posing as him. */
const LEADERS = new Set([41, 42, 43]);
const GIOVANNI = 44;
const DECOYS = new Set([45, 46]);
/** Incident display types: 1-4 Team GO Rocket, 7 golden stop, 8 Kecleon. */
const GOLDEN = 7;
const KECLEON = 8;

function polygons(g: Geometry) {
  return (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
}

/** Whether a point lies inside a Polygon or MultiPolygon (holes excluded). */
export function inside(lat: number, lon: number, g: Geometry) {
  const inRing = (ring: number[][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  return polygons(g).some(([outer, ...holes]) => inRing(outer) && !holes.some(inRing));
}

export function bbox(g: Geometry) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const [outer] of polygons(g)) {
    for (const [lon, lat] of outer) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }
  return { min: { lat: minLat, lon: minLon }, max: { lat: maxLat, lon: maxLon } };
}

async function post<T>(golbat: Golbat, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${golbat.url}${path}`, {
    method: "POST",
    headers: { ...golbat.headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) throw new Error("Golbat rejects the api_secret in [golbat]");
  if (!res.ok) throw new Error(`Golbat ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface Incident {
  display_type: number;
  character: number;
  expiration: number;
}
interface FortScan {
  pokestops: { lat: number; lon: number; lure_expire_timestamp?: number | null; invasions?: Incident[] }[];
  gyms: { lat: number; lon: number; raid_spawn_timestamp?: number | null; raid_battle_timestamp?: number | null; raid_end_timestamp?: number | null }[];
  stations: { lat: number; lon: number; start_time?: number; end_time?: number; is_inactive?: boolean; battle_end?: number | null }[];
  limit_reached?: boolean;
}
interface PokemonScan {
  pokemon: { lat: number; lon: number; iv?: number | null; shiny?: boolean | null }[];
  limit_reached?: boolean;
}

/** Stops with an AR / non-AR quest in an area, of all its stops, as Dragonite's admin counts them. */
export async function areaQuests(golbat: Golbat, geometry: Geometry, timeoutMs: number): Promise<AreaStatsCounts["quests"]> {
  const q = await post<{ ar_quests: number; no_ar_quests: number; total: number }>(golbat, "/api/quest-status", { type: "Feature", geometry, properties: {} }, timeoutMs);
  return { ar: q.ar_quests, noAr: q.no_ar_quests, stops: q.total };
}

/** One area's figures; `partial` when Golbat cut a list at its result limit. */
export async function areaStats(golbat: Golbat, geometry: Geometry, timeoutMs: number): Promise<AreaStatsCounts & { partial: boolean }> {
  const box = bbox(geometry);
  const feature = { type: "Feature", geometry, properties: {} };
  const [quests, forts, mons] = await Promise.all([
    post<{ ar_quests: number; no_ar_quests: number; total: number }>(golbat, "/api/quest-status", feature, timeoutMs),
    post<FortScan>(golbat, "/api/fort/scan", { ...box, limit: NO_LIMIT, with_incidents: true, gyms: {}, pokestops: {}, stations: {} }, timeoutMs),
    post<PokemonScan>(golbat, "/api/pokemon/v3/scan", { ...box, limit: NO_LIMIT, filters: [{}] }, timeoutMs),
  ]);
  const now = Date.now() / 1000;
  const here = <P extends { lat: number; lon: number }>(list: P[] | null | undefined) => (list ?? []).filter((p) => inside(p.lat, p.lon, geometry));

  const stops = here(forts.pokestops);
  const incidents = stops.flatMap((s) => (s.invasions ?? []).filter((i) => i.expiration > now));
  const rocket = incidents.filter((i) => i.display_type >= 1 && i.display_type <= 4);
  const gyms = here(forts.gyms);
  const stations = here(forts.stations).filter((s) => !s.is_inactive && (s.start_time ?? 0) < now && (s.end_time ?? 0) > now);
  const pokemon = here(mons.pokemon);

  return {
    quests: { ar: quests.ar_quests, noAr: quests.no_ar_quests, stops: quests.total },
    pokemon: {
      active: pokemon.length,
      withIv: pokemon.filter((p) => p.iv != null).length,
      hundo: pokemon.filter((p) => p.iv === 100).length,
      shiny: pokemon.filter((p) => p.shiny).length,
    },
    invasions: {
      grunts: rocket.filter((i) => !LEADERS.has(i.character) && i.character !== GIOVANNI && !DECOYS.has(i.character)).length,
      leaders: rocket.filter((i) => LEADERS.has(i.character)).length,
      giovanni: rocket.filter((i) => i.character === GIOVANNI).length,
      decoys: rocket.filter((i) => DECOYS.has(i.character)).length,
      golden: incidents.filter((i) => i.display_type === GOLDEN).length,
      kecleon: incidents.filter((i) => i.display_type === KECLEON).length,
    },
    stops: { total: stops.length, lures: stops.filter((s) => (s.lure_expire_timestamp ?? 0) > now).length },
    gyms: {
      total: gyms.length,
      raids: gyms.filter((g) => (g.raid_battle_timestamp ?? 0) <= now && (g.raid_end_timestamp ?? 0) > now).length,
      eggs: gyms.filter((g) => (g.raid_spawn_timestamp ?? 0) <= now && (g.raid_battle_timestamp ?? 0) > now).length,
    },
    stations: { active: stations.length, battles: stations.filter((s) => (s.battle_end ?? 0) > now).length },
    partial: !!(forts.limit_reached || mons.limit_reached),
  };
}

/** Adds several areas' figures together (the totals row). */
export function sumStats(list: AreaStatsCounts[]): AreaStatsCounts {
  const zero: AreaStatsCounts = {
    quests: { ar: 0, noAr: 0, stops: 0 },
    pokemon: { active: 0, withIv: 0, hundo: 0, shiny: 0 },
    invasions: { grunts: 0, leaders: 0, giovanni: 0, decoys: 0, golden: 0, kecleon: 0 },
    stops: { total: 0, lures: 0 },
    gyms: { total: 0, raids: 0, eggs: 0 },
    stations: { active: 0, battles: 0 },
  };
  for (const s of list) {
    for (const group of Object.keys(zero) as (keyof AreaStatsCounts)[]) {
      const acc = zero[group] as Record<string, number>;
      for (const [k, v] of Object.entries(s[group] as Record<string, number>)) acc[k] += v;
    }
  }
  return zero;
}

/** Runs `fn` over `items` with at most `n` at a time (Golbat answers each area in seconds). */
export async function limited<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * The area's spawnpoints Golbat knows of right now: Golbat's API lists no
 * spawnpoints, so they come from the Pokémon active in the area (each one
 * names its spawnpoint). Ones with no Pokémon at the moment are missing.
 */
export async function areaSpawnpoints(golbat: Golbat, geometry: Geometry, timeoutMs: number) {
  const mons = await post<{ pokemon: { lat: number; lon: number; spawn_id?: number | null; expire_timestamp_verified?: boolean }[]; limit_reached?: boolean }>(
    golbat,
    "/api/pokemon/v3/scan",
    { ...bbox(geometry), limit: NO_LIMIT, filters: [{}] },
    timeoutMs,
  );
  const seen = new Map<number, { lat: number; lon: number; verified: boolean }>();
  for (const p of mons.pokemon ?? []) {
    if (!p.spawn_id || seen.has(p.spawn_id) || !inside(p.lat, p.lon, geometry)) continue;
    seen.set(p.spawn_id, { lat: p.lat, lon: p.lon, verified: !!p.expire_timestamp_verified });
  }
  return { points: [...seen.values()], partial: !!mons.limit_reached };
}

export type { AreaStats };
