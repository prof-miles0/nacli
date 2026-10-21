// A new area with the same fields as Dragonite's admin "Create", in one or
// several stacks. At most one of them gets it enabled: two stacks scanning the
// same place only repeat each other's work.

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DragoniteInfo } from "@shared/types";
import { toast } from "@/components/toaster";
import { Button, Input, Label, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

type LatLon = { lat: number; lon: number };
type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
type Geofence = LatLon[] | Geometry | { type: "Feature"; geometry: Geometry; properties: Record<string, unknown> };

/** "lat,lon" lines (anything else is skipped), as the admin's route and geofence boxes read them. */
function parseLines(text: string): LatLon[] {
  const out: LatLon[] = [];
  for (const line of text.split("\n")) {
    const [a, b] = line.trim().split(",");
    const lat = parseFloat(a);
    const lon = parseFloat(b);
    if (line.includes(",") && Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
  }
  return out;
}

/**
 * The admin's geofence box: GeoJSON (Feature, Polygon or MultiPolygon), a
 * [{lat, lon}] list, or "lat,lon" lines. Throws a readable message when wrong.
 */
function parseGeofence(text: string): Geofence | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (t[0] !== "{" && t[0] !== "[") return parseLines(t);
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch (e) {
    throw new Error(`invalid JSON: ${(e as Error).message}`);
  }
  const geometry = (g: unknown): Geometry => {
    const type = (g as { type?: unknown })?.type;
    if (type !== "Polygon" && type !== "MultiPolygon") throw new Error(`unsupported GeoJSON type: ${String(type)}`);
    return g as Geometry;
  };
  if (Array.isArray(v)) {
    return v.map((p, i) => {
      if (typeof p?.lat !== "number" || typeof p?.lon !== "number") throw new Error(`entry ${i}: expected {lat: number, lon: number}`);
      return { lat: p.lat, lon: p.lon };
    });
  }
  const o = v as { type?: unknown; geometry?: unknown; properties?: Record<string, unknown> };
  if (o?.type === "Feature") return { type: "Feature", geometry: geometry(o.geometry), properties: o.properties ?? {} };
  return geometry(o);
}

/** Points in a geofence, for the box's label (as the admin counts them). */
function geofencePoints(g?: Geofence) {
  if (!g) return 0;
  if (Array.isArray(g)) return g.length;
  const geom = g.type === "Feature" ? g.geometry : g;
  const polys = (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates) as number[][][][];
  return polys.reduce((n, p) => n + (p[0]?.length ?? 0), 0);
}

/** Quest hours as the admin reads them: "[1,10]" or "1, 10". */
function parseHours(text: string) {
  const t = text.trim();
  if (!t) return [];
  try {
    const v = t.startsWith("[") ? JSON.parse(t) : t.split(",");
    return (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  } catch {
    return [];
  }
}

const ids = (text: string) =>
  text
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => !Number.isNaN(n));

interface Draft {
  name: string;
  geofence: string;
  pokemon: { enabled: boolean; workers: string; scout: boolean; invasion: boolean; route: string; geofence: string };
  quest: { enabled: boolean; workers: string; hours: string; route: string; geofence: string };
  fort: { enabled: boolean; workers: string; prioRaid: boolean; showcase: boolean; invasion: boolean; route: string; fullRoute: string; geofence: string };
  rare: { enabled: boolean; workers: string; permyriad: string; extra: string };
}

/** The admin's create defaults: everything off and at 0, quest hours [1,10]. */
const EMPTY: Draft = {
  name: "",
  geofence: "",
  pokemon: { enabled: false, workers: "0", scout: false, invasion: false, route: "", geofence: "" },
  quest: { enabled: false, workers: "0", hours: "[1,10]", route: "", geofence: "" },
  fort: { enabled: false, workers: "0", prioRaid: false, showcase: false, invasion: false, route: "", fullRoute: "", geofence: "" },
  rare: { enabled: false, workers: "0", permyriad: "0", extra: "" },
};

const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);

/**
 * The body Dragonite gets, as the admin builds it: a mode is sent only when it
 * has something set, and empty routes, overrides and zero workers are left out.
 */
