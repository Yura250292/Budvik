"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface Props {
  type: "cutting" | "grinding" | "drilling";
}

// ─── Particle system ───
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
  type: "spark" | "smoke" | "glow";
}

// ─── Metric indicator ───
interface MetricBubble {
  label: string;
  icon: string;
  progress: number; // 0→1
  x: number; y: number;
  delay: number;
}

const TIPS: Record<string, string[]> = {
  cutting: [
    "Проведіть пальцем, щоб різати матеріал",
    "Аналізуємо знос диску...",
    "Обчислюємо швидкість різання...",
    "Вимірюємо нагрів в зоні різу...",
    "AI шукає відгуки в інтернеті...",
    "Визначаємо ефективність...",
  ],
  grinding: [
    "Проведіть пальцем по поверхні",
    "Аналізуємо якість шліфування...",
    "Вимірюємо знімання матеріалу...",
    "Контролюємо температуру...",
    "AI порівнює з реальними тестами...",
    "Визначаємо точність обробки...",
  ],
  drilling: [
    "Натисніть, щоб почати свердлити",
    "Аналізуємо подачу свердла...",
    "Вимірюємо якість отвору...",
    "Контролюємо нагрів свердла...",
    "AI шукає характеристики...",
    "Визначаємо продуктивність...",
  ],
};

