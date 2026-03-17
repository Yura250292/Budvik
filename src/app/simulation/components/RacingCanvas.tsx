"use client";

import { useEffect, useRef } from "react";
import type { SimulationResult } from "@/lib/simulation/engine";

interface Props {
  results: SimulationResult[];
  type: "cutting" | "grinding" | "drilling";
}

const LANE_COLORS = ["#FFD600", "#3B82F6", "#EF4444", "#22C55E"];

export default function RacingCanvas({ results, type }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || results.length === 0) return;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0;

    // Normalize times: fastest = 1.0, others proportionally slower
    const minTime = Math.max(0.1, Math.min(...results.map(r => r.estimatedTimeSec)));
    const speeds = results.map(r => minTime / Math.max(0.1, r.estimatedTimeSec));

    const progress = results.map(() => 0);
    const finished = results.map(() => false);
    const finishOrder: number[] = [];
    const particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; lane: number }[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const laneHeight = () => Math.min(60, (h - 40) / results.length);
    const laneY = (i: number) => 20 + i * laneHeight() + laneHeight() / 2;
    const trackStart = 60;
    const trackEnd = () => w - 30;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const lh = laneHeight();
      const te = trackEnd();

      // Draw lanes
      for (let i = 0; i < results.length; i++) {
        const y = laneY(i);

        // Lane background
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
        ctx.fillRect(0, y - lh / 2, w, lh);

        // Lane line
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(trackStart, y);
        ctx.lineTo(te, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        const label = results[i].consumableName || results[i].toolName || `#${i + 1}`;
        ctx.fillStyle = LANE_COLORS[i % LANE_COLORS.length];
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(label.substring(0, 12), trackStart - 6, y);

        // Progress
        if (!finished[i]) {
          progress[i] = Math.min(1, progress[i] + speeds[i] * 0.004);
          if (progress[i] >= 1 && !finished[i]) {
            finished[i] = true;
            finishOrder.push(i);
          }
        }

        const px = trackStart + progress[i] * (te - trackStart);
        const color = LANE_COLORS[i % LANE_COLORS.length];

        // Track progress fill
        ctx.fillStyle = color + "20";
        ctx.fillRect(trackStart, y - lh * 0.35, px - trackStart, lh * 0.7);

        // Progress bar
        ctx.fillStyle = color;
        ctx.fillRect(trackStart, y + lh * 0.3, px - trackStart, 3);

        // Tool head
        if (type === "cutting") {
          // Spinning disc
          const t = Date.now() / 60;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, y, 10, 0, Math.PI * 2);
          ctx.stroke();
          for (let j = 0; j < 3; j++) {
            const a = t + (j * Math.PI * 2) / 3;
            ctx.beginPath();
            ctx.moveTo(px, y);
            ctx.lineTo(px + Math.cos(a) * 8, y + Math.sin(a) * 8);
            ctx.stroke();
          }
        } else if (type === "drilling") {
          // Drill bit
          const t = Date.now() / 40;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          for (let j = 0; j < 2; j++) {
            const a = t + j * Math.PI;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(a) * 3, y + Math.sin(a) * 3);
            ctx.lineTo(px + Math.cos(a) * 10, y + Math.sin(a) * 10);
            ctx.stroke();
          }
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px, y, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Grinding - oscillating pad
          const t = Date.now() / 100;
          const ox = Math.sin(t) * 4;
          ctx.fillStyle = color;
          ctx.fillRect(px - 8 + ox, y - 6, 16, 12);
          ctx.strokeStyle = "rgba(0,0,0,0.3)";
          ctx.lineWidth = 1;
          ctx.strokeRect(px - 8 + ox, y - 6, 16, 12);
        }

        // Sparks
        if (progress[i] < 1 && progress[i] > 0.02) {
          for (let s = 0; s < 2; s++) {
            particles.push({
              x: px,
              y: y + (Math.random() - 0.5) * 10,
              vx: -1 - Math.random() * 2,
              vy: (Math.random() - 0.5) * 3,
              life: 0,
              maxLife: 12 + Math.random() * 10,
              color,
              lane: i,
            });
          }
        }

        // Finish medal
        if (finished[i]) {
          const place = finishOrder.indexOf(i) + 1;
          const medals = ["🥇", "🥈", "🥉", "4"];
          ctx.font = "16px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(medals[place - 1] || `${place}`, te + 15, y);
        }
      }

      // Finish line
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(te, 10);
      ctx.lineTo(te, h - 10);
      ctx.stroke();
      ctx.setLineDash([]);

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.life++;
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = 1 - p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Reset if all finished
      if (finished.every(Boolean) && finishOrder.length === results.length) {
        setTimeout(() => {
          for (let i = 0; i < results.length; i++) {
            progress[i] = 0;
            finished[i] = false;
          }
          finishOrder.length = 0;
        }, 3000);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [results, type]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}
