import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  LabelStyle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
  Viewer,
  buildModuleUrl,
  type Entity,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { LivePoint } from "./live";

function placeText(point: LivePoint): string {
  const lat = Math.abs(point.lat).toFixed(2);
  const lon = Math.abs(point.lon).toFixed(2);
  const ns = point.lat >= 0 ? "N" : "S";
  const ew = point.lon >= 0 ? "E" : "W";
  return `${point.tail_number}  ${lat}°${ns} ${lon}°${ew}`;
}

export function Globe({
  points,
  onSelect,
}: {
  points: LivePoint[];
  onSelect?: (tail: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const framed = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = host.current;
    if (!container) {
      return;
    }
    const viewer = new Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    viewer.scene.globe.enableLighting = false;
    viewer.scene.backgroundColor = Color.fromCssColorString("#071018");
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: { x: number; y: number } }) => {
      const picked: unknown = viewer.scene.pick(new Cartesian2(movement.position.x, movement.position.y));
      const entity = picked && typeof picked === "object" && "id" in picked ? (picked as { id?: Entity }).id : undefined;
      if (entity?.name) onSelectRef.current?.(entity.name);
    }, ScreenSpaceEventType.LEFT_CLICK);
    const observer = new ResizeObserver(() => {
      if (!viewer.isDestroyed()) viewer.resize();
    });
    observer.observe(container);
    viewer.resize();
    viewerRef.current = viewer;
    let cancelled = false;
    void TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"), {
      fileExtension: "jpg",
    }).then((provider) => {
      if (cancelled || viewer.isDestroyed()) return;
      viewer.imageryLayers.addImageryProvider(provider);
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      handler.destroy();
      framed.current = false;
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    viewer.entities.removeAll();
    for (const point of points) {
      const position = Cartesian3.fromDegrees(point.lon, point.lat, Math.max(point.alt_m, 0));
      viewer.entities.add({
        name: point.tail_number,
        position,
        point: {
          pixelSize: 14,
          color: Color.fromCssColorString("#e4b15a"),
          outlineColor: Color.fromCssColorString("#1a1408"),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: placeText(point),
          font: "600 13px ui-monospace, monospace",
          fillColor: Color.fromCssColorString("#f3efe6"),
          outlineColor: Color.fromCssColorString("#071018"),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    if (!framed.current && points.length > 0) {
      const lon = points.reduce((sum, point) => sum + point.lon, 0) / points.length;
      const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat - 18, 7_500_000),
        duration: 1.4,
      });
      framed.current = true;
    }
  }, [points]);

  return <div id="globe" ref={host} />;
}