export default function InteractiveSimCanvas({ type }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    mouseX: 0,
    mouseY: 0,
    isPressed: false,
    cutProgress: 0,
    particles: [] as Particle[],
    toolAngle: 0,
    heatGlow: 0,
    vibrationOffset: 0,
    tipIndex: 0,
    tipTimer: 0,
    tipOpacity: 1,
    elapsed: 0,
    metrics: [
      { label: "Знос", icon: "⚙️", progress: 0, x: 0, y: 0, delay: 0 },
      { label: "Нагрів", icon: "🌡️", progress: 0, x: 0, y: 0, delay: 1.5 },
      { label: "Ефективність", icon: "⚡", progress: 0, x: 0, y: 0, delay: 3 },
      { label: "Час", icon: "⏱️", progress: 0, x: 0, y: 0, delay: 4.5 },
      { label: "Точність", icon: "🎯", progress: 0, x: 0, y: 0, delay: 6 },
    ] as MetricBubble[],
  });

  const [currentTip, setCurrentTip] = useState(0);

  // Cycle tips
  useEffect(() => {
    const tips = TIPS[type];
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % tips.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [type]);

  const getPointerPos = useCallback((e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const S = stateRef.current;

    // Pointer handlers
    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      S.isPressed = true;
      const pos = getPointerPos(e, canvas);
      S.mouseX = pos.x / dpr;
      S.mouseY = pos.y / dpr;
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const pos = getPointerPos(e, canvas);
      S.mouseX = pos.x / dpr;
      S.mouseY = pos.y / dpr;
    };
    const onUp = () => { S.isPressed = false; };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onUp);

    let frame = 0;
    let lastTime = performance.now();

    const spawnParticles = (x: number, y: number, count: number, intense: boolean) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * (intense ? 6 : 3);
        const isSpark = Math.random() > 0.3;
        S.particles.push({
          x, y,
          vx: Math.cos(angle) * speed + (type === "cutting" ? 2 : 0),
          vy: Math.sin(angle) * speed - (isSpark ? 2 : 0),
          life: 1,
          maxLife: 0.4 + Math.random() * (isSpark ? 0.6 : 1.2),
          color: isSpark
            ? `hsl(${30 + Math.random() * 30}, 100%, ${60 + Math.random() * 30}%)`
            : `rgba(180, 180, 180, ${0.3 + Math.random() * 0.3})`,
          size: isSpark ? 1 + Math.random() * 2 : 3 + Math.random() * 5,
          type: isSpark ? "spark" : "smoke",
        });
      }
    };

    const draw = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      S.elapsed += dt;
      frame++;

      const W = canvas.width / dpr;
      const H = canvas.height / dpr;

      ctx.clearRect(0, 0, W, H);

      // ─── Background gradient ───
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, "#0d0d0d");
      bgGrad.addColorStop(1, "#1a1a1a");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Grid pattern for "3D" feel
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (let i = 0; i < W; i += 30) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, H);
        ctx.stroke();
      }
      for (let i = 0; i < H; i += 30) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(W, i);
        ctx.stroke();
      }

      S.toolAngle += dt * 15;
      if (S.isPressed) {
        S.cutProgress = Math.min(1, S.cutProgress + dt * 0.15);
        S.heatGlow = Math.min(1, S.heatGlow + dt * 0.8);
        S.vibrationOffset = Math.sin(now * 0.03) * 2;
      } else {
        S.heatGlow = Math.max(0, S.heatGlow - dt * 0.5);
        S.vibrationOffset *= 0.9;
      }

      // ─── Draw based on type ───
      if (type === "cutting") drawCutting(ctx, W, H, dt, S, now, spawnParticles);
      else if (type === "grinding") drawGrinding(ctx, W, H, dt, S, now, spawnParticles);
      else drawDrilling(ctx, W, H, dt, S, now, spawnParticles);

      // ─── Particles ───
      for (let i = S.particles.length - 1; i >= 0; i--) {
        const p = S.particles[i];
        p.life -= dt / p.maxLife;
        if (p.life <= 0) { S.particles.splice(i, 1); continue; }
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15; // gravity
        if (p.type === "smoke") { p.vy -= 0.3; p.size += dt * 3; }

        ctx.globalAlpha = p.life;
        if (p.type === "spark") {
          // Bright streak
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * p.life;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
          ctx.stroke();
          // Glow
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // ─── Metric bubbles (floating around edges) ───
      const bubblePositions = [
        { x: W - 100, y: 30 },
        { x: W - 100, y: 70 },
        { x: W - 100, y: 110 },
        { x: 20, y: 30 },
        { x: 20, y: 70 },
      ];
      for (let i = 0; i < S.metrics.length; i++) {
        const m = S.metrics[i];
        const bp = bubblePositions[i];
        const t = Math.max(0, S.elapsed - m.delay);
        if (t <= 0) continue;
        m.progress = Math.min(1, t / 4);

        const alpha = Math.min(1, t * 2);
        const pulse = 1 + Math.sin(S.elapsed * 3 + i) * 0.03;

        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.translate(bp.x, bp.y);
        ctx.scale(pulse, pulse);

        // Pill background
        const pillW = i < 3 ? 90 : 80;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.roundRect(-5, -12, pillW, 24, 12);
        ctx.fill();

        // Progress bar inside
        ctx.fillStyle = m.progress >= 1
          ? "rgba(34, 197, 94, 0.6)"
          : "rgba(255, 214, 0, 0.4)";
        ctx.beginPath();
        ctx.roundRect(-3, -10, (pillW - 4) * m.progress, 20, 10);
        ctx.fill();

        // Text
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${m.icon} ${m.label}`, 2, 3);

        // Checkmark if done
        if (m.progress >= 1) {
          ctx.fillStyle = "#22C55E";
          ctx.font = "bold 11px system-ui";
          ctx.textAlign = "right";
          ctx.fillText("✓", pillW - 10, 4);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.font = "9px system-ui";
          ctx.textAlign = "right";
          ctx.fillText(`${Math.round(m.progress * 100)}%`, pillW - 10, 3);
        }

        ctx.restore();
      }

      // ─── Limit particles ───
      if (S.particles.length > 300) S.particles.splice(0, S.particles.length - 300);

      requestAnimationFrame(draw);
    };

    const raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onUp);
      canvas.removeEventListener("touchstart", onDown);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onUp);
    };
  }, [type, getPointerPos]);

  const tips = TIPS[type];

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#0d0d0d]" style={{ height: 340 }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none cursor-crosshair"
      />
      {/* Floating tip */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
        <div
          key={currentTip}
          className="bg-black/70 backdrop-blur-sm text-white/90 text-xs sm:text-sm px-5 py-2.5 rounded-full border border-white/10 animate-fade-in"
        >
          {tips[currentTip]}
        </div>
      </div>
      {/* "AI Симуляція" badge */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
        <div className="relative w-5 h-5">
          <div className="absolute inset-0 rounded-full border-2 border-[#FFD600]/30" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#FFD600] animate-spin" />
        </div>
        <span className="text-[#FFD600] text-xs font-bold tracking-wider uppercase">AI Симуляція</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// CUTTING MODE — Angle grinder side view
// ═══════════════════════════════════════
function drawCutting(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, now: number,
  spawnParticles: (x: number, y: number, count: number, intense: boolean) => void
) {
  const cx = S.isPressed ? S.mouseX : W * 0.45;
  const cy = S.isPressed ? S.mouseY : H * 0.5;

  // ─── Material block (3D perspective) ───
  const blockX = W * 0.15;
  const blockY = H * 0.55;
  const blockW = W * 0.7;
  const blockH = H * 0.3;
  const cutX = blockX + blockW * S.cutProgress;

  // Top face (lighter)
  ctx.fillStyle = "#4a4a4a";
  ctx.beginPath();
  ctx.moveTo(blockX, blockY);
  ctx.lineTo(blockX + 20, blockY - 15);
  ctx.lineTo(blockX + blockW + 20, blockY - 15);
  ctx.lineTo(blockX + blockW, blockY);
  ctx.fill();

  // Front face
  const metalGrad = ctx.createLinearGradient(blockX, blockY, blockX, blockY + blockH);
  metalGrad.addColorStop(0, "#555");
  metalGrad.addColorStop(0.5, "#3a3a3a");
  metalGrad.addColorStop(1, "#2a2a2a");
  ctx.fillStyle = metalGrad;
  ctx.fillRect(blockX, blockY, blockW, blockH);

  // Side face
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(blockX + blockW, blockY);
  ctx.lineTo(blockX + blockW + 20, blockY - 15);
  ctx.lineTo(blockX + blockW + 20, blockY + blockH - 15);
  ctx.lineTo(blockX + blockW, blockY + blockH);
  ctx.fill();

  // Cut line (kerf)
  if (S.cutProgress > 0.01) {
    ctx.strokeStyle = "#FFD600";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#FFD600";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(blockX, blockY);
    ctx.lineTo(cutX, blockY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(blockX, blockY + blockH);
    ctx.lineTo(cutX, blockY + blockH);
    ctx.stroke();
    // Interior darkness
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(blockX, blockY + 1, cutX - blockX, blockH - 2);
    ctx.shadowBlur = 0;
  }

  // ─── Angle grinder (3D-ish) ───
  const toolX = cx + S.vibrationOffset;
  const toolY = Math.min(cy, blockY - 5);

  // Grinder body (trapezoid shape)
  ctx.save();
  ctx.translate(toolX, toolY);

  // Main body
  const bodyGrad = ctx.createLinearGradient(-30, -40, 30, 10);
  bodyGrad.addColorStop(0, "#2d2d2d");
  bodyGrad.addColorStop(0.5, "#444");
  bodyGrad.addColorStop(1, "#333");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-15, -45);
  ctx.lineTo(15, -45);
  ctx.lineTo(20, -10);
  ctx.lineTo(-20, -10);
  ctx.closePath();
  ctx.fill();

  // Handle
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.roundRect(-40, -35, 25, 14, 5);
  ctx.fill();
  // Handle grip texture
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  for (let i = -35; i < -22; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, -35);
    ctx.lineTo(i, -21);
    ctx.stroke();
  }

  // Gear housing (circle)
  ctx.fillStyle = "#383838";
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2;
  ctx.stroke();

  // ─── Spinning disc ───
  const discR = 25;
  ctx.save();
  ctx.rotate(S.toolAngle);

  // Disc body
  const discGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, discR);
  discGrad.addColorStop(0, "#888");
  discGrad.addColorStop(0.3, "#666");
  discGrad.addColorStop(0.8, "#555");
  discGrad.addColorStop(1, "#444");
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(0, 0, discR, 0, Math.PI * 2);
  ctx.fill();

  // Disc lines (show rotation)
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
    ctx.lineTo(Math.cos(a) * discR, Math.sin(a) * discR);
    ctx.stroke();
  }

  // Center nut
  ctx.fillStyle = "#777";
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // rotation

  // Heat glow at contact point
  if (S.heatGlow > 0.1) {
    const glowR = 15 + S.heatGlow * 20;
    const glow = ctx.createRadialGradient(0, discR, 0, 0, discR, glowR);
    glow.addColorStop(0, `rgba(255, 180, 0, ${S.heatGlow * 0.6})`);
    glow.addColorStop(0.5, `rgba(255, 100, 0, ${S.heatGlow * 0.3})`);
    glow.addColorStop(1, "rgba(255, 50, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, discR, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore(); // translate

  // Sparks when cutting
  if (S.isPressed) {
    spawnParticles(toolX, toolY + 25, 3, S.cutProgress > 0.3);
  }
}

// ═══════════════════════════════════════
// GRINDING MODE — disc on surface
// ═══════════════════════════════════════
function drawGrinding(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, now: number,
  spawnParticles: (x: number, y: number, count: number, intense: boolean) => void
) {
  const cx = S.isPressed ? S.mouseX : W * 0.5;
  const cy = S.isPressed ? Math.min(S.mouseY, H * 0.6) : H * 0.45;

  // ─── Surface (perspective grid) ───
  const surfaceY = H * 0.65;
  const surfGrad = ctx.createLinearGradient(0, surfaceY, 0, H);
  surfGrad.addColorStop(0, "#4a4a4a");
  surfGrad.addColorStop(1, "#2a2a2a");
  ctx.fillStyle = surfGrad;
  ctx.fillRect(0, surfaceY, W, H - surfaceY);

  // Perspective lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const x = (i / 12) * W;
    ctx.beginPath();
    ctx.moveTo(x, surfaceY);
    ctx.lineTo(W * 0.5 + (x - W * 0.5) * 0.3, H);
    ctx.stroke();
  }

  // Grinding marks (follow cut progress)
  if (S.cutProgress > 0.01) {
    ctx.strokeStyle = "rgba(255, 214, 0, 0.15)";
    ctx.lineWidth = 3;
    for (let i = 0; i < S.cutProgress * 15; i++) {
      const gx = W * 0.2 + Math.random() * W * 0.6;
      const gy = surfaceY + 3 + Math.random() * 10;
      ctx.beginPath();
      ctx.moveTo(gx - 8, gy);
      ctx.lineTo(gx + 8, gy);
      ctx.stroke();
    }
  }

  // ─── Grinder (viewed from an angle) ───
  const toolX = cx + S.vibrationOffset;
  const toolY = Math.min(cy, surfaceY - 30);

  ctx.save();
  ctx.translate(toolX, toolY);

  // Body (angled)
  ctx.rotate(-0.3);
  const bodyGrad = ctx.createLinearGradient(-15, -50, 15, 0);
  bodyGrad.addColorStop(0, "#333");
  bodyGrad.addColorStop(1, "#444");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.roundRect(-18, -55, 36, 50, 5);
  ctx.fill();

  // Handle
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.roundRect(-35, -40, 20, 12, 4);
  ctx.fill();

  ctx.rotate(0.3);

  // Disc (ellipse — viewed from angle)
  ctx.save();
  ctx.rotate(S.toolAngle);
  ctx.scale(1, 0.5);
  const discGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
  discGrad.addColorStop(0, "#777");
  discGrad.addColorStop(0.5, "#555");
  discGrad.addColorStop(1, "#444");
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Heat glow
  if (S.heatGlow > 0.1) {
    const glow = ctx.createRadialGradient(0, 15, 0, 0, 15, 30);
    glow.addColorStop(0, `rgba(255, 150, 0, ${S.heatGlow * 0.5})`);
    glow.addColorStop(1, "rgba(255, 50, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 15, 30, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (S.isPressed) {
    S.cutProgress = Math.min(1, S.cutProgress + dt * 0.12);
    spawnParticles(toolX, surfaceY - 5, 2, false);
  }
}

// ═══════════════════════════════════════
// DRILLING MODE — top-down drill view
// ═══════════════════════════════════════
function drawDrilling(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, now: number,
  spawnParticles: (x: number, y: number, count: number, intense: boolean) => void
) {
  const cx = S.isPressed ? S.mouseX : W * 0.5;
  const cy = S.isPressed ? S.mouseY : H * 0.5;

  // ─── Material surface ───
  const matGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  matGrad.addColorStop(0, "#4a4a4a");
  matGrad.addColorStop(1, "#2a2a2a");
  ctx.fillStyle = matGrad;
  ctx.fillRect(W * 0.1, H * 0.2, W * 0.8, H * 0.65);

  // Surface texture
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  for (let i = 0; i < 20; i++) {
    const sx = W * 0.1 + Math.random() * W * 0.8;
    const sy = H * 0.2 + Math.random() * H * 0.65;
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy);
    ctx.lineTo(sx + 5, sy);
    ctx.stroke();
  }

  // ─── Drill hole (growing) ───
  if (S.cutProgress > 0.01) {
    const holeR = 5 + S.cutProgress * 20;
    const holeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, holeR);
    holeGrad.addColorStop(0, "#111");
    holeGrad.addColorStop(0.7, "#222");
    holeGrad.addColorStop(1, "#444");
    ctx.fillStyle = holeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
    ctx.fill();

    // Shaving spiral
    ctx.strokeStyle = `rgba(180, 160, 120, ${0.3 + S.cutProgress * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let a = 0; a < S.cutProgress * Math.PI * 6; a += 0.1) {
      const sr = holeR + a * 2;
      const sx = cx + Math.cos(a + S.toolAngle * 0.3) * sr;
      const sy = cy + Math.sin(a + S.toolAngle * 0.3) * sr;
      if (a === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // ─── Drill bit (from above) ───
  const toolX = cx + S.vibrationOffset;
  const toolY = cy;

  ctx.save();
  ctx.translate(toolX, toolY);
  ctx.rotate(S.toolAngle * 2);

  // Outer chuck
  ctx.fillStyle = "#555";
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Chuck jaws (3 segments)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.fillStyle = "#4a4a4a";
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 10, Math.sin(a) * 10, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drill bit center — flutes
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -8);
  ctx.lineTo(8, 8);
  ctx.moveTo(8, -8);
  ctx.lineTo(-8, 8);
  ctx.stroke();

  // Center point
  ctx.fillStyle = "#aaa";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();

  // Heat ring
  if (S.heatGlow > 0.1) {
    ctx.strokeStyle = `rgba(255, 150, 0, ${S.heatGlow * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  if (S.isPressed) {
    S.cutProgress = Math.min(1, S.cutProgress + dt * 0.1);
    spawnParticles(toolX + (Math.random() - 0.5) * 20, toolY + (Math.random() - 0.5) * 20, 1, false);
  }
}
