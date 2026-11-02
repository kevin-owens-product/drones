import { useEffect, useRef } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import atlas from "world-atlas/countries-110m.json";
import type { LivePoint } from "./live";

interface SpatialFieldProps {
  points: readonly LivePoint[];
  focusTail?: string | null;
  linkNeighbors?: boolean;
  emphasis?: ReadonlySet<string>;
  onSelect?: (tail: string) => void;
}

interface Projected {
  tail: string;
  x: number;
  y: number;
  depth: number;
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSize;
uniform mat4 uMvp;
uniform float uScale;
out vec3 vColor;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
  gl_PointSize = aSize * uScale * clamp(1.8 / gl_Position.w, 0.35, 5.0);
  vColor = aColor;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float glow = exp(-d * 2.6);
  outColor = vec4(vColor * glow, glow);
}`;

const SOLID_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uMvp;
uniform mat4 uModel;
out vec3 vNormal;
void main() {
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const SOLID_FRAG = `#version 300 es
precision mediump float;
in vec3 vNormal;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float rim = pow(1.0 - abs(n.z), 1.6);
  vec3 base = vec3(0.05, 0.12, 0.11);
  vec3 edge = vec3(0.55, 0.82, 0.42);
  outColor = vec4(base + edge * rim * 0.85, 1.0);
}`;

const LINE_FRAG = `#version 300 es
precision mediump float;
out vec4 outColor;
void main() {
  outColor = vec4(0.72, 0.86, 0.55, 0.85);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function program(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const shaderProgram = gl.createProgram();
  if (!shaderProgram) throw new Error("program");
  gl.attachShader(shaderProgram, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(shaderProgram, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(shaderProgram);
  return shaderProgram;
}

function latLonToVec(lat: number, lon: number, lift: number): [number, number, number] {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const radius = 1 + lift;
  const cosLat = Math.cos(latRad);
  return [cosLat * Math.cos(lonRad) * radius, Math.sin(latRad) * radius, cosLat * Math.sin(lonRad) * radius];
}

function facing(lat: number, lon: number): { yaw: number; pitch: number } {
  return {
    yaw: (lon * Math.PI) / 180 - Math.PI / 2,
    pitch: (lat * Math.PI) / 180,
  };
}

function rotateToward(x: number, y: number, z: number, yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

function coastLines(): Float32Array {
  const countries = feature(
    atlas as unknown as Topology,
    (atlas as unknown as Topology).objects.countries as GeometryCollection,
  );
  const lines: number[] = [];
  const pushRing = (ring: number[][]) => {
    for (let index = 1; index < ring.length; index += 1) {
      const start = ring[index - 1];
      const end = ring[index];
      if (!start || !end) continue;
      const lon0 = start[0] ?? 0;
      const lat0 = start[1] ?? 0;
      const lon1 = end[0] ?? 0;
      const lat1 = end[1] ?? 0;
      if (Math.abs(lon1 - lon0) > 180) continue;
      const from = latLonToVec(lat0, lon0, 0.006);
      const to = latLonToVec(lat1, lon1, 0.006);
      lines.push(from[0], from[1], from[2], to[0], to[1], to[2]);
    }
  };
  for (const country of countries.features) {
    const geometry = country.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) pushRing(ring);
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) pushRing(ring);
      }
    }
  }
  return new Float32Array(lines);
}

function colorOf(point: LivePoint): [number, number, number] {
  if (point.airworthiness === "restricted") return [0.96, 0.73, 0.54];
  if (point.classification === "CUI") return [0.71, 0.65, 1];
  return [0.78, 0.96, 0.55];
}

function at(values: Float32Array, index: number): number {
  return values[index] ?? 0;
}

function multiply(a: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        at(a, row) * at(b, col * 4) +
        at(a, 4 + row) * at(b, col * 4 + 1) +
        at(a, 8 + row) * at(b, col * 4 + 2) +
        at(a, 12 + row) * at(b, col * 4 + 3);
    }
  }
}

function perspective(out: Float32Array, fov: number, aspect: number, near: number, far: number): void {
  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
}

