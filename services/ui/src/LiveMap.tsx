import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONFeature,
  type GeoJSONSource,
  type LngLatBounds,
  type LngLatBoundsLike,
  type Map,
  type Marker,
} from "maplibre-gl";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import atlas from "world-atlas/countries-110m.json";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LivePoint } from "./live";

const AIRCRAFT = "aircraft";
const MAX_DOM_NODES = 250;
const CLUSTER_RADIUS = 56;
const CLUSTER_MAX_ZOOM = 8;
const CLUSTER_STROKE = 2;
const WORLD_CENTER: [number, number] = [0, 18];
const WORLD_ZOOM = 1.15;
const NATION_BOUNDS: LngLatBoundsLike = [
  [-128, 22],
  [-64, 51],
];

/** Circle radius stops. The cluster layer uses the same numbers. */
const RADIUS_STOPS: readonly (readonly [number, number])[] = [
  [2, 16],
  [10, 20],
  [50, 26],
  [200, 34],
  [1000, 44],
];

const countries = feature(
  atlas as unknown as Topology,
  (atlas as unknown as Topology).objects.countries as GeometryCollection,
);

type Frame = "world" | "nation";

interface Overlay {
  marker: Marker;
  button: HTMLButtonElement;
  place: HTMLElement | null;
  tail: string;
}

interface ClusterItem {
  kind: "cluster";
  key: string;
  lng: number;
  lat: number;
  count: number;
  clusterId: number;
}

interface AircraftItem {
  kind: "aircraft";
  key: string;
  lng: number;
  lat: number;
  tail: string;
}

type VisibleItem = ClusterItem | AircraftItem;

function where(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

function clusterRadius(count: number): number {
  const first = RADIUS_STOPS[0];
  const last = RADIUS_STOPS[RADIUS_STOPS.length - 1];
  if (!first || !last) return 16;
  if (count <= first[0]) return first[1];
  if (count >= last[0]) return last[1];
  for (let index = 1; index < RADIUS_STOPS.length; index += 1) {
    const left = RADIUS_STOPS[index - 1];
    const right = RADIUS_STOPS[index];
    if (!left || !right || count > right[0]) continue;
    const span = right[0] - left[0];
    const t = span === 0 ? 0 : (count - left[0]) / span;
    return left[1] + t * (right[1] - left[1]);
  }
  return last[1];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function lngLatOf(featureItem: GeoJSONFeature): [number, number] | null {
  const geometry = featureItem.geometry;
  if (geometry.type !== "Point") return null;
  const lng = geometry.coordinates[0];
  const lat = geometry.coordinates[1];
  if (lng === undefined || lat === undefined) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function inView(bounds: LngLatBounds, lng: number, lat: number): boolean {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  if (lat < south || lat > north) return false;
  const west = bounds.getWest();
  const east = bounds.getEast();
  if (east - west >= 360 || west - east >= 360) return true;
  if (west <= east) {
    if (lng >= west && lng <= east) return true;
    if (lng + 360 >= west && lng + 360 <= east) return true;
    if (lng - 360 >= west && lng - 360 <= east) return true;
    return false;
  }
  return lng >= west || lng <= east;
}

function aircraftCollection(points: readonly LivePoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      id: point.tail_number,
      properties: { tail_number: point.tail_number },
      geometry: {
        type: "Point",
        coordinates: [point.lon, point.lat],
      },
    })),
  };
}

function aircraftSource(map: Map): GeoJSONSource | null {
  const source = map.getSource(AIRCRAFT);
  if (source?.type !== "geojson") return null;
  return source as GeoJSONSource;
}

function moveFrame(map: Map, frame: Frame, animate: boolean) {
  if (frame === "world") {
    if (animate) map.easeTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM, duration: 700 });
    else map.jumpTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM });
    return;
  }
  if (animate) map.fitBounds(NATION_BOUNDS, { padding: 0, duration: 700 });
  else map.fitBounds(NATION_BOUNDS, { padding: 0, animate: false });
}

function paintCluster(button: HTMLButtonElement, item: ClusterItem) {
  const label = String(item.count);
  if (button.textContent !== label) button.textContent = label;
  const size = `${(clusterRadius(item.count) + CLUSTER_STROKE) * 2}px`;
  if (button.style.width !== size) {
    button.style.width = size;
    button.style.height = size;
  }
  button.dataset.clusterId = String(item.clusterId);
  button.dataset.lng = String(item.lng);
  button.dataset.lat = String(item.lat);
  const described = `${label} aircraft`;
  if (button.getAttribute("aria-label") !== described) button.setAttribute("aria-label", described);
}

