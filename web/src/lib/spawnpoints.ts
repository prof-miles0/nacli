// How the Spawnpoints page colours each spawnpoint, shared by its map (loaded
// lazily) and its legends.

export type SpawnMode = "known" | "seen" | "density";

/** Despawn time known (Golbat saw the exact second) or not. */
export const KNOWN = { yes: "#22c55e", no: "#f59e0b" };

/** Last seen: from fresh to gone quiet. Upper bounds in seconds. */
export const SEEN: { label: string; max: number; color: string }[] = [
  { label: "Last 24 hours", max: 86_400, color: "#22c55e" },
  { label: "Last 7 days", max: 7 * 86_400, color: "#a3e635" },
  { label: "Last month", max: 30 * 86_400, color: "#f59e0b" },
  { label: "Older", max: Infinity, color: "#ef4444" },
];

/** One entry of a mode's legend: also what can be hidden from the map. */
export interface SpawnCategory {
  key: string;
  label: string;
  color: string;
}

/** The categories a mode splits spawnpoints into (none for density). */
export function categories(mode: SpawnMode): SpawnCategory[] {
  if (mode === "known")
    return [
      { key: "yes", label: "Known", color: KNOWN.yes },
      { key: "no", label: "Unknown", color: KNOWN.no },
    ];
  if (mode === "seen") return SEEN.map((s, i) => ({ key: String(i), label: s.label, color: s.color }));
  return [];
}

/** Which category of each mode a spawnpoint (despawn second or -1, seconds since seen) falls in. */
export function categoryKeys(despawn: number, ageS: number): Record<Exclude<SpawnMode, "density">, string> {
  const bucket = SEEN.findIndex((s) => ageS <= s.max);
  return {
    known: despawn >= 0 ? "yes" : "no",
    seen: String(bucket < 0 ? SEEN.length - 1 : bucket),
  };
}
