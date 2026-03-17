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

    const laneHeight = () => Math.min(70, (h - 30) / results.length);
    const laneY = (i: number) => 15 + i * laneHeight() + laneHeight() / 2;
    // Dynamic label width: use ~40% of canvas on mobile, ~30% on desktop
    const labelWidth = () => Math.min(220, Math.max(100, w * 0.35));
    const trackStart = () => labelWidth() + 8;
    const trackEnd = () => w - 35;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const lh = laneHeight();
      const te = trackEnd();

      const ts = trackStart();

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
        ctx.moveTo(ts, y);
        ctx.lineTo(te, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label — fit the full name or truncate smartly
        const fullLabel = results[i].consumableName || results[i].toolName || `#${i + 1}`;
        const color = LANE_COLORS[i % LANE_COLORS.length];
        ctx.fillStyle = color;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        // Try fitting full name, reduce font if needed
        const maxLabelW = ts - 12;
        let fontSize = 11;
        let label = fullLabel;
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;

        if (ctx.measureText(label).width > maxLabelW) {
          // Try smaller font first
          fontSize = 10;
          ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        }
        if (ctx.measureText(label).width > maxLabelW) {
          fontSize = 9;
          ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        }

        // If still too long, truncate with ellipsis
        if (ctx.measureText(label).width > maxLabelW) {
          while (label.length > 5 && ctx.measureText(label + "…").width > maxLabelW) {
            label = label.slice(0, -1);
          }
          label = label.trimEnd() + "…";
        }

        // Draw on two lines if name is very long and lane is tall enough
        if (fullLabel.length > 25 && lh >= 50 && fontSize >= 10) {
          const mid = Math.ceil(fullLabel.length / 2);
          const spaceIdx = fullLabel.lastIndexOf(" ", mid);
          const breakAt = spaceIdx > 10 ? spaceIdx : mid;
          const line1 = fullLabel.substring(0, breakAt).trim();
          const line2 = fullLabel.substring(breakAt).trim();

          ctx.font = `bold 9px system-ui, sans-serif`;
          let l1 = line1, l2 = line2;
          if (ctx.measureText(l1).width > maxLabelW) {
            while (l1.length > 5 && ctx.measureText(l1 + "…").width > maxLabelW) l1 = l1.slice(0, -1);
            l1 = l1.trimEnd() + "…";
          }
          if (ctx.measureText(l2).width > maxLabelW) {
            while (l2.length > 5 && ctx.measureText(l2 + "…").width > maxLabelW) l2 = l2.slice(0, -1);
            l2 = l2.trimEnd() + "…";
          }
          ctx.fillText(l1, ts - 6, y - 7);
          ctx.fillStyle = color + "BB";
          ctx.fillText(l2, ts - 6, y + 7);
        } else {
          ctx.fillText(label, ts - 6, y);
        }

        // Progress
        if (!finished[i]) {
          progress[i] = Math.min(1, progress[i] + speeds[i] * 0.004);
          if (progress[i] >= 1 && !finished[i]) {
            finished[i] = true;
            finishOrder.push(i);
          }
        }

        const px = ts + progress[i] * (te - ts);

        // Track progress fill
        ctx.fillStyle = color + "20";
        ctx.fillRect(ts, y - lh * 0.35, px - ts, lh * 0.7);

        // Progress bar
        ctx.fillStyle = color;
        ctx.fillRect(ts, y + lh * 0.3, px - ts, 3);

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
