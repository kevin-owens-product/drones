import { useEffect, useRef } from "react";

interface Dot {
  orbit: number;
  angle: number;
  speed: number;
  size: number;
}

const DOTS: readonly Dot[] = Array.from({ length: 64 }, (_, index) => ({
  orbit: 0.16 + (index % 8) * 0.07,
  angle: (index / 64) * Math.PI * 2,
  speed: 0.12 + (index % 5) * 0.03,
  size: index % 8 === 0 ? 2.4 : 1.15,
}));

export function FloorField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !parent || !context) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let stopped = false;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    const draw = (time: number) => {
      if (stopped) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const cx = width * 0.58;
      const cy = height * 0.46;
      const scale = Math.min(width, height);
      context.strokeStyle = "rgba(127, 154, 111, 0.28)";
      context.lineWidth = 1;
      context.setLineDash([4, 7]);
      for (const radius of [0.2, 0.36, 0.52]) {
        context.beginPath();
        context.ellipse(cx, cy, scale * radius, scale * radius * 0.58, -0.45, 0, Math.PI * 2);
        context.stroke();
      }
      context.setLineDash([]);
      const points = DOTS.map((dot) => {
        const turn = reduce ? dot.angle : dot.angle + time * 0.00012 * dot.speed;
        return {
          x: cx + Math.cos(turn) * scale * dot.orbit,
          y: cy + Math.sin(turn) * scale * dot.orbit * 0.58,
          size: dot.size,
        };
      });
      context.strokeStyle = "rgba(92, 200, 255, 0.16)";
      for (let index = 0; index < points.length; index += 1) {
        const left = points[index];
        const right = points[(index + 5) % points.length];
        if (!left || !right) continue;
        const dx = left.x - right.x;
        const dy = left.y - right.y;
        if (dx * dx + dy * dy > (scale * 0.16) ** 2) continue;
        context.beginPath();
        context.moveTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.stroke();
      }
      for (const point of points) {
        context.fillStyle = point.size > 2 ? "#5cc8ff" : "#4a6a82";
        context.beginPath();
        context.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        context.fill();
      }
      if (!reduce) frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="floor-field" aria-hidden="true" />;
}
