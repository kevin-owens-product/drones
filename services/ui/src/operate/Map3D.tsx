import { useEffect, useRef, useState, type JSX } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Basemap, Layers, Picture } from "./picture";
import type { Vehicle } from "./vehicle";

/**
 * The same picture as the flat map, in 3D: terrain in relief from the site's
 * heightmap, each vehicle at its reported height above ground with a line
 * down to the ground, the jamming zone as a dome, links and task lines in the
 * air. Heights are exaggerated (VEX) so relief reads at range; the corner
 * says so. Everything is local, no tiles or globe from the network.
 */

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;
const VEX = 2;
const SIGMA_95 = 2.45;

const HEALTH: Record<Vehicle["health"], number> = {
  ok: 0x3fd69a,
  warn: 0xf4b443,
  alert: 0xff6b5b,
  offline: 0x5b6775,
};

interface Ground {
  bounds: Basemap;
  w: number;
  h: number;
  data: Float32Array; // metres above the lowest point
}

interface Frame {
  origin: { lat: number; lon: number };
  ground: Ground | null;
}

function toXZ(f: Frame, lat: number, lon: number): [number, number] {
  const cos = Math.cos((f.origin.lat * Math.PI) / 180);
  return [(lon - f.origin.lon) * cos * M_PER_DEG_LON, -(lat - f.origin.lat) * M_PER_DEG_LAT];
}

/** Ground height in metres above the lowest point of the site, bilinear. */
function groundAt(f: Frame, lat: number, lon: number): number {
  const g = f.ground;
  if (!g) return 0;
  const u = ((lon - g.bounds.west) / (g.bounds.east - g.bounds.west)) * (g.w - 1);
  const v = ((g.bounds.north - lat) / (g.bounds.north - g.bounds.south)) * (g.h - 1);
  if (u < 0 || v < 0 || u > g.w - 1 || v > g.h - 1) return 0;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(g.w - 1, x0 + 1);
  const y1 = Math.min(g.h - 1, y0 + 1);
  const fx = u - x0;
  const fy = v - y0;
  const at = (x: number, y: number) => g.data[y * g.w + x] ?? 0;
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

async function loadGround(b: Basemap): Promise<Ground | null> {
  if (!b.heightmap || !b.elevation_m) return null;
  const img = new Image();
  img.src = b.heightmap;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const span = b.elevation_m[1] - b.elevation_m[0];
  const data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i += 1) data[i] = ((px[i * 4] ?? 0) / 255) * span;
  return { bounds: b, w: c.width, h: c.height, data };
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

function line(points: THREE.Vector3[], color: number, opacity: number, dashed = false): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 40, gapSize: 30 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.Line(geo, mat);
  if (dashed) l.computeLineDistances();
  return l;
}

interface Craft {
  group: THREE.Group;
  body: THREE.Mesh;
  stalk: THREE.Line;
  shadow: THREE.Mesh;
  error: THREE.Mesh;
  target: THREE.Vector3;
  heading: number;
  label: HTMLDivElement;
}

