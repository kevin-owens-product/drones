import { call, TERRAIN } from "./live";

/**
 * The hero's live operating picture: the console's own scenario, drawn on the
 * real terrain it uses. Vehicles, the jamming zone, VIO error circles, survey
 * coverage, link quality and CBBA task lines all come from demo.handle().
 */
type Sample = { tail_number: string; time: string; lat: number; lon: number; alt_m: number; heading_deg?: number; battery_pct?: number; mode?: string; nav_source?: string; gnss_trusted?: boolean; pos_sigma_m?: number };
type Picture = {
  station: { lat: number; lon: number };
  zones: Array<{ lat: number; lon: number; radius_m: number }>;
  areas: Array<{ tail: string; ring: number[][]; flown: number[][]; covered_pct: number }>;
  links: Array<{ a: string; b: string; quality: number }>;
  tasks: Array<{ id: string; label: string; lat: number; lon: number; tail: string | null }>;
};

export type ScopeEvent = { tone: "warn" | "danger" | "ok"; tail: string; text: string };

const VIEW = { south: 35.7215, north: 35.7565, west: -120.8025, east: -120.7305 };
const M_LAT = 110_540;
const M_LON = 111_320 * Math.cos((35.7392 * Math.PI) / 180);

export function mountScope(host: HTMLElement, onStats: (s: { air: number; vio: number; attention: number; replans: number }) => void, onEvent: (e: ScopeEvent) => void): void {
  const canvas = document.createElement("canvas");
  host.prepend(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new Image();
  img.src = "/demo-assets/terrain.jpg";

  let pic: Picture | null = null;
  const prev = new Map<string, Sample>();
  const next = new Map<string, Sample>();
  const trails = new Map<string, Array<[number, number]>>();
  let sampledAt = performance.now();
  let visible = true;
  let replans = 0;
  const owners = new Map<string, string | null>();
  const flags = new Map<string, Set<string>>();

  const metresToPx = (m: number, w: number) => (m / M_LON / (VIEW.east - VIEW.west)) * w;

  function flag(tail: string, key: string, on: boolean, e: () => ScopeEvent) {
    const set = flags.get(tail) ?? new Set<string>();
    flags.set(tail, set);
    if (on && !set.has(key)) {
      set.add(key);
      onEvent(e());
    } else if (!on && set.has(key)) set.delete(key);
  }

  function poll() {
    const live = call("GET", "/v1/telemetry/live").body as { items: Sample[] };
    prev.clear();
    for (const [k, v] of next) prev.set(k, v);
    next.clear();
    const now = Date.now();
    let air = 0, vio = 0, attention = 0;
    for (const s of live.items) {
      next.set(s.tail_number, s);
      const stale = now - Date.parse(s.time) > 6000;
      const flying = s.alt_m > 5;
      if (flying) air++;
      if (s.nav_source === "vio") vio++;
      const low = (s.battery_pct ?? 100) < 30 && flying;
      if (stale || low || s.nav_source === "vio") attention++;
      flag(s.tail_number, "vio", s.nav_source === "vio", () => ({ tone: "warn", tail: s.tail_number, text: `GNSS rejected by the spoof gate. Flying on VIO, ±${Math.round(s.pos_sigma_m ?? 0)} m.` }));
      flag(s.tail_number, "low", low, () => ({ tone: "warn", tail: s.tail_number, text: `Battery ${Math.round(s.battery_pct ?? 0)}%. Returning to the station.` }));
      flag(s.tail_number, "lost", stale, () => ({ tone: "danger", tail: s.tail_number, text: "Link lost. Its tasks go back to the fleet." }));
    }
    sampledAt = performance.now();
    onStats({ air, vio, attention, replans });
  }

  function pollPicture() {
    pic = call("GET", "/v1/operations/picture").body as Picture;
    for (const t of pic.tasks) {
      const before = owners.get(t.id);
      if (before !== undefined && before !== t.tail && t.tail) {
        replans++;
        onEvent({ tone: "ok", tail: t.tail, text: `Re-planned: ${t.label} moves from ${before ?? "nobody"} to ${t.tail}.` });
      }
      owners.set(t.id, t.tail);
    }
  }

  function resize() {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t: number) {
    if (!ctx) return;
    const w = canvas.width / Math.min(window.devicePixelRatio || 1, 2);
    const h = canvas.height / Math.min(window.devicePixelRatio || 1, 2);
    // Keep the view's aspect: crop the latitude span to the box.
    const span = (VIEW.east - VIEW.west) * (h / w) * (M_LON / M_LAT);
    const mid = (VIEW.north + VIEW.south) / 2;
    const view = { ...VIEW, north: mid + span / 2, south: mid - span / 2 };
    const P = (lat: number, lon: number): [number, number] => [((lon - view.west) / (view.east - view.west)) * w, ((view.north - lat) / (view.north - view.south)) * h];

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);
    if (img.complete && img.naturalWidth) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const sx = ((view.west - TERRAIN.west) / (TERRAIN.east - TERRAIN.west)) * iw;
      const sy = ((TERRAIN.north - view.north) / (TERRAIN.north - TERRAIN.south)) * ih;
      const sw = ((view.east - view.west) / (TERRAIN.east - TERRAIN.west)) * iw;
      const sh = ((view.north - view.south) / (TERRAIN.north - TERRAIN.south)) * ih;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(5,7,10,0.12)");
    vg.addColorStop(1, "rgba(5,7,10,0.7)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // Range grid, 500 m.
    ctx.strokeStyle = "rgba(92,200,255,0.06)";
    ctx.lineWidth = 1;
    const step = metresToPx(500, w);
    for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    if (pic) {
      // Survey areas and the coverage flown so far.
      for (const a of pic.areas) {
        ctx.beginPath();
        a.ring.forEach(([la, lo], i) => { const [x, y] = P(la as number, lo as number); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath();
        ctx.fillStyle = "rgba(92,200,255,0.05)";
        ctx.fill();
        ctx.strokeStyle = "rgba(92,200,255,0.28)";
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        a.flown.forEach(([la, lo], i) => { const [x, y] = P(la as number, lo as number); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = "rgba(139,224,196,0.55)";
        ctx.lineWidth = Math.max(2, metresToPx(140, w) * 0.5);
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      }
      // GNSS jamming zone.
      for (const z of pic.zones) {
        const [x, y] = P(z.lat, z.lon);
        const r = metresToPx(z.radius_m, w);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,107,91,0.26)");
        g.addColorStop(0.8, "rgba(255,107,91,0.08)");
        g.addColorStop(1, "rgba(255,107,91,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        const pulse = (t / 2400) % 1;
        ctx.strokeStyle = `rgba(255,107,91,${0.5 * (1 - pulse)})`;
        ctx.beginPath(); ctx.arc(x, y, r * (0.4 + 0.6 * pulse), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(255,107,91,0.45)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,150,140,0.9)";
        ctx.font = "600 10px 'JetBrains Mono Variable', monospace";
        ctx.fillText("GNSS JAMMING · SIM", x - r * 0.55, y - r - 6);
      }
    }

    // Interpolated vehicle positions.
    const k = Math.min(1, (performance.now() - sampledAt) / 520);
    const pos = new Map<string, { x: number; y: number; s: Sample }>();
    for (const [tail, s] of next) {
      const p0 = prev.get(tail) ?? s;
      const lat = p0.lat + (s.lat - p0.lat) * k;
      const lon = p0.lon + (s.lon - p0.lon) * k;
      const [x, y] = P(lat, lon);
      pos.set(tail, { x, y, s });
    }

    if (pic) {
      const [sx, sy] = P(pic.station.lat, pic.station.lon);
      // Links from the station, alpha by quality.
      for (const l of pic.links) {
        const b = pos.get(l.b);
        if (!b) continue;
        ctx.strokeStyle = `rgba(92,200,255,${0.08 + 0.3 * l.quality})`;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // Task allocation lines and markers.
      for (const task of pic.tasks) {
        const [tx, ty] = P(task.lat, task.lon);
        const owner = task.tail ? pos.get(task.tail) : undefined;
        if (owner) {
          ctx.strokeStyle = "rgba(244,180,67,0.7)";
          ctx.setLineDash([2, 4]);
          ctx.lineDashOffset = -t / 60;
          ctx.beginPath(); ctx.moveTo(owner.x, owner.y); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = owner ? "#f4b443" : "#5f6b79";
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
        ctx.fillStyle = "rgba(244,210,150,0.9)";
        ctx.font = "500 10px 'Inter Variable', sans-serif";
        ctx.fillText(task.label, tx + 8, ty + 3);
      }
      // Station.
      ctx.strokeStyle = "#e7ecf2";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - 5, sy - 5, 10, 10);
      ctx.lineWidth = 1;
      ctx.fillStyle = "#e7ecf2";
      ctx.font = "600 10px 'JetBrains Mono Variable', monospace";
      ctx.fillText("GCS", sx + 9, sy + 4);
    }

    const now = Date.now();
    for (const [tail, p] of pos) {
      const s = p.s;
      const trail = trails.get(tail) ?? [];
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 2) trail.push([p.x, p.y]);
      if (trail.length > 70) trail.shift();
      trails.set(tail, trail);
      const stale = now - Date.parse(s.time) > 6000;
      const low = (s.battery_pct ?? 100) < 30 && s.alt_m > 5;
      const color = stale ? "#ff6b5b" : s.nav_source === "vio" || low ? "#f4b443" : s.alt_m > 5 ? "#3fd69a" : "#8794a3";
      ctx.beginPath();
      trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = color + "55";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1;
      if (s.nav_source === "vio" && s.pos_sigma_m) {
        const r = Math.max(6, metresToPx(s.pos_sigma_m * 6, w));
        ctx.fillStyle = "rgba(244,180,67,0.12)";
        ctx.strokeStyle = "rgba(244,180,67,0.6)";
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (stale) {
        const pulse = (t / 900) % 1;
        ctx.strokeStyle = `rgba(255,107,91,${1 - pulse})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((s.heading_deg ?? 0) * Math.PI) / 180);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      if (s.alt_m > 5) { ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); }
      else ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(231,236,242,0.85)";
      ctx.font = "600 10px 'JetBrains Mono Variable', monospace";
      ctx.fillText(tail, p.x + 9, p.y - 7);
    }

    // Scale bar.
    const bar = metresToPx(1000, w);
    ctx.strokeStyle = "rgba(231,236,242,0.6)";
    ctx.beginPath(); ctx.moveTo(w - 24 - bar, h - 92); ctx.lineTo(w - 24, h - 92); ctx.stroke();
    ctx.fillStyle = "rgba(231,236,242,0.7)";
    ctx.font = "500 10px 'JetBrains Mono Variable', monospace";
    ctx.fillText("1 km", w - 24 - bar, h - 98);
  }

  resize();
  window.addEventListener("resize", resize);
  poll();
  pollPicture();
  setInterval(() => visible && poll(), 500);
  setInterval(() => visible && pollPicture(), 1500);
  new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }).observe(host);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loop = (t: number) => {
    if (visible) draw(t);
    if (!reduce) requestAnimationFrame(loop);
  };
  if (reduce) { setInterval(() => draw(performance.now()), 1000); draw(0); }
  else requestAnimationFrame(loop);
}