function toArea(d: Draft) {
  const geo = (t: string) => parseGeofence(t);
  const route = (t: string) => {
    const r = parseLines(t);
    return r.length ? r : undefined;
  };
  const workers = (v: string) => (int(v) ? int(v) : undefined);
  const p = d.pokemon;
  const q = d.quest;
  const f = d.fort;
  const hours = parseHours(q.hours);
  return {
    name: d.name.trim(),
    geofence: geo(d.geofence),
    enable_pokemon: p.enabled,
    enable_quests: q.enabled,
    enable_forts: f.enabled,
    enable_rare_pokemon: d.rare.enabled,
    pokemon_mode:
      route(p.route) || int(p.workers) || geo(p.geofence)
        ? { workers: workers(p.workers), enable_scout: p.scout, invasion: p.invasion, route: route(p.route), geofence: geo(p.geofence) }
        : undefined,
    quest_mode:
      int(q.workers) || hours.length || route(q.route) || geo(q.geofence)
        ? { workers: workers(q.workers), hours: hours.length ? hours : undefined, route: route(q.route), geofence: geo(q.geofence) }
        : undefined,
    fort_mode:
      route(f.route) || int(f.workers) || geo(f.geofence)
        ? {
            workers: workers(f.workers),
            prio_raid: f.prioRaid,
            showcase: f.showcase,
            invasion: f.invasion,
            route: route(f.route),
            full_route: route(f.fullRoute),
            geofence: geo(f.geofence),
          }
        : undefined,
    rare_pokemon_mode: { workers: int(d.rare.workers) || 0, permyriad: int(d.rare.permyriad) || 0, extra: ids(d.rare.extra) },
  };
}

/** What is wrong with the draft, field by field (empty when it can be sent). */
function problems(d: Draft) {
  const out: Record<string, string> = {};
  if (!d.name.trim()) out.name = "Required";
  const geo = (k: string, t: string, required = false) => {
    try {
      const g = parseGeofence(t);
      if (required && !geofencePoints(g)) out[k] = "Required";
      else if (g && geofencePoints(g) < 3) out[k] = "A geofence needs at least 3 points";
    } catch (e) {
      out[k] = (e as Error).message;
    }
  };
  geo("geofence", d.geofence, true);
  geo("pokemon.geofence", d.pokemon.geofence);
  geo("quest.geofence", d.quest.geofence);
  geo("fort.geofence", d.fort.geofence);
  for (const [k, v] of [
    ["pokemon.workers", d.pokemon.workers],
    ["quest.workers", d.quest.workers],
    ["fort.workers", d.fort.workers],
    ["rare.workers", d.rare.workers],
  ]) {
    if (Number.isNaN(int(v))) out[k] = "A whole number, 0 or more";
  }
  const p = int(d.rare.permyriad);
  if (Number.isNaN(p) || p > 10_000) out["rare.permyriad"] = "From 0 to 10,000";
  // The admin's rule: quest workers come from the Pokémon and Fort ones.
  if (int(d.quest.workers) > (int(d.pokemon.workers) || 0) + (int(d.fort.workers) || 0)) {
    out["quest.workers"] = "Must be at most Pokémon + Fort workers";
  }
  return out;
}

