// An area in full, as Dragonite's admin shows and edits it: the map with its
// geofence, overrides and routes, every mode's settings, and an editor for all
// of them.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DragoniteArea, DragoniteAreas, DragoniteInfo } from "@shared/types";
import { type MapLayer, pointsOf, polygonsOf } from "@/components/area-layers";
import { AreaForm, AreaMapView, type Draft, draftOf, type FormTab, type Koji, problems, routeText, toAreaFull } from "@/components/area-form";
import { StackTag, useStacks } from "@/components/stack-tag";
import { toast } from "@/components/toaster";
import { Badge, Button, Label, Modal, Spinner } from "@/components/ui";
import { expectSaved } from "@/lib/area-pending";
import { endpoints } from "@/lib/api";
import { useAppInfo } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

type Raw = Record<string, unknown>;
const mode = (a: Raw, k: string) => (a[k] ?? {}) as Raw;
const yes = (v: unknown) => (v ? "Yes" : "No");
const pts = (n: number) => (n ? `${fmt.int(n)} points` : "–");
const fencePoints = (g: unknown) => polygonsOf(g).reduce((n, p) => n + (p[0]?.length ?? 0), 0);
const override = (g: unknown) => (g ? `Own, ${pts(fencePoints(g))}` : "Inherited");

function useFullArea(stack: DragoniteInfo, area: DragoniteArea) {
  return useQuery({ queryKey: ["dragonite-area-full", stack.id, area.id], queryFn: () => endpoints.areaFull(stack.id, area.id) });
}

/**
 * One mode's settings as a single row: its name and state, then each setting
 * as a small label / value tile (they wrap on phones). A mode that is off shows
 * just its name.
 */
