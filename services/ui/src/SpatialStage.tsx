import { useMemo, useState } from "react";
import type { LivePoint } from "./live";
import { LiveMap } from "./LiveMap";
import { SpatialField } from "./SpatialField";

export function SpatialStage({
  points,
  focusTail = null,
  linkNeighbors = false,
  emphasis,
  onSelect,
}: {
  points: readonly LivePoint[];
  focusTail?: string | null;
  linkNeighbors?: boolean;
  emphasis?: readonly string[];
  onSelect?: (tail: string) => void;
}) {
  const [scene, setScene] = useState<"field" | "map">("field");
  const marked = useMemo(() => new Set(emphasis ?? []), [emphasis]);
  return (
    <div className="map-frame">
      {scene === "field" ? (
        <SpatialField
          points={points}
          focusTail={focusTail}
          linkNeighbors={linkNeighbors}
          emphasis={marked}
          {...(onSelect ? { onSelect } : {})}
        />
      ) : (
        <LiveMap points={points} focusTail={focusTail} {...(onSelect ? { onSelect } : {})} />
      )}
      <div className="scene-switch" role="group" aria-label="Picture">
        <button type="button" className={scene === "field" ? "btn btn-primary" : "btn"} onClick={() => setScene("field")}>Field</button>
        <button type="button" className={scene === "map" ? "btn btn-primary" : "btn"} onClick={() => setScene("map")}>Map</button>
      </div>
    </div>
  );
}
