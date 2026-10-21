import { Maximize } from "lucide-react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { AppInfo, ScoutJob } from "@shared/types";
import { SCOUT_STATE, type ScoutState, scoutState } from "@/lib/scout";
import { fmt } from "@/lib/utils";
import { Attribution, baseStyle, DEFAULT_ATTRIBUTION, esc, GLYPHS, isDark, withKey } from "./device-map";

const toGeo = (jobs: ScoutJob[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: jobs.map((j) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [j.lon, j.lat] },
    properties: { ...j, color: SCOUT_STATE[scoutState(j)].color },
  })),
});

/** Where the scout queue's points are, as the admin's Scout Mode map. */
export function ScoutMap({ jobs, basemap, title }: { jobs: ScoutJob[]; basemap?: AppInfo["map"]; title?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map>(undefined);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const [dark, setDark] = useState(isDark);

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!el.current) return;
    const style = basemap
      ? baseStyle(basemap, dark)
      : ({ version: 8, glyphs: GLYPHS, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#d4dadc" } }] } as StyleSpecification);
    const m = new maplibregl.Map({
      container: el.current,
      style,
      center: [-3.7, 40.2],
      zoom: 4.5,
      attributionControl: false,
      transformRequest: (url) => ({ url: withKey(url, basemap?.cartoKey) }),
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: "240px", className: "device-popup" });
    m.on("load", () => {
      m.addSource("scouts", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "scouts",
        type: "circle",
        source: "scouts",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 12, 7],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": dark ? "#18181b" : "#ffffff",
        },
      });
      m.on("mouseenter", "scouts", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const p = e.features?.[0]?.properties as (ScoutJob & { color: string }) | undefined;
        if (!p) return;
        const j = { ...p, lat: Number(p.lat), lon: Number(p.lon), requested: Number(p.requested), fulfilled: Number(p.fulfilled) };
        const st = SCOUT_STATE[scoutState(j)];
        popup
          .setLngLat([j.lon, j.lat])
          .setHTML(
            `<div class="dp-head"><span class="dp-dot" style="background:${st.color}"></span><span class="dp-title">${esc(j.account || st.label)}</span></div>` +
              `<dl class="dp-rows"><dt>Requested</dt><dd>${esc(fmt.time(j.requested * 1000))}</dd>` +
              `<dt>Fulfilled</dt><dd>${j.fulfilled > 0 ? esc(fmt.time(j.fulfilled * 1000)) : st.label}</dd>` +
              `<dt>Position</dt><dd>${j.lat.toFixed(5)}, ${j.lon.toFixed(5)}</dd></dl>`,
          )
          .addTo(m);
      });
      m.on("mouseleave", "scouts", () => {
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      setReady(true);
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      setReady(false);
      fitted.current = false;
      m.remove();
      map.current = undefined;
    };
    // The theme only swaps the basemap (below); a new [map] makes a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap?.styleUrl, basemap?.styleUrlDark, basemap?.tilesUrl, basemap?.cartoKey]);

  // Theme change: swap the basemap, keeping our points.
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
        sources: { ...next.sources, scouts: prev!.sources.scouts },
        layers: [...next.layers, ...prev!.layers.filter((l) => l.id === "scouts")],
      }),
    });
    m.once("styledata", () => m.getLayer("scouts") && m.setPaintProperty("scouts", "circle-stroke-color", dark ? "#18181b" : "#ffffff"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  const fit = (animate: boolean) => {
    const m = map.current;
    if (!m || !jobs.length) return;
    m.resize();
    const b = new maplibregl.LngLatBounds();
    for (const j of jobs) b.extend([j.lon, j.lat]);
    m.fitBounds(b, { padding: 40, maxZoom: 14, duration: animate ? 600 : 0 });
  };

  useEffect(() => {
    const src = map.current?.getSource("scouts") as maplibregl.GeoJSONSource | undefined;
    if (!ready || !src) return;
    src.setData(toGeo(jobs));
    if (!fitted.current && jobs.length) {
      fit(false);
      fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, jobs]);

  return (
    // MapLibre makes its container position: relative, so it gets a real size, not inset-0.
    <div className="relative h-64 overflow-hidden rounded-lg border sm:h-80 lg:h-full lg:min-h-80">
      <div ref={el} className="h-full w-full" />
      {/* Title and legend float over the map, as on the Dashboard. */}
      <div className="map-glass absolute top-3 left-3 z-10 flex flex-col gap-1 rounded-md px-2.5 py-1.5">
        {title ? <span className="text-xs font-semibold">{title}</span> : null}
        <span className="flex items-center gap-3 text-[11px]">
          {(Object.keys(SCOUT_STATE) as ScoutState[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: SCOUT_STATE[k].color }} />
              {SCOUT_STATE[k].label}
            </span>
          ))}
        </span>
      </div>
      <button
        type="button"
        onClick={() => fit(true)}
        disabled={!jobs.length}
        aria-label="Fit the map to the scout jobs"
        className="map-glass absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <Maximize className="size-3.5" />
      </button>
      <Attribution html={basemap?.attribution || DEFAULT_ATTRIBUTION} />
    </div>
  );
}
