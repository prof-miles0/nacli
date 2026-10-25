// One area's spawnpoints on a map, coloured by what the page asks: despawn time
// known or not, how long since Golbat last saw it, or their density. Loaded lazily, with MapLibre.

import maplibregl, { type ExpressionSpecification, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, SpawnpointMap as SpawnpointData } from "@shared/types";
import { Attribution, baseStyle, DEFAULT_ATTRIBUTION, GLYPHS, isDark, withKey } from "@/components/device-map";
import { polygonsOf } from "@/components/area-layers";
import { categoryKeys, KNOWN, SEEN, type SpawnMode } from "@/lib/spawnpoints";
import { cn, fmt } from "@/lib/utils";

const COLOR: Record<Exclude<SpawnMode, "density">, ExpressionSpecification> = {
  known: ["case", [">=", ["get", "d"], 0], KNOWN.yes, KNOWN.no],
  seen: ["step", ["get", "a"], SEEN[0].color, ...SEEN.slice(0, -1).flatMap((s, i) => [s.max, SEEN[i + 1].color])] as ExpressionSpecification,
};

const LAYERS = ["sp-fence-fill", "sp-fence-line", "sp-heat", "sp-points"];

const despawnText = (d: number) => (d < 0 ? "Despawn time unknown" : `Despawns at :${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`);

export function SpawnpointMap({
  data,
  mode,
  hidden,
  basemap,
  className,
}: {
  data: SpawnpointData;
  mode: SpawnMode;
  /** Categories of this mode left off the map (keys from `categories`). */
  hidden: string[];
  basemap?: AppInfo["map"];
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const dark = isDark();
  // The area to frame, redone on resize until the map is moved by hand: the
  // first fit can land before the lazily loaded map has its final size.
  const bounds = useRef<maplibregl.LngLatBounds | undefined>(undefined);
  const owed = useRef(true);
  const fit = () => {
    const m = map.current;
    if (!m || !bounds.current || bounds.current.isEmpty()) return;
    // Its size first: the container can have changed since the map measured it.
    m.resize();
    m.fitBounds(bounds.current, { padding: 24, maxZoom: 16, duration: 0 });
  };

  const nowS = Math.floor(data.checkedAt / 1000);
  const points = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: data.points.map(([lat, lon, d, seen]) => {
        const a = Math.max(0, nowS - seen);
        // c_<mode>: its legend category in each mode, for the legend's filter.
        const c = categoryKeys(d, a);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { d, a, c_known: c.known, c_seen: c.seen },
        };
      }),
    }),
    [data.points, nowS],
  );
  const fence = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: polygonsOf(data.geometry).map((p) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: p }, properties: {} })),
    }),
    [data.geometry],
  );

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
    for (const ev of ["dragstart", "zoomstart", "rotatestart"] as const) {
      m.on(ev, (e) => {
        if ((e as { originalEvent?: unknown }).originalEvent) owed.current = false;
      });
    }
    // One popup, moved to whichever spawnpoint the pointer is over.
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: "device-popup" });
    m.on("mousemove", "sp-points", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      m.getCanvas().style.cursor = "pointer";
      const { d, a } = f.properties as { d: number; a: number };
      popup
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`<div style="font-size:12px;line-height:1.5"><b>${despawnText(d)}</b><br/>Last seen ${fmt.ago(Date.now() - a * 1000)}</div>`)
        .addTo(m);
    });
    m.on("mouseleave", "sp-points", () => {
      m.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.current = m;
    const ro = new ResizeObserver(() => {
      m.resize();
      if (owed.current) fit();
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      setReady(false);
      popup.remove();
      m.remove();
      map.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap?.styleUrl, basemap?.tilesUrl]);

  // The area and its points: redrawn when the area changes, framed on it.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const id of LAYERS) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of ["sp-fence", "sp"]) if (m.getSource(id)) m.removeSource(id);
    m.addSource("sp-fence", { type: "geojson", data: fence });
    m.addSource("sp", { type: "geojson", data: points });
    m.addLayer({ id: "sp-fence-fill", type: "fill", source: "sp-fence", paint: { "fill-color": "#38bdf8", "fill-opacity": 0.06 } });
    m.addLayer({ id: "sp-fence-line", type: "line", source: "sp-fence", paint: { "line-color": "#38bdf8", "line-width": 2 } });
    m.addLayer({
      id: "sp-heat",
      type: "heatmap",
      source: "sp",
      paint: {
        // Light per point: a city area holds thousands, and heavier weights turn it all red.
        "heatmap-weight": 0.12,
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 10, 16, 24],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 1.2],
        "heatmap-opacity": 0.85,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,0,0)",
          0.15,
          "#1e3a8a",
          0.35,
          "#2563eb",
          0.55,
          "#22c55e",
          0.75,
          "#facc15",
          1,
          "#ef4444",
        ],
      },
    });
    m.addLayer({
      id: "sp-points",
      type: "circle",
      source: "sp",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 3, 17, 6],
        "circle-stroke-color": dark ? "#18181b" : "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0, 15, 1],
        "circle-opacity": 0.9,
      },
    });
    const box = new maplibregl.LngLatBounds();
    for (const f of fence.features) for (const [lon, lat] of (f.geometry as GeoJSON.Polygon).coordinates[0] ?? []) box.extend([lon, lat]);
    bounds.current = box;
    owed.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, points, fence]);

  // The colouring: only paint and visibility change, the data stays.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer("sp-points")) return;
    const heat = mode === "density";
    m.setLayoutProperty("sp-heat", "visibility", heat ? "visible" : "none");
    m.setPaintProperty("sp-points", "circle-color", heat ? (dark ? "#e4e4e7" : "#27272a") : COLOR[mode]);
    // Over the heatmap the points only appear close in, to pick one out.
    const closeIn: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 0.8];
    m.setPaintProperty("sp-points", "circle-opacity", heat ? closeIn : 0.9);
    m.setPaintProperty("sp-points", "circle-stroke-opacity", heat ? closeIn : 1);
  }, [mode, ready, points, dark]);

  // What the legend leaves out, off the points and the heatmap alike.
  const hiddenKey = hidden.join(",");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer("sp-points")) return;
    const filter: ExpressionSpecification | null =
      mode !== "density" && hidden.length ? ["!", ["in", ["get", `c_${mode}`], ["literal", hidden]]] : null;
    m.setFilter("sp-points", filter);
    m.setFilter("sp-heat", filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hiddenKey, ready, points]);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border", className)}>
      <div ref={el} className="h-full w-full" />
      <Attribution html={basemap?.attribution || DEFAULT_ATTRIBUTION} />
    </div>
  );
}
