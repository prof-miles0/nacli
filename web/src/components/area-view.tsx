// An area in full, as Dragonite's admin shows and edits it: the map with its
// geofence, overrides and routes, every mode's settings, and an editor for all
// of them.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil, Save } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DragoniteArea, DragoniteInfo } from "@shared/types";
import { type MapLayer, pointsOf, polygonsOf } from "@/components/area-layers";
import { AreaForm, AreaMapView, type Draft, draftOf, type FormTab, problems, SwitchRow, toAreaFull } from "@/components/area-form";
import { toast } from "@/components/toaster";
import { Badge, Button, Label, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

type Raw = Record<string, unknown>;
const mode = (a: Raw, k: string) => (a[k] ?? {}) as Raw;
const yes = (v: unknown) => (v ? "Yes" : "No");
const pts = (n: number) => `${fmt.int(n)} points`;
const fencePoints = (g: unknown) => polygonsOf(g).reduce((n, p) => n + (p[0]?.length ?? 0), 0);
const override = (g: unknown) => (g ? `${pts(fencePoints(g))} (override)` : "– (inherits base)");

function useFullArea(stack: DragoniteInfo, area: DragoniteArea) {
  return useQuery({ queryKey: ["dragonite-area-full", stack.id, area.id], queryFn: () => endpoints.areaFull(stack.id, area.id) });
}

/**
 * One mode's settings, as the admin's show page lists them. A disabled mode
 * starts collapsed (just its title), and opens on a click.
 */
function Section({ title, on, rows }: { title: string; on?: boolean; rows: [string, ReactNode][] }) {
  return (
    <details open={on !== false} className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          <h4 className="font-semibold">{title}</h4>
        </span>
        {on === undefined ? null : <Badge tone={on ? "good" : "neutral"}>{on ? "Enabled" : "Disabled"}</Badge>}
      </summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 pb-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The admin's "Show": the area on a map and every mode's settings. */
export function AreaViewModal({ stack, area, onClose, onEdit }: { stack: DragoniteInfo; area: DragoniteArea; onClose: () => void; onEdit: () => void }) {
  const { data: app } = useAppInfo();
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
    ? [{ key: "spawnpoints", name: "Active spawns", color: "#a855f7", points: spawns.data.points.map((p) => [p.lon, p.lat] as [number, number]), noPath: true }]
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
        <div className="grid h-full min-h-0 gap-4 overflow-auto lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)] lg:overflow-hidden">
          <AreaMapView area={a} basemap={app?.map} extra={spawnLayer} className="h-80 lg:h-full" />
          <div className="flex min-h-0 flex-col gap-3 lg:overflow-auto lg:pr-1">
            <Section
              title="General"
              rows={[
                ["ID", String(a.id ?? area.id)],
                ["Dragonite", stack.name],
                ["Geofence", pts(fencePoints(a.geofence))],
                ...(app?.golbatMap
                  ? ([
                      [
                        "Active spawns",
                        spawns.error ? (
                          <span className="text-red-300">unavailable</span>
                        ) : !spawns.data ? (
                          <Spinner className="ml-auto size-3.5" />
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
                ["Populate invasions", yes(mode(a, "pokemon_mode").invasion)],
                ["Route", pts(pointsOf(mode(a, "pokemon_mode").route).length)],
                ["Geofence", override(mode(a, "pokemon_mode").geofence)],
              ]}
            />
            <Section
              title="Quest Mode"
              on={!!a.enable_quests}
              rows={[
                ["Workers", Number(mode(a, "quest_mode").workers) ? fmt.int(Number(mode(a, "quest_mode").workers)) : "All Pokémon workers"],
                ["Quest hours", Array.isArray(mode(a, "quest_mode").hours) && (mode(a, "quest_mode").hours as number[]).length ? (mode(a, "quest_mode").hours as number[]).join(", ") : "–"],
                ["Route", pts(pointsOf(mode(a, "quest_mode").route).length)],
                ["Geofence", override(mode(a, "quest_mode").geofence)],
              ]}
            />
            <Section
              title="Fort Mode"
              on={!!a.enable_forts}
              rows={[
                ["Workers", fmt.int(Number(mode(a, "fort_mode").workers) || 0)],
                ["Priority raids", yes(mode(a, "fort_mode").prio_raid)],
                ["Scan showcases", yes(mode(a, "fort_mode").showcase)],
                ["Populate invasions", yes(mode(a, "fort_mode").invasion)],
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
                ["Extra Pokémon IDs", Array.isArray(mode(a, "rare_pokemon_mode").extra) && (mode(a, "rare_pokemon_mode").extra as number[]).length ? (mode(a, "rare_pokemon_mode").extra as number[]).join(", ") : "–"],
              ]}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The admin's "Edit": every field of the area, its geofence and routes included. */
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
  const [initial] = useState(() => draftOf(base));
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

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.saveAreaFull(stack.id, area.id, toAreaFull(d, base, enabled));
      toast({ tone: "success", text: `${d.name.trim()} ${r.steps.join(" and ")} on ${stack.name}` });
      qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
      qc.invalidateQueries({ queryKey: ["dragonite-area-full", stack.id, area.id] });
      qc.invalidateQueries({ queryKey: ["dragonite-geofences"] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      large
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          Edit {area.name}
          <span className="text-sm font-normal text-muted-foreground">· {stack.name}</span>
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
        className="flex flex-col gap-4"
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
          general={
            <SwitchRow title="Area enabled" hint="Its workers scan it while it is on." on={enabled} onChange={setEnabled} />
          }
        />
        {error ? <p className="text-red-300">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
