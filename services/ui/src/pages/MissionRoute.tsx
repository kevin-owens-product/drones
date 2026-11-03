import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map, type Marker } from "maplibre-gl";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import atlas from "world-atlas/countries-110m.json";
import "maplibre-gl/dist/maplibre-gl.css";

const countries = feature(
  atlas as unknown as Topology,
  (atlas as unknown as Topology).objects.countries as GeometryCollection,
);

export interface RouteStop {
  label: string;
  kind: string;
  tail: string;
  lat: number;
  lon: number;
  offsetMin: number;
}

interface RouteKeepOut {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

function circleRing(lon: number, lat: number, radiusKm: number): [number, number][] {
  const steps = 48;
  const latRad = (lat * Math.PI) / 180;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = Math.max(111.32 * Math.cos(latRad), 1e-6);
  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    ring.push([
      lon + (radiusKm * Math.sin(angle)) / kmPerDegLon,
      lat + (radiusKm * Math.cos(angle)) / kmPerDegLat,
    ]);
  }
  return ring;
}

const KIND_LABEL: Record<string, string> = {
  transit: "Transit",
  search: "Search",
  sensor_custody: "Custody",
  loiter: "Loiter",
  rtb: "Recover",
};

const TAIL_COLOR = ["#5cc8ff", "#7dcea0", "#b6a5ff", "#f6b98a", "#8eb4ff"];

export function MissionRoute({ stops, keepouts = [] }: { stops: RouteStop[]; keepouts?: RouteKeepOut[] }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markers = useRef<Marker[]>([]);
  const stopsRef = useRef(stops);
  const keepoutsRef = useRef(keepouts);
  stopsRef.current = stops;
  keepoutsRef.current = keepouts;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      center: [0, 18],
      zoom: 1.1,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          countries: { type: "geojson", data: countries },
          route: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          keepouts: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "ocean", type: "background", paint: { "background-color": "#090c10" } },
          { id: "land", type: "fill", source: "countries", paint: { "fill-color": "#151d26" } },
          { id: "coast", type: "line", source: "countries", paint: { "line-color": "#3a4b5d", "line-width": 0.7 } },
          {
            id: "keepouts-fill",
            type: "fill",
            source: "keepouts",
            paint: { "fill-color": "#e15b4c", "fill-opacity": 0.22 },
          },
          {
            id: "keepouts-line",
            type: "line",
            source: "keepouts",
            paint: { "line-color": "#e15b4c", "line-width": 1.4 },
          },
          {
            id: "route-line",
            type: "line",
            source: "route",
            paint: { "line-color": "#5cc8ff", "line-width": 2 },
          },
        ],
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.dragRotate.disable();
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const current = stopsRef.current.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
      const byTail: Record<string, RouteStop[]> = {};
      for (const stop of current) {
        const key = stop.tail || "unassigned";
        const list = byTail[key] ?? [];
        list.push(stop);
        byTail[key] = list;
      }
      const tails = Object.keys(byTail);
      const features = tails.map((tail) => ({
        type: "Feature" as const,
        properties: { tail },
        geometry: {
          type: "LineString" as const,
          coordinates: (byTail[tail] ?? [])
            .slice()
            .sort((left, right) => left.offsetMin - right.offsetMin)
            .map((stop) => [stop.lon, stop.lat]),
        },
      }));
      const source = map.getSource("route");
      if (source && source.type === "geojson") {
        (source as GeoJSONSource).setData({ type: "FeatureCollection", features });
      }
      const zones = keepoutsRef.current.filter(
        (zone) => Number.isFinite(zone.lat) && Number.isFinite(zone.lon) && Number.isFinite(zone.radiusKm) && zone.radiusKm > 0,
      );
      const keepoutSource = map.getSource("keepouts");
      if (keepoutSource && keepoutSource.type === "geojson") {
        (keepoutSource as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: zones.map((zone) => ({
            type: "Feature" as const,
            properties: { name: zone.name },
            geometry: {
              type: "Polygon" as const,
              coordinates: [circleRing(zone.lon, zone.lat, zone.radiusKm)],
            },
          })),
        });
      }
      for (const marker of markers.current) marker.remove();
      markers.current = current.map((stop) => {
        const color = TAIL_COLOR[Math.max(tails.indexOf(stop.tail || "unassigned"), 0) % TAIL_COLOR.length] ?? "#5cc8ff";
        const el = document.createElement("button");
        el.type = "button";
        el.className = "tail-marker";
        el.style.borderColor = color;
        el.style.color = color;
        const name = document.createElement("strong");
        const hours = Math.floor(stop.offsetMin / 60);
        const mins = stop.offsetMin % 60;
        name.textContent = `${stop.tail || "—"}  T+${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
        const place = document.createElement("small");
        place.textContent = `${KIND_LABEL[stop.kind] ?? stop.kind} · ${stop.label || `${stop.lat.toFixed(1)}, ${stop.lon.toFixed(1)}`}`;
        el.append(name, place);
        return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([stop.lon, stop.lat]).addTo(map);
      });
      const places: [number, number][] = current.map((stop) => [stop.lon, stop.lat]);
      for (const zone of zones) places.push([zone.lon, zone.lat]);
      if (places.length === 1) {
        const only = places[0];
        if (only) map.easeTo({ center: only, zoom: 3, duration: 500 });
      } else if (places.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        for (const place of places) bounds.extend(place);
        map.fitBounds(bounds, { padding: 48, maxZoom: 4, duration: 500 });
      }
      map.resize();
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [stops, keepouts]);

  return <div className="mission-route-map" ref={host} />;
}
