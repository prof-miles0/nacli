// An area's map layers (geofence, overrides, routes), as plain data: kept apart
// from the map itself, so forms can build them without loading MapLibre.

/** [lon, lat] rings: outer first, then holes. */
export type Polygon = number[][][];

export interface MapLayer {
  key: string;
  name: string;
  color: string;
  polygons?: Polygon[];
  /** A route, in order: drawn as a line through its points. */
  points?: [number, number][];
  /** Scan range around each route point, in metres. */
  rangeM?: number;
  /** Loose points (e.g. spawnpoints): no line joining them. */
  noPath?: boolean;
  /** Starts hidden (e.g. the full fort route, which overlaps the route). */
  hidden?: boolean;
}

/** Any geofence shape Dragonite uses (Feature, Polygon, MultiPolygon or [{lat, lon}]) as polygons. */
export function polygonsOf(g: unknown): Polygon[] {
  if (!g) return [];
  if (Array.isArray(g)) {
    const ring = (g as { lat: number; lon: number }[]).filter((p) => typeof p?.lat === "number").map((p) => [p.lon, p.lat]);
    return ring.length >= 3 ? [[ring]] : [];
  }
  const o = g as { type?: string; geometry?: unknown; coordinates?: unknown };
  if (o.type === "Feature") return polygonsOf(o.geometry);
  if (o.type === "Polygon") return [o.coordinates as Polygon];
  if (o.type === "MultiPolygon") return o.coordinates as Polygon[];
  return [];
}

/** A route's points ([{lat, lon}]) as [lon, lat]. */
export function pointsOf(route: unknown): [number, number][] {
  return Array.isArray(route) ? route.filter((p) => typeof p?.lat === "number").map((p) => [p.lon, p.lat] as [number, number]) : [];
}

/** The admin's layers for an area: geofence, overrides and routes, in its colours. */
export function areaLayers(a: Record<string, unknown>): MapLayer[] {
  const mode = (k: string) => (a[k] ?? {}) as Record<string, unknown>;
  const p = mode("pokemon_mode");
  const f = mode("fort_mode");
  const q = mode("quest_mode");
  return [
    { key: "geofence", name: "Geofence", color: "#2196f3", polygons: polygonsOf(a.geofence) },
    { key: "pokemon-fence", name: "Pokémon geofence override", color: "#4caf50", polygons: polygonsOf(p.geofence) },
    { key: "quest-fence", name: "Quest geofence override", color: "#ffeb3b", polygons: polygonsOf(q.geofence) },
    { key: "fort-fence", name: "Fort geofence override", color: "#f44336", polygons: polygonsOf(f.geofence) },
    { key: "pokemon", name: "Pokémon route", color: "#4caf50", points: pointsOf(p.route), rangeM: 70 },
    { key: "fort", name: "Fort route", color: "#f44336", points: pointsOf(f.route), rangeM: 1500 },
    { key: "fort-full", name: "Full fort route", color: "#ff9800", points: pointsOf(f.full_route), hidden: true },
    { key: "quest", name: "Quest route", color: "#ffeb3b", points: pointsOf(q.route), hidden: true },
  ];
}
