import type { DragoniteSummary } from "@shared/types";

export type DragoniteRow = DragoniteSummary["instances"][number];

/** VictoriaMetrics scrapes every few seconds; two minutes without data means it is down. */
export const isUp = (d: DragoniteRow) => d.lastSeenS != null && d.lastSeenS < 120;

/**
 * How the Rotom link looks right now: "ok" when its controllers sit on the
 * configured Rotom (or one is detected and none configured), "mismatch" when
 * they show up elsewhere, "none" when no Rotom sees any of its controllers.
 */
export function linkState(d: DragoniteRow): "ok" | "mismatch" | "none" {
  const live = d.links.filter((l) => l.controllers > 0);
  // A stack with no [stack.rotom] expects its controllers on no Rotom.
  if (!live.length) return d.rotom ? "none" : "ok";
  if (!d.rotom) return "ok";
  return live.every((l) => l.rotomId === d.rotom) ? "ok" : "mismatch";
}