function sphereMesh(): { positions: Float32Array; normals: Float32Array; indices: Uint16Array; lines: Float32Array } {
  const bands = 28;
  const slices = 40;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let lat = 0; lat <= bands; lat += 1) {
    const theta = (lat * Math.PI) / bands;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let lon = 0; lon <= slices; lon += 1) {
      const phi = (lon * 2 * Math.PI) / slices;
      const x = sinT * Math.cos(phi);
      const y = cosT;
      const z = sinT * Math.sin(phi);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  const stride = slices + 1;
  for (let lat = 0; lat < bands; lat += 1) {
    for (let lon = 0; lon < slices; lon += 1) {
      const a = lat * stride + lon;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const lines: number[] = [];
  for (let lat = 0; lat <= bands; lat += 4) {
    const theta = (lat * Math.PI) / bands;
    for (let lon = 0; lon < slices; lon += 1) {
      const phi0 = (lon * 2 * Math.PI) / slices;
      const phi1 = ((lon + 1) * 2 * Math.PI) / slices;
      lines.push(Math.sin(theta) * Math.cos(phi0), Math.cos(theta), Math.sin(theta) * Math.sin(phi0));
      lines.push(Math.sin(theta) * Math.cos(phi1), Math.cos(theta), Math.sin(theta) * Math.sin(phi1));
    }
  }
  for (let lon = 0; lon < slices; lon += 4) {
    const phi = (lon * 2 * Math.PI) / slices;
    for (let lat = 0; lat < bands; lat += 1) {
      const t0 = (lat * Math.PI) / bands;
      const t1 = ((lat + 1) * Math.PI) / bands;
      lines.push(Math.sin(t0) * Math.cos(phi), Math.cos(t0), Math.sin(t0) * Math.sin(phi));
      lines.push(Math.sin(t1) * Math.cos(phi), Math.cos(t1), Math.sin(t1) * Math.sin(phi));
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    lines: new Float32Array(lines),
  };
}

export function SpatialField({ points, focusTail = null, linkNeighbors = false, emphasis, onSelect }: SpatialFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<(delta: number) => void>(() => {});
  const pointsRef = useRef(points);
  const focusRef = useRef(focusTail);
  const emphasisRef = useRef(emphasis);
  const onSelectRef = useRef(onSelect);
  pointsRef.current = points;
  focusRef.current = focusTail;
  emphasisRef.current = emphasis;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { antialias: true, alpha: true });
    if (!canvas || !gl) return;
    const pointProgram = program(gl, VERT, FRAG);
    const solidProgram = program(gl, SOLID_VERT, SOLID_FRAG);
    const lineProgram = program(gl, SOLID_VERT, LINE_FRAG);
    const mesh = sphereMesh();
    const solidPosition = gl.createBuffer();
    const solidNormal = gl.createBuffer();
    const solidIndex = gl.createBuffer();
    const lineBuffer = gl.createBuffer();
    const pointBuffer = gl.createBuffer();
    const linkBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, solidPosition);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, solidNormal);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, solidIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    const coasts = coastLines();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, coasts, gl.STATIC_DRAW);

    const model = new Float32Array(16);
    const view = new Float32Array(16);
    const projection = new Float32Array(16);
    const mvp = new Float32Array(16);
    const tmp = new Float32Array(16);
    view.fill(0);
    view[0] = 1;
    view[5] = 1;
    view[10] = 1;
    view[15] = 1;
    const distanceRef = { current: 2.7 };
    view[14] = -distanceRef.current;
    zoomRef.current = (delta: number) => {
      distanceRef.current = Math.min(7.5, Math.max(1.6, distanceRef.current + delta));
    };
    let yaw = -2.4;
    let pitch = 0.65;
    let framed = false;
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    const projected: Projected[] = [];
    let frame = 0;
    let stopped = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const pick = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best: Projected | null = null;
      let bestDistance = 42;
      for (const item of projected) {
        const distance = Math.hypot(item.x - x, item.y - y);
        if (distance < bestDistance && item.depth > 0.05) {
          best = item;
          bestDistance = distance;
        }
      }
      if (best) onSelectRef.current?.(best.tail);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      downX = event.clientX;
      downY = event.clientY;
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) moved = true;
      yaw -= dx * 0.005;
      pitch -= dy * 0.005;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (!moved) pick(event.clientX, event.clientY);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      distanceRef.current = Math.min(7.5, Math.max(1.6, distanceRef.current + event.deltaY * 0.002));
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let linkStamp = 0;
    let linkData = new Float32Array(0);
    const draw = (time: number) => {
      if (stopped) return;
      const current = pointsRef.current;
      const focus = focusRef.current;
      if (!framed && current.length > 0) {
        let lat = 0;
        let lon = 0;
        for (const point of current) {
          lat += point.lat;
          lon += point.lon;
        }
        const aim = facing(lat / current.length, lon / current.length);
        yaw = aim.yaw;
        pitch = aim.pitch;
        framed = true;
      }
      if (focus && !dragging) {
        const target = current.find((point) => point.tail_number === focus);
        if (target) {
          const aim = facing(target.lat, target.lon);
          yaw += (aim.yaw - yaw) * 0.08;
          pitch += (aim.pitch - pitch) * 0.08;
          if (distanceRef.current > 1.85) {
            distanceRef.current += (1.75 - distanceRef.current) * 0.06;
          }
        }
      }
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      model.set([
        cy, sy * sp, -sy * cp, 0,
        0, cp, sp, 0,
        sy, -cy * sp, cy * cp, 0,
        0, 0, 0, 1,
      ]);
      view[14] = -distanceRef.current;
      const aspect = canvas.width / Math.max(1, canvas.height);
      perspective(projection, 0.9, aspect, 0.1, 20);
      multiply(view, model, tmp);
      multiply(projection, tmp, mvp);

      gl.clearColor(0.03, 0.06, 0.07, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(solidProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(solidProgram, "uMvp"), false, mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(solidProgram, "uModel"), false, model);
      gl.bindBuffer(gl.ARRAY_BUFFER, solidPosition);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, solidNormal);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, solidIndex);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, "uMvp"), false, mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, "uModel"), false, model);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib3f(1, 0, 0, 1);
      gl.drawArrays(gl.LINES, 0, coasts.length / 3);

      const marked = emphasisRef.current;
      const cloud = new Float32Array(current.length * 7);
      const screen: Projected[] = [];
      const placed: { tail: string; lat: number; lon: number; x: number; y: number; z: number }[] = [];
      current.forEach((point, index) => {
        const lift = Math.min(0.08, Math.max(0, point.alt_m) / 12000);
        const [x, y, z] = latLonToVec(point.lat, point.lon, lift);
        const turned = rotateToward(x, y, z, yaw, pitch);
        const [r, g, b] = colorOf(point);
        const big = turned[2] < 0.02 ? 0 : marked?.has(point.tail_number) ? 11 : 3.4;
        const offset = index * 7;
        cloud[offset] = x;
        cloud[offset + 1] = y;
        cloud[offset + 2] = z;
        cloud[offset + 3] = r;
        cloud[offset + 4] = g;
        cloud[offset + 5] = b;
        cloud[offset + 6] = big;
        placed.push({ tail: point.tail_number, lat: point.lat, lon: point.lon, x, y, z });
        const clip = apply(mvp, x, y, z);
        if (clip[3] !== 0) {
          screen.push({
            tail: point.tail_number,
            x: ((clip[0] / clip[3]) * 0.5 + 0.5) * canvas.clientWidth,
            y: (1 - ((clip[1] / clip[3]) * 0.5 + 0.5)) * canvas.clientHeight,
            depth: turned[2],
          });
        }
      });
      projected.splice(0, projected.length, ...screen);

      if (linkNeighbors && placed.length > 1 && time - linkStamp > 500) {
        linkStamp = time;
        const links: number[] = [];
        const cell = 2;
        const buckets = new Map<string, number[]>();
        placed.forEach((item, index) => {
          const key = `${Math.floor(item.lon / cell)}:${Math.floor(item.lat / cell)}`;
          const list = buckets.get(key) ?? [];
          list.push(index);
          buckets.set(key, list);
        });
        placed.forEach((item, index) => {
          if (links.length > 6000) return;
          const gx = Math.floor(item.lon / cell);
          const gy = Math.floor(item.lat / cell);
          for (let ox = -1; ox <= 1; ox += 1) {
            for (let oy = -1; oy <= 1; oy += 1) {
              const list = buckets.get(`${gx + ox}:${gy + oy}`);
              if (!list) continue;
              for (const otherIndex of list) {
                if (otherIndex <= index) continue;
                const other = placed[otherIndex];
                if (!other) continue;
                const dLat = item.lat - other.lat;
                const dLon = item.lon - other.lon;
                if (dLat * dLat + dLon * dLon < 1.4) {
                  links.push(item.x, item.y, item.z, other.x, other.y, other.z);
                }
              }
            }
          }
        });
        linkData = new Float32Array(links);
      }
      if (linkNeighbors && linkData.length > 0) {
        gl.useProgram(lineProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, "uMvp"), false, mvp);
        gl.bindBuffer(gl.ARRAY_BUFFER, linkBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, linkData, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, linkData.length / 3);
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(pointProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(pointProgram, "uMvp"), false, mvp);
      gl.uniform1f(gl.getUniformLocation(pointProgram, "uScale"), canvas.width / 900);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cloud, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
      gl.drawArrays(gl.POINTS, 0, current.length);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      void time;
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      gl.deleteProgram(pointProgram);
      gl.deleteProgram(solidProgram);
      gl.deleteProgram(lineProgram);
    };
  }, [linkNeighbors]);

  return (
    <div className="spatial-wrap">
      <canvas ref={canvasRef} className="spatial-field" aria-label="Aircraft field" />
      <div className="scene-zoom" role="group" aria-label="Zoom">
        <button type="button" className="btn" onClick={() => zoomRef.current(-0.35)}>＋</button>
        <button type="button" className="btn" onClick={() => zoomRef.current(0.35)}>－</button>
      </div>
    </div>
  );
}

function apply(matrix: Float32Array, x: number, y: number, z: number): [number, number, number, number] {
  const clipX = at(matrix, 0) * x + at(matrix, 4) * y + at(matrix, 8) * z + at(matrix, 12);
  const clipY = at(matrix, 1) * x + at(matrix, 5) * y + at(matrix, 9) * z + at(matrix, 13);
  const clipZ = at(matrix, 2) * x + at(matrix, 6) * y + at(matrix, 10) * z + at(matrix, 14);
  const clipW = at(matrix, 3) * x + at(matrix, 7) * y + at(matrix, 11) * z + at(matrix, 15);
  return [clipX, clipY, clipZ, clipW];
}
