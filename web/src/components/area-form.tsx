// The fields of an area, as Dragonite's admin form lays them out (General and
// Fort & Rare Pokémon tabs), shared by "New area" and "Edit": how they are
// read from an area, checked, and turned back into what Dragonite stores.

import { lazy, type ReactNode, Suspense, useDeferredValue, useMemo, useState } from "react";
import { Castle, Check, CircleCheck, CircleDashed, Gem, Hexagon, type LucideIcon, PawPrint, Pencil, Plus, Route, ScrollText, Settings2, Trash2, TriangleAlert, WandSparkles, Grid2x2 } from "lucide-react";
import type { AppInfo } from "@shared/types";
import { Button, HoverCard, Input, Label, Modal, Spinner } from "@/components/ui";
import { cn, fmt } from "@/lib/utils";
import { areaLayers, type MapLayer, polygonsOf } from "@/components/area-layers";
import { toast } from "@/components/toaster";

type LatLon = { lat: number; lon: number };
type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
type Geofence = LatLon[] | Geometry | { type: "Feature"; geometry: Geometry; properties: Record<string, unknown> };

/** "lat,lon" lines (anything else is skipped), as the admin's route and geofence boxes read them. */
export function parseLines(text: string): LatLon[] {
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
export function parseGeofence(text: string): Geofence | undefined {
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
export function geofencePoints(g?: Geofence) {
  if (!g) return 0;
  if (Array.isArray(g)) return g.length;
  const geom = g.type === "Feature" ? g.geometry : g;
  const polys = (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates) as number[][][][];
  return polys.reduce((n, p) => n + (p[0]?.length ?? 0), 0);
}

/** Quest hours as the admin reads them: "[1,10]" or "1, 10". */
export function parseHours(text: string) {
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

export interface Draft {
  name: string;
  geofence: string;
  pokemon: { enabled: boolean; workers: string; scout: boolean; invasion: boolean; route: string; geofence: string };
  quest: { enabled: boolean; workers: string; hours: string; route: string; geofence: string };
  fort: { enabled: boolean; workers: string; prioRaid: boolean; showcase: boolean; invasion: boolean; route: string; fullRoute: string; geofence: string };
  rare: { enabled: boolean; workers: string; permyriad: string; extra: string };
}

/** The admin's create defaults: everything off and at 0, quest hours [1,10]. */
export const EMPTY: Draft = {
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
export function toArea(d: Draft) {
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
export function problems(d: Draft) {
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

export function Field({ label, error, hint, children }: { label: ReactNode; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      {/* The hint (or the error) beside the label, not under the box: the fields stay one line tall. */}
      <span className="flex min-w-0 items-baseline gap-2">
        <Label>{label}</Label>
        {/* "Required" goes unsaid: the create button stays off until it is filled in. */}
        {error && error !== "Required" ? (
          <span className="min-w-0 truncate text-[11px] text-amber-400" title={error}>
            {error}
          </span>
        ) : hint ? (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={hint}>
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/** An option as a chip: its own drawn check box, and lit up while it is on. */
export function Tick({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm whitespace-nowrap transition-colors select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        on ? "border-primary/50 bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className={cn("grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
        {on ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      {label}
    </label>
  );
}

/** A mode's tick boxes in one row, under a label like a field's. */
function Options({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <Label>Options</Label>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Every tab lays its fields out on the same three columns on wide screens. */
const COLS = "grid items-start gap-3 sm:grid-cols-3";

export function Points({ text, kind = "route", bare }: { text: string; kind?: "route" | "geofence"; bare?: boolean }) {
  let n = 0;
  try {
    n = kind === "geofence" ? geofencePoints(parseGeofence(text)) : parseLines(text).length;
  } catch {
    // The error shows under the box.
  }
  if (bare) return <>{fmt.int(n)} points</>;
  return <span className="font-normal normal-case text-muted-foreground"> · {fmt.int(n)} points</span>;
}


/** A mode's heading with its "Enabled" switch, as the admin lays them out. */
export function ModeHead({ title, on, onChange }: { title: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-4">
      <h4 className="font-semibold">{title}</h4>
      <Tick label="Enabled" on={on} onChange={onChange} />
    </div>
  );
}


/** A geofence as the admin's box shows it: "lat,lon" lines for one plain polygon, JSON otherwise. */
export function geofenceText(g: unknown): string {
  if (!g) return "";
  if (Array.isArray(g)) return (g as LatLon[]).map((p) => `${p.lat},${p.lon}`).join("\n");
  const o = g as { type?: string; geometry?: unknown; coordinates?: unknown };
  const geom = (o.type === "Feature" ? o.geometry : o) as { type?: string; coordinates?: number[][][] } | undefined;
  if (geom?.type === "Polygon" && geom.coordinates?.length === 1) {
    const ring = geom.coordinates[0];
    // The closing point repeats the first one; the admin leaves it out.
    const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    return open.map(([lon, lat]) => `${lat},${lon}`).join("\n");
  }
  return JSON.stringify(g, null, 2);
}

export const routeText = (r: unknown) => (Array.isArray(r) ? (r as LatLon[]).map((p) => `${p.lat},${p.lon}`).join("\n") : "");

/** An area as Dragonite stores it, as the form's text fields. */
export function draftOf(a: Record<string, unknown>): Draft {
  const m = (k: string) => (a[k] ?? {}) as Record<string, unknown>;
  const p = m("pokemon_mode");
  const q = m("quest_mode");
  const f = m("fort_mode");
  const r = m("rare_pokemon_mode");
  const n = (v: unknown) => String(Number(v) || 0);
  return {
    name: String(a.name ?? ""),
    geofence: geofenceText(a.geofence),
    pokemon: { enabled: !!a.enable_pokemon, workers: n(p.workers), scout: !!p.enable_scout, invasion: !!p.invasion, route: routeText(p.route), geofence: geofenceText(p.geofence) },
    quest: { enabled: !!a.enable_quests, workers: n(q.workers), hours: Array.isArray(q.hours) ? JSON.stringify(q.hours) : "[]", route: routeText(q.route), geofence: geofenceText(q.geofence) },
    fort: {
      enabled: !!a.enable_forts,
      workers: n(f.workers),
      prioRaid: !!f.prio_raid,
      showcase: !!f.showcase,
      invasion: !!f.invasion,
      route: routeText(f.route),
      fullRoute: routeText(f.full_route),
      geofence: geofenceText(f.geofence),
    },
    rare: { enabled: !!a.enable_rare_pokemon, workers: n(r.workers), permyriad: n(r.permyriad), extra: Array.isArray(r.extra) ? (r.extra as number[]).join(", ") : "" },
  };
}

/**
 * The whole area for an edit: every mode sent complete, so a field set to 0
 * or emptied is really saved (a missing one would keep its old value).
 * Fields the form does not show are kept from `base`.
 */
export function toAreaFull(d: Draft, base: Record<string, unknown>, enabled: boolean) {
  const m = (k: string) => (base[k] ?? {}) as Record<string, unknown>;
  const was = draftOf(base);
  // A geofence or route left as it was is sent exactly as stored (its GeoJSON
  // properties and format intact), not rebuilt from the text box.
  const geo = (t: string, old: string, stored: unknown) => (t === old ? (stored ?? null) : (parseGeofence(t) ?? null));
  const route = (t: string, old: string, stored: unknown) => (t === old ? stored : parseLines(t));
  const p = d.pokemon;
  const q = d.quest;
  const f = d.fort;
  const pm = m("pokemon_mode");
  const qm = m("quest_mode");
  const fm = m("fort_mode");
  return {
    ...base,
    name: d.name.trim(),
    enabled,
    geofence: geo(d.geofence, was.geofence, base.geofence),
    enable_pokemon: p.enabled,
    enable_quests: q.enabled,
    enable_forts: f.enabled,
    enable_rare_pokemon: d.rare.enabled,
    pokemon_mode: {
      ...pm,
      workers: int(p.workers),
      enable_scout: p.scout,
      invasion: p.invasion,
      route: route(p.route, was.pokemon.route, pm.route),
      geofence: geo(p.geofence, was.pokemon.geofence, pm.geofence),
    },
    quest_mode: {
      ...qm,
      workers: int(q.workers),
      hours: q.hours === was.quest.hours ? qm.hours : parseHours(q.hours),
      route: route(q.route, was.quest.route, qm.route),
      geofence: geo(q.geofence, was.quest.geofence, qm.geofence),
    },
    fort_mode: {
      ...fm,
      workers: int(f.workers),
      prio_raid: f.prioRaid,
      showcase: f.showcase,
      invasion: f.invasion,
      route: route(f.route, was.fort.route, fm.route),
      full_route: route(f.fullRoute, was.fort.fullRoute, fm.full_route),
      geofence: geo(f.geofence, was.fort.geofence, fm.geofence),
    },
    rare_pokemon_mode: {
      ...m("rare_pokemon_mode"),
      workers: int(d.rare.workers),
      permyriad: int(d.rare.permyriad),
      extra: d.rare.extra === was.rare.extra ? m("rare_pokemon_mode").extra : ids(d.rare.extra),
    },
  };
}

/** The map layers of what the form holds now (a box that does not parse yet is just left out). */
export function draftLayers(d: Draft): Record<string, unknown> {
  const geo = (t: string) => {
    try {
      return parseGeofence(t);
    } catch {
      return undefined;
    }
  };
  return {
    geofence: geo(d.geofence),
    pokemon_mode: { route: parseLines(d.pokemon.route), geofence: geo(d.pokemon.geofence) },
    quest_mode: { route: parseLines(d.quest.route), geofence: geo(d.quest.geofence) },
    fort_mode: { route: parseLines(d.fort.route), full_route: parseLines(d.fort.fullRoute), geofence: geo(d.fort.geofence) },
  };
}

// MapLibre is large: the map loads only when a form or a view shows it.
const AreaMapLazy = lazy(() => import("@/components/area-map").then((m) => ({ default: m.AreaMap })));

/** The area on a map (geofence, overrides, routes), loaded on demand. */
export function AreaMapView({
  area,
  basemap,
  className,
  only,
  extra,
}: {
  area: Record<string, unknown>;
  basemap?: AppInfo["map"];
  className?: string;
  /** Just these layers (by key), e.g. one mode's route and override. */
  only?: string[];
  /** More layers on top (e.g. Golbat's spawnpoints). */
  extra?: MapLayer[];
}) {
  const layers = [...areaLayers(area).filter((l) => !only || only.includes(l.key)), ...(extra ?? [])];
  return (
    <Suspense fallback={<div className={cn("grid min-h-72 place-items-center rounded-lg border", className)}><Spinner /></div>}>
      {/* Remounted per set of layers, so each tab frames its own. */}
      <AreaMapLazy key={only?.join(",") ?? "all"} layers={layers} basemap={basemap} className={className} />
    </Suspense>
  );
}

export type FormTab = "general" | "pokemon" | "quest" | "fort" | "rare";

/** The tabs, each one with its mode (if any) and icon. */
const TABS: { key: FormTab; label: string; icon: LucideIcon; mode?: "pokemon" | "quest" | "fort" | "rare" }[] = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "pokemon", label: "Pokémon", icon: PawPrint, mode: "pokemon" },
  { key: "quest", label: "Quest", icon: ScrollText, mode: "quest" },
  { key: "fort", label: "Fort", icon: Castle, mode: "fort" },
  { key: "rare", label: "Rare Finder", icon: Gem, mode: "rare" },
];

/** Which tab a problem (by field key) belongs to. */
const tabOf = (k: string): FormTab => (k.startsWith("pokemon.") ? "pokemon" : k.startsWith("quest.") ? "quest" : k.startsWith("fort.") ? "fort" : k.startsWith("rare.") ? "rare" : "general");

/** The tab bar: icon, name, a dot for whether its mode is on, and a warning when a field is wrong. */
export function FormTabs({ tab, setTab, errs, d }: { tab: FormTab; setTab: (t: FormTab) => void; errs: Record<string, string>; d: Draft }) {
  const bad = new Set(Object.keys(errs).filter((k) => errs[k] !== "Required").map(tabOf));
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/30 p-1">
      {TABS.map((t) => {
        const on = t.mode ? d[t.mode].enabled : undefined;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            title={t.label}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4 shrink-0" />
            {/* On a phone only the icons fit; the name stays for screen readers and hover. */}
            <span className="sr-only sm:not-sr-only">{t.label}</span>
            {on !== undefined ? (
              <span title={on ? "Enabled" : "Disabled"} className={cn("size-1.5 rounded-full", on ? "bg-green-500" : "bg-muted-foreground/40")} />
            ) : null}
            {bad.has(t.key) ? <span title="A field needs fixing" className="size-1.5 rounded-full bg-amber-400" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The Areas page's on/off switch: green when on. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors", on ? "bg-green-500" : "bg-muted-foreground/30")}
    >
      <span className={cn("absolute size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

/** A row with a title, a line of help and a switch at its end (e.g. the area's "Enabled"). */
export function SwitchRow({ title, hint, on, onChange, dot }: { title: ReactNode; hint?: ReactNode; on: boolean; onChange: (v: boolean) => void; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
      <span className="flex min-w-0 items-center gap-2.5">
        {dot ? <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot }} /> : null}
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{title}</span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </span>
      </span>
      <Toggle on={on} onChange={onChange} label={typeof title === "string" ? title : "Enabled"} />
    </div>
  );
}

/** A tab's header: what the mode does and its switch. */
function TabHead({ title, text, on, onChange, children }: { title: string; text: string; on?: boolean; onChange?: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h4 className="font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
      {on !== undefined && onChange ? (
        // Its state beside the switch: to the left on wide screens, above it on phones.
        <span className="flex shrink-0 flex-col items-center gap-1 sm:flex-row sm:gap-2">
          <span className={cn("text-xs font-medium sm:text-sm", on ? "text-green-400" : "text-muted-foreground")}>{on ? "Enabled" : "Disabled"}</span>
          <Toggle on={on} onChange={onChange} label={`${title} enabled`} />
        </span>
      ) : null}
      {children}
    </div>
  );
}

export type KojiMode = "pokemon" | "fort" | "quest";

/** Asks Kōji, through Dragonite, for a mode's route (editing an area whose Dragonite has Kōji). */
export interface Koji {
  available: boolean;
  /** Dragonite stores the new route; resolves with its point count. */
  run: (mode: KojiMode, bootstrap: boolean) => Promise<number>;
}

/** The admin's Kōji buttons for each mode's route. */
const KOJI_OPTIONS: Record<KojiMode, { bootstrap: boolean; label: string; icon: LucideIcon }[]> = {
  pokemon: [
    { bootstrap: false, label: "Get 70m route", icon: WandSparkles },
    { bootstrap: true, label: "Get 70m bootstrap", icon: Grid2x2 },
  ],
  fort: [
    { bootstrap: false, label: "Get 9x9 route", icon: WandSparkles },
    { bootstrap: true, label: "Get 9x9 bootstrap", icon: Grid2x2 },
  ],
  quest: [{ bootstrap: false, label: "Get quest route", icon: WandSparkles }],
};

const MODE_NAME: Record<KojiMode, string> = { pokemon: "Pokémon", fort: "Fort", quest: "Quest" };

/**
 * A route or geofence: its name and point count, and a button that opens the
 * box to enter or paste its points (they run to hundreds of lines). A mode's
 * route also gets the Kōji buttons when the area's Dragonite has Kōji.
 */
function Coords({
  label,
  value,
  onChange,
  kind = "route",
  error,
  hint,
  placeholder,
  emptyText = "Empty",
  basemap,
  koji,
  kojiMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  kind?: "route" | "geofence";
  error?: string;
  hint?: string;
  placeholder?: string;
  /** What an empty one means (an override: the area's geofence). */
  emptyText?: string;
  basemap?: AppInfo["map"];
  koji?: Koji;
  kojiMode?: KojiMode;
}) {
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<{ bootstrap: boolean; label: string }>();
  const Icon = kind === "geofence" ? Hexagon : Route;
  const empty = !value.trim();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-12 items-center gap-2.5 rounded-lg border px-3 py-1.5 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-medium">{label}</span>
          {error && error !== "Required" ? (
            <span className="truncate text-[11px] text-amber-400">{error}</span>
          ) : (
            <span className="truncate text-[11px] text-muted-foreground">{empty ? emptyText : <Points text={value} kind={kind} bare />}</span>
          )}
        </span>
        {koji?.available && kojiMode
          ? KOJI_OPTIONS[kojiMode].map((o) => (
              <HoverCard
                key={o.label}
                className="inline-flex"
                content={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-medium">
                      <o.icon className="size-3.5 text-violet-400" />
                      {o.label}
                    </span>
                    <span className="text-muted-foreground">From Kōji · saved at once</span>
                  </span>
                }
              >
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-8 text-muted-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-300 focus-visible:text-violet-300"
                  aria-label={`${o.label} from Kōji`}
                  onClick={() => setAsking(o)}
                >
                  <o.icon />
                </Button>
              </HoverCard>
            ))
          : null}
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          {empty ? <Plus /> : <Pencil />}
          {empty ? "Add" : "Edit"}
        </Button>
      </div>
      {asking && koji && kojiMode ? (
        <KojiModal mode={kojiMode} option={asking} points={empty ? 0 : parseLines(value).length} run={() => koji.run(kojiMode, asking.bootstrap)} onClose={() => setAsking(undefined)} />
      ) : null}
      {editing ? (
        <CoordsModal
          label={label}
          kind={kind}
          value={value}
          hint={hint}
          placeholder={placeholder}
          emptyText={emptyText}
          basemap={basemap}
          onApply={(v) => {
            onChange(v);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The admin's Kōji confirmation: Dragonite asks Kōji for the route and stores
 * it straight away, replacing the saved one (Save is not needed).
 */
function KojiModal({ mode, option, points, run, onClose }: { mode: KojiMode; option: { bootstrap: boolean; label: string }; points: number; run: () => Promise<number>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const n = await run();
      toast({ tone: "success", text: `Kōji: ${MODE_NAME[mode]} route saved with ${fmt.int(n)} points` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      icon={<WandSparkles />}
      title={option.label}
      description="From Kōji, through Dragonite"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={go} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : <WandSparkles />}
            {busy ? "Asking Kōji…" : "Get route"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p>
          Dragonite asks Kōji for the {option.bootstrap ? "bootstrap " : ""}route and <b>saves it right away</b>, replacing the stored {MODE_NAME[mode]} route
          {points ? ` (${fmt.int(points)} points)` : ""}.
        </p>
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Kōji works from the saved geofence: save geofence changes first. Other unsaved changes stay in the form.
        </p>
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}

/** The box for one route or geofence: paste or type its points, checked and drawn as they are read. */
function CoordsModal({
  label,
  kind,
  value,
  hint,
  placeholder,
  emptyText,
  basemap,
  onApply,
  onClose,
}: {
  label: string;
  kind: "route" | "geofence";
  value: string;
  hint?: string;
  placeholder?: string;
  emptyText: string;
  basemap?: AppInfo["map"];
  onApply: (v: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  // The map follows the text a beat behind, so typing stays smooth.
  const shown = useDeferredValue(text);
  let n = 0;
  let problem: string | undefined;
  try {
    n = kind === "geofence" ? geofencePoints(parseGeofence(text)) : parseLines(text).length;
  } catch (e) {
    problem = (e as Error).message;
  }
  const layers = useMemo<MapLayer[]>(() => {
    try {
      if (kind === "geofence") return [{ key: "edit", name: label, color: "#3b82f6", polygons: polygonsOf(parseGeofence(shown)) }];
      return [{ key: "edit", name: label, color: "#22c55e", points: parseLines(shown).map((p) => [p.lon, p.lat] as [number, number]) }];
    } catch {
      return [];
    }
  }, [shown, kind, label]);
  const Icon = kind === "geofence" ? Hexagon : Route;
  const lines = text ? text.split("\n").length : 0;
  return (
    <Modal
      open
      large
      tall
      onClose={onClose}
      icon={<Icon />}
      title={label}
      description={
        <>
          {kind === "geofence" ? FENCE_HINT : "One “lat,lon” per line, in the order the workers walk them."}
          {hint && hint !== FENCE_HINT ? ` ${hint}.` : ""}
        </>
      }
      footer={
        <>
          <Button type="button" variant="ghost" className="mr-auto" onClick={() => setText("")} disabled={!text}>
            <Trash2 />
            Clear
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onApply(text)} disabled={!!problem || text === value}>
            <Check />
            Apply
          </Button>
        </>
      }
    >
      {/* The editor and, beside it (above it on phones), the points it reads on a map. */}
      <div className="grid h-full min-h-0 grid-rows-[10rem_minmax(16rem,1fr)] gap-3 sm:grid-cols-2 sm:grid-rows-1 sm:gap-4">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-muted/20 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
          <textarea
            className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2.5 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoFocus
            placeholder={placeholder ?? "lat,lon"}
          />
          <div className="flex items-center gap-2 border-t bg-card/60 px-3 py-2 text-xs">
            {problem ? (
              <TriangleAlert className="size-3.5 shrink-0 text-amber-400" />
            ) : text.trim() ? (
              <CircleCheck className="size-3.5 shrink-0 text-green-400" />
            ) : (
              <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={cn("min-w-0 flex-1 truncate tabular-nums", problem ? "text-amber-400" : "text-muted-foreground")}>
              {problem ?? (text.trim() ? `${fmt.int(n)} points` : emptyText)}
            </span>
            {lines ? <span className="shrink-0 text-muted-foreground tabular-nums">{fmt.int(lines)} lines</span> : null}
          </div>
        </div>
        <div className="order-first min-h-0 sm:order-last">
          <Suspense fallback={<div className="grid h-full place-items-center rounded-lg border"><Spinner /></div>}>
            <AreaMapLazy layers={layers} basemap={basemap} className="h-full min-h-0" />
          </Suspense>
        </div>
      </div>
    </Modal>
  );
}

const FENCE_HINT = "GeoJSON (Feature, Polygon or MultiPolygon), [{lat, lon}] or one “lat,lon” per line";

/**
 * One tab of the area form: only its own fields (the map stays above the
 * tabs). `general` adds what the caller needs on that tab (the stacks to
 * create in, or the area's Enabled switch).
 */
export function AreaFields({
  d,
  set,
  errs,
  tab,
  create,
  basemap,
  nameNote,
  general,
  enabled,
  koji,
}: {
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => void;
  errs: Record<string, string>;
  tab: FormTab;
  create?: boolean;
  /** Kōji buttons on the routes (editing only). */
  koji?: Koji;
  basemap?: AppInfo["map"];
  /** Under the name (e.g. "already used"). */
  nameNote?: ReactNode;
  /** Extra fields at the top of the General tab. */
  general?: ReactNode;
  /** The area's own switch, in the General tab's header (when editing). */
  enabled?: { on: boolean; onChange: (v: boolean) => void };
}) {
  const kojiNote = create ? <p className="text-[11px] text-muted-foreground italic">Kōji routing is only available after creating the area.</p> : null;

  const fields =
    tab === "general" ? (
      <>
        <TabHead title="General" text="The area's name and the geofence every mode scans, unless a mode overrides it." on={enabled?.on} onChange={enabled?.onChange} />
        {general}
        <div className={COLS}>
          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
            <Field label="Name" error={errs.name}>
              <Input value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={128} autoFocus={create} className="sm:h-12" />
            </Field>
            {nameNote}
          </div>
          {/* Level with the name's box, below its label. */}
          <div className="min-w-0 sm:pt-[1.375rem]">
            <Coords basemap={basemap} label="Geofence" kind="geofence" value={d.geofence} onChange={(v) => set("geofence", v)} error={errs.geofence} hint={FENCE_HINT} placeholder="lat,lon — or GeoJSON" />
          </div>
        </div>
      </>
    ) : tab === "pokemon" ? (
      <>
        <TabHead title="Pokémon" text="Walks its route finding and encountering Pokémon." on={d.pokemon.enabled} onChange={(v) => set("pokemon", { enabled: v })} />
        <div className={COLS}>
          <Field label="Workers" error={errs["pokemon.workers"]}>
            <Input type="number" min={0} value={d.pokemon.workers} onChange={(e) => set("pokemon", { workers: e.target.value })} />
          </Field>
          <Options>
            <Tick label="Enable for Scout Mode" on={d.pokemon.scout} onChange={(v) => set("pokemon", { scout: v })} />
            <Tick label="Populate Invasions" on={d.pokemon.invasion} onChange={(v) => set("pokemon", { invasion: v })} />
          </Options>
        </div>
        <div className={COLS}>
          <Coords basemap={basemap} koji={koji} kojiMode="pokemon" label="Route" value={d.pokemon.route} onChange={(v) => set("pokemon", { route: v })} />
          <Coords basemap={basemap} label="Geofence override" kind="geofence" value={d.pokemon.geofence} onChange={(v) => set("pokemon", { geofence: v })} error={errs["pokemon.geofence"]} hint="Leave it empty to use the area's geofence" placeholder="Empty: the area's geofence" emptyText="The area's geofence" />
        </div>
        {kojiNote}
      </>
    ) : tab === "quest" ? (
      <>
        <TabHead title="Quest" text="Spins every Pokéstop at the quest hours, with workers lent by the Pokémon and Fort modes." on={d.quest.enabled} onChange={(v) => set("quest", { enabled: v })} />
        {d.quest.enabled && !d.pokemon.enabled && !d.fort.enabled ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Pokémon and Fort modes are both off: no worker can switch to quests until one of them is on.
          </p>
        ) : null}
        <div className={COLS}>
          <Field label="Workers" error={errs["quest.workers"]} hint="0 = all">
            <Input type="number" min={0} value={d.quest.workers} onChange={(e) => set("quest", { workers: e.target.value })} />
          </Field>
          <Field label="Quest hours" hint="e.g. [1,10]">
            <Input value={d.quest.hours} onChange={(e) => set("quest", { hours: e.target.value })} spellCheck={false} className="font-mono" />
          </Field>
        </div>
        <div className={COLS}>
          <Coords basemap={basemap} koji={koji} kojiMode="quest" label="Route" value={d.quest.route} onChange={(v) => set("quest", { route: v })} />
          <Coords basemap={basemap} label="Geofence override" kind="geofence" value={d.quest.geofence} onChange={(v) => set("quest", { geofence: v })} error={errs["quest.geofence"]} hint="Leave it empty to use the area's geofence" placeholder="Empty: the area's geofence" emptyText="The area's geofence" />
        </div>
        {kojiNote}
      </>
    ) : tab === "fort" ? (
      <>
        <TabHead title="Fort" text="Visits gyms and Pokéstops: raids, invasions and showcases." on={d.fort.enabled} onChange={(v) => set("fort", { enabled: v })} />
        <div className={COLS}>
          <Field label="Workers" error={errs["fort.workers"]}>
            <Input type="number" min={0} value={d.fort.workers} onChange={(e) => set("fort", { workers: e.target.value })} />
          </Field>
          <Options>
            <Tick label="Priority Raids" on={d.fort.prioRaid} onChange={(v) => set("fort", { prioRaid: v })} />
            <Tick label="Scan Showcases" on={d.fort.showcase} onChange={(v) => set("fort", { showcase: v })} />
            <Tick label="Populate Invasions" on={d.fort.invasion} onChange={(v) => set("fort", { invasion: v })} />
          </Options>
        </div>
        <div className={COLS}>
          <Coords basemap={basemap} koji={koji} kojiMode="fort" label="Route" value={d.fort.route} onChange={(v) => set("fort", { route: v })} />
          <Coords basemap={basemap} label="Full route" value={d.fort.fullRoute} onChange={(v) => set("fort", { fullRoute: v })} hint="Used for Optimize" />
          <Coords basemap={basemap} label="Geofence override" kind="geofence" value={d.fort.geofence} onChange={(v) => set("fort", { geofence: v })} error={errs["fort.geofence"]} hint="Leave it empty to use the area's geofence" placeholder="Empty: the area's geofence" emptyText="The area's geofence" />
        </div>
        {kojiNote}
      </>
    ) : (
      <>
        <TabHead title="Rare Finder" text="Hunts the rarest Pokémon of the area, below a rarity threshold." on={d.rare.enabled} onChange={(v) => set("rare", { enabled: v })} />
        {d.rare.enabled && !d.fort.enabled ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">It only runs while the Fort mode is on.</p>
        ) : null}
        <div className={COLS}>
          <Field label="Workers" error={errs["rare.workers"]} hint="needs Fort">
            <Input type="number" min={0} value={d.rare.workers} onChange={(e) => set("rare", { workers: e.target.value })} />
          </Field>
          <Field label="Permyriad" error={errs["rare.permyriad"]} hint="per 10,000">
            <Input type="number" min={0} max={10000} value={d.rare.permyriad} onChange={(e) => set("rare", { permyriad: e.target.value })} />
          </Field>
          <Field label="Extra Pokémon IDs" hint="always hunted">
            <Input value={d.rare.extra} onChange={(e) => set("rare", { extra: e.target.value })} spellCheck={false} placeholder="e.g. 147, 371" />
          </Field>
        </div>
      </>
    );

  return <div className="flex min-w-0 flex-col gap-4">{fields}</div>;
}

/**
 * The whole form: the area's map on top (every layer, following each edit),
 * the tabs, and the fields of the tab chosen below them.
 */
export function AreaForm({
  d,
  set,
  errs,
  tab,
  setTab,
  create,
  basemap,
  nameNote,
  general,
  enabled,
  koji,
}: {
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => void;
  errs: Record<string, string>;
  tab: FormTab;
  setTab: (t: FormTab) => void;
  koji?: Koji;
  create?: boolean;
  basemap?: AppInfo["map"];
  nameNote?: ReactNode;
  general?: ReactNode;
  enabled?: { on: boolean; onChange: (v: boolean) => void };
}) {
  return (
    // The map takes the height the tab's fields leave, so the modal keeps its size between tabs.
    <div className="flex flex-1 flex-col gap-4">
      <AreaMapView area={draftLayers(d)} basemap={basemap} className="h-64 shrink-0 sm:h-auto sm:min-h-32 sm:flex-1" />
      <FormTabs tab={tab} setTab={setTab} errs={errs} d={d} />
      {/* The same height on every tab, so the map and the tabs above never move. */}
      <div className="shrink-0 sm:h-52 sm:overflow-y-auto">
        <AreaFields d={d} set={set} errs={errs} tab={tab} create={create} basemap={basemap} nameNote={nameNote} general={general} enabled={enabled} koji={koji} />
      </div>
    </div>
  );
}
