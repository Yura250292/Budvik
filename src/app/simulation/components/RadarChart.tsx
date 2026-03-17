"use client";

import { useEffect, useRef } from "react";
import type { SimulationResult } from "@/lib/simulation/engine";

interface Props {
  results: SimulationResult[];
}

const LABELS = ["Швидкість", "Точність", "Довговічність", "Безпека", "Ефективність"];
const KEYS: (keyof SimulationResult["metrics"])[] = ["speed", "precision", "durability", "safety", "efficiency"];
const COLORS = [
  "rgba(255, 214, 0, 0.7)",
  "rgba(59, 130, 246, 0.7)",
  "rgba(239, 68, 68, 0.7)",
  "rgba(34, 197, 94, 0.7)",
];
const FILLS = [
  "rgba(255, 214, 0, 0.15)",
  "rgba(59, 130, 246, 0.15)",
  "rgba(239, 68, 68, 0.15)",
  "rgba(34, 197, 94, 0.15)",
];

export default function RadarChart({ results }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w / 2;
    const cy = h / 2 - 10;
    const r = Math.min(w, h) * 0.35;
    const sides = 5;
    const angleStep = (Math.PI * 2) / sides;
    const startAngle = -Math.PI / 2;

    // Draw grid
    for (let level = 1; level <= 4; level++) {
      const lr = (r * level) / 4;
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const a = startAngle + i * angleStep;
        const x = cx + Math.cos(a) * lr;
        const y = cy + Math.sin(a) * lr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(200,200,200,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw axes + labels
    for (let i = 0; i < sides; i++) {
      const a = startAngle + i * angleStep;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(200,200,200,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      const lx = cx + Math.cos(a) * (r + 18);
      const ly = cy + Math.sin(a) * (r + 18);
      ctx.fillStyle = "#555";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(LABELS[i], lx, ly);
    }

    // Draw data polygons
    results.forEach((result, ri) => {
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = startAngle + i * angleStep;
        const val = result.metrics[KEYS[i]] / 100;
        const x = cx + Math.cos(a) * r * val;
        const y = cy + Math.sin(a) * r * val;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = FILLS[ri % FILLS.length];
      ctx.fill();
      ctx.strokeStyle = COLORS[ri % COLORS.length];
      ctx.lineWidth = 2;
      ctx.stroke();

      // Dots
      for (let i = 0; i < sides; i++) {
        const a = startAngle + i * angleStep;
        const val = result.metrics[KEYS[i]] / 100;
        const x = cx + Math.cos(a) * r * val;
        const y = cy + Math.sin(a) * r * val;
        ctx.fillStyle = COLORS[ri % COLORS.length];
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Legend
    const legendY = h - 20;
    let legendX = w / 2 - (results.length * 70) / 2;
    results.forEach((result, ri) => {
      ctx.fillStyle = COLORS[ri % COLORS.length];
      ctx.fillRect(legendX, legendY, 12, 12);
      ctx.fillStyle = "#555";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = (result.toolName || `Інструмент ${ri + 1}`).substring(0, 15);
      ctx.fillText(label, legendX + 16, legendY + 6);
      legendX += ctx.measureText(label).width + 28;
    });
  }, [results]);

  return (
    <canvas ref={canvasRef} className="w-full h-full" />
  );
}
