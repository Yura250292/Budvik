"use client";

import { useEffect, useRef } from "react";

// Draw recognizable tool icons directly on canvas
type DrawFn = (ctx: CanvasRenderingContext2D) => void;

const drawHammer: DrawFn = (ctx) => {
  // Handle
  ctx.beginPath();
  ctx.moveTo(4, 20);
  ctx.lineTo(14, 10);
  ctx.stroke();
  // Head
  ctx.beginPath();
  ctx.rect(11, 4, 9, 5);
  ctx.fill();
  ctx.stroke();
};

const drawScrewdriver: DrawFn = (ctx) => {
  // Handle (thick)
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.lineTo(10, 14);
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.lineWidth = 1.5;
  // Shaft
  ctx.beginPath();
  ctx.moveTo(10, 14);
  ctx.lineTo(10, 4);
  ctx.stroke();
  // Tip
  ctx.beginPath();
  ctx.moveTo(10, 4);
  ctx.lineTo(8, 1);
  ctx.moveTo(10, 4);
  ctx.lineTo(12, 1);
  ctx.stroke();
};

const drawNail: DrawFn = (ctx) => {
  // Body
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.lineTo(10, 5);
  ctx.stroke();
  // Head (flat top)
  ctx.beginPath();
  ctx.moveTo(6, 5);
  ctx.lineTo(14, 5);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.lineWidth = 1.5;
  // Point
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.lineTo(9, 24);
  ctx.lineTo(11, 24);
  ctx.closePath();
  ctx.fill();
};

const drawWrench: DrawFn = (ctx) => {
  // Shaft
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.lineTo(10, 8);
  ctx.stroke();
  // Open jaw (top)
  ctx.beginPath();
  ctx.moveTo(5, 8);
  ctx.lineTo(5, 3);
  ctx.lineTo(8, 1);
  ctx.moveTo(15, 8);
  ctx.lineTo(15, 3);
  ctx.lineTo(12, 1);
  ctx.moveTo(5, 8);
  ctx.lineTo(15, 8);
  ctx.stroke();
};

const drawSledgehammer: DrawFn = (ctx) => {
  // Long handle
  ctx.beginPath();
  ctx.moveTo(6, 24);
  ctx.lineTo(12, 10);
  ctx.stroke();
  // Big heavy head
  ctx.beginPath();
  ctx.rect(6, 2, 12, 7);
  ctx.fill();
  ctx.stroke();
};

const TOOL_DRAWERS: DrawFn[] = [
  drawHammer,
  drawScrewdriver,
  drawNail,
  drawWrench,
  drawSledgehammer,
];

interface FallingTool {
  y: number;
  tool: number;
  speed: number;
  size: number;
  brightness: number;  // 0-1 lead tool brightness
}

interface Column {
  x: number;
  tools: FallingTool[];
}

// Trail length in pixels
const TRAIL_LENGTH = 6;

export default function ToolMatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const columnsRef = useRef<Column[]>([]);
  const animRef = useRef<number>(0);
  // Store previous positions for trails
  const trailsRef = useRef<Map<string, { y: number; tool: number; size: number; age: number }[]>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initColumns();
    };

    const initColumns = () => {
      const gap = 44;
      const cols: Column[] = [];
      trailsRef.current.clear();
      for (let x = 10; x < w; x += gap) {
        const colX = x + Math.random() * 14 - 7;
        const toolCount = 2 + Math.floor(Math.random() * 3);
        const tools: FallingTool[] = Array.from({ length: toolCount }, () => ({
          y: Math.random() * (h + 100) - 100,
          tool: Math.floor(Math.random() * TOOL_DRAWERS.length),
          speed: 0.4 + Math.random() * 0.8,
          size: 10 + Math.random() * 5,
          brightness: 0.5 + Math.random() * 0.5,
        }));
        cols.push({ x: colX, tools });
      }
      columnsRef.current = cols;
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      // Semi-transparent clear for trail persistence
      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.clearRect(0, 0, w, h);

      for (const col of columnsRef.current) {
        for (let ti = 0; ti < col.tools.length; ti++) {
          const t = col.tools[ti];
          const key = `${col.x.toFixed(0)}_${ti}`;

          // Update trail
          let trail = trailsRef.current.get(key);
          if (!trail) {
            trail = [];
            trailsRef.current.set(key, trail);
          }

          // Add current position to trail
          trail.unshift({ y: t.y, tool: t.tool, size: t.size, age: 0 });

          // Age and trim trail
          for (let i = 0; i < trail.length; i++) trail[i].age++;
          while (trail.length > TRAIL_LENGTH) trail.pop();

          // Draw trail (fading copies)
          for (let i = trail.length - 1; i >= 1; i--) {
            const tr = trail[i];
            const fadeOpacity = (1 - i / TRAIL_LENGTH) * 0.25 * t.brightness;
            if (fadeOpacity < 0.02) continue;

            ctx.save();
            ctx.translate(col.x, tr.y);
            const scale = tr.size / 24;
            ctx.scale(scale, scale);

            ctx.strokeStyle = `rgba(255, 214, 0, ${fadeOpacity})`;
            ctx.fillStyle = `rgba(255, 214, 0, ${fadeOpacity * 0.3})`;
            ctx.lineWidth = 1.2;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            TOOL_DRAWERS[tr.tool](ctx);
            ctx.restore();
          }

          // Draw lead tool (brightest)
          ctx.save();
          ctx.translate(col.x, t.y);
          const scale = t.size / 24;
          ctx.scale(scale, scale);

          ctx.shadowColor = `rgba(255, 214, 0, ${t.brightness * 0.7})`;
          ctx.shadowBlur = 8;

          ctx.strokeStyle = `rgba(255, 214, 0, ${t.brightness})`;
          ctx.fillStyle = `rgba(255, 214, 0, ${t.brightness * 0.4})`;
          ctx.lineWidth = 1.5;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          TOOL_DRAWERS[t.tool](ctx);
          ctx.restore();

          // Move
          t.y += t.speed;
          if (t.y > h + 40) {
            t.y = -40;
            t.tool = Math.floor(Math.random() * TOOL_DRAWERS.length);
            t.speed = 0.4 + Math.random() * 0.8;
            t.brightness = 0.5 + Math.random() * 0.5;
            trail.length = 0;
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.75 }}
    />
  );
}
