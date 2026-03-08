"use client";

import { useEffect, useRef } from "react";

// SVG path data for various tools (small, simple outlines)
const TOOLS = [
  // Wrench / Гайковий ключ
  "M3 21l3.5-3.5M8.5 15.5l-2-2L18 2l2 2L8.5 15.5zM15 5l2 2",
  // Hammer / Молоток
  "M6 18L18 6M15 3l3 3-2 2-3-3 2-2zM3 21l3-3",
  // Screwdriver / Викрутка
  "M12 2l4 4-8 8-4-4 8-8zM4 18l4 4",
  // Pliers / Пласкогубці
  "M14 2l-4 8 4 4 8-4L14 2zM10 10l-8 8 2 2 8-8",
  // Tape measure / Рулетка
  "M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20zm0 4a6 6 0 0 1 0 12",
  // Scissors / Ножиці
  "M6 6a3 3 0 1 0 0-1L12 12m0 0l6 6M12 12L6 18a3 3 0 1 0 1 0l5-6z",
  // Axe / Сокира
  "M14 4l-8 8 2 2 8-8M6 12l-4 8 8-4",
  // Gear / Шестерня
  "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07l-1.41 1.41M6.34 17.66l-1.41 1.41m0-14.14l1.41 1.41m11.32 11.32l1.41 1.41",
  // Saw / Пилка
  "M3 12h18M3 12l2-3 2 3 2-3 2 3 2-3 2 3 2-3 2 3",
  // Drill / Дриль
  "M7 11L2 6l4-4 5 5M11 7l6 6M13 13l5 5-4 4-5-5",
];

interface Column {
  x: number;
  tools: { y: number; tool: number; opacity: number; size: number; speed: number }[];
}

export default function ToolMatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const columnsRef = useRef<Column[]>([]);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      initColumns(rect.width, rect.height);
    };

    const initColumns = (w: number, h: number) => {
      const gap = 38;
      const cols: Column[] = [];
      for (let x = 0; x < w; x += gap) {
        const toolCount = 3 + Math.floor(Math.random() * 4);
        const tools = Array.from({ length: toolCount }, () => ({
          y: Math.random() * h * 1.5 - h * 0.5,
          tool: Math.floor(Math.random() * TOOLS.length),
          opacity: 0.15 + Math.random() * 0.45,
          size: 10 + Math.random() * 6,
          speed: 0.3 + Math.random() * 0.7,
        }));
        cols.push({ x: x + Math.random() * 10 - 5, tools });
      }
      columnsRef.current = cols;
    };

    resize();
    window.addEventListener("resize", resize);

    // Pre-render tool paths
    const toolPaths: Path2D[] = TOOLS.map((d) => {
      const path = new Path2D();
      // Simple SVG path parser for M, l, m, L, z, a commands
      const commands = d.match(/[MLmlzZaA][^MLmlzZaA]*/g) || [];
      let cx = 0, cy = 0;
      for (const cmd of commands) {
        const type = cmd[0];
        const nums = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
        if (type === "M") { cx = nums[0]; cy = nums[1]; path.moveTo(cx, cy); }
        else if (type === "m") { cx += nums[0]; cy += nums[1]; path.moveTo(cx, cy); }
        else if (type === "L") { cx = nums[0]; cy = nums[1]; path.lineTo(cx, cy); }
        else if (type === "l") {
          for (let i = 0; i < nums.length; i += 2) {
            cx += nums[i]; cy += nums[i + 1]; path.lineTo(cx, cy);
          }
        }
        else if (type === "z" || type === "Z") { path.closePath(); }
      }
      return path;
    });

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      for (const col of columnsRef.current) {
        for (const t of col.tools) {
          t.y += t.speed;
          if (t.y > h + 30) {
            t.y = -30;
            t.tool = Math.floor(Math.random() * TOOLS.length);
            t.opacity = 0.15 + Math.random() * 0.45;
            t.speed = 0.3 + Math.random() * 0.7;
          }

          ctx.save();
          ctx.translate(col.x, t.y);
          const scale = t.size / 24;
          ctx.scale(scale, scale);

          // Glow effect
          ctx.shadowColor = `rgba(255, 214, 0, ${t.opacity * 0.6})`;
          ctx.shadowBlur = 6;

          ctx.strokeStyle = `rgba(255, 214, 0, ${t.opacity})`;
          ctx.lineWidth = 1.5;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke(toolPaths[t.tool]);
          ctx.restore();
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
      style={{ opacity: 0.7 }}
    />
  );
}
