// The fields of an area, as Dragonite's admin form lays them out (General and
// Fort & Rare Pokémon tabs), shared by "New area" and "Edit": how they are
// read from an area, checked, and turned back into what Dragonite stores.

import { lazy, type ReactNode, Suspense } from "react";
import { Castle, ChevronRight, Gem, type LucideIcon, PawPrint, ScrollText, Settings2 } from "lucide-react";
import type { AppInfo } from "@shared/types";
import { Input, Label, Spinner } from "@/components/ui";
import { cn, fmt } from "@/lib/utils";
import { areaLayers, type MapLayer } from "@/components/area-layers";

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
      <Label>{label}</Label>
      {children}
      {/* "Required" goes unsaid: the create button stays off until it is filled in. */}
      {error && error !== "Required" ? <span className="text-[11px] text-amber-400">{error}</span> : hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Tick({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

export function Points({ text, kind = "route" }: { text: string; kind?: "route" | "geofence" }) {
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

const routeText = (r: unknown) => (Array.isArray(r) ? (r as LatLon[]).map((p) => `${p.lat},${p.lon}`).join("\n") : "");

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

/** A switch for a mode's header, saying its state beside it. */
function ModeSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-2 text-sm font-medium">
      <Toggle on={on} onChange={onChange} label="Enabled" />
      <span className={on ? "text-green-400" : "text-muted-foreground"}>{on ? "Enabled" : "Disabled"}</span>
    </span>
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
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h4 className="font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
      {on !== undefined && onChange ? <ModeSwitch on={on} onChange={onChange} /> : null}
      {children}
    </div>
  );
}

/**
 * A route or geofence box, folded to its label and point count (they run to
 * hundreds of lines); unfolded when empty, so it is easy to fill in.
 */
function Coords({
  label,
  value,
  onChange,
  kind = "route",
  error,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  kind?: "route" | "geofence";
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <details open={!value.trim() || (!!error && error !== "Required")} className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">{label}</span>
        <Points text={value} kind={kind} />
        {error && error !== "Required" ? <span className="ml-auto text-[11px] text-amber-400">{error}</span> : null}
      </summary>
      <div className="flex flex-col gap-1.5 px-3 pb-3">
        <textarea className={cn(area, "min-h-32")} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder={placeholder ?? "lat,lon"} />
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
    </details>
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
}: {
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => void;
  errs: Record<string, string>;
  tab: FormTab;
  create?: boolean;
  basemap?: AppInfo["map"];
  /** Under the name (e.g. "already used"). */
  nameNote?: ReactNode;
  /** Extra fields at the top of the General tab. */
  general?: ReactNode;
}) {
  const kojiNote = create ? <p className="text-[11px] text-muted-foreground italic">Kōji routing is only available after creating the area.</p> : null;

  const fields =
    tab === "general" ? (
      <>
        <TabHead title="General" text="The area's name and the geofence every mode scans, unless a mode overrides it." />
        {general}
        <Field label="Name" error={errs.name}>
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={128} autoFocus={create} />
        </Field>
        {nameNote}
        <Coords label="Geofence" kind="geofence" value={d.geofence} onChange={(v) => set("geofence", v)} error={errs.geofence} hint={FENCE_HINT} placeholder="lat,lon — or GeoJSON" />
      </>
    ) : tab === "pokemon" ? (
      <>
        <TabHead title="Pokémon" text="Walks its route finding and encountering Pokémon." on={d.pokemon.enabled} onChange={(v) => set("pokemon", { enabled: v })} />
        <Field label="Workers" error={errs["pokemon.workers"]}>
          <Input type="number" min={0} value={d.pokemon.workers} onChange={(e) => set("pokemon", { workers: e.target.value })} />
        </Field>
        <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
          <Tick label="Enable for Scout Mode" on={d.pokemon.scout} onChange={(v) => set("pokemon", { scout: v })} />
          <Tick label="Populate Invasions" on={d.pokemon.invasion} onChange={(v) => set("pokemon", { invasion: v })} />
        </div>
        <Coords label="Route" value={d.pokemon.route} onChange={(v) => set("pokemon", { route: v })} />
        <Coords label="Geofence override" kind="geofence" value={d.pokemon.geofence} onChange={(v) => set("pokemon", { geofence: v })} error={errs["pokemon.geofence"]} hint="Leave empty to use the area's base geofence" placeholder="Empty: the area's geofence" />
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Workers" error={errs["quest.workers"]} hint="0 uses all Pokémon workers">
            <Input type="number" min={0} value={d.quest.workers} onChange={(e) => set("quest", { workers: e.target.value })} />
          </Field>
          <Field label="Quest hours" hint="e.g. [1,10]">
            <Input value={d.quest.hours} onChange={(e) => set("quest", { hours: e.target.value })} spellCheck={false} className="font-mono" />
          </Field>
        </div>
        <Coords label="Route" value={d.quest.route} onChange={(v) => set("quest", { route: v })} />
        <Coords label="Geofence override" kind="geofence" value={d.quest.geofence} onChange={(v) => set("quest", { geofence: v })} error={errs["quest.geofence"]} hint="Leave empty to use the area's base geofence" placeholder="Empty: the area's geofence" />
        {kojiNote}
      </>
    ) : tab === "fort" ? (
      <>
        <TabHead title="Fort" text="Visits gyms and Pokéstops: raids, invasions and showcases." on={d.fort.enabled} onChange={(v) => set("fort", { enabled: v })} />
        <Field label="Workers" error={errs["fort.workers"]}>
          <Input type="number" min={0} value={d.fort.workers} onChange={(e) => set("fort", { workers: e.target.value })} />
        </Field>
        <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
          <Tick label="Priority Raids" on={d.fort.prioRaid} onChange={(v) => set("fort", { prioRaid: v })} />
          <Tick label="Scan Showcases" on={d.fort.showcase} onChange={(v) => set("fort", { showcase: v })} />
          <Tick label="Populate Invasions" on={d.fort.invasion} onChange={(v) => set("fort", { invasion: v })} />
        </div>
        <Coords label="Route" value={d.fort.route} onChange={(v) => set("fort", { route: v })} />
        <Coords label="Full route" value={d.fort.fullRoute} onChange={(v) => set("fort", { fullRoute: v })} hint="Used for Optimize" />
        <Coords label="Geofence override" kind="geofence" value={d.fort.geofence} onChange={(v) => set("fort", { geofence: v })} error={errs["fort.geofence"]} hint="Leave empty to use the area's base geofence" placeholder="Empty: the area's geofence" />
        {kojiNote}
      </>
    ) : (
      <>
        <TabHead title="Rare Finder" text="Hunts the rarest Pokémon of the area, below a rarity threshold." on={d.rare.enabled} onChange={(v) => set("rare", { enabled: v })} />
        {d.rare.enabled && !d.fort.enabled ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">It only runs while the Fort mode is on.</p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Workers" error={errs["rare.workers"]} hint="Only available when fort mode is enabled">
            <Input type="number" min={0} value={d.rare.workers} onChange={(e) => set("rare", { workers: e.target.value })} />
          </Field>
          <Field label="Permyriad" error={errs["rare.permyriad"]} hint="Rarity threshold per 10,000">
            <Input type="number" min={0} max={10000} value={d.rare.permyriad} onChange={(e) => set("rare", { permyriad: e.target.value })} />
          </Field>
        </div>
        <Field label="Extra Pokémon IDs" hint="Comma-separated, always hunted">
          <Input value={d.rare.extra} onChange={(e) => set("rare", { extra: e.target.value })} spellCheck={false} placeholder="e.g. 147, 371" />
        </Field>
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
}: {
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => void;
  errs: Record<string, string>;
  tab: FormTab;
  setTab: (t: FormTab) => void;
  create?: boolean;
  basemap?: AppInfo["map"];
  nameNote?: ReactNode;
  general?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <AreaMapView area={draftLayers(d)} basemap={basemap} className="h-64 sm:h-80" />
      <FormTabs tab={tab} setTab={setTab} errs={errs} d={d} />
      <AreaFields d={d} set={set} errs={errs} tab={tab} create={create} basemap={basemap} nameNote={nameNote} general={general} />
    </div>
  );
}