function Field({ label, error, hint, children }: { label: ReactNode; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {/* "Required" goes unsaid: the create button stays off until it is filled in. */}
      {error && error !== "Required" ? <span className="text-[11px] text-amber-400">{error}</span> : hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Tick({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

function Points({ text, kind = "route" }: { text: string; kind?: "route" | "geofence" }) {
  let n = 0;
  try {
    n = kind === "geofence" ? geofencePoints(parseGeofence(text)) : parseLines(text).length;
  } catch {
    // The error shows under the box.
  }
  return <span className="font-normal normal-case text-muted-foreground"> · {fmt.int(n)} points</span>;
}

const area = "min-h-20 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A mode's heading with its "Enabled" switch, as the admin lays them out. */
function ModeHead({ title, on, onChange }: { title: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-4">
      <h4 className="font-semibold">{title}</h4>
      <Tick label="Enabled" on={on} onChange={onChange} />
    </div>
  );
}

export function CreateAreaModal({ stacks, initial, onClose }: { stacks: DragoniteInfo[]; initial?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const color = useInstanceColor();
  const [targets, setTargets] = useState<string[]>(initial ? [initial] : stacks.slice(0, 1).map((d) => d.id));
  // Which chosen stack scans it (one at most); the rest keep it disabled.
  const [enabledIn, setEnabledIn] = useState<string>();
  const [tab, setTab] = useState<"general" | "fort">("general");
  const [d, setD] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<{ stack: string; id?: number; enabled?: boolean; error?: string }[]>();
  const set = <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) =>
    setD((x) => ({ ...x, [k]: typeof v === "object" && !Array.isArray(v) ? { ...(x[k] as object), ...v } : v }));
  const name = (id: string) => stacks.find((s) => s.id === id)?.name ?? id;

  // Names already used in the chosen stacks (Dragonite allows it, but it confuses).
  const lists = useQueries({ queries: stacks.map((s) => ({ queryKey: ["dragonite-areas", s.id], queryFn: () => endpoints.dragoniteAreas(s.id) })) });
  const taken = stacks
    .filter((s, i) => targets.includes(s.id) && lists[i].data?.areas.some((a) => a.name.trim().toLowerCase() === d.name.trim().toLowerCase()))
    .map((s) => s.name);

  const errs = problems(d);
  const shown = Object.keys(errs).filter((k) => errs[k] !== "Required");
  const generalErrs = shown.some((k) => !k.startsWith("fort.") && !k.startsWith("rare."));
  const fortErrs = shown.some((k) => k.startsWith("fort.") || k.startsWith("rare."));
  const canRun = targets.length > 0 && !Object.keys(errs).length && !busy;
  const enabledTarget = enabledIn && targets.includes(enabledIn) ? enabledIn : undefined;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.createArea({ stacks: targets, enabledIn: enabledTarget, area: toArea(d) });
      setResults(r.results);
      const ok = r.results.filter((x) => !x.error);
      const bad = r.results.filter((x) => x.error);
      toast({
        tone: bad.length ? (ok.length ? "warning" : "error") : "success",
        text: ok.length
          ? `Area “${d.name.trim()}” created in ${ok.map((x) => name(x.stack)).join(", ")}${bad.length ? ` · failed in ${bad.map((x) => name(x.stack)).join(", ")}` : ""}`
          : bad.map((x) => `${name(x.stack)}: ${x.error}`).join(" · "),
      });
      for (const s of targets) {
        qc.invalidateQueries({ queryKey: ["dragonite-areas", s] });
      }
      qc.invalidateQueries({ queryKey: ["dragonite-geofences"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (k: "general" | "fort", label: string, bad: boolean) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", tab === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
      {bad ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-400 align-middle" /> : null}
    </button>
  );

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="New area"
      footer={
        results ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={run} disabled={!canRun}>
              {busy ? <Spinner className="size-4" /> : <Plus />}
              Create in {targets.map(name).join(", ") || "…"}
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="flex flex-col gap-2">
          {results.map((r) => (
            <div key={r.stack} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              {r.error ? <X className="size-4 shrink-0 text-red-400" /> : <Check className="size-4 shrink-0 text-green-400" />}
              <span className="font-medium">{name(r.stack)}</span>
              <span className="min-w-0 text-muted-foreground">{r.error ?? `created (id ${r.id}), ${r.enabled ? "enabled" : "disabled"}`}</span>
            </div>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRun) run();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Create in</Label>
            <div className="flex flex-wrap gap-2">
              {stacks.map((s) => {
                const on = targets.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTargets(on ? targets.filter((x) => x !== s.id) : [...targets, s.id])}
                    className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent", on && "border-primary bg-accent")}
                  >
                    <span className={cn("grid size-4 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="size-2.5 rounded-full" style={{ background: s.rotom ? color(s.rotom) : "var(--muted-foreground)" }} />
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
          {targets.length ? (
            <div className="flex flex-col gap-1.5">
              <Label>Enabled</Label>
              <div role="radiogroup" className="flex flex-wrap gap-x-4 gap-y-2">
                {[undefined, ...targets].map((id) => (
                  <label key={id ?? "none"} className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="enabled-in" checked={enabledTarget === id} onChange={() => setEnabledIn(id)} className="size-4 accent-[var(--primary)]" />
                    {id ? (targets.length > 1 ? `In ${name(id)}` : "Yes") : targets.length > 1 ? "In none" : "No"}
                  </label>
                ))}
              </div>
              {targets.length > 1 ? (
                <span className="text-[11px] text-muted-foreground">Only one stack should scan it; the others get it disabled, ready to switch over.</span>
              ) : null}
            </div>
          ) : null}

          <div className="flex gap-1 rounded-lg border p-1">
            {tabBtn("general", "General", generalErrs)}
            {tabBtn("fort", "Fort & Rare Pokémon", fortErrs)}
          </div>

          {tab === "general" ? (
            <>
              <Field label="Name" error={errs.name}>
                <Input value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={128} autoFocus />
              </Field>
              {taken.length && d.name.trim() ? (
                <p className="-mt-2 text-[11px] text-amber-400">
                  {taken.join(" and ")} already {taken.length === 1 ? "has" : "have"} an area with this name.
                </p>
              ) : null}
              <Field label={<>Geofence<Points text={d.geofence} kind="geofence" /></>} error={errs.geofence} hint="GeoJSON (Feature, Polygon or MultiPolygon), [{lat, lon}] or one “lat,lon” per line">
                <textarea className={cn(area, "min-h-28")} value={d.geofence} onChange={(e) => set("geofence", e.target.value)} spellCheck={false} />
              </Field>

              <ModeHead title="Pokémon Mode" on={d.pokemon.enabled} onChange={(v) => set("pokemon", { enabled: v })} />
              <p className="-mt-2 text-[11px] text-muted-foreground italic">Kōji routing only available after creating the area.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Workers" error={errs["pokemon.workers"]}>
                  <Input type="number" min={0} value={d.pokemon.workers} onChange={(e) => set("pokemon", { workers: e.target.value })} />
                </Field>
                <div className="flex flex-col justify-end gap-2 pb-2">
                  <Tick label="Enable for Scout Mode" on={d.pokemon.scout} onChange={(v) => set("pokemon", { scout: v })} />
                  <Tick label="Populate Invasions" on={d.pokemon.invasion} onChange={(v) => set("pokemon", { invasion: v })} />
                </div>
                <Field label={<>Route<Points text={d.pokemon.route} /></>}>
                  <textarea className={area} value={d.pokemon.route} onChange={(e) => set("pokemon", { route: e.target.value })} spellCheck={false} placeholder="lat,lon" />
                </Field>
                <Field label="Pokémon Geofence Override" error={errs["pokemon.geofence"]} hint="Leave empty to use the area's base geofence">
                  <textarea className={area} value={d.pokemon.geofence} onChange={(e) => set("pokemon", { geofence: e.target.value })} spellCheck={false} />
                </Field>
              </div>

              <ModeHead title="Quest Mode" on={d.quest.enabled} onChange={(v) => set("quest", { enabled: v })} />
              {d.quest.enabled && !d.pokemon.enabled && !d.fort.enabled ? (
                <p className="-mt-2 text-[11px] text-amber-400">
                  Quests are enabled but both Pokémon and Fort modes are off: there's no worker to switch into quest mode, so no quests will run until you enable one.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Workers" error={errs["quest.workers"]} hint="0 uses all Pokémon workers">
                  <Input type="number" min={0} value={d.quest.workers} onChange={(e) => set("quest", { workers: e.target.value })} />
                </Field>
                <Field label="Quest Hours" hint="e.g. [1,10]">
                  <Input value={d.quest.hours} onChange={(e) => set("quest", { hours: e.target.value })} spellCheck={false} className="font-mono" />
                </Field>
                <Field label={<>Route<Points text={d.quest.route} /></>}>
                  <textarea className={area} value={d.quest.route} onChange={(e) => set("quest", { route: e.target.value })} spellCheck={false} placeholder="lat,lon" />
                </Field>
                <Field label="Quest Geofence Override" error={errs["quest.geofence"]} hint="Leave empty to use the area's base geofence">
                  <textarea className={area} value={d.quest.geofence} onChange={(e) => set("quest", { geofence: e.target.value })} spellCheck={false} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <ModeHead title="Fort Mode" on={d.fort.enabled} onChange={(v) => set("fort", { enabled: v })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Workers" error={errs["fort.workers"]}>
                  <Input type="number" min={0} value={d.fort.workers} onChange={(e) => set("fort", { workers: e.target.value })} />
                </Field>
                <div className="flex flex-col justify-end gap-2 pb-2">
                  <Tick label="Priority Raids" on={d.fort.prioRaid} onChange={(v) => set("fort", { prioRaid: v })} />
                  <Tick label="Scan Showcases" on={d.fort.showcase} onChange={(v) => set("fort", { showcase: v })} />
                  <Tick label="Populate Invasions" on={d.fort.invasion} onChange={(v) => set("fort", { invasion: v })} />
                </div>
                <Field label={<>Fort Route<Points text={d.fort.route} /></>}>
                  <textarea className={area} value={d.fort.route} onChange={(e) => set("fort", { route: e.target.value })} spellCheck={false} placeholder="lat,lon" />
                </Field>
                <Field label={<>Full Fort Route<Points text={d.fort.fullRoute} /></>} hint="Used for Optimize">
                  <textarea className={area} value={d.fort.fullRoute} onChange={(e) => set("fort", { fullRoute: e.target.value })} spellCheck={false} placeholder="lat,lon" />
                </Field>
                <Field label="Fort Geofence Override" error={errs["fort.geofence"]} hint="Leave empty to use the area's base geofence">
                  <textarea className={area} value={d.fort.geofence} onChange={(e) => set("fort", { geofence: e.target.value })} spellCheck={false} />
                </Field>
              </div>

              <ModeHead title="Rare Pokémon Mode" on={d.rare.enabled} onChange={(v) => set("rare", { enabled: v })} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Workers" error={errs["rare.workers"]} hint="Only available when fort mode is enabled">
                  <Input type="number" min={0} value={d.rare.workers} onChange={(e) => set("rare", { workers: e.target.value })} />
                </Field>
                <Field label="Permyriad" error={errs["rare.permyriad"]} hint="Rarity threshold per 10,000">
                  <Input type="number" min={0} max={10000} value={d.rare.permyriad} onChange={(e) => set("rare", { permyriad: e.target.value })} />
                </Field>
                <Field label="Extra Pokémon IDs" hint="Comma-separated">
                  <Input value={d.rare.extra} onChange={(e) => set("rare", { extra: e.target.value })} spellCheck={false} />
                </Field>
              </div>
            </>
          )}
          {error ? <p className="text-red-300">{error}</p> : null}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
