// Workers asked for in a save that Dragonite has not taken up yet: its status
// keeps the old target for a few seconds, so until it changes (or a minute
// goes by) the areas list shows the new one.

import type { DragoniteArea, DragoniteAreas } from "@shared/types";

const pending = new Map<string, { from: number; to: number; until: number }>();
const key = (stack: string, area: number) => `${stack}:${area}`;

/** Workers Dragonite should run in an area as configured; quest workers only while it scans quests. */
function target(a: DragoniteArea, questing: boolean): number {
  if (!a.enabled) return 0;
  return (
    (a.pokemon.enabled ? a.pokemon.workers : 0) +
    (a.fort.enabled ? a.fort.workers : 0) +
    (a.rare.enabled ? a.rare.workers : 0) +
    (a.quest.enabled && questing ? a.quest.workers : 0)
  );
}

/** The area as saved, with its live target moved by what the save changed. */
export function expectSaved(stack: string, before: DragoniteArea, after: DragoniteArea): DragoniteArea {
  // A disabled area may have no live figures yet: none running.
  const l = before.live ?? { expected: 0, active: 0, workers: [] };
  const questing = l.workers.some((w) => w.mode === "QuestMode");
  const to = Math.max(0, l.expected + target(after, questing) - target(before, questing));
  if (to === l.expected) return after;
  pending.set(key(stack, before.id), { from: l.expected, to, until: Date.now() + 60_000 });
  return { ...after, live: { ...l, expected: to } };
}

/** A fresh list with the targets Dragonite has not taken up yet. */
export function withPending(stack: string, data: DragoniteAreas): DragoniteAreas {
  if (!pending.size) return data;
  const now = Date.now();
  return {
    ...data,
    areas: data.areas.map((a) => {
      const p = pending.get(key(stack, a.id));
      if (!p) return a;
      const l = a.live ?? { expected: 0, active: 0, workers: [] };
      if (l.expected !== p.from || now > p.until) {
        pending.delete(key(stack, a.id));
        return a;
      }
      return { ...a, live: { ...l, expected: p.to } };
    }),
  };
}
