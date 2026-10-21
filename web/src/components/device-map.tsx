import { useQueries, useQuery } from "@tanstack/react-query";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Info, LocateFixed, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AppInfo, InstanceInfo, MapDevice } from "@shared/types";
import { Card, Label, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { splitWorkerId } from "@/pages/workers";
import { cn, fmt } from "@/lib/utils";

/** Fonts for the cluster counts: CARTO's, the same stack its GL styles load. */
export const GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";
const FONT = ["Montserrat Medium", "Open Sans Bold", "Noto Sans Regular", "HanWangHeiLight Regular", "NanumBarunGothic Regular"];
/**
 * Points closer than CLUSTER_RADIUS px merge into one circle, up to
 * CLUSTER_MAX_ZOOM; from the next zoom on (a province in view) every device is shown.
 */
const CLUSTER_RADIUS = 40;
const CLUSTER_MAX_ZOOM = 8;
const MIXED = "#71717a";

export const isDark = () => document.documentElement.classList.contains("dark");
/** Layers this component adds on top of the basemap (kept across style swaps). */
const OUR_LAYERS = ["geofence-fill", "geofence-line", "trail", "clusters-halo", "clusters", "cluster-count", "devices-halo", "devices", "selected-glow", "selected-ring"];
const OUR_SOURCES = ["geofences", "trail", "devices", "selected"];
/** Same limit as the server's trail: further than this is a jump, not a walk. */
const JUMP_KM = 50;
const ROAMING_MODES = new Set(["InvasionMode", "ScoutMode"]);
/** Great-circle distance in km between two [lon, lat] points. */
function kmBetween([lon1, lat1]: number[], [lon2, lat2]: number[]) {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}
/** Halo of the selected device: a colour no Rotom instance uses. */
const SELECTED = "#facc15";

/**
 * What a selection follows: the controller, so it stays selected when it moves
 * to another Rotom worker; the point itself only when no controller is on it.
 */
const selKeyOf = (d: MapDevice) =>
  d.controller && !d.controllerLeftAt ? `c:${d.rotom?.instanceId ?? ""}:${d.controller}` : `id:${d.id}`;

export const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Map credits behind a small "i": closed until clicked, closed again outside. */
export function Attribution({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="absolute right-3 bottom-3 z-10 flex items-center gap-1.5">
      {open ? (
        <span
          className="map-attribution map-glass rounded-md px-2 py-1 text-[11px] text-muted-foreground"
          // From [map] tiles_attribution in config.toml (written by the admin).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Map attribution"
        aria-expanded={open}
        className={cn(
          "map-glass grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
          open && "text-foreground",
        )}
      >
        <Info className="size-3.5" />
      </button>
    </div>
  );
}

/** Golbat keeps a location for hours; a minute without data means it is not scanning there now. */
const STALE_MS = 60_000;

const MODES: Record<string, string> = {
  PokemonMode: "Pokémon",
  QuestMode: "Quests",
  FortMode: "Forts",
  InvasionMode: "Invasions",
  ScoutMode: "Scout",
  RarePokemonMode: "Rare",
  LevelMode: "Level",
};

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The map draws on a canvas, which does not resolve var(--series-n): read the colour itself. */
const resolveColor = (c: string) => {
  const m = /^var\((--[^)]+)\)$/.exec(c);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888" : c;
};

/** CARTO wants its key on every request (style, tiles, fonts, sprites). */
export function withKey(url: string, key?: string) {
  if (!key || !/(^|\.)cartocdn\.com$/.test(new URL(url).hostname) || /[?&](api_)?key=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
}

/** Vector style from style_url, or a one-layer raster style from tiles_url. */
export function baseStyle(map: NonNullable<AppInfo["map"]>, dark: boolean): string | StyleSpecification {
  const url = dark && map.styleUrlDark ? map.styleUrlDark : map.styleUrl;
  if (url) return withKey(url, map.cartoKey);
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      base: {
        type: "raster",
        tiles: [map.tilesUrl!],
        tileSize: 256,
        attribution: map.attribution,
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

const km = (a: MapDevice, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
};

/**
 * The devices around the median position, so one far away (another country)
 * does not zoom the map out to the whole world; zooming out still shows it.
 */
function mainGroup(ds: MapDevice[], radiusKm = 2500) {
  if (ds.length < 3) return ds;
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const centre = { lat: mid(ds.map((d) => d.lat)), lon: mid(ds.map((d) => d.lon)) };
  const near = ds.filter((d) => km(d, centre) <= radiusKm);
  return near.length ? near : ds;
}

/**
 * What a point is, in Rotom's terms: the controller on it (what the map
 * follows), the Rotom worker it is using, and the device that worker runs on.
 */
function facts(d: MapDevice, instanceName?: string): [string, string][] {
  const rows: [string, string][] = [];
  if (!d.controller) rows.push(["Controller", "none right now"]);
  else if (d.controllerLeftAt) rows.push(["Controller", `disconnected ${fmt.ago(d.controllerLeftAt)}`]);
  if (d.dragonite) rows.push(["Area", d.dragonite.area], ["Mode", MODES[d.dragonite.mode] ?? d.dragonite.mode]);
  else if (d.scanContext) rows.push(["Context", d.scanContext]);
  rows.push(["Worker", `#${splitWorkerId(d.id).num}`]);
  rows.push(["Device", d.rotom ? `${d.rotom.device}${instanceName ? ` · ${instanceName}` : ""}` : d.id]);
  return rows;
}

/** The controller's name; a point with none is known by its device. */
const titleOf = (d: MapDevice) => d.controller || d.rotom?.device || d.id;

/** Hover: just who it is and how fresh; the card has the rest. */
function popupHtml(d: MapDevice, dot: string) {
  const stale = Date.now() - d.lastUpdate >= STALE_MS;
  return `
    <div class="dp-head dp-compact"><span class="dp-dot" style="background:${esc(dot)}"></span><span class="dp-title">${esc(titleOf(d))}</span></div>
    <div class="dp-foot"><span class="dp-state ${stale ? "is-stale" : ""}"></span>${stale ? "No recent data · " : ""}${esc(fmt.ago(d.lastUpdate))}</div>`;
}

/** The selected controller under the summary: same facts as the hover card, plus following. */
function SelectedCard({
  className,
  d,
  dot,
  instanceName,
  following,
  trailSince,
  onFollow,
  onClose,
}: {
  className?: string;
  d?: MapDevice;
  dot: string;
  instanceName?: string;
  following: boolean;
  trailSince?: number;
  onFollow: () => void;
  onClose: () => void;
}) {
  const stale = d ? Date.now() - d.lastUpdate >= STALE_MS : true;
  const rows: [string, string][] = d
    ? [
        ...facts(d, instanceName),
        ...(d.dragonite ? ([["Dragonite", d.dragonite.name]] as [string, string][]) : []),
        ["Position", `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}`],
        // The trail drawn on the map starts here.
        ...(trailSince ? ([["Trail", `since ${fmt.time(trailSince)}`]] as [string, string][]) : []),
      ]
    : [];
  return (
    <div
      className={cn("map-glass animate-in flex-col gap-2 rounded-lg px-3.5 py-3 text-xs", className)}
      style={{ borderColor: `${SELECTED}66` }}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 0 2px ${SELECTED}` }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d ? titleOf(d) : "Off the map"}</span>
        <button type="button" onClick={onClose} aria-label="Clear selection" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      {d ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {rows.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate text-right font-medium tabular-nums">{v}</dd>
              </Fragment>
            ))}
          </dl>
          <div className="flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", stale ? "bg-muted-foreground" : "bg-green-500 shadow-[0_0_6px] shadow-green-500")} />
              {stale ? "No recent data · " : ""}
              {fmt.ago(d.lastUpdate)}
            </span>
            {following ? (
              <span className="inline-flex items-center gap-1 font-medium" style={{ color: SELECTED }}>
                <LocateFixed className="size-3.5" />
                Following
              </span>
            ) : (
              <button type="button" onClick={onFollow} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
                <LocateFixed className="size-3.5" />
                Follow
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">This controller is no longer on the map (disconnected or no Golbat data).</p>
      )}
    </div>
  );
}

/** Where the oldest of several trails starts. */
const areaSince = (trails: { data?: { t: number }[] }[]) => {
  const starts = trails.map((t) => t.data?.[0]?.t).filter((t): t is number => t !== undefined);
  return starts.length ? Math.min(...starts) : undefined;
};

/** The selected area: whose it is and how many of its controllers show their trail. */
function AreaCard({
  className,
  area,
  controllers,
  trailSince,
  onClose,
}: {
  className?: string;
  area: { name: string; stack: string; color: string };
  controllers: number;
  trailSince?: number;
  onClose: () => void;
}) {
  const rows: [string, string][] = [
    ["Dragonite", area.stack],
    ["Controllers", String(controllers)],
    ...(trailSince ? ([["Trails", `since ${fmt.time(trailSince)}`]] as [string, string][]) : []),
  ];
  return (
    <div
      className={cn("map-glass animate-in flex-col gap-2 rounded-lg px-3.5 py-3 text-xs", className)}
      style={{ borderColor: `${SELECTED}66` }}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: area.color, boxShadow: `0 0 0 2px ${SELECTED}` }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{area.name}</span>
        <button type="button" onClick={onClose} aria-label="Clear selection" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate text-right font-medium tabular-nums">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * Where every device is scanning, from Golbat's last location for each one,
 * coloured by the Rotom instance it belongs to (grey when it has gone quiet).
 */
export function DeviceMap({
  instances,
  color,
  basemap,
}: {
  instances: InstanceInfo[];
  color: (id: string) => string;
  basemap?: AppInfo["map"];
}) {
  const q = useQuery({ queryKey: ["golbat-devices"], queryFn: endpoints.golbatDevices, refetchInterval: 15_000 });
  const fences = useQuery({ queryKey: ["dragonite-geofences"], queryFn: endpoints.geofences, refetchInterval: 60_000 });
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const devicesRef = useRef<MapDevice[]>([]);
  // Where the user left the map, kept when the basemap is swapped for the theme.
  const view = useRef<{ center: maplibregl.LngLat; zoom: number } | undefined>(undefined);
  const [dark, setDark] = useState(isDark);
  // Selected controller (by selKeyOf) and whether the map keeps it centred.
  const [selKey, setSelKey] = useState<string>();
  // Selected area ("stack:areaId"): every controller working it shows its trail.
  const [selArea, setSelArea] = useState<string>();
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // A point a controller has left (it moved to another Rotom worker) is not
  // shown: the controller appears at its new point.
  const devices = (q.data ?? []).filter((d) => !d.relocatedTo);
  devicesRef.current = devices;
  const now = Date.now();
  const live = devices.filter((d) => now - d.lastUpdate < STALE_MS);
  const selected = selKey ? devices.find((d) => selKeyOf(d) === selKey) : undefined;

  // Create the map once per basemap; the devices are a GeoJSON layer on top.
  useEffect(() => {
    if (!el.current) return;
    const style = basemap
      ? baseStyle(basemap, dark)
      : // No [map]: a plain background, the points still say where things are.
        ({
          version: 8,
          glyphs: GLYPHS,
          sources: {},
          layers: [{ id: "bg", type: "background", paint: { "background-color": "#d4dadc" } }],
        } as StyleSpecification);
    const m = new maplibregl.Map({
      container: el.current,
      style,
      center: view.current?.center ?? [-3.7, 40.2],
      zoom: view.current?.zoom ?? 4.5,
      attributionControl: false,
      transformRequest: (url) => ({ url: withKey(url, basemap?.cartoKey) }),
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
    m.on("moveend", () => {
      view.current = { center: m.getCenter(), zoom: m.getZoom() };
    });
    // Attribution: our own "i" button below (closed until clicked).
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      maxWidth: "240px",
      className: "device-popup",
    });
    m.on("load", () => {
      // Outlines of each stack's enabled areas, in its colour: at the bottom,
      // under the trail and the devices.
      m.addSource("geofences", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "geofence-fill",
        type: "fill",
        source: "geofences",
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.3, 0.18] },
      });
      m.addLayer({
        id: "geofence-line",
        type: "line",
        source: "geofences",
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "selected"], ["interpolate", ["linear"], ["zoom"], 6, 2.5, 14, 4], ["interpolate", ["linear"], ["zoom"], 6, 1, 14, 2.5]],
          "line-opacity": ["case", ["get", "selected"], 1, 0.85],
        },
      });
      // A click on an area selects it (a device or cluster on top wins).
      m.on("click", "geofence-fill", (e) => {
        if (m.queryRenderedFeatures(e.point, { layers: ["devices", "clusters"] }).length) return;
        const key = e.features?.[0]?.properties?.key;
        if (typeof key !== "string") return;
        setSelKey(undefined);
        setSelArea(key);
      });
      m.on("mouseenter", "geofence-fill", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      // Hovering an area names it, unless a device is under the pointer.
      m.on("mousemove", "geofence-fill", (e) => {
        if (m.queryRenderedFeatures(e.point, { layers: ["devices", "clusters"] }).length) return;
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="dp-head dp-compact"><span class="dp-dot" style="background:${esc(String(p.color))}"></span><span class="dp-title">${esc(String(p.name))}</span></div>` +
              `<div class="dp-foot">Area · ${esc(String(p.stack))}</div>`,
          )
          .addTo(m);
      });
      m.on("mouseleave", "geofence-fill", () => {
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      // Trail of the followed controller: drawn first, so it runs under the
      // points; it fades in from its oldest end, showing which way it went.
      m.addSource("trail", { type: "geojson", lineMetrics: true, data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 14, 4.5],
          "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(250,204,21,0)", 0.35, "rgba(250,204,21,0.45)", 1, SELECTED],
        },
      });
      // Clustered source: each cluster counts its live devices per Rotom
      // instance (c0, c1…), so it can wear that instance's colour when it is
      // all one instance, and a neutral grey when it mixes several.
      const clusterProperties: Record<string, unknown> = { live: ["+", ["get", "live"]] };
      instances.forEach((_, i) => {
        clusterProperties[`c${i}`] = ["+", ["case", ["==", ["get", "inst"], i], 1, 0]];
      });
      m.addSource("devices", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: clusterProperties as never,
      });
      const clusterColor: unknown[] = ["case"];
      // Judged on its live devices only: one quiet device does not make it "mixed".
      instances.forEach((inst, i) =>
        clusterColor.push(
          ["all", [">", ["get", "live"], 0], ["==", ["get", `c${i}`], ["get", "live"]]],
          resolveColor(color(inst.id)),
        ),
      );
      clusterColor.push(MIXED);
      const stroke = dark ? "#18181b" : "#ffffff";
      // Grows with the number of devices: 2 → 13px … 20+ → 22px.
      const clusterRadius = ["interpolate", ["linear"], ["get", "point_count"], 2, 13, 8, 17, 20, 22];
      // A soft ring of the cluster's colour around it.
      m.addLayer({
        id: "clusters-halo",
        type: "circle",
        source: "devices",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": (instances.length ? clusterColor : MIXED) as never,
          "circle-radius": ["+", clusterRadius, 7] as never,
          "circle-opacity": ["case", [">", ["get", "live"], 0], 0.22, 0.08],
          "circle-blur": 0.35,
        },
      });
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "devices",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": (instances.length ? clusterColor : MIXED) as never,
          "circle-radius": clusterRadius as never,
          "circle-opacity": ["case", [">", ["get", "live"], 0], 0.95, 0.5],
          "circle-stroke-color": stroke,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.95,
        },
      });
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "devices",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": FONT,
          "text-size": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#ffffff" },
      });
      // Live devices glow in their colour; quiet ones are just a faded dot.
      m.addLayer({
        id: "devices-halo",
        type: "circle",
        source: "devices",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "live"], 1]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["+", ["get", "radius"], 6],
          "circle-opacity": 0.25,
          "circle-blur": 0.5,
        },
      });
      m.addLayer({
        id: "devices",
        type: "circle",
        source: "devices",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["get", "radius"],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": stroke,
          "circle-stroke-width": 1.5,
        },
      });
      // The selected device, on its own (unclustered) source so its ring shows
      // at any zoom, even while the device itself is inside a cluster.
      m.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "selected-glow",
        type: "circle",
        source: "selected",
        paint: { "circle-color": SELECTED, "circle-radius": 18, "circle-opacity": 0.3, "circle-blur": 0.6 },
      });
      m.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "selected",
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 11,
          "circle-stroke-color": SELECTED,
          "circle-stroke-width": 2.5,
        },
      });
      m.on("click", "devices", (e) => {
        const d = devicesRef.current.find((x) => x.id === e.features?.[0]?.properties?.id);
        if (!d) return;
        setSelKey(selKeyOf(d));
        setSelArea(undefined);
        setFollowing(true);
      });
      // A click on empty map (no device, no cluster) clears the selection.
      m.on("click", (e) => {
        if (m.queryRenderedFeatures(e.point, { layers: ["devices", "clusters"] }).length) return;
        setSelKey(undefined);
        if (!m.queryRenderedFeatures(e.point, { layers: ["geofence-fill"] }).length) setSelArea(undefined);
      });
      // Dragging the map pauses following; the card can resume it.
      m.on("dragstart", () => setFollowing(false));
      // A cluster opens by zooming in until its devices separate.
      m.on("click", "clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = m.getSource("devices") as maplibregl.GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.25 });
      });
      m.on("mouseenter", "clusters", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "clusters", () => {
        m.getCanvas().style.cursor = "";
      });
      m.on("mousemove", "devices", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const d = devicesRef.current.find((x) => x.id === f?.properties?.id);
        if (!d || !f) return;
        popup
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(popupHtml(d, String(f.properties?.color ?? "#9ca3af")))
          .addTo(m);
      });
      m.on("mouseleave", "devices", () => {
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      setReady(true);
    });
    map.current = m;
    // The card's width settles after the map is created (lazy load, the
    // sidebar sliding): keep the canvas in step so fits land where expected.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      setReady(false);
      fitted.current = false;
      m.remove();
      map.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap?.styleUrl, basemap?.styleUrlDark, basemap?.tilesUrl, basemap?.cartoKey]);

  // Theme change: swap only the basemap, keeping our layers and the view.
  const firstStyle = useRef(true);
  useEffect(() => {
    const m = map.current;
    if (!m || !basemap) return;
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    m.setStyle(baseStyle(basemap, dark), {
      transformStyle: (prev, next) => ({
        ...next,
        sources: { ...next.sources, ...Object.fromEntries(OUR_SOURCES.map((id) => [id, prev!.sources[id]])) },
        layers: [...next.layers, ...prev!.layers.filter((l) => OUR_LAYERS.includes(l.id))],
      }),
    });
    const stroke = dark ? "#18181b" : "#ffffff";
    m.once("styledata", () => {
      for (const id of ["clusters", "devices"]) if (m.getLayer(id)) m.setPaintProperty(id, "circle-stroke-color", stroke);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  const fit = () => {
    const pts = mainGroup(live.length ? live : devices);
    if (!pts.length || !map.current) return;
    map.current.resize();
    const b = new maplibregl.LngLatBounds();
    for (const d of pts) b.extend([d.lon, d.lat]);
    // Extra room at the top for the floating summary, so it covers no device.
    map.current.fitBounds(b, {
      padding: window.innerWidth < 640 ? { top: 70, bottom: 30, left: 30, right: 30 } : { top: 120, bottom: 50, left: 50, right: 50 },
      maxZoom: 13,
      duration: fitted.current ? 600 : 0,
    });
  };

  useEffect(() => {
    const src = map.current?.getSource("devices") as maplibregl.GeoJSONSource | undefined;
    if (!ready || !src) return;
    const t = Date.now();
    src.setData({
      type: "FeatureCollection",
      // Quiet devices first, so live ones are drawn on top.
      features: [...devices]
        .sort((a, b) => a.lastUpdate - b.lastUpdate)
        .map((d) => {
          const stale = t - d.lastUpdate >= STALE_MS;
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [d.lon, d.lat] },
            properties: {
              id: d.id,
              inst: stale || !d.rotom ? -1 : instances.findIndex((i) => i.id === d.rotom!.instanceId),
              live: stale ? 0 : 1,
              color: stale || !d.rotom ? "#9ca3af" : resolveColor(color(d.rotom.instanceId)),
              radius: stale ? 4.5 : 6,
              opacity: stale ? 0.55 : 1,
            },
          };
        }),
    });
    if (!fitted.current && devices.length) {
      fit();
      fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q.data, instances, color]);

  useEffect(() => {
    const src = map.current?.getSource("geofences") as maplibregl.GeoJSONSource | undefined;
    if (!ready || !src) return;
    src.setData({
      type: "FeatureCollection",
      features: (fences.data ?? []).flatMap((s) =>
        s.areas.map((a) => ({
          type: "Feature" as const,
          geometry: a.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
          properties: {
            key: `${s.id}:${a.id}`,
            selected: selArea === `${s.id}:${a.id}`,
            name: a.name,
            stack: s.name,
            color: s.rotom ? resolveColor(color(s.rotom)) : "#9ca3af",
          },
        })),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fences.data, color, selArea]);

  // The selected area and the controllers Dragonite has working it (not
  // others passing through, such as a Rocket controller).
  const area = (() => {
    if (!selArea) return undefined;
    for (const s of fences.data ?? []) {
      const a = s.areas.find((x) => `${s.id}:${x.id}` === selArea);
      if (a) return { ...a, stackId: s.id, stack: s.name, color: s.rotom ? color(s.rotom) : "#9ca3af" };
    }
    return undefined;
  })();
  const inArea = area
    ? devices.filter(
        (d) => d.controller && d.rotom && !d.controllerLeftAt && d.dragonite?.id === area.stackId && d.dragonite.area === area.name,
      )
    : [];
  const areaTrails = useQueries({
    queries: inArea.map((d) => ({
      queryKey: ["golbat-trail", d.rotom!.instanceId, d.controller],
      queryFn: () => endpoints.golbatTrail(d.rotom!.instanceId, d.controller!),
      refetchInterval: 10_000,
    })),
  });

  // Frame a newly selected area.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !area) return;
    const b = new maplibregl.LngLatBounds();
    const polygons = (area.geometry.type === "Polygon" ? [area.geometry.coordinates] : area.geometry.coordinates) as number[][][][];
    for (const poly of polygons) for (const [lon, lat] of poly[0]) b.extend([lon, lat]);
    if (!b.isEmpty()) m.fitBounds(b, { padding: window.innerWidth < 640 ? 30 : { top: 60, bottom: 40, left: 300, right: 60 }, maxZoom: 15, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selArea, !!area]);

  // The followed controller's trail (kept by the server for the last 30 min).
  const trail = useQuery({
    queryKey: ["golbat-trail", selected?.rotom?.instanceId, selected?.controller],
    queryFn: () => endpoints.golbatTrail(selected!.rotom!.instanceId, selected!.controller!),
    enabled: !!(selected?.controller && selected.rotom && !selected.controllerLeftAt),
    refetchInterval: 10_000,
  });
  useEffect(() => {
    const src = map.current?.getSource("trail") as maplibregl.GeoJSONSource | undefined;
    if (!ready || !src) return;
    // One controller's line, ending at its point as drawn now so it joins the
    // device, unless that is a jump the server would have left out of the
    // trail (Invasions and Scout controllers do travel far).
    const line = (d: MapDevice, points: { lat: number; lon: number }[] = []) => {
      const pts = points.map((p) => [p.lon, p.lat]);
      const roams = ROAMING_MODES.has(d.dragonite?.mode ?? "");
      if (pts.length && (roams || kmBetween(pts.at(-1)!, [d.lon, d.lat]) <= JUMP_KM)) pts.push([d.lon, d.lat]);
      return pts.length >= 2 ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: pts }, properties: {} }] : [];
    };
    src.setData({
      type: "FeatureCollection",
      features: area
        ? inArea.flatMap((d, i) => line(d, areaTrails[i]?.data))
        : selKey && selected
          ? line(selected, trail.data)
          : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selKey, trail.data, selected?.lat, selected?.lon, selArea, inArea.map((d) => `${d.id}${d.lat}${d.lon}`).join(), areaTrails.map((t) => t.dataUpdatedAt).join()]);

  // Put the selected device on its source; centre on it while following.
  const firstFollow = useRef<string | undefined>(undefined);
  useEffect(() => {
    const m = map.current;
    const src = m?.getSource("selected") as maplibregl.GeoJSONSource | undefined;
    if (!m || !ready || !src) return;
    src.setData({
      type: "FeatureCollection",
      features: selected ? [{ type: "Feature", geometry: { type: "Point", coordinates: [selected.lon, selected.lat] }, properties: {} }] : [],
    });
    if (!selected || !following) return;
    if (firstFollow.current !== selKey) {
      // Newly selected: close enough that it shows as a point, not a cluster.
      firstFollow.current = selKey;
      m.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(m.getZoom(), CLUSTER_MAX_ZOOM + 2), duration: 700 });
    } else m.easeTo({ center: [selected.lon, selected.lat], duration: 900 });
  }, [ready, selKey, selected?.lat, selected?.lon, following]);

  // A gentle pulse on the selection halo.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !selKey) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = (Math.sin((t - t0) / 380) + 1) / 2;
      if (m.getLayer("selected-glow")) {
        m.setPaintProperty("selected-glow", "circle-radius", 15 + k * 8);
        m.setPaintProperty("selected-glow", "circle-opacity", 0.38 - k * 0.22);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, selKey]);

  useEffect(() => {
    if (!selKey && !selArea) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelKey(undefined);
      setSelArea(undefined);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [selKey, selArea]);

  // Devices per Rotom instance, for the legend; with a single instance it
  // would only repeat the total.
  const perInstance =
    instances.length > 1
      ? instances.map((i) => ({ i, n: live.filter((d) => d.rotom?.instanceId === i.id).length })).filter((x) => x.n > 0)
      : [];
  const unknown = live.filter((d) => !d.rotom).length;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="relative">
        <div ref={el} className="h-[340px] w-full sm:h-[420px]" />

        {/* Floating column, top left: the summary and, on wide screens, the
            selected controller below it (on a phone that card goes under the map). */}
        <div className="absolute top-3 left-3 flex max-w-[calc(100%-4.5rem)] flex-col gap-2 sm:w-64 sm:max-w-[calc(100%-7rem)]">
          <div className="map-glass pointer-events-none flex flex-col gap-2 rounded-lg px-3 py-2 sm:px-3.5 sm:py-2.5">
            <span className="hidden sm:block">
              <Label>Devices</Label>
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-lg leading-none font-bold tabular-nums sm:text-2xl">{live.length}</span>
              <span className="text-xs text-muted-foreground">
                scanning
                {devices.length > live.length ? ` · ${devices.length - live.length} inactive` : ""}
              </span>
              {/* Phone: the per-Rotom counts fit on the same line, as dots. */}
              <span className="inline-flex items-center gap-2 text-xs sm:hidden">
                {perInstance.map(({ i, n }) => (
                  <span key={i.id} className="inline-flex items-center gap-1" title={i.name}>
                    <span className="size-2 rounded-full" style={{ background: color(i.id) }} />
                    <span className="font-semibold tabular-nums">{n}</span>
                  </span>
                ))}
              </span>
            </div>
            {perInstance.length || unknown ? (
              <div className="hidden flex-wrap gap-x-3 gap-y-1 text-xs sm:flex">
                {perInstance.map(({ i, n }) => (
                  <span key={i.id} className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full ring-2 ring-white/70 dark:ring-black/40" style={{ background: color(i.id) }} />
                    <span className="text-muted-foreground">{i.name}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                  </span>
                ))}
                {unknown ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-muted-foreground/60" />
                    <span className="text-muted-foreground">no Rotom</span>
                    <span className="font-semibold tabular-nums">{unknown}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {area ? (
            <AreaCard
              className="hidden sm:flex"
              area={area}
              controllers={inArea.length}
              trailSince={areaSince(areaTrails)}
              onClose={() => setSelArea(undefined)}
            />
          ) : null}
          {selKey ? (
            <SelectedCard
              className="hidden sm:flex"
          d={selected}
          dot={selected?.rotom && Date.now() - selected.lastUpdate < STALE_MS ? color(selected.rotom.instanceId) : "#9ca3af"}
          instanceName={instances.find((i) => i.id === selected?.rotom?.instanceId)?.name}
          following={following}
          trailSince={trail.data?.[0]?.t}
          onFollow={() => {
            // Resuming zooms back in too, so the device shows as a point.
            firstFollow.current = undefined;
            setFollowing(true);
          }}
          onClose={() => setSelKey(undefined)}
            />
          ) : null}
        </div>

        <button
          type="button"
          onClick={fit}
          disabled={!devices.length}
          aria-label="Fit the map to the devices"
          className="map-glass absolute top-3 right-3 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors hover:text-foreground disabled:opacity-50 sm:px-2.5 [&>svg]:size-3.5"
        >
          <Crosshair />
          <span className="hidden sm:inline">Fit</span>
        </button>

        <Attribution html={basemap?.attribution || DEFAULT_ATTRIBUTION} />
        {q.error ? (
          <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm text-red-300">
            {(q.error as Error).message}
          </div>
        ) : !q.data ? (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner />
          </div>
        ) : null}
      </div>

      {/* Phone: the selected area or controller under the map, so it hides nothing. */}
      {area ? (
        <div className="border-t p-3 sm:hidden">
          <AreaCard className="flex" area={area} controllers={inArea.length} trailSince={areaSince(areaTrails)} onClose={() => setSelArea(undefined)} />
        </div>
      ) : null}
      {selKey ? (
        <div className="border-t p-3 sm:hidden">
          <SelectedCard
            className="flex"
          d={selected}
          dot={selected?.rotom && Date.now() - selected.lastUpdate < STALE_MS ? color(selected.rotom.instanceId) : "#9ca3af"}
          instanceName={instances.find((i) => i.id === selected?.rotom?.instanceId)?.name}
          following={following}
          trailSince={trail.data?.[0]?.t}
          onFollow={() => {
            // Resuming zooms back in too, so the device shows as a point.
            firstFollow.current = undefined;
            setFollowing(true);
          }}
          onClose={() => setSelKey(undefined)}
          />
        </div>
      ) : null}
    </Card>
  );
}