function Section({ title, on, rows }: { title: string; on?: boolean; rows: [string, ReactNode][] }) {
  return (
    <div className={cn("flex flex-col gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center", on === false && "opacity-60")}>
      <div className="flex shrink-0 items-center gap-1.5 sm:w-48">
        <h4 className="font-semibold whitespace-nowrap">{title}</h4>
        {on === undefined ? null : (
          <Badge tone={on ? "good" : "neutral"} className="ml-auto sm:ml-1">
            {on ? "On" : "Off"}
          </Badge>
        )}
      </div>
      {on === false ? null : (
        <dl className="grid min-w-0 flex-1 grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] sm:gap-x-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col">
              <dt className="truncate text-[11px] text-muted-foreground">{k}</dt>
              <dd className="truncate text-sm font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The admin's "Show": the area on a map and every mode's settings. */
export function AreaViewModal({ stack, area, onClose, onEdit }: { stack: DragoniteInfo; area: DragoniteArea; onClose: () => void; onEdit: () => void }) {
  const { data: app } = useAppInfo();
  const { multi } = useStacks();
  const q = useFullArea(stack, area);
  const a = q.data;
  // Spawnpoints, from Golbat when it is configured.
  const spawns = useQuery({
    queryKey: ["area-spawnpoints", stack.id, area.id],
    queryFn: () => endpoints.areaSpawnpoints(stack.id, area.id),
    enabled: !!app?.golbatMap,
    staleTime: 60_000,
  });
  const spawnLayer: MapLayer[] = spawns.data?.points.length
    ? [{ key: "spawnpoints", name: "Active spawns", color: "#a855f7", points: spawns.data.points.map((p) => [p.lon, p.lat] as [number, number]), noPath: true, hidden: true }]
    : [];
  return (
    <Modal
      open
      full
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {area.name}
          <Badge tone={area.enabled ? "good" : "neutral"}>{area.enabled ? "Enabled" : "Disabled"}</Badge>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit} disabled={!a}>
            <Pencil />
            Edit
          </Button>
        </>
      }
    >
      {q.error ? (
        <p className="text-red-300">{(q.error as Error).message}</p>
      ) : !a ? (
        <Spinner className="mx-auto my-20" />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
          <AreaMapView area={a} basemap={app?.map} extra={spawnLayer} className="h-72 shrink-0 sm:h-auto sm:min-h-32 sm:flex-1" />
          <div className="flex shrink-0 flex-col gap-2">
            <Section
              title="General"
              rows={[
                ["ID", String(a.id ?? area.id)],
                ...(multi ? ([["Stack", <StackTag id={stack.id} />]] as [string, ReactNode][]) : []),
                ["Geofence", pts(fencePoints(a.geofence))],
                ...(app?.golbatMap
                  ? ([
                      [
                        "Active spawns",
                        spawns.error ? (
                          <span className="text-red-300">Unavailable</span>
                        ) : !spawns.data ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <span title="Spawnpoints with a Pokémon right now, from Golbat">
                            {spawns.data.partial ? "≥ " : ""}
                            {fmt.int(spawns.data.points.length)}
                          </span>
                        ),
                      ],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
            <Section
              title="Pokémon Mode"
              on={!!a.enable_pokemon}
              rows={[
                ["Workers", fmt.int(Number(mode(a, "pokemon_mode").workers) || 0)],
                ["Scout", yes(mode(a, "pokemon_mode").enable_scout)],
                ["Invasions", yes(mode(a, "pokemon_mode").invasion)],
                ["Route", pts(pointsOf(mode(a, "pokemon_mode").route).length)],
                ["Geofence", override(mode(a, "pokemon_mode").geofence)],
              ]}
            />
            <Section
              title="Quest Mode"
              on={!!a.enable_quests}
              rows={[
                ["Workers", Number(mode(a, "quest_mode").workers) ? fmt.int(Number(mode(a, "quest_mode").workers)) : <span title="Uses the Pokémon and Fort mode workers">Shared</span>],
                ["Hours", Array.isArray(mode(a, "quest_mode").hours) && (mode(a, "quest_mode").hours as number[]).length ? (mode(a, "quest_mode").hours as number[]).join(", ") : "–"],
                ["Route", pts(pointsOf(mode(a, "quest_mode").route).length)],
                ["Geofence", override(mode(a, "quest_mode").geofence)],
              ]}
            />
            <Section
              title="Fort Mode"
              on={!!a.enable_forts}
              rows={[
                ["Workers", fmt.int(Number(mode(a, "fort_mode").workers) || 0)],
                ["Raids first", yes(mode(a, "fort_mode").prio_raid)],
                ["Showcases", yes(mode(a, "fort_mode").showcase)],
                ["Invasions", yes(mode(a, "fort_mode").invasion)],
                ["Route", pts(pointsOf(mode(a, "fort_mode").route).length)],
                ["Full route", pts(pointsOf(mode(a, "fort_mode").full_route).length)],
                ["Geofence", override(mode(a, "fort_mode").geofence)],
              ]}
            />
            <Section
              title="Rare Pokémon Mode"
              on={!!a.enable_rare_pokemon}
              rows={[
                ["Workers", fmt.int(Number(mode(a, "rare_pokemon_mode").workers) || 0)],
                ["Permyriad", fmt.int(Number(mode(a, "rare_pokemon_mode").permyriad) || 0)],
                ["Extra IDs", Array.isArray(mode(a, "rare_pokemon_mode").extra) && (mode(a, "rare_pokemon_mode").extra as number[]).length ? (mode(a, "rare_pokemon_mode").extra as number[]).join(", ") : "–"],
              ]}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The admin's "Edit": every field of the area, its geofence and routes included. */
/**
 * The table's row for an area with the editor's values, to show while the
 * save and the reload go on; what cannot be read from the draft stays as it was.
 */
function withDraft(a: DragoniteArea, d: Draft, enabled: boolean): DragoniteArea {
  const n = (v: string, old: number) => (/^\d+$/.test(v.trim()) ? Number(v) : old);
  let hours = a.quest.hours;
  try {
    const parsed = d.quest.hours.trim() ? JSON.parse(d.quest.hours) : [];
    if (Array.isArray(parsed) && parsed.every((h) => typeof h === "number")) hours = parsed;
  } catch {
    // Not a list yet: the old hours stay.
  }
  return {
    ...a,
    name: d.name.trim() || a.name,
    enabled,
    pokemon: { ...a.pokemon, enabled: d.pokemon.enabled, workers: n(d.pokemon.workers, a.pokemon.workers), scout: d.pokemon.scout, invasion: d.pokemon.invasion },
    quest: { ...a.quest, enabled: d.quest.enabled, workers: n(d.quest.workers, a.quest.workers), hours },
    fort: { ...a.fort, enabled: d.fort.enabled, workers: n(d.fort.workers, a.fort.workers), prioRaid: d.fort.prioRaid, showcase: d.fort.showcase, invasion: d.fort.invasion },
    rare: { ...a.rare, enabled: d.rare.enabled, workers: n(d.rare.workers, a.rare.workers), permyriad: n(d.rare.permyriad, a.rare.permyriad) },
  };
}

export function AreaEditModal({ stack, area, onClose }: { stack: DragoniteInfo; area: DragoniteArea; onClose: () => void }) {
  const q = useFullArea(stack, area);
  return q.error ? (
    <Modal open onClose={onClose} title={`Edit ${area.name}`}>
      <p className="text-red-300">{(q.error as Error).message}</p>
    </Modal>
  ) : !q.data ? (
    <Modal open onClose={onClose} title={`Edit ${area.name}`}>
      <Spinner className="mx-auto my-10" />
    </Modal>
  ) : (
    <EditForm stack={stack} area={area} base={q.data} onClose={onClose} />
  );
}

function EditForm({ stack, area, base, onClose }: { stack: DragoniteInfo; area: DragoniteArea; base: Raw; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: app } = useAppInfo();
  const { on } = useStacks();
  const [initial, setInitial] = useState(() => draftOf(base));
  const [d, setD] = useState<Draft>(initial);
  const [enabled, setEnabled] = useState(!!base.enabled);
  const [tab, setTab] = useState<FormTab>("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) =>
    setD((x) => ({ ...x, [k]: typeof v === "object" && !Array.isArray(v) ? { ...(x[k] as object), ...v } : v }));
  const errs = problems(d);
  const dirty = enabled !== !!base.enabled || JSON.stringify(d) !== JSON.stringify(initial);
  const canSave = dirty && !Object.keys(errs).length && !busy;

  // Kōji: Dragonite stores the new route at once, so it lands in the form as already saved.
  const kojiOn = useQuery({ queryKey: ["dragonite-koji", stack.id], queryFn: () => endpoints.kojiAvailable(stack.id), staleTime: 60_000 });
  const koji: Koji = {
    available: !!kojiOn.data?.available,
    run: async (mode, bootstrap) => {
      const r = await endpoints.kojiRoute(stack.id, area.id, mode, bootstrap);
      const route = routeText(r.route);
      setD((x) => ({ ...x, [mode]: { ...x[mode], route } }));
      setInitial((x) => ({ ...x, [mode]: { ...x[mode], route } }));
      qc.invalidateQueries({ queryKey: ["dragonite-area-full", stack.id, area.id] });
      return r.route.length;
    },
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    // Show the new figures in the areas table at once; the reload confirms them,
    // and a refused save puts the old ones back.
    const listKey = ["dragonite-areas", stack.id];
    const previous = qc.getQueryData<DragoniteAreas>(listKey);
    if (previous) qc.setQueryData<DragoniteAreas>(listKey, { ...previous, areas: previous.areas.map((a) => (a.id === area.id ? expectSaved(stack.id, a, withDraft(a, d, enabled)) : a)) });
    try {
      const r = await endpoints.saveAreaFull(stack.id, area.id, toAreaFull(d, base, enabled));
      toast({ tone: "success", text: `${d.name.trim()} ${r.steps.join(" and ")}${on(stack.id)}` });
      qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
      qc.invalidateQueries({ queryKey: ["dragonite-area-full", stack.id, area.id] });
      qc.invalidateQueries({ queryKey: ["dragonite-geofences"] });
      onClose();
    } catch (e) {
      if (previous) qc.setQueryData(listKey, previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      large
      tall
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          Edit {area.name}
          <StackTag id={stack.id} className="text-sm font-normal text-muted-foreground" />
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? <Spinner className="size-4" /> : <Save />}
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex min-h-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        <AreaForm
          d={d}
          set={set}
          errs={errs}
          tab={tab}
          setTab={setTab}
          basemap={app?.map}
          enabled={{ on: enabled, onChange: setEnabled }}
          koji={koji}
        />
        {error ? <p className="text-red-300">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