function visibleItems(map: Map): VisibleItem[] {
  const bounds = map.getBounds();
  const features = map.querySourceFeatures(AIRCRAFT);
  const seen = new Set<string>();
  const clusters: ClusterItem[] = [];
  const aircraft: AircraftItem[] = [];
  for (const featureItem of features) {
    const coords = lngLatOf(featureItem);
    if (!coords) continue;
    const [lng, lat] = coords;
    if (!inView(bounds, lng, lat)) continue;
    const count = asNumber(featureItem.properties.point_count);
    const clusterId = asNumber(featureItem.properties.cluster_id);
    if (count !== null && clusterId !== null) {
      const key = `cluster:${clusterId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clusters.push({ kind: "cluster", key, lng, lat, count, clusterId });
      continue;
    }
    const tail = featureItem.properties.tail_number;
    if (typeof tail !== "string" || tail.length === 0) continue;
    const key = `tail:${tail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    aircraft.push({ kind: "aircraft", key, lng, lat, tail });
  }
  clusters.sort((left, right) => right.count - left.count || left.clusterId - right.clusterId);
  const center = map.getCenter();
  aircraft.sort((left, right) => {
    const leftDistance = (left.lng - center.lng) ** 2 + (left.lat - center.lat) ** 2;
    const rightDistance = (right.lng - center.lng) ** 2 + (right.lat - center.lat) ** 2;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return left.tail < right.tail ? -1 : left.tail > right.tail ? 1 : 0;
  });
  const visible: VisibleItem[] = [...clusters, ...aircraft];
  return visible.slice(0, MAX_DOM_NODES);
}

export function LiveMap({
  points,
  onSelect,
  focusTail = null,
}: {
  points: readonly LivePoint[];
  onSelect?: (tail: string) => void;
  focusTail?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlays = useRef(new globalThis.Map<string, Overlay>());
  const pointsRef = useRef(points);
  const onSelectRef = useRef(onSelect);
  const frameRef = useRef<Frame>("nation");
  const readyRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const [frame, setFrame] = useState<Frame>("nation");
  pointsRef.current = points;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      bounds: NATION_BOUNDS,
      fitBoundsOptions: { padding: 0, animate: false },
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          countries: { type: "geojson", data: countries },
          [AIRCRAFT]: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterRadius: CLUSTER_RADIUS,
            clusterMaxZoom: CLUSTER_MAX_ZOOM,
          },
        },
        layers: [
          { id: "ocean", type: "background", paint: { "background-color": "#090c10" } },
          { id: "land", type: "fill", source: "countries", paint: { "fill-color": "#151d26" } },
          {
            id: "coast",
            type: "line",
            source: "countries",
            paint: { "line-color": "#3a4b5d", "line-width": 0.8 },
          },
          {
            id: "clusters",
            type: "circle",
            source: AIRCRAFT,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#5cc8ff",
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "point_count"],
                2,
                16,
                10,
                20,
                50,
                26,
                200,
                34,
                1000,
                44,
              ],
              "circle-stroke-width": CLUSTER_STROKE,
              "circle-stroke-color": "#1a1408",
            },
          },
        ],
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    let disposed = false;
    let raf = 0;

    const expand = (clusterId: number, lng: number, lat: number) => {
      const source = aircraftSource(map);
      if (!source) return;
      void source.getClusterExpansionZoom(clusterId).then(
        (zoom) => {
          if (!disposed) map.easeTo({ center: [lng, lat], zoom });
        },
        () => undefined,
      );
    };

    const stopPointer = (event: Event) => {
      event.stopPropagation();
    };

    const sync = () => {
      if (disposed || !map.isStyleLoaded() || !map.getSource(AIRCRAFT)) return;
      let items: VisibleItem[] = [];
      try {
        items = visibleItems(map);
      } catch {
        return;
      }
      const bounds = map.getBounds();
      const expecting = pointsRef.current.some((point) => inView(bounds, point.lon, point.lat));
      if (items.length === 0 && expecting) return;

      const keep = new Set<string>();
      for (const item of items) {
        keep.add(item.key);
        const existing = overlays.current.get(item.key);
        if (existing) {
          existing.marker.setLngLat([item.lng, item.lat]);
          if (item.kind === "cluster") {
            paintCluster(existing.button, item);
          } else if (existing.place) {
            const label = where(item.lat, item.lng);
            if (existing.place.textContent !== label) existing.place.textContent = label;
            const described = `${item.tail} ${label}`;
            if (existing.button.getAttribute("aria-label") !== described) {
              existing.button.setAttribute("aria-label", described);
            }
          }
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.addEventListener("mousedown", stopPointer);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (item.kind === "cluster") {
            const clusterId = Number(button.dataset.clusterId);
            const lng = Number(button.dataset.lng);
            const lat = Number(button.dataset.lat);
            if (!Number.isFinite(clusterId) || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
            expand(clusterId, lng, lat);
            return;
          }
          onSelectRef.current?.(item.tail);
        });

        let place: HTMLElement | null = null;
        if (item.kind === "cluster") {
          button.className = "tail-marker is-cluster";
          paintCluster(button, item);
        } else {
          button.className = "tail-marker";
          const name = document.createElement("strong");
          name.textContent = item.tail;
          place = document.createElement("small");
          place.textContent = where(item.lat, item.lng);
          button.append(name, place);
          button.setAttribute("aria-label", `${item.tail} ${place.textContent}`);
        }

        const marker = new maplibregl.Marker({ element: button, anchor: "center" })
          .setLngLat([item.lng, item.lat])
          .addTo(map);
        overlays.current.set(item.key, { marker, button, place, tail: item.kind === "aircraft" ? item.tail : "" });
      }

      for (const [key, overlay] of overlays.current) {
        if (keep.has(key)) continue;
        overlay.marker.remove();
        overlays.current.delete(key);
      }
    };

    syncRef.current = sync;

    const schedule = () => {
      if (disposed || raf !== 0) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        sync();
      });
    };

    const onClusterClick = (event: { originalEvent: Event; features?: GeoJSONFeature[] }) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(".tail-marker")) return;
      const hit = event.features?.[0];
      if (!hit) return;
      const clusterId = asNumber(hit.properties.cluster_id);
      const coords = lngLatOf(hit);
      if (clusterId === null || !coords) return;
      expand(clusterId, coords[0], coords[1]);
    };

    const onSource = (event: { sourceId: string; isSourceLoaded: boolean }) => {
      if (event.sourceId === AIRCRAFT && event.isSourceLoaded) schedule();
    };

    map.on("load", () => {
      map.resize();
      moveFrame(map, frameRef.current, false);
      readyRef.current = true;
      schedule();
    });
    map.on("moveend", schedule);
    map.on("idle", schedule);
    map.on("sourcedata", onSource);
    map.on("click", "clusters", onClusterClick);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    mapRef.current = map;

    return () => {
      disposed = true;
      readyRef.current = false;
      syncRef.current = () => {};
      if (raf !== 0) window.cancelAnimationFrame(raf);
      observer.disconnect();
      map.off("moveend", schedule);
      map.off("idle", schedule);
      map.off("sourcedata", onSource);
      map.off("click", "clusters", onClusterClick);
      for (const overlay of overlays.current.values()) overlay.marker.remove();
      overlays.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const apply = () => {
      const source = aircraftSource(map);
      if (!source) return;
      void source.setData(aircraftCollection(points), true).then(
        () => {
          if (!cancelled) syncRef.current();
        },
        () => undefined,
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
    return () => {
      cancelled = true;
      map.off("load", apply);
    };
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusTail) return;
    const point = pointsRef.current.find((item) => item.tail_number === focusTail);
    if (!point) return;
    const go = () => map.easeTo({ center: [point.lon, point.lat], zoom: 8, duration: 600 });
    if (map.isStyleLoaded()) go();
    else map.once("load", go);
  }, [focusTail]);

  function selectFrame(next: Frame) {
    frameRef.current = next;
    setFrame(next);
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    moveFrame(map, next, true);
  }

  return (
    <>
      <div className="map-switch" role="group" aria-label="Map frame">
        <button type="button" className={frame === "world" ? "btn btn-primary" : "btn btn-quiet"} onClick={() => selectFrame("world")}>
          World
        </button>
        <button type="button" className={frame === "nation" ? "btn btn-primary" : "btn btn-quiet"} onClick={() => selectFrame("nation")}>
          Nation
        </button>
      </div>
      <div id="live-map" ref={host} />
    </>
  );
}
