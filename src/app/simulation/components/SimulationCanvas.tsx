"use client";

import { useEffect, useRef } from "react";
import type { SimulationType } from "@/lib/simulation/specs";
import type { SimulationResult } from "@/lib/simulation/engine";
import { getMaterialById } from "@/lib/simulation/materials";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Props {
  type: SimulationType;
  results: SimulationResult[];
  materialColor?: string;
}

export default function SimulationCanvas({ type, results }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0;
    const particles: Particle[] = [];
    let progress = 0;
    const speed = results.length > 0
      ? Math.max(0.1, Math.min(1.5, 100 / (results[0].estimatedTimeSec + 1)))
      : 0.5;

    const matColor = "#F59E0B";

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

    const spawnParticles = (x: number, y: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 1 + Math.random() * 3;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - Math.random() * 2,
          life: 0,
          maxLife: 20 + Math.random() * 30,
          color: Math.random() > 0.5 ? "#FFD600" : matColor,
          size: 1 + Math.random() * 2,
        });
      }
    };

    const drawCutting = () => {
      const blockX = w * 0.15;
      const blockW = w * 0.7;
      const blockY = h * 0.45;
      const blockH = h * 0.35;

      // Material block
      ctx.fillStyle = "#555";
      ctx.fillRect(blockX, blockY, blockW, blockH);
      ctx.strokeStyle = "#777";
      ctx.lineWidth = 1;
      ctx.strokeRect(blockX, blockY, blockW, blockH);

      // Cut line progress
      const cutX = blockX + progress * blockW;
      if (progress > 0 && progress < 1) {
        ctx.fillStyle = "#1A1A1A";
        ctx.fillRect(blockX, blockY, cutX - blockX, blockH);
        // Cut line glow
        ctx.strokeStyle = "#FFD600";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#FFD600";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(cutX, blockY);
        ctx.lineTo(cutX, blockY + blockH);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Disc
      const discX = cutX;
      const discY = blockY - 10;
      const discR = 25;
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(discX, discY, discR, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating lines in disc
      const t = Date.now() / 50;
      for (let i = 0; i < 4; i++) {
        const a = t + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(discX + Math.cos(a) * 5, discY + Math.sin(a) * 5);
        ctx.lineTo(discX + Math.cos(a) * discR * 0.9, discY + Math.sin(a) * discR * 0.9);
        ctx.strokeStyle = "rgba(255,214,0,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Sparks at contact point
      if (progress > 0.02 && progress < 0.98) {
        spawnParticles(cutX, blockY, 2);
      }
    };

    const drawGrinding = () => {
      // Surface
      const surfaceY = h * 0.65;
      ctx.fillStyle = "#555";
      ctx.fillRect(w * 0.1, surfaceY, w * 0.8, h * 0.2);

      // Ground area
      ctx.fillStyle = "#888";
      ctx.fillRect(w * 0.1, surfaceY, w * 0.8 * progress, h * 0.2);

      // Disc
      const discX = w * 0.1 + w * 0.8 * progress;
      const discY = surfaceY - 5;
      const discR = 30;

      // Disc body
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(discX, discY, discR, 0, Math.PI * 2);
      ctx.stroke();

      // Rotation
      const t = Date.now() / 40;
      for (let i = 0; i < 6; i++) {
        const a = t + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(discX, discY);
        ctx.lineTo(discX + Math.cos(a) * discR * 0.85, discY + Math.sin(a) * discR * 0.85);
        ctx.strokeStyle = "rgba(255,214,0,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Sparks upward
      if (progress > 0.02 && progress < 0.98) {
        for (let i = 0; i < 3; i++) {
          particles.push({
            x: discX + (Math.random() - 0.5) * 20,
            y: surfaceY,
            vx: (Math.random() - 0.5) * 2,
            vy: -2 - Math.random() * 4,
            life: 0,
            maxLife: 15 + Math.random() * 20,
            color: Math.random() > 0.3 ? "#FFD600" : "#FF6B00",
            size: 1 + Math.random() * 1.5,
          });
        }
      }
    };

    const drawDrilling = () => {
      const centerX = w / 2;
      const centerY = h * 0.5;
      const holeR = 20 + progress * 15;

      // Material surface
      ctx.fillStyle = "#555";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 80, 0, Math.PI * 2);
      ctx.fill();

      // Hole
      if (progress > 0.01) {
        ctx.fillStyle = "#1A1A1A";
        ctx.beginPath();
        ctx.arc(centerX, centerY, holeR * progress, 0, Math.PI * 2);
        ctx.fill();

        // Hole edge glow
        ctx.strokeStyle = "rgba(255,214,0,0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, holeR * progress, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Drill bit - rotating cross
      const t = Date.now() / 30;
      ctx.strokeStyle = "#FFD600";
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 2; i++) {
        const a = t + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(a) * 3, centerY + Math.sin(a) * 3);
        ctx.lineTo(centerX + Math.cos(a) * (holeR * 0.8), centerY + Math.sin(a) * (holeR * 0.8));
        ctx.stroke();
      }

      // Center point
      ctx.fillStyle = "#FFD600";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      ctx.fill();

      // Debris particles spiral outward
      if (progress > 0.02 && progress < 0.98) {
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = holeR * progress;
          particles.push({
            x: centerX + Math.cos(angle) * dist,
            y: centerY + Math.sin(angle) * dist,
            vx: Math.cos(angle) * 1.5,
            vy: Math.sin(angle) * 1.5,
            life: 0,
            maxLife: 20 + Math.random() * 15,
            color: "#999",
            size: 1 + Math.random(),
          });
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      // Update progress
      progress = Math.min(1, progress + speed * 0.003);
      if (progress >= 1) progress = 0; // loop

      // Draw based on type
      if (type === "cutting") drawCutting();
      else if (type === "grinding") drawGrinding();
      else drawDrilling();

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // gravity
        p.life++;

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        const alpha = 1 - p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Progress bar
      const barY = h - 12;
      ctx.fillStyle = "#333";
      ctx.fillRect(w * 0.1, barY, w * 0.8, 4);
      ctx.fillStyle = "#FFD600";
      ctx.fillRect(w * 0.1, barY, w * 0.8 * progress, 4);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [type, results]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
    />
  );
}
