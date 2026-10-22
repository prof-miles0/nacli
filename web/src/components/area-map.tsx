// An area on a map, as Dragonite's admin draws it: its geofence, the per-mode
// geofence overrides and the routes (with each Pokémon / fort stop's scan
// range), each one a layer that can be switched off.

import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo } from "@shared/types";
import { Attribution, baseStyle, DEFAULT_ATTRIBUTION, GLYPHS, isDark, withKey } from "@/components/device-map";
import { cn, fmt } from "@/lib/utils";
import type { MapLayer } from "@/components/area-layers";

/** Metres to pixels at zoom 0 and 22 at this latitude, for a circle that keeps its real size. */
function metresAt(lat: number, m: number) {
  // MapLibre's zoom 0 shows the whole world in 512 px (not the 256 px of raster
  // tiles): the Earth's circumference / 512 metres per pixel at the equator.
  const perPx0 = (40_075_016.686 / 512) * Math.cos((lat * Math.PI) / 180);
  return ["interpolate", ["exponential", 2], ["zoom"], 0, m / perPx0, 22, (m / perPx0) * 2 ** 22];
}

export function AreaMap({ layers, basemap, className }: { layers: MapLayer[]; basemap?: AppInfo["map"]; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | undefined>(undefined);
  const [ready, setReady] = useState(false);
  // What to frame, and whether that framing is still owed: the first fit can
  // land before the container has its size (the map's code and styles load
  // lazily), so it is redone on resize until the user moves the map.
  const bounds = useRef<maplibregl.LngLatBounds | undefined>(undefined);
  const owed = useRef(true);
  const fit = () => {
    const m = map.current;
    const box = el.current;
    if (!m || !bounds.current || bounds.current.isEmpty() || !box || box.clientWidth < 10 || box.clientHeight < 10) return;
    m.resize();
    m.fitBounds(bounds.current, { padding: 40, maxZoom: 16, duration: 0 });
  };
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(layers.filter((l) => l.hidden).map((l) => l.key)));
  const dark = isDark();
  // Redrawn only when the shapes change, not on every render of the form.
  const sig = useMemo(() => {
    // A cheap fingerprint of every coordinate: any edited point redraws the map.
    let h = 0;
    const add = (x: number) => {
      h = (h * 31 + Math.round(x * 1e6)) | 0;
    };
    for (const l of layers) {
      add(l.key.length);
      for (const p of l.polygons ?? []) for (const ring of p) for (const [x, y] of ring) (add(x), add(y));
      for (const [x, y] of l.points ?? []) (add(x), add(y));
      add(l.points?.length ?? -1);
    }
    return h;
  }, [layers]);

  useEffect(() => {
    if (!el.current) return;
    const style = basemap
      ? baseStyle(basemap, dark)
      : ({ version: 8, glyphs: GLYPHS, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#d4dadc" } }] } as StyleSpecification);
    const m = new maplibregl.Map({
      container: el.current,
      style,
      center: [-3.7, 40.2],
      zoom: 4,
      attributionControl: false,
      transformRequest: (url) => ({ url: withKey(url, basemap?.cartoKey) }),
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
    m.on("load", () => setReady(true));
    // Moved by hand: stop reframing on resize.
    for (const ev of ["dragstart", "zoomstart", "rotatestart"] as const) {
      m.on(ev, (e) => {
        if ((e as { originalEvent?: unknown }).originalEvent) owed.current = false;
      });
    }
    map.current = m;
    const ro = new ResizeObserver(() => {
      m.resize();
      if (owed.current) fit();
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      setReady(false);
      m.remove();
      map.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap?.styleUrl, basemap?.tilesUrl]);

  // (Re)draw every layer: fills and outlines for geofences, a line, its stops
  // and their scan range for routes.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const id of m.getStyle().layers.map((l) => l.id).filter((id) => id.startsWith("area-"))) m.removeLayer(id);
    for (const id of Object.keys(m.getStyle().sources).filter((id) => id.startsWith("area-"))) m.removeSource(id);
    const box = new maplibregl.LngLatBounds();
    for (const l of layers) {
      const src = `area-${l.key}`;
      const features: GeoJSON.Feature[] = [];
      for (const p of l.polygons ?? []) {
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: p }, properties: {} });
        for (const [lon, lat] of p[0] ?? []) box.extend([lon, lat]);
      }
      const pts = l.points ?? [];
      if (pts.length > 1 && !l.noPath) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} });
      for (const pt of pts) {
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: pt }, properties: {} });
        box.extend(pt);
      }
      m.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features } });
      const vis = hidden.has(l.key) ? "none" : "visible";
      if (l.polygons?.length) {
        m.addLayer({ id: `${src}-fill`, type: "fill", source: src, filter: ["==", ["geometry-type"], "Polygon"], layout: { visibility: vis }, paint: { "fill-color": l.color, "fill-opacity": 0.12 } });
        m.addLayer({ id: `${src}-line`, type: "line", source: src, filter: ["==", ["geometry-type"], "Polygon"], layout: { visibility: vis }, paint: { "line-color": l.color, "line-width": 2 } });
      }
      if (pts.length) {
        const lat = pts[0][1];
        if (l.rangeM) {
          m.addLayer({
            id: `${src}-range`,
            type: "circle",
            source: src,
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: vis },
            paint: { "circle-color": l.color, "circle-opacity": 0.08, "circle-radius": metresAt(lat, l.rangeM) as never, "circle-stroke-color": l.color, "circle-stroke-opacity": 0.3, "circle-stroke-width": 1 },
          });
        }
        m.addLayer({ id: `${src}-path`, type: "line", source: src, filter: ["==", ["geometry-type"], "LineString"], layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": l.color, "line-width": 1.5, "line-opacity": 0.6 } });
        m.addLayer({ id: `${src}-stop`, type: "circle", source: src, filter: ["==", ["geometry-type"], "Point"], layout: { visibility: vis }, paint: { "circle-color": l.color, "circle-radius": 3, "circle-stroke-color": dark ? "#18181b" : "#ffffff", "circle-stroke-width": 1 } });
      }
    }
    bounds.current = box;
    owed.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig]);

  // Switching a layer only toggles its visibility.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const l of layers) {
      for (const suffix of ["fill", "line", "range", "path", "stop"]) {
        const id = `area-${l.key}-${suffix}`;
        if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", hidden.has(l.key) ? "none" : "visible");
      }
    }
  }, [ready, hidden, layers]);

  const shown = layers.filter((l) => l.polygons?.length || l.points?.length);
  const count = (l: MapLayer) => (l.points?.length ? `${fmt.int(l.points.length)} points` : `${fmt.int((l.polygons ?? []).reduce((n, p) => n + (p[0]?.length ?? 0), 0))} points`);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border", className)}>
      <div ref={el} className="h-full min-h-72 w-full" />
      {shown.length ? (
        <div className="map-glass absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-col gap-1 rounded-lg px-2.5 py-2 text-xs">
          {shown.map((l) => (
            <label key={l.key} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={!hidden.has(l.key)}
                onChange={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(l.key)) n.delete(l.key);
                    else n.add(l.key);
                    return n;
                  })
                }
                className="size-3.5 accent-[var(--primary)]"
              />
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
              <span className="truncate">{l.name}</span>
              <span className="ml-auto pl-2 text-muted-foreground tabular-nums">{count(l)}</span>
            </label>
          ))}
        </div>
      ) : null}
      <Attribution html={basemap?.attribution || DEFAULT_ATTRIBUTION} />
    </div>
  );
}