export function Map3D({
  fleet,
  picture,
  layers,
  selected,
  follow,
  onSelect,
}: {
  fleet: readonly Vehicle[];
  picture: Picture | null;
  layers: Layers;
  selected: string | null;
  follow: boolean;
  onSelect: (tail: string | null) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    frame: Frame;
    terrain: THREE.Object3D | null;
    overlay: THREE.Group;
    crafts: Map<string, Craft>;
    framed: boolean;
  } | null>(null);
  const props = useRef({ fleet, picture, layers, selected, follow, onSelect });
  props.current = { fleet, picture, layers, selected, follow, onSelect };
  const [ground, setGround] = useState<Ground | null>(null);
  const [failed, setFailed] = useState(false);

  // One renderer for the life of the view.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x070a0e);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x070a0e, 9000, 22000);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a1016, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-4000, 6000, -3000);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 10, 60_000);
    camera.position.set(-2500, 3500, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 200;
    controls.maxDistance = 20_000;
    const overlay = new THREE.Group();
    scene.add(overlay);
    state.current = { renderer, scene, camera, controls, frame: { origin: { lat: 0, lon: 0 }, ground: null }, terrain: null, overlay, crafts: new Map(), framed: false };

    const resize = () => {
      const w = Math.max(200, el.clientWidth);
      const h = Math.max(200, el.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // Click (not drag) picks the nearest vehicle under the pointer.
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      let best: string | null = null;
      let bestD = 18;
      for (const [tail, c] of state.current?.crafts ?? []) {
        if (!c.group.visible) continue;
        const v = c.group.position.clone().project(camera);
        const d = Math.hypot(((v.x - p.x) * rect.width) / 2, ((v.y - p.y) * rect.height) / 2);
        if (v.z < 1 && d < bestD) {
          bestD = d;
          best = tail;
        }
      }
      void ray;
      props.current.onSelect(best);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const s = state.current;
      if (s) {
        const k = 1 - Math.exp(-dt / 0.35);
        const box = renderer.domElement.getBoundingClientRect();
        for (const [tail, c] of s.crafts) {
          c.group.position.lerp(c.target, k);
          const cur = c.body.rotation.y;
          const want = -((c.heading * Math.PI) / 180);
          const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          c.body.rotation.y = cur + d * k;
          const g = groundAt(s.frame, ...latLonOf(s.frame, c.group.position)) * VEX;
          const top = c.group.position.y;
          const pos = c.stalk.geometry.attributes.position as THREE.BufferAttribute;
          pos.setY(1, g - top);
          pos.needsUpdate = true;
          c.shadow.position.y = g - top + 2;
          const v = c.group.position.clone().project(s.camera);
          const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && c.group.visible;
          c.label.style.display = on ? "" : "none";
          if (on) c.label.style.transform = `translate(${((v.x + 1) / 2) * box.width + 10}px, ${((1 - v.y) / 2) * box.height - 8}px)`;
          c.label.classList.toggle("is-sel", tail === props.current.selected);
        }
        const sel = props.current.selected ? s.crafts.get(props.current.selected) : null;
        if (sel && props.current.follow) {
          const delta = sel.group.position.clone().sub(s.controls.target).multiplyScalar(k);
          s.controls.target.add(delta);
          s.camera.position.add(delta);
        }
        s.controls.update();
        renderer.render(s.scene, s.camera);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      for (const c of state.current?.crafts.values() ?? []) c.label.remove();
      state.current = null;
    };
  }, []);

  // Terrain: once per basemap.
  const basemap = picture?.basemap ?? null;
  const basemapKey = basemap ? `${basemap.url}|${basemap.heightmap ?? ""}` : "";
  useEffect(() => {
    let stopped = false;
    if (!basemap) {
      setGround(null);
      return;
    }
    void loadGround(basemap).then((g) => {
      if (!stopped) setGround(g);
    });
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapKey]);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (s.terrain) {
      s.scene.remove(s.terrain);
      disposeTree(s.terrain);
      s.terrain = null;
    }
    const live = fleet.filter((v) => v.live);
    const b = basemap;
    s.frame = {
      origin: b ? { lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2 } : live[0]?.live ? { lat: live[0].live.lat, lon: live[0].live.lon } : s.frame.origin,
      ground,
    };
    if (b && layers.terrain) {
      const [x0, z0] = toXZ(s.frame, b.north, b.west);
      const [x1, z1] = toXZ(s.frame, b.south, b.east);
      const gw = ground?.w ?? 2;
      const gh = ground?.h ?? 2;
      const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, gw - 1, gh - 1);
      geo.rotateX(-Math.PI / 2);
      if (ground) {
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i += 1) pos.setY(i, (ground.data[i] ?? 0) * VEX);
        geo.computeVertexNormals();
      }
      geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const tex = new THREE.TextureLoader().load(b.url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, color: 0xcfe6ff }));
      s.terrain = mesh;
    } else {
      const grid = new THREE.GridHelper(20_000, 40, 0x2f3a47, 0x1a222c);
      s.terrain = grid;
    }
    s.scene.add(s.terrain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ground, basemapKey, layers.terrain]);

  // Vehicles: targets move each poll; the frame loop glides to them.
  useEffect(() => {
    const s = state.current;
    const box = labels.current;
    if (!s || !box) return;
    const seen = new Set<string>();
    for (const v of fleet) {
      const p = v.live;
      if (!p) continue;
      seen.add(v.tail);
      let c = s.crafts.get(v.tail);
      if (!c) {
        const group = new THREE.Group();
        const bodyGeo = new THREE.ConeGeometry(28, 90, 4);
        bodyGeo.rotateX(-Math.PI / 2); // tip points along -Z (north) before heading
        const body = new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: HEALTH[v.health], emissive: HEALTH[v.health], emissiveIntensity: 0.45 }));
        const stalk = line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -100, 0)], HEALTH[v.health], 0.55);
        const shadow = new THREE.Mesh(new THREE.RingGeometry(14, 22, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: HEALTH[v.health], transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
        const error = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf4b443, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
        group.add(body, stalk, shadow, error);
        s.scene.add(group);
        const label = document.createElement("div");
        label.className = "m3-label";
        box.appendChild(label);
        c = { group, body, stalk, shadow, error, target: new THREE.Vector3(), heading: p.heading_deg ?? 0, label };
        s.crafts.set(v.tail, c);
      }
      const [x, z] = toXZ(s.frame, p.lat, p.lon);
      const y = (groundAt(s.frame, p.lat, p.lon) + Math.max(0, p.alt_m ?? 0)) * VEX + 30;
      const fresh = c.target.lengthSq() === 0;
      c.target.set(x, y, z);
      if (fresh || c.group.position.distanceTo(c.target) > 600) c.group.position.copy(c.target);
      if (typeof p.heading_deg === "number") c.heading = p.heading_deg;
      const color = HEALTH[v.health];
      (c.body.material as THREE.MeshLambertMaterial).color.setHex(color);
      (c.body.material as THREE.MeshLambertMaterial).emissive.setHex(color);
      (c.stalk.material as THREE.LineBasicMaterial).color.setHex(color);
      (c.shadow.material as THREE.MeshBasicMaterial).color.setHex(color);
      const sigma = p.gnss_trusted === false && typeof p.pos_sigma_m === "number" ? SIGMA_95 * p.pos_sigma_m : 0;
      c.error.visible = sigma > 0;
      c.error.scale.setScalar(Math.max(1, sigma));
      const isSel = v.tail === selected;
      c.body.scale.setScalar(isSel ? 1.5 : 1);
      c.label.textContent = `${v.tail} · ${Math.max(0, Math.round(p.alt_m ?? 0))} m AGL${sigma > 0 ? ` · ±${Math.round(sigma)} m` : ""}`;
      c.label.dataset.health = v.health;
    }
    for (const [tail, c] of s.crafts) {
      if (seen.has(tail)) continue;
      s.scene.remove(c.group);
      disposeTree(c.group);
      c.label.remove();
      s.crafts.delete(tail);
    }
    if (!s.framed && seen.size > 0) {
      const box3 = new THREE.Box3();
      for (const c of s.crafts.values()) box3.expandByPoint(c.target);
      const center = box3.getCenter(new THREE.Vector3());
      const size = box3.getSize(new THREE.Vector3()).length();
      s.controls.target.copy(center);
      s.camera.position.set(center.x - size * 0.25, center.y + size * 0.4, center.z + size * 0.62);
      s.framed = true;
    }
  }, [fleet, selected, ground]);

  // Operating picture overlays: rebuilt each poll, they are cheap.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const child of [...s.overlay.children]) {
      s.overlay.remove(child);
      disposeTree(child);
    }
    if (!picture) return;
    const f = s.frame;
    const at = (lat: number, lon: number, lift = 6): THREE.Vector3 => {
      const [x, z] = toXZ(f, lat, lon);
      return new THREE.Vector3(x, groundAt(f, lat, lon) * VEX + lift, z);
    };
    const drape = (pts: readonly (readonly [number, number])[], lift = 8): THREE.Vector3[] => {
      const out: THREE.Vector3[] = [];
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i]!;
        const b = pts[i + 1];
        out.push(at(a[0], a[1], lift));
        if (!b) continue;
        for (let k = 1; k < 12; k += 1) out.push(at(a[0] + ((b[0] - a[0]) * k) / 12, a[1] + ((b[1] - a[1]) * k) / 12, lift));
      }
      return out;
    };
    const craftAt = (tail: string): THREE.Vector3 | null => s.crafts.get(tail)?.target.clone() ?? null;

    for (const z of picture.zones ?? []) {
      const c = at(z.lat, z.lon, 0);
      const r = z.radius_m;
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xf4b443, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      const wire = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xf4b443, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      dome.position.copy(c);
      wire.position.copy(c);
      dome.scale.y = 0.6;
      wire.scale.y = 0.6;
      s.overlay.add(dome, wire);
    }

    if (layers.coverage) {
      for (const a of picture.areas ?? []) {
        const ring = [...a.ring, a.ring[0]!];
        s.overlay.add(line(drape(ring), 0x5cc8ff, 0.5));
        if (a.flown.length > 1) s.overlay.add(line(drape(a.flown, 10), 0x3fd69a, 0.85));
        if (a.ahead.length > 1) s.overlay.add(line(drape(a.ahead, 10), 0x5cc8ff, 0.55, true));
      }
    }

    if (layers.links) {
      const station = picture.station ? at(picture.station.lat, picture.station.lon, 40) : null;
      if (station) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(10, 18, 80, 8), new THREE.MeshLambertMaterial({ color: 0x5cc8ff, emissive: 0x16384a }));
        mast.position.copy(station);
        s.overlay.add(mast);
      }
      for (const l of picture.links ?? []) {
        const a = l.a === "GCS" ? station : craftAt(l.a);
        const b = l.b === "GCS" ? station : craftAt(l.b);
        if (!a || !b) continue;
        const color = l.quality <= 0 ? 0xff6b5b : l.quality < 0.3 ? 0xff6b5b : l.quality < 0.6 ? 0xf4b443 : 0x5cc8ff;
        s.overlay.add(line([a, b], color, l.quality <= 0 ? 0.7 : 0.12 + 0.35 * l.quality, l.quality < 0.3));
      }
    }

    if (layers.tasks) {
      for (const t of picture.tasks ?? []) {
        const p = at(t.lat, t.lon, 40);
        const mark = new THREE.Mesh(new THREE.OctahedronGeometry(30), new THREE.MeshLambertMaterial({ color: 0xc9a7ff, emissive: 0x3a2a5c }));
        mark.position.copy(p);
        s.overlay.add(mark);
        const owner = t.tail ? craftAt(t.tail) : null;
        if (owner) s.overlay.add(line([owner, p], 0xc9a7ff, 0.7, true));
      }
    }
  }, [picture, layers, fleet, ground]);

  if (failed) {
    return <div className="m3 m3-failed meta">3D view needs WebGL, which this browser has turned off. The flat map still works.</div>;
  }

  return (
    <div ref={host} className="m3" data-testid="map-3d">
      <div ref={labels} className="m3-labels" aria-hidden="true" />
      <div className="m3-note meta">
        3D · heights ×{VEX} · drag to orbit, right-drag to pan, scroll to zoom
        {basemap?.heightmap ? null : " · no heightmap, flat ground"}
      </div>
    </div>
  );
}

function latLonOf(f: Frame, v: THREE.Vector3): [number, number] {
  const cos = Math.cos((f.origin.lat * Math.PI) / 180);
  return [f.origin.lat - v.z / M_PER_DEG_LAT, f.origin.lon + v.x / (cos * M_PER_DEG_LON)];
}
